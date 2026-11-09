import { mutedReason } from './tuning.js'
import { DEFAULT_REGION } from './regions/index.js'

const DEFAULT_TZ = DEFAULT_REGION.timeZone

export const TREND_DAYS = 30

export const headlinePrices = ({ rows, item, tz = DEFAULT_TZ }) => {
  const usable = rows.filter((row) => row.category !== 'reject')
    .filter((row) => !mutedReason({ item, listing: row }))
  const category = headlineCategory({ rows: usable, item })
  if (!category) return { lowestRecent: null, trend: null }
  const inCategory = usable.filter((row) => row.category === category)
  return {
    lowestRecent: lowestRecent(inCategory),
    trend: itemTrend({ rows: inCategory, item, tz })
  }
}

export const headlineCategory = ({ rows, item }) => item.categories
  .find(({ id }) => rows.some((row) => row.category === id))?.id ?? null

export const itemTrend = ({ rows, item, tz = DEFAULT_TZ }) => {
  const category = item.categories.find(({ id }) => rows.some((row) => row.category === id))
  if (!category) return null
  return {
    category: category.id,
    days: lowestPerDay({ rows: rows.filter((row) => row.category === category.id), tz }),
    alertPrice: item.rules?.[category.id]?.maxPrice ?? null
  }
}

const lowestRecent = (rows) => {
  const cheapest = rows.reduce(
    (best, row) => (!best || row.effectivePrice < best.effectivePrice ? row : best),
    null
  )
  if (!cheapest) return null
  const { effectivePrice, retailer, category, checkedAt, url, verified } = cheapest
  return { effectivePrice, retailer, category, checkedAt, url, verified }
}

const lowestPerDay = ({ rows, tz }) => {
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  const lowest = new Map()
  rows.forEach((row) => {
    const day = dayFormat.format(new Date(row.checkedAt))
    const current = lowest.get(day)
    if (current === undefined || row.effectivePrice < current) {
      lowest.set(day, row.effectivePrice)
    }
  })
  return [...lowest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, price]) => ({ day, lowest: price }))
}
