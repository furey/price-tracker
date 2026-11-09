import { getAlert, getRun, previousDealAlert, runListings } from './db.js'
import { dedupeKey, listingConcerns, qualify, rankListings } from './decide.js'
import { hostOf } from './retailers.js'
import { DEFAULT_REGION } from './regions/index.js'
import { formatPrice } from './text.js'
import { tuningEntryFor } from './tuning.js'
import { itemVersionConfig } from './item-store.js'

const LISTING_KINDS = ['deal', 'muted', 'check']

export const alertDetail = ({ db, id, region = DEFAULT_REGION, tzFor = () => region.timeZone }) => {
  const alert = getAlert({ db, id })
  if (!alert) return null
  const run = alert.runId ? getRun({ db, id: alert.runId }) : null
  const config = run?.itemVersion
    ? itemVersionConfig({ db, id: alert.itemId, version: run.itemVersion })
    : null
  const listings = run ? runListings({ db, runId: run.id }) : []
  const listing = LISTING_KINDS.includes(alert.kind) ? findListing({ alert, listings }) : null
  const day = dayOf({
    at: listing?.checkedAt ?? alert.sentAt,
    tz: tzFor(alert.itemId) ?? region.timeZone
  })
  return {
    alert,
    listing: listing ? withDeliveredTotal(listing) : null,
    why: listing && config
      ? whyFor({ db, alert, listing, listings, config, run, region })
      : null,
    check: alert.kind === 'check' ? checkOf({ alert, listing, config, region }) : null,
    day,
    run: run ? describeRun(run) : null
  }
}

const checkOf = ({ alert, listing, config, region }) => ({
  host: hostOf(listing?.url ?? alert.url),
  concerns: listing && config ? listingConcerns({ item: config, listing, region }) : []
})

const whyFor = (context) => (context.alert.kind === 'muted'
  ? explainMuted(context)
  : explain(context))

const explainMuted = ({ alert, listing, config, run, region }) => {
  const found = tuningEntryFor({ item: config, tuned: alert.category })
  const limit = found?.entry?.notifyBelow ?? null
  const what = found?.kind === 'never' ? 'the product you rejected' : 'the muted model'
  return {
    muted: true,
    category: listing.category,
    categoryDescription: null,
    version: run.itemVersion,
    rule: null,
    reasons: [limit === null
      ? `A price alert on ${what} ${found?.label ?? ''}`.trim()
      : `Below your ${money({ amount: limit, region })} price alert on ${what} ${
        found?.label ?? ''}`.trim()],
    rank: null,
    dedupe: { key: alert.category, minDrop: config.dedupe?.minDrop ?? 0, previous: null }
  }
}

const explain = ({ db, alert, listing, listings, config, run, region }) => {
  const rule = config.rules?.[listing.category] ?? null
  const category = config.categories?.find(({ id }) => id === listing.category) ?? null
  const { reasons } = qualify({ listing, rule, region })
  return {
    category: listing.category,
    categoryDescription: category?.description ?? null,
    version: run.itemVersion,
    rule,
    reasons: reasons.map((reason) => describeReason({ reason, category: listing.category })),
    rank: rankOf({ listing, listings, categories: config.categories ?? [] }),
    dedupe: dedupeOf({ db, alert, minDrop: config.dedupe?.minDrop ?? 0, region })
  }
}

const describeReason = ({ reason, category }) => {
  const cap = /^under (.+) cap$/.exec(reason)
  return cap
    ? `Under the ${cap[1]} alert price for ${category}`
    : `${reason[0].toUpperCase()}${reason.slice(1)} for ${category}`
}

const rankOf = ({ listing, listings, categories }) => {
  const qualified = listings.filter((entry) => entry.qualifies)
  const ranked = rankListings({ listings: qualified, categories })
  const position = ranked.findIndex((entry) => entry.id === listing.id)
  return position === -1 ? null : { position: position + 1, of: ranked.length }
}

const dedupeOf = ({ db, alert, minDrop, region }) => {
  const previous = previousDealAlert({ db, alert })
  const key = dedupeKey({ retailer: alert.retailer ?? '', category: alert.category })
  if (!previous) return { key, minDrop, previous: null, dropAmount: null }
  const dropAmount = previous.effectivePrice - alert.effectivePrice
  return {
    key,
    minDrop,
    previous: {
      id: previous.id, sentAt: previous.sentAt, effectivePrice: previous.effectivePrice
    },
    dropAmount,
    summary: `Last alert for this retailer and category was ${money({
      amount: previous.effectivePrice, region
    })}; this is ${money({ amount: dropAmount, region })} lower (minimum drop ${money({
      amount: minDrop, region
    })}).`
  }
}

const findListing = ({ alert, listings }) => {
  const sameSubject = (entry) => (alert.kind === 'muted'
    ? entry.tuned === alert.category
    : entry.category === alert.category)
  const matches = listings.filter((entry) =>
    entry.retailer?.toLowerCase() === alert.retailer?.toLowerCase()
    && sameSubject(entry)
    && entry.effectivePrice === alert.effectivePrice)
  return matches.find((entry) => entry.url === alert.url) ?? matches[0] ?? null
}

const withDeliveredTotal = (listing) => ({
  ...listing,
  deliveredTotal: typeof listing.deliveryCost === 'number'
    ? (listing.effectivePrice ?? listing.price) + listing.deliveryCost
    : null
})

const money = ({ amount, region }) =>
  formatPrice({ amount, currency: region.currency, locale: region.locale })

const describeRun = (run) => ({
  id: run.id,
  mode: run.mode,
  trigger: run.trigger,
  status: run.status,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  itemVersion: run.itemVersion,
  sources: run.research?.sources ?? []
})

const dayOf = ({ at, tz }) => new Intl.DateTimeFormat('en-CA', { timeZone: tz })
  .format(new Date(at))
