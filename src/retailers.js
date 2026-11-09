import { DEFAULT_REGION } from './regions/index.js'
import { linkUrl } from './url-rules.js'

const NOISE_WORDS = ['warehouse', 'australia', 'au', 'online', 'store']
const DOMAIN_PATTERN = /\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+)(?:\.com\.au|\.net\.au|\.com)\b/gi
const PARENTHETICAL_PATTERN = /\(([^)]*)\)/g
const EBAY_NAME_PATTERN = /^\s*ebay(?:\.com(?:\.au)?)?\b\s*(?:au\b)?\s*[-:,]?\s*(.*)$/i
const EBAY_HOST_PATTERN = /(^|\.)ebay\.com(\.au)?$/i
const SOLD_BY_PREFIX = /^\s*sold\s+by\s+/i
const SOLD_BY_PATTERN = /^\s*sold\s+by\s+(.+?)\s*$/i

export const canonicalRetailer = ({ name, knownRetailers = [] }) => {
  const cleaned = cleanName(name)
  const key = comparisonKey(name)
  const match = knownRetailers.find((known) => comparisonKey(known) === key)
  return match ?? cleaned
}

export const sellerNote = (name) => {
  const seller = parentheticals(name)
    .map((text) => SOLD_BY_PATTERN.exec(text)?.[1])
    .find(Boolean)
  return seller ? `Sold by ${seller}` : null
}

export const knownRetailersFor = (item) => [
  ...(item.sources?.sites ?? []).map((site) => site.name),
  ...(item.direct ?? []).map((entry) => entry.retailer)
].filter(Boolean)

export const listingTrust = ({ item, listing, region = DEFAULT_REGION }) => {
  const host = hostOf(listing.url)
  if (!host) return { trusted: false, host: null, reason: 'listing has no web address' }
  const sites = trustedSitesFor({ item, region })
  const claimed = sites.filter((site) => nameClaims({ retailer: listing.retailer, site }))
  if (claimed.length && !claimed.some((site) => hostBelongsTo({ host, site }))) {
    return { trusted: false, host, reason: `${listing.retailer} named but the site is ${host}` }
  }
  const known = sites.some((site) => hostBelongsTo({ host, site }))
  if (known) return { trusted: true, host, reason: null }
  return { trusted: false, host, reason: `unrecognised site ${host}` }
}

export const retailerHomeUrl = ({ name, region = DEFAULT_REGION }) => {
  const site = region.retailers.find((retailer) => nameClaims({ retailer: name, site: retailer }))
  return site?.hosts?.length ? linkUrl(`https://${site.hosts[0]}/`) : null
}

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export const normaliseListings = ({ item, listings, region = DEFAULT_REGION }) => {
  const knownRetailers = knownRetailersFor(item)
  return listings.map((listing) => normaliseListing({ listing, knownRetailers, region }))
}

const normaliseListing = ({ listing, knownRetailers, region }) => {
  if (typeof listing.retailer !== 'string') return listing
  const original = listing.retailer.trim()
  const ebaySeller = ebaySellerOf({ original, url: listing.url })
  if (ebaySeller !== null) {
    return normaliseEbayListing({ listing, seller: ebaySeller, retailer: region.ebayRetailer })
  }
  const retailer = canonicalRetailer({ name: original, knownRetailers })
  const additions = [
    sellerNote(original),
    retailer === original ? null : `Listed as: ${original}`
  ].filter(Boolean)
  if (additions.length === 0) return { ...listing, retailer }
  const notes = [...additions, listing.notes].filter(Boolean).join('; ')
  return { ...listing, retailer, notes }
}

const normaliseEbayListing = ({ listing, seller, retailer }) => {
  const note = seller ? `Sold by ${seller} on eBay` : null
  const notes = [note, listing.notes].filter(Boolean).join('; ')
  return { ...listing, retailer, notes }
}

const ebaySellerOf = ({ original, url }) => {
  const named = EBAY_NAME_PATTERN.exec(original)
  if (named) return sellerFromRemainder(named[1])
  return isEbayUrl(url) ? sellerFromRemainder(original) : null
}

const sellerFromRemainder = (remainder) => {
  const text = remainder.trim()
  const soldBy = parentheticals(text)
    .map((inner) => SOLD_BY_PATTERN.exec(inner)?.[1])
    .find(Boolean)
  const bare = text.replace(PARENTHETICAL_PATTERN, ' ').replace(SOLD_BY_PREFIX, '').trim()
  const inner = parentheticals(text)[0]?.trim()
  return soldBy ?? (bare || inner || '').replace(SOLD_BY_PREFIX, '').trim()
}

const isEbayUrl = (url) => {
  try {
    return EBAY_HOST_PATTERN.test(new URL(url).hostname)
  } catch {
    return false
  }
}

const cleanName = (name) => {
  const original = String(name ?? '').trim()
  const cleaned = stripNoiseWords(
    original
      .replace(PARENTHETICAL_PATTERN, ' ')
      .replace(DOMAIN_PATTERN, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
  return cleaned || original
}

const stripNoiseWords = (text) => {
  const words = text.split(' ')
  while (words.length > 1 && NOISE_WORDS.includes(words.at(-1).toLowerCase())) words.pop()
  return words.join(' ')
}

const comparisonKey = (name) => cleanName(name).toLowerCase()

const trustedSitesFor = ({ item, region }) => [
  ...region.retailers,
  ...(item?.sources?.sites ?? []).map((site) => ({ names: [site.name], url: site.url })),
  ...(item?.direct ?? []).map((entry) => ({ names: [entry.retailer], url: entry.url }))
].map(({ names, hosts = [], url }) => ({
  names: names.filter(Boolean),
  hosts: [...hosts, hostOf(url)].filter(Boolean)
})).filter((site) => site.hosts.length)

const nameClaims = ({ retailer, site }) => {
  const claimed = `${nameWords(retailer)} `
  return site.names.some((name) => nameWords(name) && claimed.startsWith(`${nameWords(name)} `))
}

const hostBelongsTo = ({ host, site }) =>
  site.hosts.some((known) => host === known || host.endsWith(`.${known}`))

const nameWords = (name) => String(name ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

const parentheticals = (name) =>
  [...String(name ?? '').matchAll(PARENTHETICAL_PATTERN)].map((match) => match[1])
