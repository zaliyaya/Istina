import { h, setChildren } from './dom.js'
import { parseSheetUrl, fetchSheet, sheetLink, errorMessage } from './gviz.js'
import { loadFile } from './fileLoad.js'
import { demoTable } from './demo.js'
import {
  analyzeTable,
  applyFilters,
  dateExtent,
  chooseUnit,
  unitLabel,
  unitLabelAgg,
  trimPartialEdges,
  buildTimeline,
  computeKpis,
  aggregateByCategory,
  categorySlots,
  timelineByCategory,
  uniqueValues,
  COUNT_KEY,
} from './analyze.js'
import { fmtFull } from './format.js'
import { lineChart, barChart } from './charts.js'
import { statTile, chartCard, selectBox, legendRow, dataTable, filterBar, themeToggle } from './ui.js'

// ============================================================
// состояние
// ============================================================

const state = {
  status: 'idle', // idle | loading | refreshing | ready | error
  error: '',
  table: null,
  analysis: null,
  source: null, // { kind: 'sheet', ref: {id,gid} } | { kind: 'file', name }
  urlInput: '',
  loadedAt: null,
  filters: { preset: 'all', from: null, to: null, cats: {} },
  barMeasureSel: {}, // colIndex -> measure key
  splitDim: null,
  splitMeasure: COUNT_KEY,
}

const root = document.getElementById('app')
let dashHost = null // контейнер дэшборда: перерисовывается без пересборки шапки

// ============================================================
// загрузка данных
// ============================================================

async function loadSheet(input) {
  const parsed = parseSheetUrl(input)
  if (!parsed) {
    state.error =
      'Это не похоже на ссылку на Google Таблицу. Нужна ссылка вида docs.google.com/spreadsheets/d/…'
    state.status = state.table ? 'ready' : 'error'
    render()
    return
  }
  state.status = state.table ? 'refreshing' : 'loading'
  state.error = ''
  render()
  try {
    const table = await fetchSheet(parsed)
    adoptTable(table, { kind: 'sheet', ref: parsed })
    updateQuery((q) => q.set('sheet', input.trim()))
    store('lastSheetUrl', input.trim())
  } catch (e) {
    state.error = errorMessage(e)
    state.status = state.table ? 'ready' : 'error'
  }
  render()
}

async function onFile(file) {
  if (!file) return
  state.status = state.table ? 'refreshing' : 'loading'
  state.error = ''
  render()
  try {
    const table = await loadFile(file)
    if (!table.cols.length) throw new Error('EMPTY')
    adoptTable(table, { kind: 'file', name: file.name })
    updateQuery((q) => q.delete('sheet'))
  } catch (e) {
    state.error =
      e.message === 'EMPTY'
        ? 'Файл пустой или не удалось найти в нём таблицу.'
        : e.message === 'XLSX_CDN'
          ? 'Не удалось загрузить модуль для Excel (нужен интернет). Сохраните файл как CSV и попробуйте снова.'
          : 'Не удалось разобрать файл. Поддерживаются CSV, TSV и Excel (.xlsx).'
    state.status = state.table ? 'ready' : 'error'
  }
  render()
}

function adoptTable(table, source) {
  state.table = table
  state.analysis = analyzeTable(table)
  state.source = source
  state.loadedAt = new Date()
  state.status = 'ready'
  state.error = ''
  // новый набор данных — сбрасываем фильтры и выборы
  state.filters = { preset: 'all', from: null, to: null, cats: {} }
  state.barMeasureSel = {}
  state.splitDim = null
  state.splitMeasure = defaultMeasureKey()
}

function loadDemo() {
  adoptTable(demoTable(), { kind: 'file', name: 'Демо-данные: продажи' })
  updateQuery((q) => {
    q.delete('sheet')
    q.set('demo', '1')
  })
  render()
}

function changeSource() {
  state.status = 'idle'
  state.table = null
  state.analysis = null
  state.source = null
  state.error = ''
  render()
}

function store(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* приватный режим — просто не запомним */
  }
}

// history.replaceState на file:// бросает SecurityError — адресная строка
// там всё равно не нужна, поэтому просто молча пропускаем
function updateQuery(mutate) {
  try {
    const u = new URL(location.href)
    mutate(u.searchParams)
    history.replaceState(null, '', u)
  } catch {
    /* открыт как локальный файл — пропускаем */
  }
}

function restore(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

// ============================================================
// производные данные (аналог computed из Vue-версии)
// ============================================================

function defaultMeasureKey() {
  const ms = (state.analysis && state.analysis.measures) || []
  return ms.length > 1 ? ms[1].key : COUNT_KEY
}

function measureByKey(key) {
  const ms = state.analysis.measures
  return ms.find((m) => m.key === key) || ms[0]
}

function computeView() {
  const a = state.analysis
  const rows = state.table.rows

  const extent = a.timeCol ? dateExtent(rows, a.timeCol.index) : null
  const filteredRows = applyFilters(rows, a.timeCol, state.filters)
  const filteredExtent = a.timeCol ? dateExtent(filteredRows, a.timeCol.index) : null
  const unit = filteredExtent ? chooseUnit(filteredExtent[0], filteredExtent[1]) : null

  let timeline = null
  if (a.timeCol && unit) {
    timeline = trimPartialEdges(
      buildTimeline(filteredRows, a.timeCol.index, a.measures, unit),
      unit,
      filteredExtent,
    )
  }

  const kpis = computeKpis(filteredRows, timeline, a.measures, 6)

  // малые кратные: динамика каждого измерения (одиночный ряд — слот 1 + вуаль)
  let timeCharts = []
  if (timeline && timeline.length >= 2) {
    const xs = timeline.map((b) => b.t)
    timeCharts = a.measures.slice(0, 6).map((m) => ({
      key: m.key,
      title: m.label,
      xs,
      series: [
        { name: m.label, color: 'var(--series-1)', values: timeline.map((b) => b.values[m.key]) },
      ],
    }))
  }

  // бары по категориям (топ-10 + «Прочее»), выбор измерения в шапке карточки
  const barCards = a.categoryCols.slice(0, 2).map((c) => {
    const selKey = state.barMeasureSel[c.index] || defaultMeasureKey()
    const measure = measureByKey(selKey)
    return {
      col: c,
      selKey,
      measure,
      items: aggregateByCategory(filteredRows, c.index, measure, 10),
    }
  })

  // динамика по категориям: топ-5 цветных + «Прочее» серым; цвета закреплены
  // за категориями по полному набору данных — фильтры не перекрашивают
  let splitChart = null
  const splitDimIndex =
    state.splitDim != null
      ? state.splitDim
      : a.categoryCols.length
        ? a.categoryCols[0].index
        : null
  if (a.timeCol && unit && splitDimIndex != null && timeline && timeline.length >= 2) {
    const measure = measureByKey(state.splitMeasure)
    const slots = categorySlots(rows, splitDimIndex, measure, 5)
    let { xs, series } = timelineByCategory(
      filteredRows,
      a.timeCol.index,
      splitDimIndex,
      measure,
      unit,
      slots,
    )
    // синхронизируем с обрезанной динамикой: без неполных крайних бакетов
    const t0 = timeline[0].t
    const t1 = timeline[timeline.length - 1].t
    const keep = xs.map((t, i) => (t >= t0 && t <= t1 ? i : -1)).filter((i) => i >= 0)
    if (keep.length < xs.length) {
      xs = keep.map((i) => xs[i])
      series = series.map((ser) => ({ ...ser, values: keep.map((i) => ser.values[i]) }))
    }
    const colored = series.map((ser) => ({
      ...ser,
      color: ser.slot === 'other' ? 'var(--series-other)' : `var(--series-${ser.slot})`,
    }))
    splitChart = {
      measure,
      dimIndex: splitDimIndex,
      xs,
      series: colored,
      legend: colored.map((ser) => ({ name: ser.name, color: ser.color, kind: 'line' })),
    }
  }

  return { extent, filteredRows, unit, timeline, kpis, timeCharts, barCards, splitChart }
}

// ============================================================
// рендер
// ============================================================

function errorBox(message) {
  return h('p', { class: 'error-box', role: 'alert', text: message })
}

function topbar() {
  const right = []
  if (state.status === 'ready' || state.status === 'refreshing') {
    if (state.source && state.source.kind === 'sheet') {
      right.push(
        h('a', {
          class: 'btn',
          href: sheetLink(state.source.ref),
          target: '_blank',
          rel: 'noopener',
          text: 'Открыть таблицу ↗',
        }),
        h('button', {
          class: 'btn',
          disabled: state.status === 'refreshing',
          text: '⟳ Обновить',
          onclick: () => loadSheet(state.urlInput),
        }),
      )
    } else if (state.source) {
      right.push(
        h('span', { class: 'file-badge', title: state.source.name, text: '📄 ' + state.source.name }),
      )
    }
    right.push(h('button', { class: 'btn', text: 'Сменить источник', onclick: changeSource }))
  }
  right.push(themeToggle())

  return h('header', { class: 'topbar' }, [
    h('div', { class: 'brand' }, [
      h('span', { 'aria-hidden': 'true', text: '📊' }),
      h('span', { class: 'brand-name', text: 'Sheets Dashboard' }),
    ]),
    h('div', { class: 'topbar-right' }, right),
  ])
}

function landing() {
  const input = h('input', {
    class: 'text-input',
    type: 'url',
    placeholder: 'https://docs.google.com/spreadsheets/d/…',
    'aria-label': 'Ссылка на Google Таблицу',
    value: state.urlInput,
  })
  input.addEventListener('input', () => {
    state.urlInput = input.value
  })

  const form = h(
    'form',
    {
      class: 'url-row',
      onsubmit: (e) => {
        e.preventDefault()
        loadSheet(input.value)
      },
    },
    [
      input,
      h('button', {
        class: 'btn primary',
        type: 'submit',
        disabled: state.status === 'loading',
        text: state.status === 'loading' ? 'Загрузка…' : 'Построить',
      }),
    ],
  )

  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,.tsv,.txt,.xlsx,.xls',
    class: 'visually-hidden',
    onchange: (e) => {
      const file = e.target.files[0]
      e.target.value = ''
      onFile(file)
    },
  })

  const drop = h('label', { class: 'drop-zone' }, [
    fileInput,
    h('span', { class: 'drop-icon', 'aria-hidden': 'true', text: '📄' }),
    h('span', {}, [
      'Перетащите файл CSV или Excel сюда — или ',
      h('u', { text: 'выберите файл' }),
    ]),
  ])
  drop.addEventListener('dragover', (e) => {
    e.preventDefault()
    drop.classList.add('over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('over')
    onFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0])
  })

  return h('main', { class: 'landing' }, [
    h('div', { class: 'chips' }, [
      h('span', { class: 'chip', text: 'Google Таблицы' }),
      h('span', { class: 'chip', text: 'CSV' }),
      h('span', { class: 'chip', text: 'Excel' }),
    ]),
    h('h1', {}, ['Дэшборд из вашей таблицы — ', h('span', { class: 'grad', text: 'за секунды' })]),
    h('p', {
      class: 'landing-sub',
      text: 'Вставьте ссылку или перетащите файл. Типы колонок определятся сами: KPI, динамика, разбивки по категориям и таблица.',
    }),
    h('div', { class: 'card landing-card' }, [
      form,
      h('p', {
        class: 'hint',
        text: 'Таблица должна быть доступна по ссылке: Файл → Настройки доступа → «Все, у кого есть ссылка» → Читатель.',
      }),
      h('div', { class: 'divider' }, [h('span', { text: 'или' })]),
      drop,
      state.error && errorBox(state.error),
    ]),
    h('p', {
      class: 'privacy',
      text: '🔒 Данные не отправляются на сервер — всё считается в вашем браузере.',
    }),
    h('button', { class: 'btn demo-btn', text: 'Попробовать на демо-данных', onclick: loadDemo }),
  ])
}

function dashboard() {
  const a = state.analysis
  const stamp = state.loadedAt
    ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(state.loadedAt)
    : ''

  const catFilterCols = a.categoryCols.slice(0, 3).map((c) => ({
    index: c.index,
    label: c.label,
    values: uniqueValues(state.table.rows, c.index),
  }))

  const bar = filterBar({
    hasTime: !!a.timeCol,
    extent: a.timeCol ? dateExtent(state.table.rows, a.timeCol.index) : null,
    categoryCols: catFilterCols,
    filters: state.filters,
    // фильтр меняет и подпись периода в панели, и весь дэшборд — проще
    // перерисовать экран целиком, чем сверять что изменилось
    onChange: (next) => {
      state.filters = next
      render()
    },
  })

  dashHost = h('div', { class: state.status === 'refreshing' ? 'dash refreshing' : 'dash' })

  const main = h('main', { class: 'dash-wrap' }, [
    state.error && errorBox(state.error),
    h('div', {
      class: 'dash-meta',
      text:
        `${fmtFull(state.table.rows.length)} строк · ${state.table.cols.length} колонок` +
        (stamp ? ` · загружено в ${stamp}` : ''),
    }),
    bar,
    dashHost,
  ])

  renderDash()
  return main
}

function renderDash() {
  if (!dashHost) return
  const a = state.analysis
  const view = computeView()
  const parts = []

  if (view.filteredRows.length === 0) {
    parts.push(
      h('div', {
        class: 'card empty-slice',
        text: 'По выбранным фильтрам нет ни одной строки.',
      }),
    )
  }

  const deltaLabel = view.unit ? 'к пред. ' + unitLabel(view.unit) : ''
  parts.push(
    h(
      'div',
      { class: 'kpi-row' },
      view.kpis.map((k) =>
        statTile({ label: k.label, value: k.total, delta: k.delta, deltaLabel, spark: k.spark }),
      ),
    ),
  )

  const measureOptions = a.measures.map((m) => ({ value: m.key, label: m.label }))

  if (view.timeCharts.length) {
    parts.push(
      h(
        'div',
        { class: 'charts-grid' },
        view.timeCharts.map((c) =>
          chartCard(
            { title: c.title, subtitle: unitLabelAgg(view.unit) },
            lineChart({ xs: c.xs, series: c.series, unit: view.unit, ariaLabel: c.title }),
          ),
        ),
      ),
    )
  }

  if (view.splitChart) {
    const sc = view.splitChart
    const title = sc.measure.label + ' по категориям'
    const controls = [
      selectBox({
        options: measureOptions,
        value: state.splitMeasure,
        ariaLabel: 'Показатель',
        onChange: (v) => {
          state.splitMeasure = v
          renderDash()
        },
      }),
    ]
    if (a.categoryCols.length > 1) {
      controls.push(
        selectBox({
          options: a.categoryCols.map((c) => ({ value: c.index, label: c.label })),
          value: sc.dimIndex,
          ariaLabel: 'Разбивка',
          onChange: (v) => {
            state.splitDim = +v
            renderDash()
          },
        }),
      )
    }
    parts.push(
      chartCard(
        {
          title,
          subtitle:
            unitLabelAgg(view.unit) +
            (sc.series.some((x) => x.slot === 'other') ? ' · топ-5 + Прочее' : ''),
          controls,
          wide: true,
        },
        [
          lineChart({ xs: sc.xs, series: sc.series, unit: view.unit, height: 280, ariaLabel: title }),
          legendRow(sc.legend),
        ],
      ),
    )
  }

  if (view.barCards.length) {
    parts.push(
      h(
        'div',
        { class: 'charts-grid' },
        view.barCards.map((b) =>
          chartCard(
            {
              title: b.measure.label + ' — ' + b.col.label,
              subtitle: b.items.some((i) => i.other) ? 'топ-10 + Прочее' : '',
              controls: [
                selectBox({
                  options: measureOptions,
                  value: b.selKey,
                  ariaLabel: 'Показатель',
                  onChange: (v) => {
                    state.barMeasureSel[b.col.index] = v
                    renderDash()
                  },
                }),
              ],
            },
            barChart({
              items: b.items,
              ariaLabel: b.measure.label + ' по ' + b.col.label,
            }),
          ),
        ),
      ),
    )
  }

  parts.push(
    chartCard(
      { title: 'Данные', subtitle: 'полный срез с учётом фильтров', wide: true },
      dataTable({ columns: a.columns, rows: view.filteredRows }),
    ),
  )

  dashHost.className = state.status === 'refreshing' ? 'dash refreshing' : 'dash'
  setChildren(dashHost, parts)
}

function render() {
  const showLanding =
    state.status === 'idle' || state.status === 'loading' || state.status === 'error'
  if (showLanding) dashHost = null
  setChildren(root, [topbar(), showLanding ? landing() : dashboard()])
}

// ============================================================
// старт
// ============================================================

const query = new URL(location.href).searchParams
const fromQuery = query.get('sheet')
if (fromQuery) {
  state.urlInput = fromQuery
  render()
  loadSheet(fromQuery)
} else if (query.get('demo')) {
  loadDemo()
} else {
  state.urlInput = restore('lastSheetUrl')
  render()
}
