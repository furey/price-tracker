import { ACCESSORY_CATEGORY, kitPartIds } from './kits.js'
import { DEFAULT_REGION, isHomeHost } from './regions/index.js'
import { hostOf } from './retailers.js'
import { enabledDirect } from './tuning.js'
import { validateResearch } from './validate.js'
import {
  BLOCKED_FETCH_NOTE, linkUrl, publicUrlProblem, safeFetch, unsafeUrlError
} from './safe-url.js'
import { variantMatcher } from './variant-filter.js'

export { DIRECT_PARSERS } from './direct-parsers.js'

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REQUEST_TIMEOUT_MS = 25_000
const SHOPIFY_FALLBACK_GAP_MS = 20_000
const JSON_LD_GAP_MS = 5_000
const CATALOG_PAGE_SIZE = 250
const MAX_CATALOG_PAGES = 4
const BLOCKED_STATUSES = [403, 429]
const CHALLENGE_MARKERS = [
  'Just a moment...',
  'Pardon Our Interruption',
  'Attention Required! | Cloudflare',
  'cf-browser-verification',
  'px-captcha',
  '_Incapsula_Resource',
  'Access Denied'
]

export const checkDirect = async ({
  item,
  fetchImpl: rawFetch = safeFetch,
  now = new Date(),
  pauseMs,
  sleep = defaultSleep,
  region = DEFAULT_REGION,
  listedHosts = listedHostsOf(item)
}) => {
  const fetchImpl = screenedFetch(rawFetch)
  const pacer = createPacer({ sleep })
  const gaps = {
    shopify: pauseMs ?? SHOPIFY_FALLBACK_GAP_MS,
    jsonld: pauseMs ?? JSON_LD_GAP_MS
  }
  const indexed = enabledDirect(item).map((entry, index) => ({ entry, index }))
  const isShopify = ({ entry }) => entry.parser === 'shopify'
  const outcomes = []
  for (const items of groupByOrigin(indexed.filter(isShopify))) {
    const results = await checkShopifyOrigin({
      items, fetchImpl, pacer, gapMs: gaps.shopify, region, listedHosts
    })
    items.forEach(({ index }, position) => {
      outcomes[index] = results[position]
    })
  }
  for (const { entry, index } of indexed.filter((indexedEntry) => !isShopify(indexedEntry))) {
    await pacer.pace({ origin: new URL(entry.url).origin, gapMs: gaps.jsonld })
    const result = await fetchEntryResult({ entry, fetchImpl, region })
    outcomes[index] = outcome({ entry, result })
  }
  return {
    checkedAt: now.toISOString(),
    sources: outcomes.map(({ source }) => source),
    listings: outcomes.flatMap(({ listings }) => listings)
  }
}

export const runDirectCheck = async ({
  item, now = new Date(), region = DEFAULT_REGION, ...options
}) => {
  const data = await checkDirect({ item, now, region, ...options })
  const categoryIds = item.categories.map(({ id }) => id)
  const { ok, errors, value } = validateResearch({
    data, categoryIds, partIds: kitPartIds(item), maxPrice: region.maxPrice
  })
  if (!ok) return { ok: false, errors, costUsd: null }
  const everySourceErrored = value.sources.length > 0
    && value.sources.every(({ status }) => status === 'error')
  if (everySourceErrored) {
    const detail = value.sources.map(({ name, note }) => `${name}: ${note}`).join('; ')
    return { ok: false, errors: [`every direct check errored (${detail})`], costUsd: null }
  }
  return { ok: true, data: value, costUsd: null }
}

export const testDirectEntry = async ({
  entry, fetchImpl = safeFetch, region = DEFAULT_REGION, listedHosts = listedHostsOf({
    direct: [entry]
  })
}) => {
  const result = await fetchEntryResult({
    entry, fetchImpl: screenedFetch(fetchImpl), region, listedHosts
  })
  return {
    status: result.status,
    note: result.note,
    url: linkUrl(entry.url),
    listings: result.listings ?? []
  }
}

export const parseDirectBody = ({
  parser, body, entry, region = DEFAULT_REGION, listedHosts = []
}) => {
  if (parser === 'shopify') return parseShopify({ body, entry, region, listedHosts })
  if (parser === 'jsonld') return parseJsonLd({ body, entry, region })
  return failure(`unknown parser "${parser}"`)
}

export const parseShopify = ({ body, entry, region = DEFAULT_REGION, listedHosts = [] }) => {
  const product = readShopifyProduct(body)
  if (!product) {
    return isChallengePage(body)
      ? blocked('challenge page instead of product JSON')
      : failure('response is not Shopify product JSON')
  }
  return parseShopifyProduct({ product, entry, region, listedHosts })
}

export const parseShopifyProduct = ({
  product, entry, region = DEFAULT_REGION, listedHosts = []
}) => {
  const variants = (product.variants ?? []).filter(variantMatches({ product, entry }))
  if (variants.length === 0) return failure('no matching variants in Shopify product JSON')
  if (!shopifyCurrencyConfirmed({ region, url: entry.url, listedHosts })) {
    return failure(unconfirmedShopifyNote(region))
  }
  const listings = variants.map((variant) => shopifyListing({ product, variant, entry }))
  const missingAvailability = variants.some((variant) => typeof variant.available !== 'boolean')
  const note = missingAvailability
    ? `${listings.length} variants; availability field missing, treated as in stock`
    : `${listings.length} variants`
  return { status: 'ok', note, listings }
}

export const parseJsonLd = ({ body, entry, region = DEFAULT_REGION }) => {
  const nodes = readJsonLdBlocks(body).flatMap(flattenNodes)
  const products = nodes.filter(isProduct)
  if (products.length === 0) {
    return isChallengePage(body)
      ? blocked('challenge page instead of product page')
      : failure('no Product JSON-LD found (price may be rendered by JavaScript)')
  }
  const candidates = products.flatMap((product) => productOffers({ product }))
  const regionCandidates = candidates.filter(({ currency }) => currency === region.currency)
  if (regionCandidates.length === 0) {
    return failure(describeMissingCurrency({ candidates, currency: region.currency }))
  }
  const listings = regionCandidates
    .map((candidate) => jsonLdListing({ candidate, entry }))
    .filter((listing) => titleMatches({ title: listing.title, entry }))
  if (listings.length === 0) return failure('no JSON-LD offers match the variant filter')
  return { status: 'ok', note: `${listings.length} JSON-LD offers`, listings }
}

export const isChallengePage = (body) =>
  typeof body === 'string' && CHALLENGE_MARKERS.some((marker) => body.includes(marker))

export const shopifyJsonUrl = (url) => {
  const parsed = new URL(url)
  parsed.search = ''
  parsed.hash = ''
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}.json`
  return parsed.toString()
}

export const directSourceName = ({ retailer, url }) =>
  `${retailer} direct ${lastPathSegment(url)}`.trim()

const checkShopifyOrigin = async ({ items, fetchImpl, pacer, gapMs, region, listedHosts }) => {
  const origin = new URL(items[0].entry.url).origin
  const catalog = await fetchCatalog({ origin, fetchImpl, pacer, gapMs, region })
  if (catalog) {
    return items.map(({ entry }) => catalogOutcome({ catalog, entry, region, listedHosts }))
  }
  return fetchProductsOneByOne({ items, origin, fetchImpl, pacer, gapMs, region, listedHosts })
}

const catalogOutcome = ({ catalog, entry, region, listedHosts }) => {
  const handle = lastPathSegment(entry.url)
  const product = catalog.find((candidate) => candidate.handle === handle)
  const result = product
    ? parseShopifyProduct({ product, entry, region, listedHosts })
    : { status: 'not_found', note: `no product "${handle}" in products.json`, listings: [] }
  return outcome({ entry, result })
}

const fetchCatalog = async ({ origin, fetchImpl, pacer, gapMs, region }) => {
  const products = []
  for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
    await pacer.pace({ origin, gapMs: page === 1 ? 0 : gapMs })
    const batch = await fetchCatalogPage({ origin, page, fetchImpl, region })
    if (!batch) return null
    products.push(...batch)
    if (batch.length < CATALOG_PAGE_SIZE) break
  }
  return products
}

const fetchCatalogPage = async ({ origin, page, fetchImpl, region }) => {
  const pageParam = page > 1 ? `&page=${page}` : ''
  try {
    const response = await fetchImpl(
      `${origin}/products.json?limit=${CATALOG_PAGE_SIZE}${pageParam}`, requestOptions(region)
    )
    if (!response.ok) return null
    const products = JSON.parse(await response.text())?.products
    return Array.isArray(products) ? products : null
  } catch {
    return null
  }
}

const fetchProductsOneByOne = async ({
  items, origin, fetchImpl, pacer, gapMs, region, listedHosts
}) => {
  const outcomes = []
  let rateLimited = false
  for (const { entry } of items) {
    if (rateLimited) {
      outcomes.push(outcome({ entry, result: blocked('skipped after HTTP 429 from this site') }))
      continue
    }
    await pacer.pace({ origin, gapMs })
    const result = await fetchEntryResult({ entry, fetchImpl, region, listedHosts })
    rateLimited = result.rateLimited === true
    outcomes.push(outcome({ entry, result }))
  }
  return outcomes
}

const fetchEntryResult = async ({ entry, fetchImpl, region, listedHosts = [] }) => {
  const requestUrl = entry.parser === 'shopify' ? shopifyJsonUrl(entry.url) : entry.url
  try {
    const response = await fetchImpl(requestUrl, requestOptions(region))
    if (BLOCKED_STATUSES.includes(response.status)) {
      return { ...blocked(`HTTP ${response.status}`), rateLimited: response.status === 429 }
    }
    if (!response.ok) return failure(`HTTP ${response.status}`)
    const body = await response.text()
    return parseDirectBody({ parser: entry.parser, body, entry, region, listedHosts })
  } catch (error) {
    return failure(describeFetchError(error))
  }
}

const groupByOrigin = (items) => {
  const groups = new Map()
  for (const item of items) {
    const origin = new URL(item.entry.url).origin
    groups.set(origin, [...(groups.get(origin) ?? []), item])
  }
  return [...groups.values()]
}

const createPacer = ({ sleep }) => {
  const lastRequestAt = new Map()
  const pace = async ({ origin, gapMs }) => {
    const last = lastRequestAt.get(origin)
    const wait = last === undefined ? 0 : gapMs - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    lastRequestAt.set(origin, Date.now())
  }
  return { pace }
}

const lastPathSegment = (url) => new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''

const requestOptions = (region) => ({
  headers: {
    'User-Agent': USER_AGENT,
    'Accept-Language': `${region.locale},en;q=0.9`,
    Accept: 'application/json,text/html;q=0.9,*/*;q=0.8'
  },
  signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
})

const screenedFetch = (fetchImpl) => {
  const transport = fetchImpl === globalThis.fetch ? safeFetch : fetchImpl
  return async (url, options) => {
    const problem = publicUrlProblem(url)
    if (problem) throw unsafeUrlError(problem)
    return transport(url, options)
  }
}

const outcome = ({ entry, result }) => ({
  source: {
    name: directSourceName(entry), status: result.status, note: result.note, url: entry.url
  },
  listings: result.listings ?? []
})

const describeFetchError = (error) => {
  if (error?.name === 'TimeoutError') return `timed out after ${REQUEST_TIMEOUT_MS / 1000} s`
  if (error?.message === 'response too large') return error.message
  return BLOCKED_FETCH_NOTE
}

const listingCategory = (entry) => entry.part ? ACCESSORY_CATEGORY : entry.category

const blocked = (note) => ({ status: 'blocked', note, listings: [] })

const failure = (note) => ({ status: 'error', note, listings: [] })

const readShopifyProduct = (body) => {
  try {
    const product = JSON.parse(body)?.product
    return product && Array.isArray(product.variants) ? product : null
  } catch {
    return null
  }
}

const variantMatches = ({ product, entry }) => (variant) =>
  titleMatches({ title: shopifyTitle({ product, variant }), entry })

const titleMatches = ({ title, entry }) => variantMatcher(entry.variantFilter)?.(title) ?? false

const shopifyTitle = ({ product, variant }) =>
  variant.title && variant.title !== 'Default Title'
    ? `${product.title} - ${variant.title}`
    : product.title

const shopifyListing = ({ product, variant, entry }) => {
  const price = toPrice(variant.price)
  const compareAt = toPrice(variant.compare_at_price)
  return {
    retailer: entry.retailer,
    title: shopifyTitle({ product, variant }),
    category: listingCategory(entry),
    part: entry.part ?? null,
    rejectReason: null,
    price: price,
    wasPrice: compareAt !== null && price !== null && compareAt > price ? compareAt : null,
    effectivePrice: price,
    deliveryCost: null,
    isClearance: false,
    inStock: typeof variant.available === 'boolean' ? variant.available : true,
    verified: true,
    url: entry.url,
    evidence: 'Shopify product JSON',
    notes: typeof variant.available === 'boolean'
      ? ''
      : 'availability not in product JSON, assumed in stock'
  }
}

const readJsonLdBlocks = (html) => {
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  return [...String(html).matchAll(pattern)].flatMap(([, content]) => parseBlock(content))
}

const parseBlock = (content) => {
  try {
    return [JSON.parse(content.trim())]
  } catch {
    return []
  }
}

const flattenNodes = (node) => {
  if (Array.isArray(node)) return node.flatMap(flattenNodes)
  if (!node || typeof node !== 'object') return []
  return [node, ...flattenNodes(node['@graph'] ?? [])]
}

const hasType = ({ node, type }) => [node['@type']].flat().includes(type)

const isProduct = (node) => hasType({ node, type: 'Product' }) || hasType({
  node, type: 'ProductGroup'
})

const productOffers = ({ product }) => {
  const variants = hasType({ node: product, type: 'ProductGroup' })
    ? [product.hasVariant ?? []].flat().filter(Boolean)
    : []
  const sources = variants.length > 0 ? variants : [product]
  return sources.flatMap((source) =>
    [source.offers ?? []].flat().filter(Boolean).flatMap((offer) =>
      offerCandidates({ offer, source, group: product })))
}

const offerCandidates = ({ offer, source, group }) => {
  const aggregate = hasType({ node: offer, type: 'AggregateOffer' })
  const nested = aggregate ? [offer.offers ?? []].flat().filter(Boolean) : []
  if (nested.length > 0) {
    return nested.flatMap((inner) =>
      offerCandidates({ offer: { priceCurrency: offer.priceCurrency, ...inner }, source, group }))
  }
  const price = aggregate ? toPrice(offer.lowPrice ?? offer.price) : readOfferPrice(offer)
  if (price === null) return []
  return [{
    price,
    currency: readOfferCurrency(offer),
    availability: offer.availability ?? null,
    aggregate,
    name: source.name ?? group.name ?? null,
    offerName: offer.name ?? null,
    url: offer.url ?? source.url ?? null,
    was: readListPrice(offer)
  }]
}

const readOfferPrice = (offer) => {
  const direct = toPrice(offer.price)
  if (direct !== null) return direct
  const specs = [offer.priceSpecification ?? []].flat()
  return toPrice(specs.find((spec) => spec?.price !== undefined)?.price)
}

const readOfferCurrency = (offer) => {
  const specs = [offer.priceSpecification ?? []].flat()
  return offer.priceCurrency ?? specs.find((spec) => spec?.priceCurrency)?.priceCurrency ?? null
}

const readListPrice = (offer) => {
  const specs = [offer.priceSpecification ?? []].flat()
  const list = specs.find((spec) => /ListPrice/i.test(String(spec?.priceType ?? '')))
  return toPrice(list?.price)
}

const jsonLdListing = ({ candidate, entry }) => {
  const title = [candidate.name, candidate.offerName]
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(' - ') || entry.retailer
  const evidence = candidate.aggregate ? 'JSON-LD AggregateOffer' : 'JSON-LD Offer'
  const hasAvailability = candidate.availability !== null
  return {
    retailer: entry.retailer,
    title,
    category: listingCategory(entry),
    part: entry.part ?? null,
    rejectReason: null,
    price: candidate.price,
    wasPrice: candidate.was !== null && candidate.was > candidate.price ? candidate.was : null,
    effectivePrice: candidate.price,
    deliveryCost: null,
    isClearance: false,
    inStock: hasAvailability && /InStock$/i.test(String(candidate.availability)),
    verified: true,
    url: entry.url,
    evidence,
    notes: describeJsonLdNotes({ candidate, hasAvailability })
  }
}

const describeJsonLdNotes = ({ candidate, hasAvailability }) => [
  candidate.aggregate ? 'lowest price across offers' : null,
  hasAvailability ? null : 'availability missing in JSON-LD, treated as out of stock'
].filter(Boolean).join('; ')

const describeMissingCurrency = ({ candidates, currency }) => {
  if (candidates.length === 0) return 'Product JSON-LD has no priced offers'
  const currencies = [...new Set(candidates.map(({ currency: found }) => found ?? 'unknown'))]
  return `no ${currency} offer in JSON-LD (found ${currencies.join(', ')})`
}

const listedHostsOf = (item) => [
  ...(item?.sources?.sites ?? []).map((site) => site?.url),
  ...(item?.direct ?? []).map((entry) => entry?.url)
].map(hostOf).filter(Boolean)

const shopifyCurrencyConfirmed = ({ region, url, listedHosts }) => {
  if (region.shopifyCurrency === 'home-host') return isHomeHost({ region, url })
  const host = hostOf(url)
  return Boolean(host) && listedHosts.includes(host)
}

const unconfirmedShopifyNote = (region) =>
  `Shopify price found, but the store currency is not confirmed as ${region.currency}`

const toPrice = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''))
  return Number.isFinite(number) && number > 0 ? number : null
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
