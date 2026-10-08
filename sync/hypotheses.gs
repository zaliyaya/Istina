// Общие гипотезы для сайта Истины (zaliyaya.github.io/Istina).
// Хранит список в первом листе таблицы «Гипотезы || Истина».
// Как подключить: в таблице «Расширения → Apps Script», вставить этот код,
// «Начать развёртывание → Новое развёртывание → Веб-приложение»,
// «Запуск от имени: я», «Доступ: все», скопировать адрес веб-приложения.
// Обновить код: вставить новый, «Начать развёртывание → Управление
// развёртываниями → карандаш → Версия: новая версия» — адрес не меняется.

// Колонки, которые сайт пишет всегда. Новые поля гипотез добавляются в
// таблицу сами — отдельной колонкой справа.
const BASE_COLUMNS = ['id', 'title', 'text', 'item', 'section', 'startWeek', 'created', 'status', 'note', 'updated'];

function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(BASE_COLUMNS);
  return sh;
}

function columns_(sh, extra) {
  const cols = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getDisplayValues()[0].filter(String);
  const missing = BASE_COLUMNS.concat(extra || []).filter(c => cols.indexOf(c) < 0);
  if (missing.length) {
    sh.getRange(1, cols.length + 1, 1, missing.length).setValues([missing]);
    cols.push.apply(cols, missing);
  }
  sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // даты и числа храним как текст
  return cols;
}

function list_() {
  const sh = sheet_();
  const cols = columns_(sh);
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, cols.length).getDisplayValues() : [];
  return rows.filter(r => r[0]).map(r => {
    const h = {};
    cols.forEach((c, i) => { h[c] = r[i]; });
    try { h.item = h.item ? JSON.parse(h.item) : null; } catch (e) { h.item = null; }
    return h;
  });
}

function rowOf_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, hypotheses: list_() });
}

// Тело запроса: {action: 'upsert', hypotheses: [...]} или {action: 'delete', id}
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const body = JSON.parse(e.postData.contents);
    const sh = sheet_();
    if (body.action === 'upsert') {
      const keys = [];
      for (const h of body.hypotheses || []) for (const k in h) if (keys.indexOf(k) < 0) keys.push(k);
      const cols = columns_(sh, keys);
      for (const h of body.hypotheses || []) {
        if (!h || !h.id) continue;
        const row = cols.map(c => c === 'item' ? (h.item ? JSON.stringify(h.item) : '')
          : c === 'updated' ? new Date().toISOString() : String(h[c] == null ? '' : h[c]));
        const at = rowOf_(sh, h.id);
        if (at) sh.getRange(at, 1, 1, cols.length).setValues([row]);
        else sh.appendRow(row);
      }
    } else if (body.action === 'delete') {
      const at = rowOf_(sh, body.id);
      if (at) sh.deleteRow(at);
    }
    return json_({ ok: true, hypotheses: list_() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
