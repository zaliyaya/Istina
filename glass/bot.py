"""Бот учёта боя посуды Истины.

Запускается по расписанию в GitHub Actions (.github/workflows/glass-bot.yml):
забирает новые сообщения из Telegram (getUpdates), находит сообщения о бое,
подсчёты и приход посуды, пишет их в glass/data.json и вшивает в index.html
(блок <script id="glass-data">), откуда их читает вкладка «Посуда».

  python glass/bot.py poll      забрать новые сообщения (нужен TELEGRAM_BOT_TOKEN)
  python glass/bot.py ack       подтвердить Telegram, что они сохранены (после пуша)
  python glass/bot.py embed     только перевшить data.json в index.html
  python glass/bot.py import FILE CHAT_ID   загрузить историю (выгрузка чата JSON)

Сотрудники пишут в чат как раньше: «Бой, дегустка, разбила при натирке».
Бот ставит 👌 на распознанное сообщение и отвечает, если не понял позицию.
Ещё понимает «Подсчёт посуды» (строки «Вилки 32») и «Приход, белый бокал, 12».
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from parse import ITEMS, parse, parse_count, parse_receipt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "glass", "data.json")
INDEX = os.path.join(ROOT, "index.html")
BLOCK = re.compile(r'(<script type="application/json" id="glass-data">)(.*?)(</script>)', re.S)
ACK_FILE = os.path.join(os.environ.get("RUNNER_TEMP") or os.path.join(ROOT, "glass"), "glass_ack.txt")
COUNT_HEAD =re.compile(r"^\s*(подсч[её]т|пересч[её]т|инвентаризац)", re.I)


def load():
    with open(DATA, encoding="utf-8") as f:
        return json.load(f)


def save(data):
    data["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(DATA, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")


def embed(data):
    """Вшивает данные в index.html: страница читает их при загрузке."""
    public = {k: data[k] for k in ("counts", "receipts", "events", "prices", "updated") if k in data}
    payload = json.dumps(public, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    with open(INDEX, encoding="utf-8") as f:
        html = f.read()
    if not BLOCK.search(html):
        raise SystemExit("в index.html нет блока glass-data")
    html = BLOCK.sub(lambda m: m.group(1) + payload + m.group(3), html, count=1)
    with open(INDEX, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)


def sender_name(msg):
    u = msg.get("from") or {}
    return " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x) or u.get("username") or "?"


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds")


def apply_message(data, chat_id, msg_id, date, who, text):
    """Учитывает одно сообщение (новое или отредактированное). Возвращает (тип, распознано ли)."""
    eid = f"{chat_id}:{msg_id}"
    for key in ("events", "counts", "receipts"):
        data[key] = [e for e in data[key] if e.get("id") != eid]
    if COUNT_HEAD.match(text):
        items, unknown = parse_count(text)
        if items:
            data["counts"].append({"id": eid, "date": date, "who": who, "items": items, "unknown": unknown})
            return "count", not unknown
    receipt = parse_receipt(text)
    if receipt:
        data["receipts"].append({"id": eid, "date": date, "who": who, "items": receipt, "text": text[:300]})
        return "receipt", True
    items = parse(text)
    if items:
        data["events"].append({"id": eid, "date": date, "who": who, "text": text[:300], "items": items})
        data["events"].sort(key=lambda e: e["date"])
        return "breakage", all(i["kind"] != "unknown" for i in items)
    return None, False


def tg(token, method, **params):
    body = urllib.parse.urlencode({k: json.dumps(v) if isinstance(v, (list, dict)) else v
                                   for k, v in params.items()}).encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=body)
    with urllib.request.urlopen(req, timeout=60) as r:
        res = json.loads(r.read())
    if not res.get("ok"):
        raise RuntimeError(f"{method}: {res}")
    return res["result"]


def poll():
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    only_chat = os.environ.get("GLASS_CHAT_ID", "").strip()
    data = load()
    before = json.dumps([data["counts"], data["receipts"], data["events"]], ensure_ascii=False)
    # Смещение не храним: Telegram сам держит неподтверждённые обновления до суток,
    # подтверждаем их в конце вызовом getUpdates с offset.
    updates = tg(token, "getUpdates", timeout=0, allowed_updates=["message", "edited_message"])
    names = ", ".join(sorted({n.lower() for n, kind, _ in ITEMS if kind != "other"}))
    for u in updates:
        msg = u.get("message") or u.get("edited_message")
        if not msg:
            continue
        chat = msg["chat"]
        if chat["type"] not in ("group", "supergroup"):
            continue
        if only_chat and str(chat["id"]) != only_chat:
            print("пропускаю чат", chat["id"], chat.get("title"))
            continue
        text = msg.get("text") or msg.get("caption") or ""
        kind, ok = apply_message(data, chat["id"], msg["message_id"], iso(msg["date"]), sender_name(msg), text)
        if not kind:
            continue
        print(kind, "ok" if ok else "НЕ ПОНЯЛ", chat.get("title"), repr(text[:80]))
        try:
            if ok:
                tg(token, "setMessageReaction", chat_id=chat["id"], message_id=msg["message_id"],
                   reaction=[{"type": "emoji", "emoji": "👌"}])
            elif "edited_message" not in u:
                if kind == "count":
                    unknown = data["counts"][-1]["unknown"]
                    text = (f"Подсчёт записала, но не узнала строки: {'; '.join(unknown)}. "
                            f"Позиции: {names}. Можно исправить это сообщение.")
                else:
                    text = ("Не поняла, что разбилось. Напишите, пожалуйста, так: «Бой, белый бокал, разбила при натирке». "
                            f"Позиции: {names}. Можно просто исправить это сообщение.")
                tg(token, "sendMessage", chat_id=chat["id"], reply_to_message_id=msg["message_id"], text=text)
        except Exception as e:  # реакция не критична
            print("не смогла ответить:", e)
    if json.dumps([data["counts"], data["receipts"], data["events"]], ensure_ascii=False) != before:
        save(data)
        embed(data)
    if updates:
        # подтверждаем отдельной командой ack после успешного пуша, чтобы не потерять сообщения
        with open(ACK_FILE, "w") as f:
            f.write(str(updates[-1]["update_id"] + 1))
    print(f"обновлений: {len(updates)}")


def ack():
    """Подтверждает Telegram, что обновления сохранены: больше он их не отдаст."""
    if not os.path.exists(ACK_FILE):
        return
    offset = int(open(ACK_FILE).read())
    tg(os.environ["TELEGRAM_BOT_TOKEN"], "getUpdates", offset=offset, limit=1, timeout=0)
    os.remove(ACK_FILE)


def import_history(path, chat_id):
    """Загружает историю: JSON-список {id, date, sender, text} (как отдаёт telegram-mcp)."""
    data = load()
    msgs = json.load(open(path, encoding="utf-8"))
    n = 0
    for m in msgs:
        who = re.sub(r"\s*\(@.*$", "", m.get("sender") or "?")
        date = datetime.fromisoformat(m["date"]).astimezone(timezone.utc).isoformat(timespec="seconds")
        kind, _ = apply_message(data, chat_id, m["id"], date, who, m.get("text") or "")
        n += kind == "breakage"
    save(data)
    embed(data)
    print("сообщений о бое:", n)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "poll"
    if cmd == "poll":
        poll()
    elif cmd == "ack":
        ack()
    elif cmd == "embed":
        embed(load())
    elif cmd == "import":
        import_history(sys.argv[2], int(sys.argv[3]))
    else:
        raise SystemExit(__doc__)
