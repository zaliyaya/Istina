// «Красивые» деления оси: чистые числа 1/2/5×10ⁿ
export function niceScale(min, max, tickCount = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] }
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, ticks: [0, 1] }
    min = Math.min(0, min)
    max = Math.max(0, max)
    if (min === max) return { min: 0, max: 1, ticks: [0, 1] }
  }
  const span = max - min
  const step0 = span / tickCount
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  const n = Math.round((hi - lo) / step)
  for (let i = 0; i <= n; i++) ticks.push(lo + i * step)
  return { min: lo, max: hi, ticks }
}

// Ширина контейнера через ResizeObserver — графики рендерятся в точных пикселях.
// Возвращает функцию отписки.
export function observeWidth(el, onChange, initial = 600) {
  if (typeof ResizeObserver !== 'function') {
    onChange(el.clientWidth || initial)
    return () => {}
  }
  const ro = new ResizeObserver((entries) => {
    const w = entries[0] && entries[0].contentRect && entries[0].contentRect.width
    if (w) onChange(w)
  })
  ro.observe(el)
  return () => ro.disconnect()
}
