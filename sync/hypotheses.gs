// Общие гипотезы для сайта Истины (zaliyaya.github.io/Istina).
// Хранит гипотезы в таблице «Гипотезы || Истина» на двух листах:
// «В работе» — принятые (в работе, подтвердилась, не подтвердилась) с
// обратной связью, «Отклонённые» — с которыми не согласны, с причиной.
// При смене статуса строка сама переезжает между листами.
// Как подключить: в таблице «Расширения → Apps Script», вставить этот код,
// «Начать развёртывание → Новое развёртывание → Веб-приложение»,
// «Запуск от имени: я», «Доступ: все», скопировать адрес веб-приложения.
// Обновить код: вставить новый, «Начать развёртывание → Управление
// развёртываниями → карандаш → Версия: новая версия» — адрес не меняется.

// Колонки ищутся по заголовку, поэтому их можно переставлять и добавлять
// свои — скрипт их не трогает. id и item служебные, они скрыты.
const SHEETS = {
  work: {
    name: 'В работе',
    cols: [['title', 'Гипотеза'], ['text', 'Описание'], ['section', 'Раздел'], ['status', 'Статус'],
      ['note', 'Обратная связь'], ['startWeek', 'Эффект считаем с'], ['created', 'Добавлена'],
      ['updated', 'Обновлена'], ['id', 'id'], ['item', 'item']],
  },
  rejected: {
    name: 'Отклонённые',
    cols: [['title', 'Гипотеза'], ['note', 'Причина отказа'], ['text', 'Описание'], ['section', 'Раздел'],
      ['created', 'Добавлена'], ['updated', 'Обновлена'], ['startWeek', 'Эффект считаем с'],
      ['id', 'id'], ['item', 'item']],
  },
};
const HIDDEN = ['id', 'item'];
const SECTION_LABEL = { '': 'Всё заведение', kitchen: 'Кухня', bar: 'Бар' };
const STATUS_LABEL = { active: 'В работе', yes: 'Подтвердилась', no: 'Не подтвердилась', rejected: 'Не согласны' };

function invert_(o) { const r = {}; for (const k in o) r[o[k]] = k; return r; }
const SECTION_KEY = invert_(SECTION_LABEL);
const STATUS_KEY = invert_(STATUS_LABEL);

function toCell_(key, h) {
  const v = h[key];
  if (key === 'item') return v ? JSON.stringify(v) : '';
  if (key === 'section') return SECTION_LABEL[v || ''] || String(v);
  if (key === 'status') return STATUS_LABEL[v || 'active'] || String(v);
  if (key === 'updated') return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  return String(v == null ? '' : v);
}

function fromCell_(key, v) {
  if (key === 'item') { try { return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  if (key === 'section') return v in SECTION_KEY ? SECTION_KEY[v] : v;
  if (key === 'status') return v in STATUS_KEY ? STATUS_KEY[v] : (v || 'active');
  return v;
}

// Лист и номера колонок по ключам. Недостающие колонки дописываются справа.
function sheet_(kind) {
  const spec = SHEETS[kind];
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(spec.name);
  const fresh = !sh;
  if (!sh) sh = ss.insertSheet(spec.name);
  const head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0] : [];
  const missing = spec.cols.filter(c => head.indexOf(c[1]) < 0);
  if (missing.length) {
    let at = head.length;
    while (at > 0 && !head[at - 1]) at--;
    sh.getRange(1, at + 1, 1, missing.length).setValues([missing.map(c => c[1])]).setFontWeight('bold');
    missing.forEach(c => { head[at++] = c[1]; });
  }
  const idx = {};
  spec.cols.forEach(c => { idx[c[0]] = head.indexOf(c[1]) + 1; });
  if (fresh || missing.length) {
    sh.setFrozenRows(1);
    spec.cols.forEach(c => {
      const col = idx[c[0]];
      sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@'); // даты и числа храним как текст
      if (HIDDEN.indexOf(c[0]) >= 0) sh.hideColumns(col);
      else if (c[0] === 'title' || c[0] === 'text' || c[0] === 'note') sh.setColumnWidth(col, 320);
    });
  }
  return { sh, idx, kind, width: Math.max(sh.getLastColumn(), 1) };
}

function rows_(t) {
  const n = t.sh.getLastRow() - 1;
  return n > 0 ? t.sh.getRange(2, 1, n, t.width).getDisplayValues() : [];
}

function rowOf_(t, id) {
  const rows = rows_(t);
  for (let i = 0; i < rows.length; i++) if (rows[i][t.idx.id - 1] === id) return i + 2;
  return 0;
}

function read_(t) {
  return rows_(t).filter(r => r[t.idx.id - 1]).map(r => {
    const h = {};
    SHEETS[t.kind].cols.forEach(c => { h[c[0]] = fromCell_(c[0], r[t.idx[c[0]] - 1]); });
    if (t.kind === 'rejected') h.status = 'rejected';
    return h;
  });
}

function write_(t, h) {
  let at = rowOf_(t, h.id);
  if (!at) {
    at = t.sh.getLastRow() + 1;
    if (at > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 100);
  }
  // Пишем только свои колонки: добавленные в таблице руками не трогаем
  SHEETS[t.kind].cols.forEach(c => {
    t.sh.getRange(at, t.idx[c[0]]).setNumberFormat('@').setValue(toCell_(c[0], h));
  });
}

function remove_(t, id) {
  const at = rowOf_(t, id);
  if (at) t.sh.deleteRow(at);
}

// Раньше всё лежало одним списком на первом листе с заголовком «id» в A1.
// Переносим такие строки на новые листы, старый лист удаляем.
function migrate_(work, rejected) {
  const ours = [SHEETS.work.name, SHEETS.rejected.name];
  SpreadsheetApp.getActive().getSheets().forEach(sh => {
    if (ours.indexOf(sh.getName()) >= 0 || sh.getLastRow() < 1 || sh.getRange(1, 1).getDisplayValue() !== 'id') return;
    const data = sh.getDataRange().getDisplayValues();
    const head = data.shift();
    data.filter(r => r[0]).forEach(r => {
      const h = {};
      head.forEach((k, i) => { h[k] = r[i]; });
      try { h.item = h.item ? JSON.parse(h.item) : null; } catch (e) { h.item = null; }
      write_(h.status === 'rejected' ? rejected : work, h);
    });
    SpreadsheetApp.getActive().deleteSheet(sh);
    work.sh.activate();
    SpreadsheetApp.getActive().moveActiveSheet(1);
  });
}

function tables_() {
  const work = sheet_('work');
  const rejected = sheet_('rejected');
  migrate_(work, rejected);
  return { work, rejected };
}

function list_(t) {
  return read_(t.work).concat(read_(t.rejected))
    .sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1));
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return json_({ ok: true, hypotheses: list_(tables_()) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Тело запроса: {action: 'upsert', hypotheses: [...]} или {action: 'delete', id}
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const t = tables_();
    if (body.action === 'upsert') {
      for (const h of body.hypotheses || []) {
        if (!h || !h.id) continue;
        const to = h.status === 'rejected' ? t.rejected : t.work;
        remove_(to === t.work ? t.rejected : t.work, h.id);
        write_(to, h);
      }
    } else if (body.action === 'delete') {
      remove_(t.work, body.id);
      remove_(t.rejected, body.id);
    }
    return json_({ ok: true, hypotheses: list_(t) });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
