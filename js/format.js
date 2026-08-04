// Форматирование чисел и дат (ru-RU)

const full = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('ru-RU', {
  notation: 'compact',
  maximumSignificantDigits: 3,
})
const pct = new Intl.NumberFormat('ru-RU', {
  style: 'percent',
  maximumFractionDigits: 1,
  signDisplay: 'always',
})

export function fmtFull(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return full.format(v)
}

export function fmtCompact(v) {
  if (v == null || Number.isNaN(v)) return '—'
  if (Math.abs(v) < 10000) return full.format(v)
  return compact.format(v)
}

export function fmtDelta(v) {
  if (v == null || !Number.isFinite(v)) return null
  return pct.format(v)
}

const dayShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const dayYear = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })
const monthShort = new Intl.DateTimeFormat('ru-RU', { month: 'short', year: 'numeric' })
const dayLong = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const monthLong = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

// подпись деления оси X по единице бакета
export function fmtTick(date, unit, withYear = false) {
  if (unit === 'year') return String(date.getFullYear())
  if (unit === 'month') return monthShort.format(date)
  return withYear ? dayYear.format(date) : dayShort.format(date)
}

// заголовок тултипа
export function fmtBucket(date, unit) {
  if (unit === 'year') return String(date.getFullYear())
  if (unit === 'month') return monthLong.format(date)
  if (unit === 'week') return 'нед. с ' + dayLong.format(date)
  return dayLong.format(date)
}

// значение-дата в таблице
export function fmtCell(v, type) {
  if (v == null || v === '') return ''
  if (v instanceof Date) {
    return type === 'datetime' ? dateTime.format(v) : dateOnly.format(v)
  }
  if (typeof v === 'number') return full.format(v)
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет'
  return String(v)
}
