// Загрузка локальных файлов: CSV / TSV / XLSX → та же нормализованная таблица,
// что и у gviz: { cols: [{key,label,type}], rows: [[...]] }

// Модуль Excel тянется с CDN и только когда действительно нужен:
// для CSV/TSV страница не грузит ни байта лишнего.
const XLSX_CDN = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs'

export async function loadFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    let XLSX
    try {
      XLSX = await import(XLSX_CDN)
    } catch {
      throw new Error('XLSX_CDN')
    }
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
    return inferTable(grid)
  }
  const text = await file.text()
  return inferTable(parseCsv(text))
}

// ---------- CSV (RFC 4180 + автоопределение разделителя) ----------

function detectDelimiter(text) {
  const head = text.slice(0, 4000)
  const counts = [',', ';', '\t'].map((d) => ({
    d,
    n: (head.match(new RegExp(d === '\t' ? '\t' : '\\' + d, 'g')) || []).length,
  }))
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

export function parseCsv(text) {
  const delim = detectDelimiter(text)
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// ---------- вывод типов ----------

const BOOL_MAP = {
  true: true, false: false, да: true, нет: false, yes: true, no: false,
  истина: true, ложь: false,
}

function tryNumber(s) {
  let t = s.trim().replace(/[\s ]/g, '').replace(/[₽$€%]/g, '')
  if (!t || !/\d/.test(t)) return null
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '')
  else t = t.replace(',', '.')
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const DATE_RES = [
  // ISO: 2026-08-03 или 2026-08-03T12:30(:00)
  { re: /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?$/, y: 1, m: 2, d: 3, h: 4, min: 5 },
  // 03.08.2026 или 03/08/2026 (+ время)
  { re: /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/, y: 3, m: 2, d: 1, h: 4, min: 5 },
]

function tryDate(s) {
  const t = s.trim()
  for (const { re, y, m, d, h, min } of DATE_RES) {
    const g = t.match(re)
    if (!g) continue
    const date = new Date(+g[y], +g[m] - 1, +g[d], +(g[h] || 0), +(g[min] || 0))
    if (date.getMonth() !== +g[m] - 1 || date.getDate() !== +g[d]) return null
    return { date, hasTime: g[h] != null }
  }
  return null
}

// grid: массив массивов (строки как из CSV/XLSX) → нормализованная таблица
export function inferTable(grid) {
  const rows0 = grid.filter((r) => r && r.some((v) => v != null && String(v).trim() !== ''))
  if (rows0.length === 0) return { cols: [], rows: [] }

  const width = Math.max(...rows0.map((r) => r.length))
  const header = rows0[0].map((v, i) => {
    const s = v == null ? '' : String(v).trim()
    return s || `Колонка ${i + 1}`
  })
  const body = rows0.slice(1).map((r) => {
    const out = new Array(width).fill(null)
    for (let i = 0; i < width; i++) {
      const v = r[i]
      out[i] = v == null || v === '' ? null : v
    }
    return out
  })

  const cols = []
  const colTotals = []
  for (let i = 0; i < width; i++) {
    const stats = { number: 0, date: 0, datetime: 0, boolean: 0, string: 0, total: 0 }
    for (const r of body) {
      const v = r[i]
      if (v == null) continue
      stats.total++
      if (typeof v === 'number') stats.number++
      else if (v instanceof Date) {
        stats.date++
        if (v.getHours() || v.getMinutes()) stats.datetime++
      } else if (typeof v === 'boolean') stats.boolean++
      else {
        const s = String(v)
        const d = tryDate(s)
        if (d) {
          stats.date++
          if (d.hasTime) stats.datetime++
        } else if (tryNumber(s) != null) stats.number++
        else if (BOOL_MAP[s.trim().toLowerCase()] !== undefined) stats.boolean++
        else stats.string++
      }
    }
    const t = stats.total || 1
    let type = 'string'
    if (stats.date / t >= 0.9) type = stats.datetime > 0 ? 'datetime' : 'date'
    else if (stats.number / t >= 0.9) type = 'number'
    else if (stats.boolean / t >= 0.9) type = 'boolean'
    cols.push({ key: 'col' + i, label: header[i] || `Колонка ${i + 1}`, type })
    colTotals.push(stats.total)
  }

  const rows = body.map((r) =>
    r.map((v, i) => {
      if (v == null) return null
      const type = cols[i].type
      if (type === 'number') {
        if (typeof v === 'number') return v
        return tryNumber(String(v))
      }
      if (type === 'date' || type === 'datetime') {
        if (v instanceof Date) return v
        const d = tryDate(String(v))
        return d ? d.date : null
      }
      if (type === 'boolean') {
        if (typeof v === 'boolean') return v
        const b = BOOL_MAP[String(v).trim().toLowerCase()]
        return b === undefined ? null : b
      }
      if (v instanceof Date) return v
      return String(v)
    }),
  )

  // полностью пустые колонки (частый хвост из Google Sheets) не несут данных
  const keep = cols.map((_, i) => i).filter((i) => colTotals[i] > 0)
  if (keep.length > 0 && keep.length < cols.length) {
    return {
      cols: keep.map((i, j) => ({ ...cols[i], key: 'col' + j })),
      rows: rows.map((r) => keep.map((i) => r[i])),
    }
  }
  return { cols, rows }
}
