import { lookup } from 'node:dns/promises'
import { checkDirect } from './direct.js'
import { publicUrl } from './draft-harden.js'
import { DEFAULT_REGION } from './regions/index.js'
import { hostOf } from './retailers.js'
import { isBlockedAddress, safeFetch } from './safe-url.js'

export const testCandidates = async ({
  candidates, fetchImpl = safeFetch, lookupImpl = lookup, sleep, pauseMs, log = () => {},
  region = DEFAULT_REGION, listedUrls = []
}) => {
  const listedHosts = listedUrls.map(hostOf).filter(Boolean)
  const pass = { fetchImpl, sleep, pauseMs, region, listedHosts }
  const screened = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    problem: await urlProblem({ url: candidate.url, lookupImpl })
  })))
  const fetchable = screened.filter(({ problem }) => !problem).map(({ candidate }) => candidate)
  const shopifyResults = await runPass({
    ...pass, candidates: fetchable.filter(looksLikeShopify), parser: 'shopify'
  })
  const needJsonLd = fetchable.filter((candidate) => !acceptedShopify({
    result: shopifyResults.get(candidate.url)
  }))
  const jsonLdResults = await runPass({ ...pass, candidates: needJsonLd, parser: 'jsonld' })
  const results = screened.map(({ candidate, problem }) => {
    if (problem) return { ...candidate, status: 'skipped', note: problem, kept: false }
    const shopify = shopifyResults.get(candidate.url)
    if (acceptedShopify({ result: shopify })) {
      return summarise({ candidate, result: shopify })
    }
    const jsonld = jsonLdResults.get(candidate.url)
    return summarise({ candidate, result: jsonld ?? shopify })
  })
  const kept = results.filter((result) => result.kept).length
  log(`tested ${results.length} direct candidates, kept ${kept}`)
  return results
}

export const keptEntries = (results) => results
  .filter(({ kept }) => kept)
  .map(({ retailer, url, category, parser, variantFilter }) =>
    ({ retailer, url, category, parser, ...(variantFilter ? { variantFilter } : {}) }))

export const urlProblem = async ({ url, lookupImpl = lookup }) => {
  const normalised = publicUrl(url)
  if (!normalised) return 'Not a public web address'
  const { hostname } = new URL(normalised)
  try {
    const addresses = await lookupImpl(hostname, { all: true })
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (list.length === 0) return 'The site does not resolve'
    return list.some(({ address }) => isBlockedAddress(address))
      ? 'The site resolves to a private network address'
      : null
  } catch {
    return 'The site does not resolve'
  }
}

const runPass = async ({
  candidates, parser, fetchImpl, sleep, pauseMs, region, listedHosts
}) => {
  if (candidates.length === 0) return new Map()
  const item = {
    id: 'draft-probe',
    categories: [...new Set(candidates.map(({ category }) => category))]
      .map((id) => ({ id, description: id })),
    direct: candidates.map(({ retailer, url, category, variantFilter }) =>
      ({ retailer, url, category, parser, ...(variantFilter ? { variantFilter } : {}) }))
  }
  const data = await checkDirect({
    item, fetchImpl, region, listedHosts, ...(sleep ? { sleep } : {}),
    ...(pauseMs !== undefined ? { pauseMs } : {})
  })
  return new Map(candidates.map((candidate, index) => [candidate.url, {
    parser,
    source: data.sources[index],
    listings: data.listings.filter((listing) => listing.url === candidate.url)
  }]))
}

const summarise = ({ candidate, result }) => {
  const priced = (result?.listings ?? []).filter(({ price }) => typeof price === 'number')
  const cheapest = priced.reduce((best, listing) =>
    (!best || listing.price < best.price ? listing : best), null)
  const kept = result?.source?.status === 'ok' && Boolean(cheapest)
  return {
    ...candidate,
    parser: result?.parser ?? null,
    status: kept ? 'ok' : result?.source?.status ?? 'error',
    note: kept ? `${priced.length} priced listing${priced.length === 1 ? '' : 's'}`
      : result?.source?.note || 'no price data',
    price: cheapest?.price ?? null,
    inStock: cheapest?.inStock ?? null,
    title: cheapest?.title ?? null,
    kept
  }
}

const acceptedShopify = ({ result }) => result?.source?.status === 'ok'
  && result.listings.some(({ price }) => typeof price === 'number')

const looksLikeShopify = ({ url }) => /\/products\/[^/]+\/?$/.test(new URL(url).pathname)
