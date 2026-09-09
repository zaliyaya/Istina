// HTML-парсер выбрасывает <sc-for> внутри <select> — там разрешены только
// <option>, из-за чего выпадающие списки оставались пустыми. Тот же шаблон
// продублирован текстом внутри <script>, где разметка не разбирается;
// после запуска отдаём его рантайму, и списки собираются правильно.
//
// Рантайм стартует через промис, поэтому просто дождаться DOMContentLoaded
// нельзя: к этому моменту его API ещё нет. Ждём появления.
;(function () {
  var tries = 0
  function apply() {
    var raw = document.getElementById('raw-template')
    if (!raw) return true
    var registry = window.__dcRegistry
    var names = registry ? Object.keys(registry) : []
    if (typeof window.__dcUpdate !== 'function' || !names.length) {
      if (++tries > 200) return true // ~10 секунд: дальше ждать бессмысленно
      return false
    }
    var html = raw.textContent.split('<\\/script>').join('</' + 'script>')
    for (var i = 0; i < names.length; i++) window.__dcUpdate(names[i], 'html', html, false)
    return true
  }
  if (!apply()) {
    var timer = setInterval(function () {
      if (apply()) clearInterval(timer)
    }, 50)
  }
})()
