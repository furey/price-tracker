import { isCategoryMuted } from './tuning.js'

export const RECENT_DAYS = 7

export const itemVerdict = ({ item, dealWindows = [], retailers = [], now = new Date() }) => {
  const order = watchedOrder(item)
  const live = liveDeal({ dealWindows, order })
  if (live) return live
  const offers = recentOffers({ item, retailers, now, order })
  if (!offers.length) return { kind: 'none' }
  const ruled = offers.filter(({ target }) => target !== null)
  if (!ruled.length) return { kind: 'no-rule', ...pickOffer(offers, byPrice(order)) }
  const closest = pickOffer(ruled, byGap(order))
  if (closest.gap <= 0) return { kind: 'deal', ...closest, live: false }
  return { kind: 'gap', ...closest }
}

export const hasLiveDeal = ({ item, dealWindows = [] }) =>
  Boolean(liveDeal({ dealWindows, order: watchedOrder(item) }))

export const bestRecentByCategory = ({ item, retailers = [], now = new Date() }) => {
  const order = watchedOrder(item)
  const offers = recentOffers({ item, retailers, now, order })
  return new Map(order
    .map((category) => [category, pickOffer(
      offers.filter((offer) => offer.category === category), byPrice(order)
    )])
    .filter(([, offer]) => offer))
}

export const targetPrice = ({ rule, isClearance = false }) => {
  if (!rule) return null
  const cap = isClearance && isNumber(rule.maxPriceIfClearance)
    ? rule.maxPriceIfClearance
    : rule.maxPrice
  const rrpTarget = isNumber(rule.rrp) && isNumber(rule.minPctBelowRrp)
    ? rule.rrp * (1 - rule.minPctBelowRrp / 100)
    : null
  const targets = [cap, rrpTarget].filter(isNumber)
  return targets.length ? Math.max(...targets) : null
}

const watchedOrder = (item) => (item?.categories ?? [])
  .map(({ id }) => id)
  .filter((category) => !isCategoryMuted({ item, category }))

const liveDeal = ({ dealWindows, order }) => {
  const live = dealWindows
    .filter((window) => window.live && order.includes(window.category))
    .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)
      || a.lowest - b.lowest)
  const [window] = live
  if (!window) return null
  return {
    kind: 'deal',
    live: true,
    category: window.category,
    retailer: window.retailer,
    price: window.best?.effectivePrice ?? window.lowest,
    url: window.best?.url ?? null,
    since: window.startDay
  }
}

const recentOffers = ({ item, retailers, now, order }) => {
  const since = now.getTime() - RECENT_DAYS * DAY_MS
  return retailers
    .filter((row) => !row.muted && order.includes(row.category))
    .filter((row) => isNumber(row.latest) && Date.parse(row.lastSeen) >= since)
    .map((row) => offerFrom({ row, rule: item.rules?.[row.category] }))
}

const offerFrom = ({ row, rule }) => {
  const target = targetPrice({ rule, isClearance: row.latestIsClearance })
  return {
    category: row.category,
    retailer: row.retailer,
    price: row.latest,
    url: row.url ?? null,
    target,
    gap: target === null ? null : row.latest - target
  }
}

const pickOffer = (offers, compare) => [...offers].sort(compare)[0]

const byPrice = (order) => (a, b) => a.price - b.price
  || order.indexOf(a.category) - order.indexOf(b.category)

const byGap = (order) => (a, b) => a.gap / a.target - b.gap / b.target
  || order.indexOf(a.category) - order.indexOf(b.category)
  || a.price - b.price

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const DAY_MS = 86_400_000
