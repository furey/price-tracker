import { isBotCheck } from './bot-checks.js'
import { ACCESSORY_CATEGORY, kitListings } from './kits.js'
import { DEFAULT_REGION } from './regions/index.js'
import { listingTrust } from './retailers.js'
import { formatPrice, roundToCurrency, sanitizeOutgoing } from './text.js'
import {
  CATEGORY_TUNED_PREFIX, NEVER_TUNED_PREFIX, applyTuning, isCategoryMuted, mutedSummary,
  noticeKey, priceAlertCandidates
} from './tuning.js'

const DEAL_PRIORITY = 4
const MUTED_PRIORITY = 3
const HEARTBEAT_PRIORITY = 2
const CHECK_PRIORITY = 2
const RRP_FLOOR_SHARE = 0.4
const CAP_FLOOR_SHARE = 0.5
const DEFAULT_DAY_TZ = DEFAULT_REGION.timeZone

export const decide = ({
  item, research, lastAlerts, lastMutedAlerts = new Map(), lastCheckAlerts = new Map(),
  region = DEFAULT_REGION
}) => {
  const listings = applyTuning({ item, listings: research.listings })
  const usable = eligibleListings(listings)
  const singles = usable.filter((listing) => !listing.tuned)
  const assembled = kitListings({
    item, listings: usable.filter((listing) => !isNeverTuned(listing)), region
  }).map((listing) => tuneKit({ item, listing }))
  const eligible = [...singles, ...assembled.filter((listing) => !listing.tuned)]
  const qualified = eligible
    .map((listing) => ({
      listing, ...qualify({ listing, rule: item.rules[listing.category], region })
    }))
    .filter((result) => result.qualifies)
    .map(({ listing, reasons }) => ({ listing, reasons }))
  const reasonsByListing = new Map(qualified.map((entry) => [entry.listing, entry.reasons]))
  const ranked = rankListings({
    listings: qualified.map((entry) => entry.listing),
    categories: item.categories
  }).map((listing) => ({ listing, reasons: reasonsByListing.get(listing) }))
  const minDrop = item.dedupe?.minDrop ?? 0
  const flagged = ranked
    .map((entry) => ({ ...entry, ...checkFor({ item, listing: entry.listing, region }) }))
    .filter((entry) => entry.concerns.length)
  const flaggedListings = new Set(flagged.map((entry) => entry.listing))
  const deals = ranked.filter((entry) => !flaggedListings.has(entry.listing))
  const passes = (entry) => passesDedupe({ listing: entry.listing, lastAlerts, minDrop })
  const best = deals.find(passes) ?? null
  const checkNotice = flagged.find((entry) => passesDedupe({
    listing: entry.listing, lastAlerts: lastCheckAlerts, minDrop
  })) ?? null
  const suppressed = [
    ...deals
      .filter((entry) => !passes(entry))
      .map(({ listing }) => ({
        listing, reason: suppressionReason({ listing, lastAlerts, region })
      })),
    ...flagged.map(({ listing, concerns }) => ({
      listing, reason: `check before buying: ${concerns.join('; ')}`
    }))
  ]
  const trampolines = eligible.filter((listing) => listing.category !== ACCESSORY_CATEGORY)
  const lowestPool = qualified.length ? qualified.map((entry) => entry.listing) : trampolines
  const priceAlerts = priceAlertCandidates({
    item, listings: [...listings, ...assembled]
  })
  return {
    eligible,
    kitListings: assembled,
    muted: [...usable, ...assembled].filter((listing) => listing.tuned),
    mutedNotice: priceAlerts.find((candidate) => passesDedupe({
      listing: candidate.listing,
      lastAlerts: lastMutedAlerts,
      minDrop,
      keyOf: noticeKey
    })) ?? null,
    qualified,
    ranked,
    best,
    checkNotice,
    suppressed,
    lowest: lowestListing(lowestPool),
    failedSources: (research.sources ?? []).filter((source) => source.status !== 'ok')
  }
}

export const eligibleListings = (listings) => listings
  .filter((listing) => listing.category !== 'reject')
  .filter((listing) => listing.inStock === true)
  .filter((listing) => Boolean(listing.url))
  .filter((listing) => typeof listing.price === 'number')
  .map((listing) => ({
    ...listing,
    effectivePrice: listing.effectivePrice ?? listing.price
  }))

export const qualify = ({ listing, rule, region = DEFAULT_REGION }) => {
  if (!rule) return { qualifies: false, reasons: ['no rule for category'] }
  const effective = listing.effectivePrice ?? listing.price
  const cap = capFor({ listing, rule })
  const rrpThreshold = rrpThresholdFor(rule)
  const qualifyingReasons = []
  const money = moneyFormatter(region)
  if (cap !== null && effective <= cap) qualifyingReasons.push(`under ${money(cap)} cap`)
  if (rrpThreshold !== null && effective <= rrpThreshold) {
    qualifyingReasons.push(rrpReason({ effective, rule, money }))
  }
  if (qualifyingReasons.length) return { qualifies: true, reasons: qualifyingReasons }
  return { qualifies: false, reasons: missReasons({ effective, cap, rrpThreshold, rule, money }) }
}

export const isImplausiblePrice = ({ listing, rule, region = DEFAULT_REGION }) =>
  implausiblePriceConcern({ listing, rule, region }) !== null

export const listingConcerns = ({ item, listing, region = DEFAULT_REGION }) =>
  checkFor({ item, listing, region }).concerns

export const rankListings = ({ listings, categories }) => {
  const categoryIndex = (listing) => {
    const index = categories.findIndex((category) => category.id === listing.category)
    return index === -1 ? categories.length : index
  }
  const effective = (listing) => listing.effectivePrice ?? listing.price
  return [...listings].sort((a, b) =>
    Number(Boolean(b.verified)) - Number(Boolean(a.verified))
    || categoryIndex(a) - categoryIndex(b)
    || effective(a) - effective(b))
}

export const dedupeKey = (listing) => `${listing.retailer.trim().toLowerCase()}|${listing.category}`

export const passesDedupe = ({ listing, lastAlerts, minDrop, keyOf = dedupeKey }) => {
  const last = lookupLastAlert({ lastAlerts, key: keyOf(listing) })
  if (!last) return true
  const effective = listing.effectivePrice ?? listing.price
  return effective < last.effectivePrice - minDrop
}

export const formatDealMessage = ({ item, listing, region = DEFAULT_REGION }) => {
  const money = moneyFormatter(region)
  const lines = [
    `Model: ${listing.title}`,
    `Price: ${priceText({ listing, money })}`,
    `Retailer: ${listing.retailer}`,
    ...notesLine({ listing, money })
  ]
  return {
    title: sanitizeOutgoing(`${item.name} deal found`),
    message: sanitizeOutgoing(lines.join('\n')),
    priority: DEAL_PRIORITY,
    click: listing.url
  }
}

export const formatMutedMessage = ({ item, notice, region = DEFAULT_REGION }) => {
  const { listing, kind, label, limit } = notice
  const money = moneyFormatter(region)
  const what = kind === 'never' ? `product you rejected (${label})` : `muted model (${label})`
  const lines = [
    `Model: ${listing.title}`,
    `Price: ${priceText({ listing, money })}`,
    `Retailer: ${listing.retailer}`,
    `This is a ${what}. You asked to hear if it drops below ${money(limit)}.`
  ]
  return {
    title: sanitizeOutgoing(`${item.name}: muted item below ${money(limit)}`),
    message: sanitizeOutgoing(lines.join('\n')),
    priority: MUTED_PRIORITY,
    click: listing.url
  }
}

export const formatCheckMessage = ({ item, notice, region = DEFAULT_REGION }) => {
  const { listing, host, concerns } = notice
  const lines = [
    `Site: ${host ?? 'unknown'}`,
    `Model: ${listing.title}`,
    `Price: ${priceText({ listing, money: moneyFormatter(region) })}`,
    `Listed as: ${listing.retailer}`,
    `Why: ${concerns.join('; ')}`,
    'Check this site is genuine before you buy. Open the dashboard for details.'
  ]
  return {
    title: sanitizeOutgoing(`${item.name}: check this listing`),
    message: sanitizeOutgoing(lines.join('\n')),
    priority: CHECK_PRIORITY
  }
}

export const formatHeartbeatMessage = ({
  item, lowest, failedSources, qualifiedCount, region = DEFAULT_REGION
}) => {
  const money = moneyFormatter(region)
  const lines = [
    lowest
      ? `Lowest seen: ${money(lowest.effectivePrice ?? lowest.price)} `
        + `at ${lowest.retailer}`
      : 'No in-stock listings found this run',
    `Qualifying listings: ${qualifiedCount}`,
    failedSources.length
      ? `Failed sources: ${failedSources.map((source) => source.name).join(', ')}`
      : 'All sources checked ok',
    botCheckSummary(failedSources),
    mutedSummary(item)
  ].filter(Boolean)
  const heartbeat = {
    title: sanitizeOutgoing(`${item.name} still tracking`),
    message: sanitizeOutgoing(lines.join('\n')),
    priority: HEARTBEAT_PRIORITY
  }
  return lowest?.url ? { ...heartbeat, click: lowest.url } : heartbeat
}

export const lowestPerRetailerPerDay = (rows, { tz = DEFAULT_DAY_TZ } = {}) => {
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  const groups = new Map()
  rows
    .filter((row) => typeof row.effectivePrice === 'number')
    .forEach((row) => {
      const day = dayFormat.format(new Date(row.checkedAt))
      const key = `${day}|${row.retailer.trim().toLowerCase()}|${row.category}`
      const current = groups.get(key)
      if (current && current.lowest <= row.effectivePrice) return
      groups.set(key, {
        day,
        retailer: row.retailer,
        category: row.category,
        lowest: row.effectivePrice,
        verified: Boolean(row.verified)
      })
    })
  return [...groups.values()].sort((a, b) =>
    a.day.localeCompare(b.day) || a.lowest - b.lowest || a.retailer.localeCompare(b.retailer))
}

const checkFor = ({ item, listing, region }) => {
  const trust = listingTrust({ item, listing, region })
  const priceConcern = implausiblePriceConcern({
    listing, rule: item.rules?.[listing.category], region
  })
  return {
    host: trust.host,
    concerns: [trust.trusted ? null : trust.reason, priceConcern].filter(Boolean)
  }
}

const implausiblePriceConcern = ({ listing, rule, region }) => {
  const prices = [listing.price, listing.effectivePrice ?? listing.price]
  if (prices.some((price) => !isNumber(price) || price <= 0)) return 'price is zero or missing'
  const floor = priceFloorFor({ rule, currency: region.currency })
  const effective = prices[1]
  if (floor === null || effective >= floor) return null
  const money = moneyFormatter(region)
  return `${money(effective)} is under ${money(floor)}, too cheap to be likely`
}

const priceFloorFor = ({ rule, currency }) => {
  if (isNumber(rule?.rrp) && rule.rrp > 0) {
    return roundToCurrency({ amount: rule.rrp * RRP_FLOOR_SHARE, currency })
  }
  if (isNumber(rule?.maxPrice) && rule.maxPrice > 0) {
    return roundToCurrency({ amount: rule.maxPrice * CAP_FLOOR_SHARE, currency })
  }
  return null
}

const isNeverTuned = (listing) => String(listing.tuned ?? '').startsWith(NEVER_TUNED_PREFIX)

const tuneKit = ({ item, listing }) => (isCategoryMuted({ item, category: listing.category })
  ? { ...listing, tuned: `${CATEGORY_TUNED_PREFIX}${listing.category}` }
  : listing)

const capFor = ({ listing, rule }) => {
  const useClearanceCap = listing.isClearance && isNumber(rule.maxPriceIfClearance)
  const cap = useClearanceCap ? rule.maxPriceIfClearance : rule.maxPrice
  return isNumber(cap) ? cap : null
}

const rrpThresholdFor = (rule) => isNumber(rule.rrp) && isNumber(rule.minPctBelowRrp)
  ? rule.rrp * (1 - rule.minPctBelowRrp / 100)
  : null

const rrpReason = ({ effective, rule, money }) => {
  const pctBelow = Math.round((1 - effective / rule.rrp) * 100)
  return `${pctBelow}% below RRP ${money(rule.rrp)}`
}

const missReasons = ({ effective, cap, rrpThreshold, rule, money }) => {
  const reasons = []
  if (cap !== null) reasons.push(`${money(effective)} over ${money(cap)} cap`)
  if (rrpThreshold !== null) {
    reasons.push(`less than ${rule.minPctBelowRrp}% below RRP ${money(rule.rrp)}`)
  }
  return reasons.length ? reasons : ['rule has no usable thresholds']
}

const lookupLastAlert = ({ lastAlerts, key }) => {
  if (!lastAlerts) return null
  return lastAlerts instanceof Map ? lastAlerts.get(key) ?? null : lastAlerts[key] ?? null
}

const suppressionReason = ({ listing, lastAlerts, region }) => {
  const last = lookupLastAlert({ lastAlerts, key: dedupeKey(listing) })
  const effective = listing.effectivePrice ?? listing.price
  const money = moneyFormatter(region)
  return `already alerted at ${money(last.effectivePrice)}, now ${money(effective)}`
}

const lowestListing = (listings) => listings.reduce(
  (lowest, listing) => !lowest || listing.effectivePrice < lowest.effectivePrice
    ? listing
    : lowest,
  null
)

const priceText = ({ listing, money }) => listing.wasPrice
  ? `${money(listing.price)} (was ${money(listing.wasPrice)})`
  : money(listing.price)

const notesLine = ({ listing, money }) => {
  const parts = [
    listing.notes,
    listing.isClearance ? 'clearance' : null,
    isNumber(listing.effectivePrice) && listing.effectivePrice < listing.price
      ? `effective ${money(listing.effectivePrice)} after promo`
      : null,
    listing.verified ? null : 'unverified',
    deliveryNote({ amount: listing.deliveryCost, money })
  ].filter(Boolean)
  return parts.length ? [`Notes: ${parts.join('; ')}`] : []
}

const botCheckSummary = (sources) => {
  const names = sources.filter(isBotCheck).map(({ name }) => name)
  return names.length ? `Asked for a bot check: ${names.join(', ')}` : null
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const deliveryNote = ({ amount, money }) => {
  if (!isNumber(amount)) return null
  return amount === 0 ? 'free delivery' : `delivery ${money(amount)}`
}

const moneyFormatter = (region) => (amount) =>
  formatPrice({ amount, currency: region.currency, locale: region.locale })
