import { DEFAULT_DELIVERY_DAYS, addDays } from './draft-schedule.js'
import { DEFAULT_REGION } from './regions/index.js'
import { formatPrice, sanitizeOutgoing } from './text.js'

export const LAST_CHANCE_KIND = 'last-chance'
export const DEFAULT_LAST_CHANCE_DAYS = 3

export const lastChanceDate = (deadline) => {
  if (!isDay(deadline?.needBy)) return null
  const deliveryDays = deadline.deliveryDays ?? DEFAULT_DELIVERY_DAYS
  const lastChanceDays = deadline.lastChanceDays ?? DEFAULT_LAST_CHANCE_DAYS
  return addDays(deadline.needBy, -(deliveryDays + lastChanceDays))
}

export const checksStopOn = (deadline) => (isDay(deadline?.needBy)
  ? addDays(deadline.needBy, -(deadline.deliveryDays ?? DEFAULT_DELIVERY_DAYS))
  : null)

export const lastChanceDue = ({ deadline, today }) => {
  const from = lastChanceDate(deadline)
  return from !== null && today >= from && today < deadline.needBy
}

export const lastChancePick = ({ item, listings }) => {
  const order = new Map((item.categories ?? []).map(({ id }, index) => [id, index]))
  const rank = (listing) => order.get(listing.category) ?? order.size
  return listings
    .filter((listing) => !listing.tuned && listing.inStock === true && priceOf(listing) !== null)
    .toSorted((a, b) => rank(a) - rank(b) || priceOf(a) - priceOf(b))[0] ?? null
}

export const formatLastChanceMessage = ({ item, listing, deadline, region = DEFAULT_REGION }) => {
  const money = (amount) => formatPrice({
    amount, currency: region.currency, locale: region.locale
  })
  const stop = formatDay({ day: checksStopOn(deadline), region })
  const needBy = formatDay({ day: deadline.needBy, region })
  const cap = listing ? item.rules?.[listing.category]?.maxPrice : null
  const lines = listing
    ? [
      `Lowest in-stock price: ${money(priceOf(listing))} at ${listing.retailer}`,
      `Model: ${listing.title}`,
      ...(typeof cap === 'number' ? [`Your alert price: ${money(cap)}`] : []),
      `Checks stop on ${stop}. Buy now to have it by ${needBy}.`
    ]
    : [`No in-stock listing found. Checks stop on ${stop}.`]
  const alert = {
    title: sanitizeOutgoing(`${item.name} last chance`),
    message: sanitizeOutgoing(lines.join('\n')),
    priority: LAST_CHANCE_PRIORITY
  }
  return listing?.url ? { ...alert, click: listing.url } : alert
}

const LAST_CHANCE_PRIORITY = 4
const DAY = /^\d{4}-\d{2}-\d{2}$/

const isDay = (value) => typeof value === 'string' && DAY.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const priceOf = (listing) => {
  const price = listing.effectivePrice ?? listing.price
  return typeof price === 'number' ? price : null
}

const formatDay = ({ day, region }) => new Intl.DateTimeFormat(region.locale, {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
}).format(new Date(`${day}T00:00:00Z`))
