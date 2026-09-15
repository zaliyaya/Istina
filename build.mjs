// Сборка отчёта в один автономный файл.
// Всё встраивается внутрь: React, рантайм, чтение Excel, история и данные.
// Запуск: node build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8')

// ---------- исходные данные ----------
// История 2026 года из ручного отчёта + недели из настоящих выгрузок.

const history = JSON.parse(read('data/history.json'))

// Данные берём только из настоящих выгрузок. Всё, что раньше переносилось из
// ручного отчёта, отброшено: там встречались незаполненные итоги по категориям
// и сдвиг бара на неделю. Из ручного отчёта остаётся только состав групп бара.
const CUTOFF = '2026-05-04'

const seed = {}

// Недели, для которых есть настоящая выгрузка, перекрывают ручной отчёт:
// экспорт из учётной системы точнее, чем цифры, перенесённые руками.
let overridden = 0
const exportsDir = 'data/exports'
const exportFiles = readdirSync(exportsDir).filter((f) => f.endsWith('.xlsx')).sort()

if (exportFiles.length) {
  const { readXlsx } = await import('./src/xlsxread-node.mjs')
  const { parseWeeklySheet } = await import('./src/parse-node.mjs')
  for (const file of exportFiles) {
    const buf = readFileSync(`${exportsDir}/${file}`)
    const sheets = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const parsed = parseWeeklySheet(sheets[0].rows, file)
    if (!parsed.section) {
      console.warn(`  пропуск: не понял раздел в ${file}`)
      continue
    }
    if (parsed.remainders.length) {
      const list = parsed.remainders.map((r) => `${r.category} +${r.qty} шт`).join(', ')
      console.warn(`  ${file}: итог больше суммы строк (${list})`)
    }
    if (parsed.week < CUTOFF) continue
    if (!seed[parsed.week]) seed[parsed.week] = {}
    if (seed[parsed.week][parsed.section]) overridden++
    seed[parsed.week][parsed.section] = parsed.rows.map((r) => ({
      category: r.category,
      name: r.name,
      markup: r.markup ?? null,
      cost: r.cost ?? null,
      qty: r.qty ?? null,
      revenue: r.revenue ?? null,
      profit: r.profit ?? null,
    }))
  }
}

// Состав групп бара переносим из ручного отчёта: в выгрузке групп нет.
const groupSeed = {}
for (const [category, info] of Object.entries(history.barGroups || {})) {
  if (info.section === 'bar' && info.group) groupSeed[category] = info.group
}

// Дубль шаблона текстом для рантайма: внутри <script> разметку никто не
// разбирает, поэтому циклы внутри <select> доживают до сборки.
const rawTemplate = read('src/template.html').split('</script>').join('<\\/script>')

// Версия данных — по самой поздней неделе и их количеству: пересобрали с новой
// выгрузкой — версия изменилась, и отчёт подмешает её у всех, кто откроет файл.
const seedWeeks = Object.keys(seed).sort()
const seedVersion = `${seedWeeks.length}-${seedWeeks[seedWeeks.length - 1] || 'пусто'}`

// ---------- сборка страницы ----------

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Истина · Анализ продаж</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>&#127863;</text></svg>">
<script>
/* React 18 (UMD, production) — встроен, чтобы файл работал без интернета */
${read('vendor/react.js')}
</script>
<script>
${read('vendor/react-dom.js')}
</script>
<script>
/* Чтение .xlsx своими силами: распаковка ZIP и разбор XML, без библиотек */
${read('src/xlsxread.js')}
</script>
<script>
${read('src/xlsx-shim.js')}
</script>
<script>
/* Файлу нечего догружать по сети. Пустая карта ресурсов отключает повторное
   чтение документа через fetch — на file:// оно всё равно запрещено. */
window.__resources = {}
</script>
<script>
${read('vendor/support.js')}
</script>
<script type="application/json" id="seed-data">${JSON.stringify(seed)}</script>
<script type="application/json" id="group-seed">${JSON.stringify(groupSeed)}</script>
<!-- Версия вшитых данных. Меняется при каждой пересборке: по ней отчёт
     понимает, что файл обновили, и подмешивает новые недели к тому,
     что уже накоплено в браузере. -->
<script type="text/plain" id="seed-version">${seedVersion}</script>
<!-- Недели раньше этой даты в отчёте не ведутся: до неё данные переносились
     руками и им нельзя доверять. При обновлении файла такие недели удаляются
     и у тех, кто открывал прошлые версии. -->
<script type="text/plain" id="seed-cutoff">${CUTOFF}</script>
</head>
<body>
<x-dc>
${read('src/template.html')}
</x-dc>
<script type="text/plain" id="raw-template">${rawTemplate}</script>
<script>
${read('src/boot.js')}
</script>
${read('src/props.txt')}
${read('src/app.js')}
</script>
</body>
</html>
`

writeFileSync('отчет.html', html)
console.log(
  `отчет.html собран: ${(html.length / 1024 / 1024).toFixed(2)} МБ · ` +
    `недель ${Object.keys(seed).length} (с ${CUTOFF}) · заменено выгрузками ${overridden} · ` +
    `категорий бара с группой ${Object.keys(groupSeed).length} · версия данных ${seedVersion}`,
)
