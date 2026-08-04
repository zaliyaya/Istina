// Мини-хелперы вместо шаблонов Vue: h() строит HTML-узел, s() — SVG-узел.
// Всё остальное приложение работает обычными DOM-методами.

const SVG_NS = 'http://www.w3.org/2000/svg'
const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'textContent'])

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.setAttribute('class', v)
    else if (k === 'style') Object.assign(el.style, v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v)
    } else if (k === 'text') el.textContent = v
    else if (PROP_KEYS.has(k)) el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
}

function appendAll(el, children) {
  const list = Array.isArray(children) ? children : [children]
  for (const c of list) {
    if (c == null || c === false) continue
    if (Array.isArray(c)) appendAll(el, c)
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag)
  const { value, ...rest } = props || {}
  applyProps(el, rest)
  appendAll(el, children)
  // value у <select> выставляем после <option>, иначе не найдёт вариант
  if (value !== undefined && value !== null) el.value = value
  return el
}

export function s(tag, props = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'text') el.textContent = v
    else el.setAttribute(k, v)
  }
  appendAll(el, children)
  return el
}

// Виджеты с ResizeObserver помечаются data-widget и кладут отписку в __dispose;
// перед заменой содержимого её нужно вызвать, иначе наблюдатели копятся.
export function setChildren(host, children) {
  for (const node of host.querySelectorAll('[data-widget]')) {
    if (typeof node.__dispose === 'function') node.__dispose()
  }
  host.replaceChildren()
  appendAll(host, children)
}
