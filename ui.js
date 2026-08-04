import { h } from './dom.js'
import { sparkline } from './charts.js'
import { fmtCompact, fmtFull, fmtDelta, fmtCell } from './format.js'

// ---------- KPI-плитка ----------

export function statTile({ label, value, delta, deltaLabel = '', spark }) {
  const deltaText = fmtDelta(delta)
  const main = h('div', { class: 'tile-main' }, [
    h('div', { class: 'tile-label', text: label }),
    h('div', { class: 'tile-value', title: fmtFull(value), text: fmtCompact(value) }),
    deltaText &&
      h('div', { class: delta >= 0 ? 'tile-delta up' : 'tile-delta down' }, [
        h('span', { 'aria-hidden': 'true', text: delta >= 0 ? '▲' : '▼' }),
        ' ' + deltaText + ' ',
        deltaLabel && h('span', { class: 'tile-delta-label', text: deltaLabel }),
      ]),
  ])
  const sp = spark && spark.length >= 2 ? sparkline({ values: spark }) : null
  if (sp) sp.setAttribute('class', 'tile-spark')
  return h('div', { class: 'card tile' }, [main, sp])
}

// ---------- карточка графика ----------

export function chartCard({ title, subtitle = '', controls = [], wide = false }, children) {
  return h('section', { class: wide ? 'card chart-card wide' : 'card chart-card' }, [
    h('header', { class: 'chart-card-head' }, [
      h('div', {}, [
        h('h3', { class: 'chart-card-title', text: title }),
        subtitle && h('p', { class: 'chart-card-subtitle', text: subtitle }),
      ]),
      h('div', { class: 'chart-card-controls' }, controls),
    ]),
    children,
  ])
}

// выпадающий список показателей/разбивок в шапке карточки
export function selectBox({ options, value, ariaLabel, onChange }) {
  return h(
    'select',
    {
      'aria-label': ariaLabel,
      value: String(value),
      onchange: (e) => onChange(e.target.value),
    },
    options.map((o) => h('option', { value: String(o.value), text: o.label })),
  )
}

// ---------- легенда ----------
// обязательна при ≥2 рядах; ключ повторяет форму марки (line/rect)

export function legendRow(items) {
  return h(
    'div',
    { class: 'legend', role: 'list' },
    items.map((it) =>
      h('span', { class: 'legend-item', role: 'listitem' }, [
        h('span', {
          class: it.kind === 'rect' ? 'legend-key rect' : 'legend-key line',
          style: { background: it.color },
        }),
        h('span', { class: 'legend-name', text: it.name }),
      ]),
    ),
  )
}

// ---------- таблица-двойник ----------
// каждое значение дэшборда достижимо и без графиков

export function dataTable({ columns, rows }) {
  let limit = 50

  const tbody = h('tbody')
  const info = h('span', { class: 'muted' })
  const moreBtn = h('button', {
    class: 'btn',
    text: 'Показать ещё',
    onclick: () => {
      limit += 200
      fill()
    },
  })

  function fill() {
    const visible = rows.slice(0, limit)
    tbody.replaceChildren(
      ...visible.map((r) =>
        h(
          'tr',
          {},
          columns.map((c) =>
            h('td', {
              class: c.type === 'number' ? 'num' : null,
              text: fmtCell(r[c.index], c.type),
            }),
          ),
        ),
      ),
    )
    info.textContent = `Показано ${visible.length} из ${rows.length}`
    moreBtn.hidden = limit >= rows.length
  }

  function exportCsv() {
    const esc = (v) => {
      const str = v == null ? '' : String(v)
      return /[",\n;]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str
    }
    const head = columns.map((c) => esc(c.label)).join(';')
    const body = rows
      .map((r) => columns.map((c) => esc(fmtCell(r[c.index], c.type))).join(';'))
      .join('\n')
    const blob = new Blob(['\ufeff' + head + '\n' + body], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'data.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  fill()

  return h('div', {}, [
    h('div', { class: 'table-scroll' }, [
      h('table', {}, [
        h('thead', {}, [
          h(
            'tr',
            {},
            columns.map((c) =>
              h('th', { class: c.type === 'number' ? 'num' : null, text: c.label }),
            ),
          ),
        ]),
        tbody,
      ]),
    ]),
    h('div', { class: 'table-footer' }, [
      info,
      h('span', { class: 'spacer' }),
      moreBtn,
      h('button', { class: 'btn', text: 'Скачать CSV', onclick: exportCsv }),
    ]),
  ])
}

// ---------- панель фильтров ----------
// Один ряд над всеми графиками: диапазон дат (пресеты списком, свой период —
// за волосяной чертой в футере) + фильтры по измерениям.

const PRESETS = [
  { id: 'all', label: 'Весь период' },
  { id: 'd7', label: 'Последние 7 дней' },
  { id: 'd30', label: 'Последние 30 дней' },
  { id: 'd90', label: 'Последние 90 дней' },
  { id: 'month', label: 'Последний месяц данных' },
  { id: 'year', label: 'Последний год данных' },
]

const shortDate = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
})

function presetRange(id, extent) {
  if (!extent || id === 'all') return { from: null, to: null }
  const anchor = extent[1]
  const day = (n) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - n + 1)
  if (id === 'd7') return { from: day(7), to: null }
  if (id === 'd30') return { from: day(30), to: null }
  if (id === 'd90') return { from: day(90), to: null }
  if (id === 'month') return { from: new Date(anchor.getFullYear(), anchor.getMonth(), 1), to: null }
  if (id === 'year') return { from: new Date(anchor.getFullYear(), 0, 1), to: null }
  return { from: null, to: null }
}

export function filterBar({ hasTime, extent, categoryCols, filters, onChange }) {
  const root = h('div', { class: 'filter-bar' })
  let open = false
  let popover = null

  function buttonLabel() {
    if (filters.preset === 'custom') {
      const f = filters.from ? shortDate.format(filters.from) : '…'
      const t = filters.to ? shortDate.format(filters.to) : '…'
      return `${f} – ${t}`
    }
    const p = PRESETS.find((x) => x.id === filters.preset)
    return p ? p.label : 'Весь период'
  }

  function onDocDown(e) {
    if (!e.target.closest('.date-filter')) closePopover()
  }

  function closePopover() {
    open = false
    document.removeEventListener('pointerdown', onDocDown)
    render()
  }

  function pickPreset(id) {
    const { from, to } = presetRange(id, extent)
    open = false
    document.removeEventListener('pointerdown', onDocDown)
    onChange({ ...filters, preset: id, from, to })
  }

  function applyCustom(fromStr, toStr) {
    const from = fromStr ? new Date(fromStr + 'T00:00:00') : null
    let to = toStr ? new Date(toStr + 'T23:59:59') : null
    if (from && to && to < from) to = null
    open = false
    document.removeEventListener('pointerdown', onDocDown)
    onChange({ ...filters, preset: 'custom', from, to })
  }

  function setCat(index, value) {
    const cats = { ...filters.cats }
    if (value === '') delete cats[index]
    else cats[index] = value
    onChange({ ...filters, cats })
  }

  function buildPopover() {
    const fromInput = h('input', { type: 'date', 'aria-label': 'С даты' })
    const toInput = h('input', { type: 'date', 'aria-label': 'По дату' })
    return h('div', { class: 'popover card' }, [
      ...PRESETS.map((p) =>
        h('button', { class: 'preset-row', onclick: () => pickPreset(p.id) }, [
          h('span', { class: 'check', 'aria-hidden': 'true', text: filters.preset === p.id ? '✓' : '' }),
          p.label,
        ]),
      ),
      h('div', { class: 'popover-footer' }, [
        h('div', { class: 'custom-title', text: 'Свой период' }),
        h('div', { class: 'custom-inputs' }, [
          fromInput,
          h('span', { class: 'range-dash', text: '–' }),
          toInput,
          h('button', {
            class: 'btn',
            text: 'ОК',
            onclick: () => applyCustom(fromInput.value, toInput.value),
          }),
        ]),
      ]),
    ])
  }

  function render() {
    const hasActive = filters.preset !== 'all' || Object.keys(filters.cats).length > 0
    const parts = []

    if (hasTime) {
      popover = open ? buildPopover() : null
      parts.push(
        h('div', { class: 'date-filter' }, [
          h(
            'button',
            {
              class: 'btn',
              'aria-expanded': String(open),
              onclick: () => {
                open = !open
                if (open) document.addEventListener('pointerdown', onDocDown)
                else document.removeEventListener('pointerdown', onDocDown)
                render()
              },
            },
            [h('span', { 'aria-hidden': 'true', text: '📅' }), ' ' + buttonLabel()],
          ),
          popover,
        ]),
      )
    }

    for (const c of categoryCols) {
      parts.push(
        h('label', { class: 'cat-filter' }, [
          h('span', { class: 'cat-label', text: c.label }),
          h(
            'select',
            {
              class: 'combo',
              value: filters.cats[c.index] == null ? '' : filters.cats[c.index],
              onchange: (e) => setCat(c.index, e.target.value),
            },
            [
              h('option', { value: '', text: 'Все' }),
              ...c.values.map((v) => h('option', { value: v, text: v })),
            ],
          ),
        ]),
      )
    }

    if (hasActive) {
      parts.push(
        h('button', {
          class: 'btn reset',
          text: '✕ Сбросить',
          onclick: () => onChange({ preset: 'all', from: null, to: null, cats: {} }),
        }),
      )
    }

    root.replaceChildren(...parts)
  }

  render()
  return root
}

// ---------- переключатель темы ----------
// Системная → светлая → тёмная. Выбор хранится в localStorage,
// index.html применяет его до первого рендера.

const MODES = [
  { id: 'auto', icon: '◐', title: 'Тема: как в системе' },
  { id: 'light', icon: '☀️', title: 'Тема: светлая' },
  { id: 'dark', icon: '🌙', title: 'Тема: тёмная' },
]

function readTheme() {
  try {
    return localStorage.getItem('theme') || 'auto'
  } catch {
    return 'auto'
  }
}

export function themeToggle() {
  let current = readTheme()
  const btn = h('button', { class: 'btn theme-btn' })

  function paint() {
    const mode = MODES.find((m) => m.id === current) || MODES[0]
    btn.textContent = mode.icon
    btn.title = mode.title
  }

  function apply(mode) {
    current = mode
    try {
      if (mode === 'auto') {
        delete document.documentElement.dataset.theme
        localStorage.removeItem('theme')
      } else {
        document.documentElement.dataset.theme = mode
        localStorage.setItem('theme', mode)
      }
    } catch {
      /* приватный режим — тема просто не запомнится */
    }
    paint()
  }

  btn.addEventListener('click', () => {
    const i = MODES.findIndex((m) => m.id === current)
    apply(MODES[(i + 1) % MODES.length].id)
  })

  paint()
  return btn
}
