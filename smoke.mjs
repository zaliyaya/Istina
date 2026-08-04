// Смоук-тест: чистая логика + полный рендер в jsdom.
// Запуск: node smoke.mjs
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

let failed = 0
const ok = (cond, name, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : ' — ' + extra))
  if (!cond) failed++
}

// ---------- 1. логика без DOM ----------
console.log('\n[1] разбор и анализ данных')

const { parseCsv, inferTable } = await import('./js/fileLoad.js')
const csv = 'Дата;Канал;Выручка\n03.08.2026;Сайт;1 234,56\n04.08.2026;Розница;2 000\n'
const t = inferTable(parseCsv(csv))
ok(t.cols.length === 3, 'три колонки', JSON.stringify(t.cols))
ok(t.cols[0].type === 'date', 'дата 03.08.2026 распознана', t.cols[0].type)
ok(t.cols[2].type === 'number', 'число «1 234,56» распознано', t.cols[2].type)
ok(t.rows[0][2] === 1234.56, 'русский формат числа разобран', String(t.rows[0][2]))

const { demoTable } = await import('./js/demo.js')
const demo = demoTable()
ok(demo.rows.length > 300, 'демо-набор построен: ' + demo.rows.length + ' строк')

const { analyzeTable, buildTimeline, computeKpis, aggregateByCategory, applyFilters } =
  await import('./js/analyze.js')
const a = analyzeTable(demo)
ok(!!a.timeCol, 'колонка времени найдена')
ok(a.measures.length === 3, 'показатели: Записей + Выручка + Заказы', String(a.measures.length))
ok(a.categoryCols.length === 2, 'категории: Канал + Регион', String(a.categoryCols.length))

const tl = buildTimeline(demo.rows, a.timeCol.index, a.measures, 'day')
ok(tl.length === 120, 'таймлайн — 120 дней', String(tl.length))
const kpi = computeKpis(demo.rows, tl, a.measures)
ok(kpi[0].total === demo.rows.length, 'KPI «Записей» = число строк')
ok(kpi[1].spark.length === 12, 'спарклайн — 12 точек', String(kpi[1].spark.length))
const bars = aggregateByCategory(demo.rows, a.categoryCols[0].index, a.measures[1], 10)
ok(bars.length === 4, 'бары по каналам: 4 значения', String(bars.length))

const cut = applyFilters(demo.rows, a.timeCol, {
  from: new Date(2026, 6, 1),
  to: null,
  cats: { [a.categoryCols[0].index]: 'Сайт' },
})
ok(cut.length > 0 && cut.length < demo.rows.length, 'фильтры срезают выборку: ' + cut.length)

// ---------- 2. разбор ответа gviz ----------
console.log('\n[2] ответ Google Sheets (gviz)')

const gvizBody = {
  table: {
    cols: [
      { id: 'A', label: '', type: 'string' },
      { id: 'B', label: '', type: 'string' },
    ],
    rows: [
      { c: [{ v: 'Дата' }, { v: 'Выручка' }] },
      { c: [{ v: '01.07.2026' }, { v: '100' }] },
      { c: [{ v: '02.07.2026' }, { v: '250' }] },
    ],
  },
}
const payload = `/*O_o*/\ngoogle.visualization.Query.setResponse(${JSON.stringify(gvizBody)});`

const dom0 = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://example.org/' })
globalThis.window = dom0.window
globalThis.document = dom0.window.document
globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => payload })

const { fetchSheet, parseSheetUrl } = await import('./js/gviz.js')
const ref = parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-dEfGhIjKlMnOpQrStUvWxYz/edit#gid=42')
ok(ref && ref.id === '1AbC-dEfGhIjKlMnOpQrStUvWxYz' && ref.gid === '42', 'ID и gid из ссылки')
const sheet = await fetchSheet(ref)
ok(sheet.cols[0].label === 'Дата', 'заголовок поднят из первой строки (лист без шапки)', sheet.cols[0].label)
ok(sheet.cols[0].type === 'date' && sheet.cols[1].type === 'number', 'типы переопределены заново')
ok(sheet.rows.length === 2, 'строка заголовков не попала в данные', String(sheet.rows.length))

// ---------- 3. полный рендер в jsdom ----------
console.log('\n[3] рендер приложения')

const html = readFileSync('./index.html', 'utf8')
const dom = new JSDOM(html, { url: 'https://example.org/?demo=1', pretendToBeVisual: true })
const win = dom.window
win.ResizeObserver = class {
  observe() {}
  disconnect() {}
}
globalThis.window = win
globalThis.document = win.document
globalThis.location = win.location
globalThis.history = win.history
globalThis.localStorage = win.localStorage
globalThis.Node = win.Node
globalThis.Intl = Intl
globalThis.URL = win.URL
globalThis.Blob = win.Blob

await import('./js/app.js')

const $ = (sel) => win.document.querySelectorAll(sel)
const root = win.document.getElementById('app')
ok($('.topbar').length === 1, 'шапка отрисована')
ok($('.tile').length === 3, 'три KPI-плитки', String($('.tile').length))
ok($('.tile-spark').length === 3, 'спарклайны в плитках')
ok($('.filter-bar').length === 1, 'панель фильтров')
ok($('.line-chart svg').length === 4, 'графики: 3 динамики + разбивка', String($('.line-chart svg').length))
ok($('.bar-chart').length === 2, 'два барчарта по категориям', String($('.bar-chart').length))
ok($('.legend-item').length === 4, 'легенда: 4 канала', String($('.legend-item').length))
ok($('.table-scroll tbody tr').length === 50, 'таблица: первые 50 строк', String($('.table-scroll tbody tr').length))
ok($('.chart-card').length === 7, 'карточек: 3 динамики + разбивка + 2 бара + таблица', String($('.chart-card').length))
ok(/строк · 5 колонок/.test(root.textContent), 'подпись «строк · колонок»')

// оси и подписи в линейном графике
const first = $('.line-chart svg')[0]
ok(first.querySelectorAll('path').length >= 2, 'линия + вуаль под ней')
ok(first.querySelectorAll('.tick-text text').length > 4, 'подписи осей')
ok(first.querySelectorAll('.end-label').length === 1, 'подпись значения у конца линии')

// интерактив: смена показателя в барчарте
const barSelect = $('.chart-card-controls select')[$('.chart-card-controls select').length - 1]
const beforeLabels = [...$('.bar-chart')[1].querySelectorAll('.bar-value')].map((e) => e.textContent)
barSelect.value = '__count'
barSelect.dispatchEvent(new win.Event('change'))
const afterLabels = [...$('.bar-chart')[1].querySelectorAll('.bar-value')].map((e) => e.textContent)
ok(beforeLabels.join() !== afterLabels.join(), 'смена показателя пересчитывает бары')

// интерактив: фильтр по категории
const catSelect = $('.filter-bar select')[0]
catSelect.value = 'Сайт'
catSelect.dispatchEvent(new win.Event('change'))
ok($('.reset').length === 1, 'появилась кнопка «Сбросить»')
const rowsAfter = win.document.querySelector('.dash-meta').textContent
ok($('.table-scroll tbody tr').length > 0, 'таблица не опустела после фильтра')
ok(rowsAfter.includes('строк'), 'мета-строка на месте')

// интерактив: попап периода
const dateBtn = win.document.querySelector('.date-filter .btn')
dateBtn.dispatchEvent(new win.Event('click'))
ok($('.popover').length === 1, 'открылся выбор периода')
const preset30 = [...$('.preset-row')].find((b) => b.textContent.includes('30 дней'))
preset30.dispatchEvent(new win.Event('click'))
ok(win.document.querySelector('.date-filter .btn').textContent.includes('30 дней'), 'пресет применён')
ok($('.popover').length === 0, 'попап закрылся')

// смена темы
const themeBtn = win.document.querySelector('.theme-btn')
themeBtn.dispatchEvent(new win.Event('click'))
ok(win.document.documentElement.dataset.theme === 'light', 'тема переключилась на светлую')

// возврат на лендинг
const change = [...$('.topbar-right .btn')].find((b) => b.textContent.includes('Сменить'))
change.dispatchEvent(new win.Event('click'))
ok($('.landing').length === 1, 'вернулись на стартовый экран')
ok($('.drop-zone').length === 1, 'зона загрузки файла на месте')

console.log(failed ? `\n${failed} проверок упало\n` : '\nвсе проверки прошли\n')
process.exit(failed ? 1 : 0)
