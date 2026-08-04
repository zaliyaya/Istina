// Склейка модулей в один автономный dashboard.html.
// ES-модули не грузятся по file://, поэтому весь код кладётся в обычный
// <script> внутри IIFE, а стили — в <style>.
// Запуск: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const ORDER = [
  'format.js',
  'scale.js',
  'dom.js',
  'fileLoad.js',
  'analyze.js',
  'demo.js',
  'gviz.js',
  'charts.js',
  'ui.js',
  'app.js',
]

const strip = (src) =>
  src
    // import { a, b } from './x.js'  /  import x from 'y'
    .replace(/import\s+[\w*{}\n\s,]+\s+from\s+['"][^'"]+['"];?/g, '')
    .replace(/^export\s+/gm, '')
    .trim()

// Excel: динамический import() модуля тоже не работает по file://,
// поэтому классическая библиотека подключается обычным <script>.
const XLSX_SHIM = `
const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
let xlsxPromise = null
function loadXlsxGlobal() {
  if (window.XLSX) return Promise.resolve(window.XLSX)
  if (!xlsxPromise) {
    xlsxPromise = new Promise((resolve, reject) => {
      const tag = document.createElement('script')
      tag.src = XLSX_URL
      tag.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX_CDN')))
      tag.onerror = () => reject(new Error('XLSX_CDN'))
      document.head.append(tag)
    })
  }
  return xlsxPromise
}
`.trim()

const parts = ORDER.map((name) => {
  let code = strip(readFileSync(`js/${name}`, 'utf8'))
  if (name === 'fileLoad.js') {
    const before = code
    code = code.replace('XLSX = await import(XLSX_CDN)', 'XLSX = await loadXlsxGlobal()')
    if (code === before) throw new Error('не нашёл место подключения xlsx в fileLoad.js')
  }
  return `// ===== ${name} =====\n${code}`
})

const css = readFileSync('css/style.css', 'utf8').trim()
const template = readFileSync('index.html', 'utf8')

const head = template
  .split('<link rel="stylesheet"')[0]
  .replace(/^[\s\S]*?<head>\n/, '')
  .trimEnd()

const html = `<!doctype html>
<html lang="ru">
  <head>
${head}
    <style>
${css}
    </style>
    <script>
      // применяем сохранённую тему до первого рендера, чтобы не мигало
      try {
        var t = localStorage.getItem('theme')
        if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
      } catch (e) {}
    </script>
  </head>
  <body>
    <div id="app"></div>
    <noscript>
      <p style="padding: 24px">Для работы дэшборда нужен включённый JavaScript.</p>
    </noscript>
    <script>
;(function () {
'use strict'

// ===== подключение SheetJS (только когда открывают .xlsx) =====
${XLSX_SHIM}

${parts.join('\n\n')}
})()
    </script>
  </body>
</html>
`

writeFileSync('dashboard.html', html)
const kb = (html.length / 1024).toFixed(0)
console.log(`dashboard.html собран: ${kb} КБ, модулей — ${ORDER.length}`)
