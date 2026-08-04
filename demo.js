// Демо-набор: 120 дней продаж. Детерминированный генератор,
// чтобы дэшборд всегда выглядел одинаково.
import { inferTable } from './fileLoad.js'

const CHANNELS = [
  ['Сайт', 1.0],
  ['Маркетплейс', 0.75],
  ['Розница', 0.45],
  ['Партнёры', 0.2],
]
const REGIONS = ['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск']

// простой LCG вместо Math.random — воспроизводимо
function makeRand(seed) {
  let s = seed
  return () => {
    s = (s * 48271) % 2147483647
    return s / 2147483647
  }
}

export function demoTable() {
  const rand = makeRand(20260803)
  const rows = [['Дата', 'Канал', 'Регион', 'Выручка', 'Заказы']]
  const start = new Date(2026, 3, 5) // 5 апреля 2026, 120 дней до начала августа
  for (let d = 0; d < 120; d++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d)
    const growth = 1 + d / 160 // лёгкий тренд вверх
    const weekend = date.getDay() === 0 || date.getDay() === 6 ? 0.6 : 1
    for (const [channel, weight] of CHANNELS) {
      if (rand() < 0.12) continue // не каждый канал продаёт каждый день
      const region = REGIONS[Math.floor(rand() * REGIONS.length)]
      const orders = Math.max(1, Math.round((4 + rand() * 14) * weight * weekend * growth))
      const avgCheck = 1800 + rand() * 2600
      const revenue = Math.round(orders * avgCheck)
      const dd = String(date.getDate()).padStart(2, '0')
      const mm = String(date.getMonth() + 1).padStart(2, '0')
      rows.push([`${dd}.${mm}.${date.getFullYear()}`, channel, region, String(revenue), String(orders)])
    }
  }
  return inferTable(rows)
}
