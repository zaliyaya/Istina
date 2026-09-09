// Подмена библиотеки SheetJS: тот же вызов XLSX.read / sheet_to_json,
// но читаем файл сами и синхронно — без интернета и без CDN.
// Реализация распаковки и разбора XML лежит в xlsxread.js.

;(function () {
  'use strict'

  function readSync(data) {
    const buffer =
      data instanceof ArrayBuffer
        ? data
        : data.buffer
          ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
          : data
    const sheets = window.__readXlsxSync(buffer)
    const out = { SheetNames: [], Sheets: {} }
    for (const sheet of sheets) {
      out.SheetNames.push(sheet.name)
      out.Sheets[sheet.name] = { __rows: sheet.rows }
    }
    return out
  }

  function sheetToJson(ws, opts) {
    const defval = opts && 'defval' in opts ? opts.defval : undefined
    const rows = (ws && ws.__rows) || []
    const width = rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0)
    return rows.map((row) => {
      const r = row || []
      const out = new Array(width)
      for (let i = 0; i < width; i++) {
        const v = r[i]
        out[i] = v === undefined || v === null ? defval : v
      }
      return out
    })
  }

  window.XLSX = { read: readSync, utils: { sheet_to_json: sheetToJson } }
})()
