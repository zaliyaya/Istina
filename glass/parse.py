"""Разбор сообщений о бое посуды из рабочего чата Истины.

Формат, который просят писать сотрудников: «Бой, <позиция>, <причина>».
На деле пишут вольно: «Бой красного бокала, разбила при натирке»,
«Бой, три дегустационных бокала. Упали с подставки на мойке»,
«Дегустка, бой, при натирке», несколько строк «Бой, …» в одном сообщении.
"""
import re

# Канонические позиции (как в подсчёте посуды) и как их называют в чате.
# Порядок важен: более длинные/точные шаблоны раньше.
ITEMS = [
    ("Бокал для красного", "glass", r"красн\w*|для\s+красного"),
    ("Бокал для белого", "glass", r"бел\w*|для\s+белого"),
    ("Дегустационный бокал", "glass", r"дегуст\w*"),
    ("Хайбол", "glass", r"хайбол\w*"),
    ("Флюте", "glass", r"флют\w*|флоте"),
    ("Шале", "glass", r"шале\w*"),
    ("Креманка", "glass", r"креман\w*"),
    ("Тюльпан", "glass", r"тюльпан\w*"),
    ("Коньячный бокал", "glass", r"коньяч\w*|снифтер\w*"),
    ("Рокс", "glass", r"рокс\w*|олд\s*фе\w*"),
    ("Водник", "glass", r"водник\w*|рюмк\w*|стопк\w*"),
    ("Чайная ложка", "cutlery", r"чайн\w*\s+ложк\w*|ложк\w*\s+чайн\w*"),
    ("Десертная ложка", "cutlery", r"дес\w*\.?\s+ложк\w*|ложк\w*\s+дес\w*"),
    ("Суповая ложка", "cutlery", r"суп\w*\s+ложк\w*|ложк\w*\s+суп\w*|больш\w*\s+ложк\w*"),
    ("Вилка", "cutlery", r"вилк\w*|вилок"),
    # «нож(?!к)»: не путать с «ножка» (лопнула ножка бокала)
    ("Стейковый нож", "cutlery", r"стейк\w*\s+нож(?!к)\w*|нож(?!к)\w*\s+стейк\w*"),
    ("Столовый нож", "cutlery", r"столов\w*\s+нож(?!к)\w*|нож(?!к)\w*\s+столов\w*|гладк\w*\s+нож(?!к)\w*|нож(?!к)\w*"),
    # не входят в подсчёт, но бьются: учитываем в аналитике
    ("Арендованный бокал", "other", r"арендован\w*"),
    ("Аперольный бокал", "other", r"аперол\w*"),
    ("Графин", "other", r"графин\w*"),
    ("Чашка", "other", r"чашк\w*"),
    ("Чайник", "other", r"чайник\w*"),
    ("Мерник", "other", r"мерник\w*"),
    ("Айриш", "other", r"айриш\w*"),
]
ITEM_RE = [(name, kind, re.compile(r"(?<![а-яё])(?:" + pat + r")", re.I)) for name, kind, pat in ITEMS]

NUM_WORDS = {
    "один": 1, "одна": 1, "одну": 1, "одного": 1, "два": 2, "две": 2, "двух": 2, "пара": 2,
    "три": 3, "трёх": 3, "трех": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7,
    "восемь": 8, "девять": 9, "десять": 10,
}
QTY_BEFORE = re.compile(r"(\d+|" + "|".join(NUM_WORDS) + r")\s*(?:шт\.?\s*)?(?:[а-яё]+\s+)?$", re.I)
QTY_AFTER = re.compile(r"^\s*[-–]?\s*(\d+)\s*(?:шт|штук)", re.I)

# Причины: первая подходящая по порядку
REASONS = [
    ("Техперсонал", r"тех\.?\s*перс\w*|барбек\w*"),
    ("Гости", r"гост\w*"),
    ("Натирка", r"натир\w*"),
    ("Мойка", r"мойк\w*|раковин\w*|подставк\w*"),
    ("Скол / трещина", r"скол\w*|трещин\w*|треснул\w*|лопнул\w*|ножк\w*"),
    ("Уронили / случайно", r"уронил\w*|упал\w*|случайн\w*|разбил\w*|разбит\w*|уничтож\w*|несчастн\w*"),
]
REASON_RE = [(name, re.compile(pat, re.I)) for name, pat in REASONS]

BOY = re.compile(r"(?<![а-яё])бой(?![а-яё])", re.I)


def is_breakage(text):
    """Сообщение о бое: слово «бой» среди первых слов."""
    head = " ".join(re.findall(r"[а-яё]+", (text or "").lower())[:3])
    return bool(BOY.search(head))


def classify_reason(text):
    for name, rx in REASON_RE:
        if rx.search(text):
            return name
    return "Не указана"


def _segments(text):
    """Делит сообщение на куски по строкам, начинающимся с «бой»."""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    segs = []
    for l in lines:
        if BOY.match(l) or not segs:
            segs.append(l)
        else:
            segs[-1] += " " + l
    return segs


def parse_segment(seg):
    low = seg.lower().replace("ё", "е")
    body = BOY.sub(" ", low, count=1)
    found = []  # (start, end, name, kind)
    for name, kind, rx in ITEM_RE:
        for m in rx.finditer(body):
            if any(m.start() < e and s < m.end() for s, e, *_ in found):
                continue
            found.append((m.start(), m.end(), name, kind))
    found.sort()
    items = []
    for s, e, name, kind in found:
        qty = 1
        mb = QTY_BEFORE.search(body[max(0, s - 20):s])
        ma = QTY_AFTER.search(body[e:e + 12])
        tok = (mb or ma)
        if tok:
            v = tok.group(1)
            qty = int(v) if v.isdigit() else NUM_WORDS.get(v, 1)
        if items and items[-1]["item"] == name:
            continue
        items.append({"item": name, "kind": kind, "qty": qty})
    # причина — текст без названий позиций
    rest = body
    for s, e, *_ in sorted(found, reverse=True):
        rest = rest[:s] + " " + rest[e:]
    reason_text = re.sub(r"^[\s,.:;–-]+|[\s,.:;–-]+$", "", re.sub(r"\s+", " ", re.sub(r"\b(бокал\w*|бой)\b", " ", rest)))
    return items, classify_reason(rest), reason_text


def parse(text):
    """Возвращает список {item, kind, qty, reason, reason_text}. Пусто, если не про бой."""
    if not is_breakage(text):
        return []
    out = []
    segs = _segments(text)
    # «Бой, флюте / Бой, белый бокал / Оба разбила техперс»: общая причина в конце
    parsed = [parse_segment(s) for s in segs]
    common = next((r for _, r, _ in reversed(parsed) if r != "Не указана"), "Не указана")
    common_text = next((t for _, r, t in reversed(parsed) if r != "Не указана"), "")
    for items, reason, rtext in parsed:
        if not items:
            continue
        if reason == "Не указана":
            reason, rtext = common, common_text
        for it in items:
            out.append({**it, "reason": reason, "reason_text": rtext})
    if not out:
        out.append({"item": "Не распознано", "kind": "unknown", "qty": 1,
                    "reason": parsed[0][1] if parsed else "Не указана", "reason_text": text.strip()[:120]})
    return out


# Подсчёт посуды: строки «3 красных бокала» или «Вилки 32»
COUNT_LINE = re.compile(r"^\s*(?:(\d+)\s+(.+?)|(.+?)[\s:–-]+(\d+))\s*(?:шт\.?)?\s*$", re.I)


def parse_count(text):
    """«Подсчёт посуды»: {позиция: количество}. Нераспознанные строки — в unknown."""
    res, unknown = {}, []
    for line in text.splitlines()[1:]:
        m = COUNT_LINE.match(line)
        if not m:
            continue
        qty = int(m.group(1) or m.group(4))
        label = (m.group(2) or m.group(3)).lower().replace("ё", "е")
        name = next((n for n, _, rx in ITEM_RE if rx.search(label)), None)
        if name:
            res[name] = res.get(name, 0) + qty
        else:
            unknown.append(line.strip())
    return res, unknown


def parse_receipt(text):
    """«Приход, красный бокал, 12» — пополнение."""
    low = text.lower()
    if not re.match(r"\s*приход\b", low):
        return []
    out = []
    for line in text.splitlines():
        items, _, _ = parse_segment(re.sub(r"(?i)приход", " ", line))
        nums = re.findall(r"\d+", line)
        for it in items:
            out.append({"item": it["item"], "kind": it["kind"], "qty": int(nums[-1]) if nums else it["qty"]})
    return out
