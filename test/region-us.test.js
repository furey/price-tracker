import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { checkDirect, parseJsonLd, parseShopifyProduct, testDirectEntry } from '../src/direct.js'
import { testCandidates } from '../src/draft-direct.js'
import { buildScopePrompt } from '../src/draft-prompts.js'
import { requiredMembership } from '../src/memberships.js'
import { activeRegion } from '../src/region.js'
import { regionProfile } from '../src/regions/index.js'
import { buildPrompt, research, itemUrls, webFetchRules } from '../src/research.js'
import { listingTrust, normaliseListings } from '../src/retailers.js'
import { saleEventsFor, saleWindowAt } from '../src/sale-windows.js'
import { publicSettings, setSettings, validateSetting } from '../src/settings.js'
import { scriptedClaude } from './fake-claude.js'
import { GOLDEN_DIR, GOLDEN_NOW } from './golden-inputs.js'

const US = regionProfile({ id: 'us' })
const AU = regionProfile({ id: 'au' })
const GENERIC = regionProfile({ id: 'generic' })
const US_ITEM = JSON.parse(readFileSync(
  resolve(GOLDEN_DIR, '../us/dewalt-dcd791.json'), 'utf8'
))
const US_DELIVERY = { suburb: 'Brooklyn', postcode: '11201' }

test('REGION=us selects USD, en-US, and New York time, and TIME_ZONE overrides it', () => {
  const region = activeRegion({ env: { REGION: 'us' } })
  assert.deepEqual(
    [region.id, region.currency, region.locale, region.timeZone],
    ['us', 'USD', 'en-US', 'America/New_York']
  )
  const pacific = activeRegion({ env: { REGION: 'US', TIME_ZONE: 'America/Los_Angeles' } })
  assert.equal(pacific.timeZone, 'America/Los_Angeles')
})

test('the US research prompt matches the captured prompt', () => {
  const prompt = buildPrompt({
    item: US_ITEM, now: GOLDEN_NOW, delivery: US_DELIVERY, memberships: ['Amazon Prime'],
    region: US
  })
  assert.equal(prompt, fixture('research-prompt-us-dewalt-dcd791.txt'))
})

test('the US claude args match the captured args', async () => {
  const { spawnImpl, calls } = scriptedClaude([{ resultText: 'nope' }, { resultText: 'nope' }])
  await research({ item: US_ITEM, now: GOLDEN_NOW, spawnImpl, region: US })
  const expected = JSON.parse(fixture('research-args-us-dewalt-dcd791.json'))
  assert.deepEqual(calls.map(({ args }) => args), expected.map(({ args }) => args))
  assert.deepEqual(calls[0].args.slice(-4), ['--max-turns', '25', '--model', 'sonnet'])
})

test('the US prompt asks for pre-tax prices, Slickdeals posts, and the ZIP code', () => {
  const prompt = buildPrompt({
    item: US_ITEM, now: GOLDEN_NOW, delivery: US_DELIVERY, region: US
  })
  for (const text of ['OzBargain', 'eBay AU', 'Amazon.com.au', 'Australian', '.com.au']) {
    assert.ok(!prompt.includes(text), `US prompt mentions ${text}`)
  }
  assert.match(prompt, /US prices exclude sales tax\. Record the listed price before tax\./)
  assert.match(prompt, /^\d+\. Slickdeals: you may include a post/m)
  assert.match(prompt, /delivery cost to this ZIP code/)
  assert.match(prompt, /The buyer lives at Brooklyn 11201 United States\./)
  const ebayRule = /^(\d+)\. eBay: accept a listing/m.exec(prompt)[1]
  assert.match(prompt, new RegExp(`except on eBay as rule ${ebayRule} allows`))
})

test('the US allowlist holds named retailer hosts and item hosts, never *.com', () => {
  assert.deepEqual(
    webFetchRules({ urls: itemUrls(US_ITEM), region: US }),
    JSON.parse(fixture('fetch-rules-us-dewalt-dcd791.json'))
  )
  const rules = webFetchRules({ urls: [], region: US })
  assert.ok(rules.includes('WebFetch(domain:bestbuy.com)'))
  assert.ok(rules.includes('WebFetch(domain:*.slickdeals.net)'))
  assert.ok(!rules.some((rule) => /domain:\*\.(com|net)\)/.test(rule)))
  assert.ok(!rules.some((rule) => rule.includes('.au')))
})

test('the US profile trusts major US retailers and the sites on the item', () => {
  const trust = (retailer, url) =>
    listingTrust({ item: US_ITEM, listing: { retailer, url }, region: US }).trusted
  assert.equal(trust('Best Buy', 'https://www.bestbuy.com/site/x'), true)
  assert.equal(trust('B&H', 'https://www.bhphotovideo.com/c/x'), true)
  assert.equal(trust('Acme Tools', 'https://www.acmetools.com/x'), true)
  assert.equal(trust('Best Buy', 'https://bestbuy-deals.example.com/x'), false)
  assert.equal(trust('JB Hi-Fi', 'https://www.jbhifi.com.au/x'), false)
  const [ebay] = normaliseListings({
    item: US_ITEM, region: US,
    listings: [{ retailer: 'eBay (Sold by toolstore)', url: 'https://www.ebay.com/itm/1' }]
  })
  assert.deepEqual([ebay.retailer, ebay.notes], ['eBay', 'Sold by toolstore on eBay'])
})

test('US sale windows follow Thanksgiving, the federal holidays, and Prime Day', () => {
  assert.deepEqual(saleEventsFor({ year: 2026, region: US }), [
    { name: 'Presidents\' Day', date: '2026-02-16' },
    { name: 'Memorial Day', date: '2026-05-25' },
    { name: 'Prime Day (approximate)', date: '2026-07-14' },
    { name: 'Labor Day', date: '2026-09-07' },
    { name: 'Black Friday', date: '2026-11-27' },
    { name: 'Cyber Monday', date: '2026-11-30' }
  ])
  const events = Object.fromEntries(saleEventsFor({ year: 2025, region: US })
    .map(({ name, date }) => [name, date]))
  assert.equal(events['Black Friday'], '2025-11-28')
  assert.equal(events['Memorial Day'], '2025-05-26')
  assert.deepEqual(saleWindowAt({ item: {}, today: '2026-11-20', region: US }), {
    names: ['Black Friday', 'Cyber Monday'], until: '2026-12-07'
  })
})

test('the US delivery setting is a ZIP code, labelled as one', () => {
  const env = { REGION: 'us' }
  assert.equal(validateSetting({ key: 'deliveryPostcode', value: '11201', env }), null)
  assert.equal(validateSetting({ key: 'deliveryPostcode', value: '11201-1234', env }), null)
  assert.match(validateSetting({ key: 'deliveryPostcode', value: '2042', env }), /ZIP code/)
  const db = openDb(':memory:')
  setSettings({ db, changes: { deliveryPostcode: '11201' }, env })
  const labels = Object.fromEntries(publicSettings({ db, env })
    .map(({ key, label }) => [key, label]))
  assert.equal(labels.deliveryPostcode, 'Delivery ZIP code')
  assert.equal(labels.deliverySuburb, 'Delivery city')
  const auLabels = Object.fromEntries(publicSettings({ db: openDb(':memory:'), env: {} })
    .map(({ key, label }) => [key, label]))
  assert.equal(auLabels.deliveryPostcode, 'Delivery postcode')
})

test('US memberships gate Costco and Sam\'s Club prices', () => {
  assert.equal(requiredMembership({ url: 'https://www.costco.com/x', region: US }), 'Costco')
  assert.equal(requiredMembership({ url: 'https://www.samsclub.com/x', region: US }),
    'Sam\'s Club')
  assert.equal(requiredMembership({ url: 'https://www.costco.com.au/x', region: US }), null)
})

test('the US wizard scope prompt is US-only and asks no ZIP code question', () => {
  const scope = buildScopePrompt({
    input: { request: 'a robot vacuum' }, existing: [], delivery: US_DELIVERY,
    today: '2026-11-07', region: US
  })
  assert.match(scope, /You help a buyer in the United States set up a price tracker/)
  assert.match(scope, /quantity, or ZIP code\. You already have them\./)
  assert.ok(!scope.includes('Australia'))
})

test('a JSON-LD offer in another currency is rejected in the US', () => {
  const body = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product', name: 'Drill',
    offers: { price: '149.00', priceCurrency: 'AUD', availability: 'InStock' }
  })}</script>`
  const entry = { retailer: 'Shop', url: 'https://shop.example.com/p', category: 'kit' }
  const result = parseJsonLd({ body, entry, region: US })
  assert.equal(result.status, 'error')
  assert.equal(result.note, 'no USD offer in JSON-LD (found AUD)')
})

test('Shopify prices count in the US and generic regions only from hosts on the item', () => {
  const product = { title: 'Drill', variants: [{ title: 'Default Title', price: '129.00' }] }
  const entry = { retailer: 'Shop', url: 'https://www.shop.example.com/products/drill' }
  for (const region of [US, GENERIC]) {
    const listed = parseShopifyProduct({
      product, entry, region, listedHosts: ['shop.example.com']
    })
    assert.equal(listed.status, 'ok')
    assert.equal(listed.listings[0].price, 129)
    const unlisted = parseShopifyProduct({
      product, entry, region, listedHosts: ['other.example.com']
    })
    assert.equal(unlisted.status, 'error')
    assert.match(unlisted.note, new RegExp(`not confirmed as ${region.currency}`))
  }
  const au = parseShopifyProduct({ product, entry, region: AU, listedHosts: ['shop.example.com'] })
  assert.equal(au.status, 'error')
})

test('a US direct check accepts Shopify prices from the entries on the item', async () => {
  const item = {
    id: 'drill', categories: [{ id: 'kit', description: 'Kit' }],
    direct: [{
      retailer: 'Shop', url: 'https://shop.example.com/products/drill', category: 'kit',
      parser: 'shopify'
    }]
  }
  const data = await checkDirect({ item, fetchImpl: shopifyFetch, region: US, sleep: noSleep })
  assert.equal(data.sources[0].status, 'ok')
  assert.equal(data.listings[0].price, 129)
  const tested = await testDirectEntry({
    entry: item.direct[0], fetchImpl: shopifyFetch, region: US
  })
  assert.equal(tested.status, 'ok')
})

test('US wizard candidates accept Shopify prices only from links the buyer gave', async () => {
  const candidate = (url) => ({ retailer: 'Shop', url, category: 'kit' })
  const results = await testCandidates({
    candidates: [
      candidate('https://shop.example.com/products/drill'),
      candidate('https://other.example.com/products/drill')
    ],
    fetchImpl: shopifyFetch,
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    sleep: noSleep,
    region: US,
    listedUrls: ['https://shop.example.com/products/drill']
  })
  assert.deepEqual(results.map(({ kept, parser }) => [kept, parser]),
    [[true, 'shopify'], [false, 'jsonld']])
})

const fixture = (name) => readFileSync(resolve(GOLDEN_DIR, name), 'utf8')

const noSleep = async () => {}

const shopifyFetch = async (url) => {
  const { pathname } = new URL(url)
  if (pathname === '/products.json') return response({ status: 404, body: 'missing' })
  if (pathname.endsWith('.json')) {
    return response({
      body: JSON.stringify({
        product: {
          title: 'Drill', handle: 'drill',
          variants: [{ title: 'Default Title', price: '129.00', available: true }]
        }
      })
    })
  }
  return response({ body: '<html><title>Drill</title></html>' })
}

const response = ({ status = 200, body }) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
  headers: new Headers({ 'content-type': 'application/json' })
})
