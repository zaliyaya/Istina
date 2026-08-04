import { h, s } from './dom.js'
import { niceScale, observeWidth } from './scale.js'
import { fmtCompact, fmtFull, fmtTick, fmtBucket } from './format.js'

// ============================================================
// Линейный график: 2px линии, заливка-«вуаль» 10% для одиночного ряда,
// crosshair-тултип со всеми рядами в точке, клавиатурная навигация ←/→.
// xs — отметки времени (ms), общие для всех рядов.
// series — [{ name, color, values: number[] }]
// ============================================================

const PAD_TOP = 12
const PAD_BOTTOM = 26
const PAD_RIGHT = 18

function yDomainOf(series) {
  let min = 0
  let max = 1
  let any = false
  for (const ser of series) {
    for (const v of ser.values) {
      if (!Number.isFinite(v)) continue
      if (!any) {
        min = Math.min(0, v)
        max = v
        any = true
      } else {
        if (v < min) min = v
        if (v > max) max = v
      }
    }
  }
  return niceScale(min, Math.max(min + 1e-9, max), 4)
}

export function lineChart({ xs, series, unit = 'day', height = 230, ariaLabel = 'График' }) {
  const wrap = h('div', {
    class: 'line-chart',
    tabindex: '0',
    role: 'img',
    'aria-label': ariaLabel,
  })
  wrap.dataset.widget = 'line'

  if (!xs.length) {
    wrap.append(h('p', { class: 'empty', text: 'Нет данных за выбранный период' }))
    return wrap
  }

  const yDomain = yDomainOf(series)
  const longest = Math.max(...yDomain.ticks.map((t) => fmtCompact(t).length), 2)
  const padLeft = Math.min(70, Math.max(34, longest * 7 + 8))
  const plotH = height - PAD_TOP - PAD_BOTTOM

  let width = 600
  let hoverIdx = null

  const plotW = () => Math.max(10, width - padLeft - PAD_RIGHT)
  const xAt = (i) =>
    xs.length <= 1 ? padLeft + plotW() / 2 : padLeft + (i / (xs.length - 1)) * plotW()
  const yAt = (v) => PAD_TOP + plotH - ((v - yDomain.min) / (yDomain.max - yDomain.min)) * plotH

  const crossesYear =
    xs.length >= 2 && new Date(xs[0]).getFullYear() !== new Date(xs[xs.length - 1]).getFullYear()

  function xTicks() {
    const n = xs.length
    const maxTicks = Math.max(2, Math.floor(plotW() / 74))
    const step = Math.max(1, Math.ceil(n / maxTicks))
    const idxs = []
    for (let i = 0; i < n; i += step) idxs.push(i)
    if (idxs[idxs.length - 1] !== n - 1 && n > 1) {
      if (xAt(n - 1) - xAt(idxs[idxs.length - 1]) < 50) idxs.pop()
      idxs.push(n - 1)
    }
    return idxs.map((i) => ({
      i,
      x: xAt(i),
      label: fmtTick(new Date(xs[i]), unit, crossesYear),
    }))
  }

  function linePath(values) {
    return values
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
      .join('')
  }

  // вуаль под линией — только для одиночного ряда
  function areaPath() {
    if (series.length !== 1 || xs.length < 2) return null
    const values = series[0].values
    const base = PAD_TOP + plotH
    return `${linePath(values)}L${xAt(values.length - 1).toFixed(1)},${base}L${xAt(0).toFixed(1)},${base}Z`
  }

  function draw() {
    const ticks = xTicks()
    const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}` })

    // сетка: сплошные волосяные линии
    svg.append(
      s(
        'g',
        { 'shape-rendering': 'crispEdges' },
        yDomain.ticks.map((t) =>
          s('line', {
            x1: padLeft,
            x2: width - PAD_RIGHT,
            y1: yAt(t),
            y2: yAt(t),
            stroke: t === 0 ? 'var(--axis)' : 'var(--grid)',
            'stroke-width': 1,
          }),
        ),
      ),
    )

    // подписи осей
    svg.append(
      s('g', { class: 'tick-text' }, [
        ...yDomain.ticks.map((t) =>
          s('text', {
            x: padLeft - 6,
            y: yAt(t) + 3.5,
            'text-anchor': 'end',
            text: fmtCompact(t),
          }),
        ),
        ...ticks.map((t) =>
          s('text', {
            x: Math.max(padLeft + 8, Math.min(t.x, width - 20)),
            y: height - 8,
            'text-anchor': 'middle',
            text: t.label,
          }),
        ),
      ]),
    )

    // crosshair
    const hovering = hoverIdx != null && hoverIdx < xs.length
    if (hovering) {
      svg.append(
        s('line', {
          x1: xAt(hoverIdx),
          x2: xAt(hoverIdx),
          y1: PAD_TOP,
          y2: PAD_TOP + plotH,
          stroke: 'var(--axis)',
          'stroke-width': 1,
          'shape-rendering': 'crispEdges',
        }),
      )
    }

    // данные
    const area = areaPath()
    if (area) svg.append(s('path', { d: area, fill: series[0].color, opacity: 0.1 }))

    for (const ser of series) {
      const endX = xAt(ser.values.length - 1)
      const endY = yAt(ser.values[ser.values.length - 1])
      svg.append(
        s('g', {}, [
          s('path', {
            d: linePath(ser.values),
            fill: 'none',
            stroke: ser.color,
            'stroke-width': 2,
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
          }),
          // маркер конца с кольцом цвета поверхности
          s('circle', {
            cx: endX,
            cy: endY,
            r: 4,
            fill: ser.color,
            stroke: 'var(--surface-1)',
            'stroke-width': 2,
          }),
        ]),
      )
    }

    // подпись значения у конца линии — только для одиночного ряда
    if (series.length === 1) {
      const values = series[0].values
      const endX = xAt(values.length - 1)
      const endY = yAt(values[values.length - 1])
      svg.append(
        s('text', {
          x: Math.min(endX - 8, width - 8),
          y: Math.max(12, endY - 10),
          'text-anchor': 'end',
          class: 'end-label',
          text: fmtCompact(values[values.length - 1]),
        }),
      )
    }

    // точки под crosshair
    if (hovering) {
      svg.append(
        s(
          'g',
          {},
          series.map((ser) =>
            s('circle', {
              cx: xAt(hoverIdx),
              cy: yAt(ser.values[hoverIdx]),
              r: 4.5,
              fill: ser.color,
              stroke: 'var(--surface-1)',
              'stroke-width': 2,
            }),
          ),
        ),
      )
    }

    const nodes = [svg]

    if (hovering) {
      const x = xAt(hoverIdx)
      const flip = x > width - 190
      const tip = h(
        'div',
        {
          class: 'tooltip',
          style: {
            left: flip ? '' : `${x + 14}px`,
            right: flip ? `${width - x + 14}px` : '',
            top: `${PAD_TOP}px`,
          },
        },
        [
          h('div', { class: 'tooltip-title', text: fmtBucket(new Date(xs[hoverIdx]), unit) }),
          ...series.map((ser) =>
            h('div', { class: 'tooltip-row' }, [
              h('span', { class: 'tooltip-key', style: { background: ser.color } }),
              h('span', { class: 'tooltip-value', text: fmtFull(ser.values[hoverIdx]) }),
              h('span', { class: 'tooltip-name', text: ser.name }),
            ]),
          ),
        ],
      )
      nodes.push(tip)
    }

    wrap.replaceChildren(...nodes)
  }

  function idxFromEvent(e) {
    const rect = wrap.getBoundingClientRect()
    const px = e.clientX - rect.left
    const n = xs.length
    if (n <= 1) return n - 1
    const t = (px - padLeft) / plotW()
    return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))))
  }

  function setHover(i) {
    if (i === hoverIdx) return
    hoverIdx = i
    draw()
  }

  wrap.addEventListener('pointermove', (e) => setHover(idxFromEvent(e)))
  wrap.addEventListener('pointerleave', () => setHover(null))
  wrap.addEventListener('blur', () => setHover(null))
  wrap.addEventListener('keydown', (e) => {
    const n = xs.length
    if (!n) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const d = e.key === 'ArrowRight' ? 1 : -1
      const cur = hoverIdx == null ? n - 1 : hoverIdx
      setHover(Math.max(0, Math.min(n - 1, cur + d)))
    } else if (e.key === 'Escape') {
      setHover(null)
    }
  })

  draw()
  wrap.__dispose = observeWidth(wrap, (w) => {
    if (Math.abs(w - width) < 0.5) return
    width = w
    draw()
  })

  return wrap
}

// ============================================================
// Горизонтальные бары: ≤24px толщиной, скруглённый конец-с-данными (4px),
// прямой у базовой линии; каждый бар подписан значением у конца.
// Марка — hit-target: hover подсвечивает ряд и показывает тултип.
// items — [{ label, value, other? }]
// ============================================================

export function barChart({ items, color = 'var(--series-1)', ariaLabel = 'Диаграмма' }) {
  const root = h('div', { class: 'bar-chart', role: 'img', 'aria-label': ariaLabel })
  if (!items.length) {
    root.append(h('p', { class: 'empty', text: 'Нет данных' }))
    return root
  }

  const vals = items.map((i) => i.value)
  const min = Math.min(0, ...vals)
  const max = Math.max(0, ...vals)
  const span = max - min || 1
  const zeroPct = ((0 - min) / span) * 100

  const bar = (v) => {
    const wPct = (Math.abs(v) / span) * 100
    return v >= 0
      ? { left: zeroPct, width: wPct, neg: false }
      : { left: ((v - min) / span) * 100, width: wPct, neg: true }
  }

  for (const it of items) {
    const g = bar(it.value)
    const fill = h('span', {
      class: g.neg ? 'bar-fill neg' : 'bar-fill',
      style: {
        left: g.left + '%',
        width: Math.max(g.width, 0.4) + '%',
        background: it.other ? 'var(--series-other)' : color,
      },
    })
    const valueLabel = h('span', {
      class: 'bar-value',
      style: g.neg
        ? { right: 100 - g.left + '%', paddingRight: '6px' }
        : { left: g.left + g.width + '%', paddingLeft: '6px' },
      text: fmtCompact(it.value),
    })
    const tooltip = h('span', { class: 'bar-tooltip', hidden: true }, [
      h('span', { class: 'bar-tooltip-value', text: fmtFull(it.value) }),
      h('span', { class: 'bar-tooltip-name', text: it.label }),
    ])

    const row = h('div', { class: 'bar-row', tabindex: '0' }, [
      h('span', { class: 'bar-label', title: it.label, text: it.label }),
      h('span', { class: 'bar-track' }, [fill, valueLabel]),
      tooltip,
    ])

    const on = () => {
      row.classList.add('hovered')
      tooltip.hidden = false
    }
    const off = () => {
      row.classList.remove('hovered')
      tooltip.hidden = true
    }
    row.addEventListener('pointerenter', on)
    row.addEventListener('pointerleave', off)
    row.addEventListener('focus', on)
    row.addEventListener('blur', off)

    root.append(row)
  }

  return root
}

// ============================================================
// 12-точечный спарклайн: линия приглушённым серым, текущий период — акцентная точка
// ============================================================

export function sparkline({ values, width = 110, height = 34 }) {
  if (!values || values.length < 2) return null
  const pad = 4
  let min = Math.min(...values)
  let max = Math.max(...values)
  if (min === max) {
    min -= 1
    max += 1
  }
  const w = width - pad * 2
  const hgt = height - pad * 2
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * w,
    pad + hgt - ((v - min) / (max - min)) * hgt,
  ])
  const last = pts[pts.length - 1]

  return s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' }, [
    s('polyline', {
      points: pts.map(([x, y]) => `${x},${y}`).join(' '),
      fill: 'none',
      stroke: 'var(--spark)',
      'stroke-width': 1.5,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
    s('circle', {
      cx: last[0],
      cy: last[1],
      r: 3,
      fill: 'var(--accent)',
      stroke: 'var(--surface-1)',
      'stroke-width': 2,
    }),
  ])
}
