// Проверка собранного отчёта в браузерном окружении.
// Запуск: node test.mjs
import { JSDOM } from 'jsdom'
import { readFileSync, readdirSync } from 'node:fs'

let failed = 0
const ok = (c, n, e = '') => {
  console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : ' — ' + e))
  if (!c) failed++
}

const html = readFileSync('./отчет.html', 'utf8')
const UP = '/mnt/user-data/uploads'

function open(storage) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/otchet.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      }
      w.matchMedia =
        w.matchMedia ||
        (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
      w.addEventListener('error', (e) => console.log('   JS ОШИБКА:', e.message))
      if (storage) w.localStorage.setItem('istina-sales-db-v2', storage)
    },
  })
  return dom.window
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// textContent включает и содержимое <script>, поэтому берём только то,
// что реально видно на странице
const text = (w) => {
  const root = w.document.getElementById('dc-root') || w.document.body
  const clone = root.cloneNode(true)
  for (const s of clone.querySelectorAll('script,style')) s.remove()
  return clone.textContent.replace(/\s+/g, ' ')
}
const btn = (w, label) =>
  [...w.document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)

// ---------- 1. первый запуск ----------
console.log('\n[1] первый запуск: история подхватывается сама')
const w = open(null)
await wait(800)
const t0 = text(w)
ok(/Истина · Анализ продаж/.test(t0), 'заголовок на месте')
ok(/36 недель в базе/.test(t0), 'в базе 36 недель', (/(\d+) недел\S* в базе/.exec(t0) || [])[0])
ok(/Выручка/.test(t0) && /Прибыль/.test(t0) && /Средняя наценка/.test(t0), 'показатели выведены')
ok(/Кухня/.test(t0) && /Бар/.test(t0), 'разделы кухня и бар')
ok(/Доля в продажах/.test(t0), 'блок долей')
ok(w.document.querySelectorAll('svg').length >= 2, 'графики нарисованы', String(w.document.querySelectorAll('svg').length))
ok(!/\{"20\d\d-/.test(t0), 'исходные данные не вывалились текстом на страницу')

const saved = w.localStorage.getItem('istina-sales-db-v2')
ok(!!saved && saved.length > 100000, 'база сохранена в браузере: ' + (saved ? (saved.length / 1024).toFixed(0) + ' КБ' : 'нет'))
const db0 = JSON.parse(saved)
ok(Object.keys(db0.weeks).length === 36, 'в сохранённой базе 36 недель', String(Object.keys(db0.weeks).length))

// суммы за неделю 31.08 должны совпасть с выгрузками: 168 676 + 165 284
const wk = db0.weeks['2026-08-31']
const sum = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0)
ok(!!wk && !!wk.kitchen && !!wk.bar, 'неделя 31.08 есть по обоим разделам')
ok(Math.abs(sum(wk.kitchen, 'revenue') - 168676.48) < 1, 'выручка кухни за 31.08 сходится', String(sum(wk.kitchen, 'revenue')))
ok(Math.abs(sum(wk.kitchen, 'qty') - 339) < 0.5, 'количество кухни за 31.08 сходится', String(sum(wk.kitchen, 'qty')))
ok(Math.abs(sum(wk.bar, 'qty') - 410) < 0.5, 'количество бара за 31.08 сходится', String(sum(wk.bar, 'qty')))

// строки, которых нет в выгрузке, но которые входят в итог категории
const wk17 = db0.weeks['2026-08-17']
ok(Math.abs(sum(wk17.bar, 'qty') - 667) < 0.5, 'бар за 17.08: сумма равна итогу файла (667)', String(sum(wk17.bar, 'qty')))
ok(
  wk17.bar.some((x) => x.name === '(без детализации)'),
  'непропечатанные строки сохранены отдельной позицией',
)

// ---------- 2. вкладки ----------
console.log('\n[2] переходы по вкладкам')
btn(w, 'Категории').dispatchEvent(new w.Event('click', { bubbles: true }))
await wait(300)
const tTable = text(w)
ok(/Категория \/ позиция/.test(tTable), 'на «Категориях» появилась сводка по неделям')
ok(/Итого/.test(tTable), 'есть колонка итога')
ok(/ЗАВТРАКИ|САЛАТЫ|КОКТЕЙЛИ/.test(tTable), 'категории перечислены')

btn(w, 'Данные').dispatchEvent(new w.Event('click', { bubbles: true }))
await wait(300)
const tData = text(w)
ok(/xlsx|Excel|выгруз/i.test(tData), 'на «Данных» есть загрузка файлов')
ok(w.document.querySelector('input[type=file]') !== null, 'поле выбора файла присутствует')

btn(w, 'Дашборд').dispatchEvent(new w.Event('click', { bubbles: true }))
await wait(300)
ok(/Средняя наценка/.test(text(w)) && /Доля в продажах/.test(text(w)), 'вернулись на дашборд', text(w).slice(0,120))

// ---------- 3. загрузка новой недели ----------
console.log('\n[3] загрузка выгрузки через интерфейс')
const w2 = open(null)
await wait(800)
btn(w2, 'Данные').dispatchEvent(new w2.Event('click', { bubbles: true }))
await wait(200)

const files = readdirSync(UP).filter((f) => f.includes('24_08_2026'))
ok(files.length >= 1, 'нашёл файлы для загрузки: ' + files.length)
const input = w2.document.querySelector('input[type=file]')
const objs = files.map((f) => {
  const b = readFileSync(UP + '/' + f)
  return new w2.File([new Uint8Array(b)], f)
})
Object.defineProperty(input, 'files', { value: objs })
input.dispatchEvent(new w2.Event('change', { bubbles: true }))
await wait(1200)

const tUp = text(w2)
ok(/позиций|Готово|неделя/i.test(tUp), 'показано сообщение о загрузке')
ok(!/Ошибка при чтении/.test(tUp), 'файл прочитан без ошибок', tUp.slice(0, 200))
const db2 = JSON.parse(w2.localStorage.getItem('istina-sales-db-v2'))
ok(!!db2.weeks['2026-08-24'] && !!db2.weeks['2026-08-24'].bar, 'неделя 24.08 по бару записана')
ok(
  Math.abs(sum(db2.weeks['2026-08-24'].bar, 'qty') - 708) < 0.5,
  'количество бара за 24.08 совпало с итогом файла (708)',
  String(sum(db2.weeks['2026-08-24'].bar, 'qty')),
)

// ---------- 4. повторное открытие ----------
console.log('\n[4] данные переживают перезапуск')
const w3 = open(saved)
await wait(800)
ok(/36 недель в базе/.test(text(w3)), 'после перезапуска недели на месте')



// ---------- 5. группы бара ----------
console.log('\n[5] группы бара')
const w5 = open(null)
await wait(900)
const db5 = JSON.parse(w5.localStorage.getItem('istina-sales-db-v2'))
ok(Object.keys(db5.groups || {}).length === 16, 'состав групп перенесён из отчёта', String(Object.keys(db5.groups||{}).length))
ok(db5.groups['КОКТЕЙЛИ'] === 'КОКТЕЙЛИ' || !!db5.groups['КОКТЕЙЛИ'], 'у категории есть группа', JSON.stringify(db5.groups['КОКТЕЙЛИ']))
ok(db5.groups['БЕЛЫЕ ВИНА 125МЛ'] === 'БОКАЛЫ', 'вина по бокалам отнесены к БОКАЛАМ', String(db5.groups['БЕЛЫЕ ВИНА 125МЛ']))

// фильтр по группе появляется в панели
const sels = [...w5.document.querySelectorAll('select')]
const groupSel = sels.find((s) => [...s.options].some((o) => o.textContent === 'Все группы бара'))
ok(!!groupSel, 'в фильтрах есть выбор группы бара')
const groupNames = groupSel ? [...groupSel.options].map((o) => o.textContent) : []
ok(groupNames.includes('БОКАЛЫ') && groupNames.includes('КОКТЕЙЛИ'), 'группы перечислены', groupNames.join('/'))

// выбор группы урезает выручку
const before = text(w5)
const revBefore = (/Выручка ([\d\s ]+) ₽/.exec(before) || [])[1]
groupSel.value = 'БОКАЛЫ'
groupSel.dispatchEvent(new w5.Event('change', { bubbles: true }))
await wait(400)
const after = text(w5)
const revAfter = (/Выручка ([\d\s ]+) ₽/.exec(after) || [])[1]
ok(revBefore && revAfter && revBefore !== revAfter, `фильтр по группе пересчитывает цифры: ${revBefore} → ${revAfter}`)

// справочник групп на вкладке «Данные»
btn(w5, 'Данные').dispatchEvent(new w5.Event('click', { bubbles: true }))
await wait(300)
const tData5 = text(w5)
ok(/Группы бара/.test(tData5), 'на «Данных» есть справочник групп')
ok(/КОКТЕЙЛИ/.test(tData5) && /без группы/.test(tData5), 'категории со списком групп выведены')

// ---------- 6. неполные недели ----------
console.log('\n[6] неполные недели')
const dbGap = JSON.parse(saved)
delete dbGap.weeks['2026-08-31'].bar
const w6 = open(JSON.stringify(dbGap))
await wait(900)
const t6 = text(w6)
ok(/Неполные недели/.test(t6), 'предупреждение о неполной неделе показано')
ok(/нет выгрузки бара/.test(t6), 'сказано, какого раздела не хватает', t6.slice(0, 150))


// ---------- 8. сортировка в «Категориях» ----------
console.log('\n[8] раздельная сортировка категорий и позиций')

// строка категории: ячейка со стрелкой и названием в двух соседних span
const catCells = (w) =>
  [...w.document.querySelectorAll('div')].filter(
    (d) => d.children.length === 2 && /^[▸▾]$/.test(d.children[0].textContent.trim()),
  )
const catNames = (w) => catCells(w).map((d) => d.children[1].textContent.trim()).filter(Boolean)

const w8 = open(saved)
await wait(900)
btn(w8, 'Категории').dispatchEvent(new w8.Event('click', { bubbles: true }))
await wait(400)

const sortBtns = [...w8.document.querySelectorAll('button')].filter((b) =>
  /По алфавиту|По значению/.test(b.textContent),
)
ok(sortBtns.length === 4, 'две пары кнопок: для категорий и для позиций', String(sortBtns.length))
ok(/КАТЕГОРИИ/i.test(text(w8)) && /ПОЗИЦИИ/i.test(text(w8)), 'группы кнопок подписаны')

const byValue = catNames(w8)
ok(byValue.length > 3, 'категории перечислены: ' + byValue.length + ' — ' + byValue.slice(0, 3).join(', '))

sortBtns[0].dispatchEvent(new w8.Event('click', { bubbles: true })) // категории по алфавиту
await wait(400)
const byName = catNames(w8)
ok(byValue.join() !== byName.join(), 'сортировка категорий меняет порядок')
ok(
  byName.join() === byName.slice().sort((a, b) => a.localeCompare(b, 'ru')).join(),
  'категории встали по алфавиту',
  byName.slice(0, 4).join(' / '),
)

// раскрываем категорию, в которой заведомо много позиций
const hot = catCells(w8).find((d) => d.children[1].textContent.trim() === 'ГОРЯЧЕЕ') || catCells(w8)[0]
hot.parentElement.dispatchEvent(new w8.Event('click', { bubbles: true }))
await wait(400)
const openCat = catCells(w8).find((d) => d.children[0].textContent.trim() === '▾')
ok(!!openCat, 'категория раскрылась')

// строки позиций — сетки, у которых первая ячейка это название
const itemNames = () =>
  [...w8.document.querySelectorAll('div')]
    .filter((d) => d.children.length > 4 && [...d.children].every((c) => c.children.length <= 1))
    .map((d) => d.children[0].textContent.trim())
    .filter((t) => t && t !== 'Итого' && t !== 'Категория / позиция')
const itemsBefore = itemNames().join()
ok(itemNames().length > 3, 'в раскрытой категории несколько позиций: ' + itemNames().length)
sortBtns[2].dispatchEvent(new w8.Event('click', { bubbles: true })) // позиции по алфавиту
await wait(400)
const t8 = text(w8)
ok(/По алфавиту ↑|По алфавиту ↓/.test(t8), 'сортировка позиций переключилась')
ok(itemsBefore !== itemNames().join(), 'порядок позиций изменился')
ok(catNames(w8).join() === byName.join(), 'порядок категорий при этом не тронут')

// ---------- 9. прочерки вместо ложных нулей ----------
console.log('\n[9] нет данных — прочерк, а не ноль')
const w9 = open(saved)
await wait(900)
btn(w9, 'Категории').dispatchEvent(new w9.Event('click', { bubbles: true }))
await wait(300)
;[...w9.document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Бар')
  .dispatchEvent(new w9.Event('click', { bubbles: true }))
await wait(400)

const cells9 = [...w9.document.querySelectorAll('div')].filter(
  (d) => d.children.length === 2 && /^[▸▾]$/.test(d.children[0].textContent.trim()),
)
const cocktails = cells9.find((d) => d.children[1].textContent.trim() === 'КОКТЕЙЛИ')
ok(!!cocktails, 'категория КОКТЕЙЛИ найдена', cells9.map((d) => d.children[1].textContent.trim()).slice(0, 5).join('/'))
cocktails.parentElement.dispatchEvent(new w9.Event('click', { bubbles: true }))
await wait(400)

const t9 = text(w9)
ok(/Aperol Spritz/.test(t9), 'позиции коктейлей показаны')
ok(/без детализации/.test(t9), 'строка «без детализации» на месте')
ok(/—/.test(t9), 'в неделях без данных стоит прочерк')
ok(/Прочерк означает/.test(t9), 'под таблицей есть пояснение')

// «+ 1 Безлимитный…» из выгрузки и «Плюс 1 Безлимитный…» из старого отчёта —
// одна позиция; раньше они висели двумя строками с нулями и прочерками
const gridRows = [...w9.document.querySelectorAll('div')].filter(
  (d) => d.children.length > 4 && [...d.children].every((c) => c.children.length <= 1),
)
const cellsOf = (r) => [...r.children].map((c) => c.textContent.trim())
const plusRows = gridRows.filter((r) => /Безлимитный Aperol Spritz 250мл$/.test(cellsOf(r)[0]) && /^(\+|Плюс)/.test(cellsOf(r)[0]))
ok(plusRows.length === 1, 'позиция «+1 Безлимитный» не задвоилась', String(plusRows.length))
const plusCells = plusRows.length ? cellsOf(plusRows[0]) : []
ok(!plusCells.includes('—'), 'у неё нет пустых недель', plusCells.join('/'))

// выручка у комплиментов действительно ноль, а штуки — нет
const qtyBtn = [...w9.document.querySelectorAll('button')].find((b) => /^Количество$/.test(b.textContent.trim()))
ok(!!qtyBtn, 'есть переключатель на количество')
qtyBtn.dispatchEvent(new w9.Event('click', { bubbles: true }))
await wait(400)
const gridRows2 = [...w9.document.querySelectorAll('div')].filter(
  (d) => d.children.length > 4 && [...d.children].every((c) => c.children.length <= 1),
)
const plusQty = gridRows2.map(cellsOf).find((c) => /Безлимитный Aperol Spritz 250мл$/.test(c[0]) && /^(\+|Плюс)/.test(c[0]))
ok(plusQty && Number(plusQty[1].replace(/\s/g, '')) > 0, 'в штуках у комплиментов есть значения', plusQty ? plusQty.slice(0, 4).join('/') : '—')

console.log(failed ? `\n${failed} проверок упало\n` : '\nвсе проверки прошли\n')
process.exit(failed ? 1 : 0)

// ---------- 7. пресеты периода ----------
console.log('\n[7] период')
const w7 = open(saved)
await wait(900)
const periodSel = [...w7.document.querySelectorAll('select')].find((s) =>
  [...s.options].some((o) => o.textContent === 'Последняя неделя'),
)
ok(!!periodSel, 'список периодов заполнен')
const labels = [...periodSel.options].map((o) => o.textContent)
ok(labels.includes('Предыдущая неделя'), 'есть «Предыдущая неделя»', labels.join('/'))

periodSel.value = 'w1'
periodSel.dispatchEvent(new w7.Event('change', { bubbles: true }))
await wait(300)
const tLast = text(w7)
periodSel.value = 'prev'
periodSel.dispatchEvent(new w7.Event('change', { bubbles: true }))
await wait(300)
const tPrev = text(w7)
const rev = (s) => (/Выручка ([\d\s ]+) ₽/.exec(s) || [])[1]
ok(rev(tLast) && rev(tPrev) && rev(tLast) !== rev(tPrev), `недели различаются: ${rev(tLast)} → ${rev(tPrev)}`)

console.log(failed ? `\n${failed} проверок упало\n` : '\nвсе проверки прошли\n')
process.exit(failed ? 1 : 0)
