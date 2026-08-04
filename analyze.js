// Анализ таблицы: классификация колонок, фильтры, бакеты времени, агрегаты.

export const COUNT_KEY = '__count'

// ---------- классификация колонок ----------

export function analyzeTable(table) {
  const { cols, rows } = table
  const n = rows.length

  const columns = cols.map((c, i) => {
    const meta = { ...c, index: i }
    if (c.type === 'number') {
      meta.kind = 'measure'
    } else if (c.type === 'date' || c.type === 'datetime') {
      meta.kind = 'time'
    } else {
      const uniq = new Set()
      for (const r of rows) {
        const v = r[i]
        if (v == null || v === '') continue
        uniq.add(typeof v === 'boolean' ? (v ? 'Да' : 'Нет') : String(v))
        if (uniq.size > 40) break
      }
      const limit = Math.min(40, Math.max(2, Math.ceil(n * 0.6)))
      meta.kind = uniq.size >= 2 && uniq.size <= limit ? 'category' : 'text'
      meta.uniqueCount = uniq.size
    }
    return meta
  })

  const timeCol = columns.find((c) => c.kind === 'time') || null

  // измерения: «количество записей» всегда первым, затем числовые колонки
  const measures = [
    { key: COUNT_KEY, label: 'Записей', col: -1 },
    ...columns
      .filter((c) => c.kind === 'measure')
      .map((c) => ({ key: c.key, label: c.label, col: c.index })),
  ]

  const categoryCols = columns
    .filter((c) => c.kind === 'category')
    .sort((a, b) => a.uniqueCount - b.uniqueCount)

  return { columns, timeCol, measures, categoryCols }
}

export function categoryValue(v) {
  if (v == null || v === '') return '(пусто)'
  if (typeof v === 'boolean') return v ? 'Да' : 'Нет'
  return String(v)
}

export function uniqueValues(rows, colIndex, cap = 200) {
  const set = new Set()
  for (const r of rows) {
    set.add(categoryValue(r[colIndex]))
    if (set.size > cap) break
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ru'))
}

// ---------- фильтры ----------

// filters: { from: Date|null, to: Date|null, cats: { [colIndex]: value|null } }
export function applyFilters(rows, timeCol, filters) {
  const { from, to, cats } = filters
  const catEntries = Object.entries(cats).filter(([, v]) => v != null && v !== '')
  if (!from && !to && catEntries.length === 0) return rows

  return rows.filter((r) => {
    if (timeCol && (from || to)) {
      const d = r[timeCol.index]
      if (!(d instanceof Date)) return false
      if (from && d < from) return false
      if (to && d > to) return false
    }
    for (const [idx, val] of catEntries) {
      if (categoryValue(r[+idx]) !== val) return false
    }
    return true
  })
}

// ---------- бакеты времени ----------

export function dateExtent(rows, timeIdx) {
  let min = null
  let max = null
  for (const r of rows) {
    const d = r[timeIdx]
    if (!(d instanceof Date)) continue
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  return min && max ? [min, max] : null
}

// единица бакета: чтобы точек было не больше ~60
export function chooseUnit(min, max) {
  const days = (max - min) / 86400000
  if (days <= 62) return 'day'
  if (days <= 430) return 'week'
  if (days <= 1850) return 'month'
  return 'year'
}

export function unitLabel(unit) {
  return { day: 'дню', week: 'неделе', month: 'месяцу', year: 'году' }[unit]
}

export function unitLabelAgg(unit) {
  return { day: 'по дням', week: 'по неделям', month: 'по месяцам', year: 'по годам' }[unit]
}

export function bucketStart(d, unit) {
  if (unit === 'year') return new Date(d.getFullYear(), 0, 1)
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth(), 1)
  if (unit === 'week') {
    const day = (d.getDay() + 6) % 7 // понедельник — начало недели
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day)
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function nextBucket(d, unit) {
  if (unit === 'year') return new Date(d.getFullYear() + 1, 0, 1)
  if (unit === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const days = unit === 'week' ? 7 : 1
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
}

// Временной ряд: сумма каждого измерения по бакетам, пустые бакеты = 0
export function buildTimeline(rows, timeIdx, measures, unit) {
  const map = new Map()
  for (const r of rows) {
    const d = r[timeIdx]
    if (!(d instanceof Date)) continue
    const t = bucketStart(d, unit).getTime()
    let b = map.get(t)
    if (!b) {
      b = { t, values: {} }
      for (const m of measures) b.values[m.key] = 0
      map.set(t, b)
    }
    for (const m of measures) {
      if (m.col === -1) b.values[m.key] += 1
      else if (typeof r[m.col] === 'number') b.values[m.key] += r[m.col]
    }
  }
  if (map.size === 0) return []

  const times = [...map.keys()].sort((a, b) => a - b)
  const out = []
  let cur = new Date(times[0])
  const last = times[times.length - 1]
  while (cur.getTime() <= last) {
    const t = cur.getTime()
    const b = map.get(t)
    if (b) out.push(b)
    else {
      const empty = { t, values: {} }
      for (const m of measures) empty.values[m.key] = 0
      out.push(empty)
    }
    cur = nextBucket(cur, unit)
    if (out.length > 1000) break // защита от битых дат
  }
  return out
}

// Неполные крайние бакеты (неделя/месяц/год, захваченные данными частично)
// занижают края линии и искажают дельту KPI — обрезаем их из динамики.
export function trimPartialEdges(timeline, unit, ext) {
  if (!ext || unit === 'day' || timeline.length < 3) return timeline
  const [min, max] = ext
  const dayOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  let out = timeline
  if (dayOf(min) !== bucketStart(min, unit).getTime()) out = out.slice(1)
  const lastDay = nextBucket(bucketStart(max, unit), unit).getTime() - 86400000
  if (dayOf(max) < lastDay) out = out.slice(0, -1)
  return out.length >= 2 ? out : timeline
}

// ---------- агрегаты ----------

export function measureValue(row, measure) {
  if (measure.col === -1) return 1
  const v = row[measure.col]
  return typeof v === 'number' ? v : 0
}

// Сумма измерения по категориям: топ-N + «Прочее»
export function aggregateByCategory(rows, catIdx, measure, topN = 10) {
  const totals = new Map()
  for (const r of rows) {
    const key = categoryValue(r[catIdx])
    totals.set(key, (totals.get(key) || 0) + measureValue(r, measure))
  }
  const sorted = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (sorted.length <= topN) {
    return sorted.map(([label, value]) => ({ label, value }))
  }
  const head = sorted.slice(0, topN).map(([label, value]) => ({ label, value }))
  const rest = sorted.slice(topN).reduce((s, [, v]) => s + v, 0)
  head.push({ label: 'Прочее', value: rest, other: true })
  return head
}

// Стабильная раскраска категорий: слоты по полному (нефильтрованному) набору,
// чтобы фильтры не перекрашивали выживших. Максимум 5 цветных + «Прочее».
export function categorySlots(allRows, catIdx, measure, maxSlots = 5) {
  const totals = new Map()
  for (const r of allRows) {
    const key = categoryValue(r[catIdx])
    totals.set(key, (totals.get(key) || 0) + measureValue(r, measure))
  }
  const sorted = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const slots = new Map()
  sorted.slice(0, maxSlots).forEach(([label], i) => slots.set(label, i + 1)) // series-1..5
  return slots
}

// Ряды «измерение по времени, разбитое по категории» для слотов + «Прочее»
export function timelineByCategory(rows, timeIdx, catIdx, measure, unit, slots) {
  const seriesMap = new Map() // label -> Map<t, sum>
  const bucketSet = new Set()
  for (const r of rows) {
    const d = r[timeIdx]
    if (!(d instanceof Date)) continue
    const t = bucketStart(d, unit).getTime()
    bucketSet.add(t)
    const raw = categoryValue(r[catIdx])
    const label = slots.has(raw) ? raw : 'Прочее'
    let m = seriesMap.get(label)
    if (!m) {
      m = new Map()
      seriesMap.set(label, m)
    }
    m.set(t, (m.get(t) || 0) + measureValue(r, measure))
  }
  const xs = [...bucketSet].sort((a, b) => a - b)
  const order = [...slots.keys()].filter((l) => seriesMap.has(l))
  if (seriesMap.has('Прочее')) order.push('Прочее')
  const series = order.map((label) => ({
    name: label,
    slot: slots.get(label) || 'other',
    values: xs.map((t) => seriesMap.get(label).get(t) || 0),
  }))
  return { xs, series }
}

// KPI: сумма за срез + дельта последнего бакета к предыдущему + спарклайн
export function computeKpis(rows, timeline, measures, maxTiles = 6) {
  return measures.slice(0, maxTiles).map((m) => {
    let total = 0
    for (const r of rows) total += measureValue(r, m)
    let delta = null
    let spark = null
    if (timeline && timeline.length >= 2) {
      spark = timeline.slice(-12).map((b) => b.values[m.key])
      const lastV = timeline[timeline.length - 1].values[m.key]
      const prevV = timeline[timeline.length - 2].values[m.key]
      if (prevV !== 0) delta = (lastV - prevV) / Math.abs(prevV)
    }
    return { key: m.key, label: m.label, total, delta, spark }
  })
}
