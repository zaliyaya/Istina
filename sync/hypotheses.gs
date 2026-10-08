// Общие гипотезы для сайта Истины (zaliyaya.github.io/Istina).
// Хранит список в первом листе таблицы «Гипотезы || Истина».
// Как подключить: в таблице «Расширения → Apps Script», вставить этот код,
// «Начать развёртывание → Новое развёртывание → Веб-приложение»,
// «Запуск от имени: я», «Доступ: все», скопировать адрес веб-приложения.

const COLUMNS = ['id', 'title', 'text', 'item', 'section', 'startWeek', 'created', 'status', 'updated'];

function sheet_() {
  const sh = SpreadsheetApp.getActive().getSheets()[0];
  sh.getRange('A:I').setNumberFormat('@'); // даты и числа храним как текст
  if (sh.getLastRow() === 0) sh.appendRow(COLUMNS);
  return sh;
}

function list_() {
  const sh = sheet_();
  const rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, COLUMNS.length).getDisplayValues() : [];
  return rows.filter(r => r[0]).map(r => {
    const h = {};
    COLUMNS.forEach((c, i) => { h[c] = r[i]; });
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
      for (const h of body.hypotheses || []) {
        if (!h || !h.id) continue;
        const row = COLUMNS.map(c => c === 'item' ? (h.item ? JSON.stringify(h.item) : '')
          : c === 'updated' ? new Date().toISOString() : String(h[c] == null ? '' : h[c]));
        const at = rowOf_(sh, h.id);
        if (at) sh.getRange(at, 1, 1, COLUMNS.length).setValues([row]);
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
