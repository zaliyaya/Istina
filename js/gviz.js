// Загрузка данных Google Sheets через публичный gviz-эндпоинт.
// Работает для таблиц с доступом «все, у кого есть ссылка» — без API-ключей.

import { inferTable } from './fileLoad.js'

const SHEET_ID_RE = /\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/
const GVIZ_DATE_RE = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?/

export function parseSheetUrl(input) {
  const s = String(input || '').trim()
  if (!s) return null
  let id = null
  const m = s.match(SHEET_ID_RE)
  if (m) id = m[1]
  else if (/^[a-zA-Z0-9-_]{25,}$/.test(s)) id = s // вставили голый ID
  if (!id) return null
  const gidMatch = s.match(/[#?&]gid=(\d+)/)
  return { id, gid: gidMatch ? gidMatch[1] : null }
}

export function sheetLink({ id, gid }) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit${gid ? '#gid=' + gid : ''}`
}

export async function fetchSheet({ id, gid }) {
  const params = new URLSearchParams({ tqx: 'out:json' })
  if (gid != null) params.set('gid', gid)
  const url = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?${params}`

  let res
  try {
    res = await fetch(url, { redirect: 'follow' })
  } catch {
    // закрытая таблица уводит на страницу логина Google — fetch падает на CORS
    throw new Error('ACCESS')
  }
  if (!res.ok) throw new Error(res.status === 404 ? 'NOT_FOUND' : 'ACCESS')

  const text = await res.text()
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start === -1 || end <= start) throw new Error('ACCESS')

  let payload
  try {
    payload = JSON.parse(text.slice(start + 1, end))
  } catch {
    throw new Error('PARSE')
  }
  if (payload.status === 'error') {
    const e = payload.errors && payload.errors[0]
    throw new Error('GVIZ:' + ((e && (e.detailed_message || e.message)) || 'unknown'))
  }
  return normalizeTable(payload.table)
}

function parseValue(cell, type) {
  if (!cell || cell.v == null) return null
  const v = cell.v
  if (type === 'date' || type === 'datetime') {
    if (typeof v === 'string') {
      const m = v.match(GVIZ_DATE_RE)
      if (m) {
        return new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
      }
    }
    return null
  }
  if (type === 'timeofday') return cell.f != null ? cell.f : String(v)
  return v
}

// Приводим gviz-таблицу к { cols: [{key,label,type}], rows: [[...]] }.
// Затем прогоняем через общий вывод типов (inferTable): у листов без
// закреплённого заголовка gviz типизирует все колонки как string, и числа
// с датами нужно распознавать заново — тем же кодом, что и для файлов.
function normalizeTable(table) {
  const rawCols = table.cols || []
  let rows = (table.rows || []).map((r) =>
    rawCols.map((c, i) => parseValue(r.c && r.c[i], c.type)),
  )

  let labels = rawCols.map((c) => (c.label || '').trim())

  // Если у листа нет закреплённой строки заголовка, gviz отдаёт пустые label,
  // а заголовки лежат первой строкой данных.
  if (labels.every((l) => !l) && rows.length > 0) {
    const first = rows[0]
    const looksLikeHeader = first.every((v) => v == null || typeof v === 'string')
    if (looksLikeHeader) {
      labels = first.map((v, i) => (v ? String(v).trim() : rawCols[i].id || `Колонка ${i + 1}`))
      rows = rows.slice(1)
    }
  }
  labels = labels.map((l, i) => l || rawCols[i].id || `Колонка ${i + 1}`)

  return inferTable([labels, ...rows])
}

export function errorMessage(err) {
  const msg = err && err.message ? err.message : String(err)
  if (msg === 'ACCESS') {
    // при открытии страницы с диска браузер может резать запрос ещё до Google
    const local = typeof location !== 'undefined' && location.protocol === 'file:'
    return (
      'Не удалось получить данные. Проверьте, что доступ к таблице открыт: Файл → Настройки доступа → «Все, у кого есть ссылка» → Читатель.' +
      (local
        ? ' Страница открыта как локальный файл — если доступ уже открыт, браузер мог заблокировать запрос: положите файлы на любой хостинг или скачайте таблицу в CSV и перетащите сюда.'
        : '')
    )
  }
  if (msg === 'NOT_FOUND') return 'Таблица не найдена — проверьте ссылку.'
  if (msg === 'PARSE') return 'Не удалось разобрать ответ Google Sheets.'
  if (msg.startsWith('GVIZ:')) return 'Google Sheets вернул ошибку: ' + msg.slice(5)
  return 'Ошибка загрузки: ' + msg
}
