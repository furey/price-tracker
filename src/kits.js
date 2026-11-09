import { DEFAULT_REGION } from './regions/index.js'
import { formatPrice } from './text.js'

export const ACCESSORY_CATEGORY = 'accessory'
export const KIT_SOURCE = 'kit'
export const KIT_RETAILER_PREFIX = 'Kit: '

export const kitPrice = ({ kit, listings }) => {
  const chosen = kit.parts.map((part) => ({
    part,
    listing: cheapestFor({ part, listings: listings.filter(isUsable) })
  }))
  const missing = chosen.filter(({ listing }) => !listing).map(({ part }) => part.id)
  const picked = chosen.filter(({ listing }) => listing)
  const total = sum(picked.map(({ listing }) => effectivePrice(listing)))
  const deliveryCost = deliveryTotal(picked.map(({ listing }) => listing))
  return {
    kit,
    complete: missing.length === 0,
    missing,
    chosen: picked,
    retailers: uniqueRetailers(picked),
    total,
    deliveryCost,
    delivered: deliveryCost === null ? null : total + deliveryCost
  }
}

export const kitListing = ({ kit, listings, region = DEFAULT_REGION }) => {
  const result = kitPrice({ kit, listings })
  if (!result.complete) return null
  const [trampoline] = result.chosen
  return {
    retailer: `${KIT_RETAILER_PREFIX}${result.retailers.join(', ')}`,
    title: `${kit.name} (parts)`,
    category: kit.category,
    part: null,
    rejectReason: null,
    price: result.total,
    wasPrice: null,
    effectivePrice: result.total,
    deliveryCost: result.deliveryCost,
    isClearance: false,
    inStock: true,
    verified: result.chosen.every(({ listing }) => listing.verified === true),
    url: trampoline.listing.url,
    evidence: result.chosen.map((chosen) => partSummary({ ...chosen, region })).join(' + '),
    notes: result.chosen.map((chosen) => partLine({ ...chosen, region })).join('; ')
  }
}

export const kitListings = ({ item, listings, region = DEFAULT_REGION }) => (item.kits ?? [])
  .map((kit) => kitListing({ kit, listings, region }))
  .filter(Boolean)

export const kitPartIds = (item) => [
  ...new Set((item.kits ?? []).flatMap((kit) => kit.parts.map((part) => part.id)))
]

export const accessoryPartIds = (item) => [
  ...new Set((item.kits ?? []).flatMap((kit) =>
    kit.parts.filter((part) => !part.match).map((part) => part.id)))
]

export const isKitListing = (listing) =>
  String(listing.retailer ?? '').startsWith(KIT_RETAILER_PREFIX)

const cheapestFor = ({ part, listings }) => listings
  .filter(matchesPart(part))
  .reduce((cheapest, listing) =>
    !cheapest || effectivePrice(listing) < effectivePrice(cheapest) ? listing : cheapest, null)

const matchesPart = (part) => (listing) => part.match
  ? listing.category === part.match && !listing.part
  : listing.part === part.id

const isUsable = (listing) => !isKitListing(listing)
  && listing.category !== 'reject'
  && listing.inStock === true
  && Boolean(listing.url)
  && Number.isFinite(effectivePrice(listing))

const effectivePrice = (listing) => listing.effectivePrice ?? listing.price

const deliveryTotal = (listings) => {
  const byRetailer = new Map()
  listings.forEach((listing) => {
    const key = listing.retailer.trim().toLowerCase()
    const known = Number.isFinite(listing.deliveryCost)
    const current = byRetailer.get(key)
    if (current === null || !known) return byRetailer.set(key, null)
    byRetailer.set(key, Math.max(current ?? 0, listing.deliveryCost))
  })
  const amounts = [...byRetailer.values()]
  return amounts.some((amount) => amount === null) ? null : sum(amounts)
}

const uniqueRetailers = (picked) => [
  ...new Set(picked.map(({ listing }) => listing.retailer))
]

const partSummary = ({ part, listing, region }) =>
  `${part.id} ${priceOf({ listing, region })} at ${listing.retailer}`

const partLine = ({ part, listing, region }) =>
  `${part.id}: ${listing.title} ${priceOf({ listing, region })} at ${listing.retailer} `
  + `(${listing.url})`

const priceOf = ({ listing, region }) => formatPrice({
  amount: effectivePrice(listing), currency: region.currency, locale: region.locale
})

const sum = (numbers) => numbers.reduce((total, number) => total + number, 0)
