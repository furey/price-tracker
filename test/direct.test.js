import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkDirect, isChallengePage, parseDirectBody, parseJsonLd, parseShopify, runDirectCheck,
  shopifyJsonUrl
} from '../src/direct.js'
import { validateResearch } from '../src/validate.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')

const shopifyEntry = {
  retailer: 'Springfree', url: 'https://shop.example.com.au/products/oval', category: 'base',
  parser: 'shopify'
}
const jsonLdEntry = {
  retailer: 'Myer', url: 'https://myer.example/p/oval', category: 'base', parser: 'jsonld'
}

const shopifyBody = (variants) => JSON.stringify({
  product: { title: 'Medium Oval Trampoline', variants }
})

const page = (...blocks) => `<html><head>${blocks
  .map((block) => `<script data-x="1" type="application/ld+json">${JSON.stringify(block)}</script>`)
  .join('')}</head><body></body></html>`

const product = (offers, extra = {}) => ({
  '@context': 'https://schema.org', '@type': 'Product', name: 'Oval', offers, ...extra
})

const offer = (overrides = {}) => ({
  '@type': 'Offer',
  price: '1799',
  priceCurrency: 'AUD',
  availability: 'https://schema.org/InStock',
  ...overrides
})

const response = ({ status = 200, body = '' }) => ({
  status, ok: status >= 200 && status < 300, text: async () => body
})

test('shopify parser makes one listing per variant with compare-at as was price', () => {
  const body = shopifyBody([
    { id: 1, title: 'Black', price: '1799.00', compare_at_price: '1999.00', available: true },
    { id: 2, title: 'Grey', price: '1850.00', compare_at_price: null, available: false }
  ])
  const result = parseShopify({ body, entry: shopifyEntry })
  assert.equal(result.status, 'ok')
  assert.equal(result.listings.length, 2)
  const [black, grey] = result.listings
  assert.equal(black.title, 'Medium Oval Trampoline - Black')
  assert.equal(black.price, 1799)
  assert.equal(black.effectivePrice, 1799)
  assert.equal(black.wasPrice, 1999)
  assert.equal(black.inStock, true)
  assert.equal(black.verified, true)
  assert.equal(black.isClearance, false)
  assert.equal(black.evidence, 'Shopify product JSON')
  assert.equal(grey.wasPrice, null)
  assert.equal(grey.inStock, false)
})

test('shopify parser ignores a compare-at price that is not higher', () => {
  const body = shopifyBody([{ id: 1, title: 'Black', price: '100', compare_at_price: '90' }])
  assert.equal(parseShopify({ body, entry: shopifyEntry }).listings[0].wasPrice, null)
})

test('shopify parser treats a missing available field as in stock and says so', () => {
  const body = shopifyBody([{ id: 1, title: 'Default Title', price: '1799.00' }])
  const result = parseShopify({ body, entry: shopifyEntry })
  assert.equal(result.listings[0].inStock, true)
  assert.equal(result.listings[0].title, 'Medium Oval Trampoline')
  assert.match(result.note, /availability field missing/)
  assert.match(result.listings[0].notes, /assumed in stock/)
})

test('shopify parser applies the variant filter to the product and variant title', () => {
  const body = JSON.stringify({
    product: {
      title: 'Moving Bundle',
      variants: [
        { id: 1, title: 'Medium Oval', price: '2200', available: true },
        { id: 2, title: 'Large Oval', price: '2600', available: true }
      ]
    }
  })
  const result = parseShopify({ body, entry: { ...shopifyEntry, variantFilter: 'medium oval' } })
  assert.deepEqual(result.listings.map(({ title }) => title), ['Moving Bundle - Medium Oval'])
})

test('shopify parser reports an error when the filter removes every variant', () => {
  const body = shopifyBody([{ id: 1, title: 'Black', price: '1', available: true }])
  const result = parseShopify({ body, entry: { ...shopifyEntry, variantFilter: 'jumbo' } })
  assert.equal(result.status, 'error')
})

test('shopify parser reports a challenge page as blocked and other text as error', () => {
  const challenge = '<title>Just a moment...</title>'
  assert.equal(parseShopify({ body: challenge, entry: shopifyEntry }).status, 'blocked')
  assert.equal(parseShopify({ body: 'nope', entry: shopifyEntry }).status, 'error')
})

test('shopifyJsonUrl appends .json and drops query and trailing slash', () => {
  assert.equal(
    shopifyJsonUrl('https://shop.example.com.au/products/oval/?variant=1'),
    'https://shop.example.com.au/products/oval.json'
  )
})

test('jsonld parser reads a plain Product Offer', () => {
  const result = parseJsonLd({ body: page(product(offer())), entry: jsonLdEntry })
  assert.equal(result.status, 'ok')
  const [listing] = result.listings
  assert.equal(listing.price, 1799)
  assert.equal(listing.inStock, true)
  assert.equal(listing.evidence, 'JSON-LD Offer')
  assert.equal(listing.url, jsonLdEntry.url)
})

test('jsonld parser finds a Product inside @graph and inside arrays', () => {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'WebSite' }, product(offer())]
  }
  assert.equal(parseJsonLd({ body: page(graph), entry: jsonLdEntry }).listings.length, 1)
  const array = [{ '@type': 'Organization' }, product(offer({ price: 1700 }))]
  assert.equal(parseJsonLd({ body: page(array), entry: jsonLdEntry }).listings[0].price, 1700)
})

test('jsonld parser reads an AggregateOffer low price', () => {
  const aggregate = { '@type': 'AggregateOffer', lowPrice: '1650.50', priceCurrency: 'AUD' }
  const result = parseJsonLd({ body: page(product(aggregate)), entry: jsonLdEntry })
  const [listing] = result.listings
  assert.equal(listing.price, 1650.5)
  assert.equal(listing.evidence, 'JSON-LD AggregateOffer')
  assert.equal(listing.inStock, false)
  assert.match(listing.notes, /availability missing/)
})

test('jsonld parser reads offers nested in an AggregateOffer', () => {
  const aggregate = {
    '@type': 'AggregateOffer', priceCurrency: 'AUD', offers: [offer({ price: 10 }), offer()]
  }
  const result = parseJsonLd({ body: page(product(aggregate)), entry: jsonLdEntry })
  assert.deepEqual(result.listings.map(({ price }) => price), [10, 1799])
})

test('jsonld parser rejects non-AUD offers', () => {
  const body = page(product(offer({ priceCurrency: 'USD' })))
  const result = parseJsonLd({ body, entry: jsonLdEntry })
  assert.equal(result.status, 'error')
  assert.match(result.note, /no AUD offer/)
})

test('jsonld parser marks other availability values out of stock', () => {
  const body = page(product(offer({ availability: 'https://schema.org/OutOfStock' })))
  assert.equal(parseJsonLd({ body, entry: jsonLdEntry }).listings[0].inStock, false)
})

test('jsonld parser skips broken blocks and reports pages without a Product', () => {
  const broken = '<script type="application/ld+json">{oops</script>'
  const result = parseJsonLd({ body: broken, entry: jsonLdEntry })
  assert.equal(result.status, 'error')
  assert.match(result.note, /JavaScript/)
})

test('jsonld parser reports challenge pages as blocked', () => {
  const body = '<html><title>Pardon Our Interruption</title></html>'
  assert.equal(parseJsonLd({ body, entry: jsonLdEntry }).status, 'blocked')
  assert.equal(parseDirectBody({ parser: 'jsonld', body, entry: jsonLdEntry }).status, 'blocked')
})

test('isChallengePage spots known interstitials', () => {
  assert.equal(isChallengePage('<title>Just a moment...</title>'), true)
  assert.equal(isChallengePage('<title>Springfree</title>'), false)
})

const directItem = (direct) => ({
  categories: [{ id: 'base', description: 'Base' }, { id: 'bundle', description: 'Bundle' }],
  direct
})

const routedFetch = (routes) => async (url) => {
  const route = routes[url]
  if (route instanceof Error) throw route
  return response(route ?? { status: 404 })
}

test('checkDirect returns research-shaped data that passes validateResearch', async () => {
  const item = directItem([shopifyEntry, jsonLdEntry])
  const fetchImpl = routedFetch({
    'https://shop.example.com.au/products/oval.json': {
      body: shopifyBody([{ id: 1, title: 'Black', price: '1799.00', available: true }])
    },
    [jsonLdEntry.url]: { body: page(product(offer())) }
  })
  const data = await checkDirect({ item, fetchImpl, now: NOW, pauseMs: 0 })
  assert.equal(data.checkedAt, NOW.toISOString())
  assert.deepEqual(data.sources.map(({ status }) => status), ['ok', 'ok'])
  assert.equal(data.listings.length, 2)
  const check = validateResearch({ data, categoryIds: ['base', 'bundle'] })
  assert.deepEqual(check.errors, [])
  assert.equal(check.ok, true)
})

test('checkDirect maps blocks, challenge pages, 404, and network errors', async () => {
  const urls = ['a', 'b', 'c', 'd', 'e'].map((name) => `https://s.example/p/${name}`)
  const item = directItem(urls.map((url) => ({ ...jsonLdEntry, url })))
  const fetchImpl = routedFetch({
    [urls[0]]: { status: 403 },
    [urls[1]]: { status: 429 },
    [urls[2]]: { body: '<title>Just a moment...</title>' },
    [urls[3]]: { status: 404 },
    [urls[4]]: new Error('socket hang up')
  })
  const data = await checkDirect({ item, fetchImpl, now: NOW, pauseMs: 0 })
  assert.deepEqual(
    data.sources.map(({ status }) => status),
    ['blocked', 'blocked', 'blocked', 'error', 'error']
  )
  assert.equal(data.listings.length, 0)
  assert.equal(validateResearch({ data, categoryIds: ['base'] }).ok, true)
})

test('checkDirect sends browser headers and a timeout signal, one request per entry', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return response({ status: 403 })
  }
  await checkDirect({ item: directItem([jsonLdEntry]), fetchImpl, pauseMs: 0 })
  assert.equal(calls.length, 1)
  assert.match(calls[0].options.headers['User-Agent'], /Mozilla/)
  assert.match(calls[0].options.headers['Accept-Language'], /en-AU/)
  assert.ok(calls[0].options.signal instanceof AbortSignal)
})

test('runDirectCheck fails only when every source errored', async () => {
  const item = directItem([jsonLdEntry])
  const failing = await runDirectCheck({
    item, fetchImpl: routedFetch({}), now: NOW, pauseMs: 0
  })
  assert.equal(failing.ok, false)
  assert.match(failing.errors[0], /every direct check errored/)
  const blocked = await runDirectCheck({
    item, fetchImpl: routedFetch({ [jsonLdEntry.url]: { status: 403 } }), now: NOW, pauseMs: 0
  })
  assert.equal(blocked.ok, true)
  assert.equal(blocked.data.sources[0].status, 'blocked')
})

test('an accessory entry yields accessory listings tagged with the part', () => {
  const entry = { ...shopifyEntry, category: undefined, part: 'sunshade' }
  const body = shopifyBody([{ id: 1, title: 'Default Title', price: '249.00', available: true }])
  const [listing] = parseShopify({ body, entry }).listings
  assert.equal(listing.category, 'accessory')
  assert.equal(listing.part, 'sunshade')
  assert.equal(listing.price, 249)
})

test('trampoline entries carry a null part', () => {
  const body = shopifyBody([{ id: 1, title: 'Default Title', price: '1799', available: true }])
  assert.equal(parseShopify({ body, entry: shopifyEntry }).listings[0].part, null)
})

test('runDirectCheck accepts accessory listings for the item kit parts', async () => {
  const item = {
    categories: [{ id: 'base' }],
    kits: [{ id: 'k', name: 'K', category: 'base', parts: [{ id: 'sunshade', description: 'S' }] }],
    direct: [{ ...shopifyEntry, category: undefined, part: 'sunshade' }]
  }
  const body = shopifyBody([{ id: 1, title: 'Default Title', price: '249', available: true }])
  const result = await runDirectCheck({
    item, now: NOW, pauseMs: 0, fetchImpl: async () => response({ body })
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.listings[0].part, 'sunshade')
})

const CATALOG_URL = 'https://shop.example.com.au/products.json?limit=250'

const catalogProduct = ({ handle, title = handle, variants }) => ({
  handle,
  title,
  variants: variants ?? [{ id: 1, title: 'Default Title', price: '100.00', available: true }]
})

const shopifyEntryFor = (handle, extra = {}) => ({
  ...shopifyEntry, url: `https://shop.example.com.au/products/${handle}`, ...extra
})

const recordingFetch = (routes) => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const route = routes[url]
    if (route instanceof Error) throw route
    return response(route ?? { status: 404 })
  }
  return { calls, fetchImpl }
}

test('shopify entries on one origin share a single products.json request', async () => {
  const item = directItem([
    shopifyEntryFor('oval'),
    shopifyEntryFor('bundle', { variantFilter: 'medium oval' }),
    shopifyEntryFor('wheels', { category: undefined, part: 'wheels' })
  ])
  const catalog = {
    products: [
      catalogProduct({ handle: 'other' }),
      catalogProduct({ handle: 'oval', title: 'Medium Oval Trampoline' }),
      catalogProduct({
        handle: 'bundle',
        title: 'Bundle',
        variants: [
          { id: 1, title: 'Medium Oval', price: '2000', compare_at_price: '2200', available: true },
          { id: 2, title: 'Large Oval', price: '2500', available: true }
        ]
      }),
      catalogProduct({ handle: 'wheels' })
    ]
  }
  const { calls, fetchImpl } = recordingFetch({ [CATALOG_URL]: { body: JSON.stringify(catalog) } })
  const data = await checkDirect({ item, fetchImpl, now: NOW, pauseMs: 0 })
  assert.deepEqual(calls, [CATALOG_URL])
  assert.deepEqual(data.sources.map(({ status }) => status), ['ok', 'ok', 'ok'])
  assert.deepEqual(data.listings.map(({ title }) => title), [
    'Medium Oval Trampoline', 'Bundle - Medium Oval', 'wheels'
  ])
  assert.equal(data.listings[1].wasPrice, 2200)
  assert.equal(data.listings[2].category, 'accessory')
  assert.equal(data.listings[2].part, 'wheels')
})

test('a handle missing from products.json is reported not_found', async () => {
  const { fetchImpl } = recordingFetch({
    [CATALOG_URL]: { body: JSON.stringify({ products: [catalogProduct({ handle: 'oval' })] }) }
  })
  const data = await checkDirect({
    item: directItem([shopifyEntryFor('oval'), shopifyEntryFor('gone')]),
    fetchImpl, pauseMs: 0
  })
  assert.deepEqual(data.sources.map(({ status }) => status), ['ok', 'not_found'])
})

test('products.json follows page 2 only when 250 products come back', async () => {
  const full = Array.from({ length: 250 }, (_, number) => catalogProduct({ handle: `p${number}` }))
  const { calls, fetchImpl } = recordingFetch({
    [CATALOG_URL]: { body: JSON.stringify({ products: full }) },
    [`${CATALOG_URL}&page=2`]: {
      body: JSON.stringify({ products: [catalogProduct({ handle: 'oval' })] })
    }
  })
  const data = await checkDirect({
    item: directItem([shopifyEntryFor('oval')]), fetchImpl, pauseMs: 0
  })
  assert.deepEqual(calls, [CATALOG_URL, `${CATALOG_URL}&page=2`])
  assert.equal(data.sources[0].status, 'ok')
})

test('shopify entries on different origins get one products.json request each', async () => {
  const other = 'https://other.example.com.au'
  const { calls, fetchImpl } = recordingFetch({
    [CATALOG_URL]: { body: JSON.stringify({ products: [catalogProduct({ handle: 'oval' })] }) },
    [`${other}/products.json?limit=250`]: {
      body: JSON.stringify({ products: [catalogProduct({ handle: 'oval' })] })
    }
  })
  const data = await checkDirect({
    item: directItem([
      shopifyEntryFor('oval'), { ...shopifyEntryFor('oval'), url: `${other}/products/oval` }
    ]),
    fetchImpl, pauseMs: 0
  })
  assert.equal(calls.length, 2)
  assert.deepEqual(data.sources.map(({ status }) => status), ['ok', 'ok'])
})

test('a failed products.json falls back to per-product requests paced 20 s apart', async () => {
  const sleeps = []
  const { calls, fetchImpl } = recordingFetch({
    'https://shop.example.com.au/products/a.json': {
      body: shopifyBody([{ id: 1, title: 'Default Title', price: '10', available: true }])
    },
    'https://shop.example.com.au/products/b.json': {
      body: shopifyBody([{ id: 1, title: 'Default Title', price: '20', available: true }])
    }
  })
  const data = await checkDirect({
    item: directItem([shopifyEntryFor('a'), shopifyEntryFor('b')]),
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) }
  })
  assert.deepEqual(calls, [
    CATALOG_URL,
    'https://shop.example.com.au/products/a.json',
    'https://shop.example.com.au/products/b.json'
  ])
  assert.equal(sleeps.length, 2)
  assert.ok(sleeps.every((ms) => ms > 19_000 && ms <= 20_000))
  assert.deepEqual(data.sources.map(({ status }) => status), ['ok', 'ok'])
})

test('products.json that is not JSON triggers the fallback', async () => {
  const { calls, fetchImpl } = recordingFetch({
    [CATALOG_URL]: { body: '<html>nope</html>' },
    'https://shop.example.com.au/products/a.json': {
      body: shopifyBody([{ id: 1, title: 'Default Title', price: '10', available: true }])
    }
  })
  const data = await checkDirect({
    item: directItem([shopifyEntryFor('a')]), fetchImpl, pauseMs: 0
  })
  assert.equal(calls.length, 2)
  assert.equal(data.sources[0].status, 'ok')
})

test('the first 429 in the fallback blocks the remaining entries without requests', async () => {
  const { calls, fetchImpl } = recordingFetch({
    'https://shop.example.com.au/products/a.json': { status: 429 }
  })
  const data = await checkDirect({
    item: directItem([shopifyEntryFor('a'), shopifyEntryFor('b'), shopifyEntryFor('c')]),
    fetchImpl, pauseMs: 0
  })
  assert.deepEqual(calls, [CATALOG_URL, 'https://shop.example.com.au/products/a.json'])
  assert.deepEqual(data.sources.map(({ status }) => status), ['blocked', 'blocked', 'blocked'])
  assert.match(data.sources[2].note, /429/)
})

test('json-ld entries on one origin are paced at least 5 s apart', async () => {
  const sleeps = []
  const urls = ['a', 'b', 'c'].map((name) => `https://myer.example/p/${name}`)
  const { calls, fetchImpl } = recordingFetch({})
  await checkDirect({
    item: directItem(urls.map((url) => ({ ...jsonLdEntry, url }))),
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms) }
  })
  assert.deepEqual(calls, urls)
  assert.equal(sleeps.length, 2)
  assert.ok(sleeps.every((ms) => ms > 4_000 && ms <= 5_000))
})

test('sources keep the order of the direct entries across parsers', async () => {
  const { fetchImpl } = recordingFetch({
    [CATALOG_URL]: { body: JSON.stringify({ products: [catalogProduct({ handle: 'oval' })] }) },
    [jsonLdEntry.url]: { body: page(product(offer())) }
  })
  const data = await checkDirect({
    item: directItem([jsonLdEntry, shopifyEntryFor('oval')]), fetchImpl, pauseMs: 0
  })
  assert.deepEqual(data.sources.map(({ name }) => name), [
    'Myer direct oval', 'Springfree direct oval'
  ])
})

test('each direct source carries the page it checked', async () => {
  const { fetchImpl } = recordingFetch({
    [CATALOG_URL]: { body: JSON.stringify({ products: [catalogProduct({ handle: 'oval' })] }) },
    [jsonLdEntry.url]: { body: page(product(offer())) }
  })
  const shopify = shopifyEntryFor('oval')
  const data = await checkDirect({
    item: directItem([jsonLdEntry, shopify]), fetchImpl, pauseMs: 0
  })
  assert.deepEqual(data.sources.map(({ url }) => url), [jsonLdEntry.url, shopify.url])
})

test('checkDirect never fetches a private address, even from a saved item', async () => {
  const { calls, fetchImpl } = recordingFetch({})
  const entries = [
    { ...jsonLdEntry, url: 'http://192.168.1.1:5000/webapi' },
    { ...shopifyEntry, url: 'http://2130706433/products/oval' }
  ]
  const data = await checkDirect({ item: directItem(entries), fetchImpl, pauseMs: 0 })
  assert.deepEqual(calls, [])
  assert.ok(data.sources.every(({ status }) => status === 'error'))
  assert.ok(data.sources.every(({ note }) => note === 'Could not fetch that page'))
})

test('a stored backtracking filter matches nothing and returns at once', () => {
  const body = shopifyBody([{ id: 1, title: 'a'.repeat(200), price: '100', available: true }])
  const started = performance.now()
  const result = parseShopify({ body, entry: { ...shopifyEntry, variantFilter: '(a|a?)+$' } })
  assert.ok(performance.now() - started < 50)
  assert.equal(result.status, 'error')
})
