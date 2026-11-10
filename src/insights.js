import { dedupeKey, qualify } from './decide.js'
import { KIT_SOURCE, kitPrice } from './kits.js'
import { mutedReason } from './tuning.js'
import { DEFAULT_REGION } from './regions/index.js'

const DEFAULT_TZ = DEFAULT_REGION.timeZone
const MS_PER_DAY = 86_400_000
const MAX_GAP_DAYS = 2

export const buildInsights = ({
  rows, item, alerts = [], tz = DEFAULT_TZ, now, rulesByVersion = new Map()
}) => {
  const { live, muted, kitRows } = splitMuted({ rows, item })
  return {
    series: [...priceSeries(live, { tz }), ...markMuted(priceSeries(muted, { tz }))],
    bestDays: bestDays(live, { tz }),
    dealWindows: dealWindows({ rows: live, item, alerts, tz, now, rulesByVersion }),
    priceChanges: priceChanges(live, { tz }),
    retailers: [
      ...retailerSummaries(live, { tz }),
      ...markMuted(retailerSummaries(muted, { tz }))
    ],
    kits: kitInsights({ rows: kitRows, item }),
    mutedCount: muted.length
  }
}

export const splitMuted = ({ rows, item }) => {
  const reasonOf = (row) => (item ? mutedReason({ item, listing: row }) : null)
  const marked = rows.map((row) => ({ row, reason: reasonOf(row) }))
  return {
    live: marked.filter(({ reason }) => !reason).map(({ row }) => row),
    muted: marked.filter(({ reason }) => reason)
      .map(({ row, reason }) => ({ ...row, muted: reason })),
    kitRows: marked.filter(({ reason }) => reason !== 'never').map(({ row }) => row)
  }
}

export const priceSeries = (rows, { tz = DEFAULT_TZ } = {}) => {
  const groups = new Map()
  priced(rows).forEach((row) => {
    const day = dayOf({ iso: row.checkedAt, tz })
    const key = `${day}|${dedupeKey(row)}`
    const group = groups.get(key) ?? { observations: 0, sources: new Set(), lowestRow: null }
    group.observations += 1
    if (row.source) group.sources.add(row.source)
    if (!group.lowestRow || row.effectivePrice < group.lowestRow.effectivePrice) {
      group.lowestRow = row
    }
    groups.set(key, { ...group, day })
  })
  return [...groups.values()]
    .map(({ day, observations, sources, lowestRow }) => ({
      day,
      retailer: lowestRow.retailer,
      category: lowestRow.category,
      lowest: lowestRow.effectivePrice,
      verified: Boolean(lowestRow.verified),
      qualifies: Boolean(lowestRow.qualifies),
      source: lowestRow.source ?? null,
      url: lowestRow.url ?? null,
      sources: [...sources].sort(),
      observations
    }))
    .sort((a, b) =>
      a.day.localeCompare(b.day) || a.lowest - b.lowest || a.retailer.localeCompare(b.retailer))
}

export const bestDays = (rows, { tz = DEFAULT_TZ } = {}) => {
  const best = new Map()
  priced(rows).forEach((row) => {
    const current = best.get(row.category)
    if (!current || isBetter({ row, than: current })) best.set(row.category, row)
  })
  return [...best.values()]
    .map((row) => describeObservation({ row, tz }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

export const dealWindows = ({
  rows, item, alerts = [], tz = DEFAULT_TZ, now, rulesByVersion = new Map()
}) => {
  const observed = priced(rows)
  const asOfDay = dayOf({ iso: now ? toIso(now) : latestCheckedAt(observed), tz })
  const dealAlerts = alerts.filter(isDeliveredDeal)
  return [...groupBy({ items: observed, keyOf: dedupeKey }).entries()]
    .flatMap(([key, keyRows]) => windowsFor({
      key, keyRows, tz, ruleFor: ruleForRow({ item, rulesByVersion })
    }))
    .map((window) => finishWindow({ window, dealAlerts, asOfDay, tz }))
    .sort((a, b) => b.startDay.localeCompare(a.startDay) || a.retailer.localeCompare(b.retailer))
}

export const priceChanges = (rows, { tz = DEFAULT_TZ } = {}) => {
  const bestRowPerDay = priceSeries(rows, { tz })
  return [...groupBy({ items: bestRowPerDay, keyOf: dedupeKey }).values()]
    .flatMap((days) => days.slice(1).map((day, index) => changeBetween({
      before: days[index], after: day
    })))
    .filter(Boolean)
    .sort((a, b) => b.day.localeCompare(a.day) || a.retailer.localeCompare(b.retailer))
}

export const retailerSummaries = (rows, { tz = DEFAULT_TZ } = {}) => {
  const series = priceSeries(rows, { tz })
  const seriesByKey = groupBy({ items: series, keyOf: dedupeKey })
  return [...groupBy({ items: priced(rows), keyOf: dedupeKey }).values()]
    .map((keyRows) => summarise({ keyRows, days: seriesByKey.get(dedupeKey(keyRows[0])) }))
    .sort((a, b) => a.lowest - b.lowest || a.retailer.localeCompare(b.retailer))
}

export const kitInsights = ({ rows, item }) => {
  const singles = priced(rows).filter((row) => row.source !== KIT_SOURCE)
  return (item?.kits ?? [])
    .map((kit) => kitInsight({ kit, singles }))
    .filter(Boolean)
}

const markMuted = (entries) => entries.map((entry) => ({ ...entry, muted: true }))

const kitInsight = ({ kit, singles }) => {
  const result = kitPrice({ kit, listings: singles })
  if (!result.complete) return null
  return {
    id: kit.id,
    name: kit.name,
    total: result.total,
    delivered: result.delivered,
    parts: result.chosen.map(describePart),
    vsBundle: bundleComparison({ kit, total: result.total, singles })
  }
}

const describePart = ({ part, listing }) => ({
  id: part.id,
  name: part.name ?? part.id,
  retailer: listing.retailer,
  title: listing.title ?? null,
  price: listing.effectivePrice,
  deliveryCost: listing.deliveryCost ?? null,
  url: listing.url ?? null,
  verified: Boolean(listing.verified)
})

const bundleComparison = ({ kit, total, singles }) => {
  const cheapest = singles
    .filter((row) => row.category === kit.category)
    .reduce((best, row) => !best || row.effectivePrice < best.effectivePrice ? row : best,
      null)
  if (!cheapest) return null
  return {
    bundlePrice: cheapest.effectivePrice,
    retailer: cheapest.retailer,
    title: cheapest.title ?? null,
    url: cheapest.url ?? null,
    saving: cheapest.effectivePrice - total
  }
}

const ruleForRow = ({ item, rulesByVersion }) => (row) => {
  const versionRules = rulesByVersion.get(row.itemVersion)
  return (versionRules ?? item.rules ?? {})[row.category]
}

const windowsFor = ({ key, keyRows, tz, ruleFor }) => {
  const days = [...groupBy({
    items: keyRows,
    keyOf: (row) => dayOf({ iso: row.checkedAt, tz })
  }).entries()].sort(([a], [b]) => a.localeCompare(b))
  const windows = []
  let open = null
  days.forEach(([day, dayRows]) => {
    const qualifying = dayRows.filter((row) => qualify({ listing: row, rule: ruleFor(row) })
      .qualifies)
    if (qualifying.length === 0) {
      open = null
      return
    }
    if (open && dayNumber(day) - dayNumber(open.endDay) <= MAX_GAP_DAYS) {
      open.endDay = day
      open.rows.push(...qualifying)
      return
    }
    open = { key, startDay: day, endDay: day, rows: [...qualifying] }
    windows.push(open)
  })
  const lastObservedDay = days.at(-1)[0]
  return windows.map((window) => ({ ...window, lastObservedDay }))
}

const finishWindow = ({ window, dealAlerts, asOfDay, tz }) => {
  const sorted = [...window.rows].sort((a, b) => a.checkedAt.localeCompare(b.checkedAt))
  const best = sorted.reduce((current, row) => isBetter({ row, than: current }) ? row : current)
  const alert = firstAlertWithin({ window, dealAlerts, tz })
  const live = window.endDay === window.lastObservedDay
    && dayNumber(asOfDay) - dayNumber(window.endDay) < MAX_GAP_DAYS
  return {
    retailer: best.retailer,
    category: best.category,
    startDay: window.startDay,
    endDay: window.endDay,
    startAt: sorted[0].checkedAt,
    endAt: sorted.at(-1).checkedAt,
    live,
    lowest: best.effectivePrice,
    observations: sorted.length,
    alertSent: Boolean(alert),
    alert: alert ? { sentAt: alert.sentAt, effectivePrice: alert.effectivePrice } : null,
    best: describeObservation({ row: best, tz })
  }
}

const firstAlertWithin = ({ window, dealAlerts, tz }) => dealAlerts
  .filter((alert) => alert.retailer && alert.category && dedupeKey(alert) === window.key)
  .filter((alert) => {
    const day = dayOf({ iso: alert.sentAt, tz })
    return day >= window.startDay && day <= window.endDay
  })
  .sort((a, b) => a.sentAt.localeCompare(b.sentAt))[0] ?? null

const changeBetween = ({ before, after }) => {
  const delta = after.lowest - before.lowest
  if (Math.abs(delta) < 1) return null
  return {
    retailer: after.retailer,
    category: after.category,
    day: after.day,
    previousDay: before.day,
    from: before.lowest,
    to: after.lowest,
    delta,
    direction: delta < 0 ? 'drop' : 'rise',
    source: after.source,
    url: after.url
  }
}

const summarise = ({ keyRows, days }) => {
  const byTime = [...keyRows].sort((a, b) =>
    a.checkedAt.localeCompare(b.checkedAt) || b.effectivePrice - a.effectivePrice)
  const latest = byTime.at(-1)
  const prices = keyRows.map((row) => row.effectivePrice)
  return {
    retailer: latest.retailer,
    category: latest.category,
    latest: latest.effectivePrice,
    latestIsClearance: Boolean(latest.isClearance),
    latestDeliveryCost: latest.deliveryCost ?? null,
    latestDelivered: deliveredTotal(latest),
    lowest: Math.min(...prices),
    highest: Math.max(...prices),
    lastSeen: latest.checkedAt,
    url: latest.url ?? null,
    sources: [...new Set(keyRows.map((row) => row.source).filter(Boolean))].sort(),
    sparkline: days.map(({ day, lowest }) => ({ day, value: lowest }))
  }
}

const describeObservation = ({ row, tz }) => ({
  category: row.category,
  retailer: row.retailer,
  title: row.title ?? null,
  effectivePrice: row.effectivePrice,
  price: row.price ?? null,
  wasPrice: row.wasPrice ?? null,
  deliveryCost: row.deliveryCost ?? null,
  deliveredTotal: deliveredTotal(row),
  day: dayOf({ iso: row.checkedAt, tz }),
  checkedAt: row.checkedAt,
  url: row.url ?? null,
  evidence: row.evidence ?? null,
  notes: row.notes ?? null,
  verified: Boolean(row.verified),
  source: row.source ?? null
})

const deliveredTotal = (row) => Number.isFinite(row.deliveryCost)
  ? row.effectivePrice + row.deliveryCost
  : null

const isBetter = ({ row, than }) =>
  row.effectivePrice < than.effectivePrice
  || (row.effectivePrice === than.effectivePrice && row.checkedAt < than.checkedAt)

const isDeliveredDeal = (alert) => alert.kind === 'deal' && alert.delivered !== false

const priced = (rows) => rows
  .filter((row) => row.category !== 'reject' && row.inStock !== false)
  .filter((row) => Number.isFinite(row.effectivePrice))

const latestCheckedAt = (rows) => rows.reduce(
  (latest, row) => (row.checkedAt > latest ? row.checkedAt : latest),
  '1970-01-01T00:00:00.000Z'
)

const groupBy = ({ items, keyOf }) => {
  const groups = new Map()
  items.forEach((item) => {
    const key = keyOf(item)
    groups.set(key, [...(groups.get(key) ?? []), item])
  })
  return groups
}

const dayOf = ({ iso, tz }) => new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  .format(new Date(iso))

const dayNumber = (day) => Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY

const toIso = (value) => (value instanceof Date ? value.toISOString() : value)
