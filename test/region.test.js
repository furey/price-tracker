import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { formatDealMessage, qualify } from '../src/decide.js'
import { parseJsonLd, parseShopifyProduct } from '../src/direct.js'
import { buildResearchPrompt, buildScopePrompt } from '../src/draft-prompts.js'
import { withCurrentKeys } from '../src/legacy-keys.js'
import { activeRegion } from '../src/region.js'
import { regionProfile } from '../src/regions/index.js'
import { buildPrompt, webFetchRules } from '../src/research.js'
import { listingTrust } from '../src/retailers.js'
import { saleWindowAt } from '../src/sale-windows.js'
import { setSettings } from '../src/settings.js'
import { formatPrice } from '../src/text.js'
import { validateResearch } from '../src/validate.js'
import { createItem, findItem } from '../src/item-store.js'
import { goldenItem } from './golden-inputs.js'

const NOW = new Date('2026-11-07T00:00:00Z')
const GENERIC = regionProfile({ id: 'generic', currency: 'USD', locale: 'en-US' })
const AU = regionProfile({ id: 'au' })

test('REGION selects the profile, defaults to au, and rejects an unknown name', () => {
  assert.equal(activeRegion({ env: {} }).id, 'au')
  assert.equal(activeRegion({ env: {} }).currency, 'AUD')
  assert.equal(activeRegion({ env: { REGION: 'generic', CURRENCY: 'eur' } }).currency, 'EUR')
  assert.equal(activeRegion({ env: { REGION: 'Generic' } }).timeZone, 'UTC')
  assert.throws(() => activeRegion({ env: { REGION: 'mars' } }), /Unknown REGION "mars"/)
})

test('Settings override the currency, locale, and time zone of the profile', () => {
  const db = openDb(':memory:')
  const env = { REGION: 'generic' }
  setSettings({ db, changes: { currency: 'gbp', locale: 'en-GB', timeZone: 'Europe/London' }, env })
  const region = activeRegion({ db, env })
  assert.deepEqual(
    [region.id, region.currency, region.locale, region.timeZone],
    ['generic', 'GBP', 'en-GB', 'Europe/London']
  )
  assert.throws(() => setSettings({ db, changes: { currency: 'ZZZ' }, env }), /unknown currency/)
  assert.throws(() => setSettings({ db, changes: { timeZone: 'Mars/Base' }, env }), /IANA/)
})

test('the generic research prompt drops the AU rules and keeps rule numbers consistent', () => {
  const item = {
    id: 'demo', product: 'A demo product.', categories: [{ id: 'base', description: 'Demo' }],
    sources: { sites: [{ name: 'Shop', url: 'https://shop.example.com/' }], searches: ['demo'] }
  }
  const prompt = buildPrompt({ item, now: NOW, region: GENERIC })
  for (const text of ['OzBargain', 'eBay AU', 'Amazon.com.au', 'Australia', '.com.au/product']) {
    assert.ok(!prompt.includes(text), `generic prompt mentions ${text}`)
  }
  assert.match(prompt, /Today is 2026-11-07 \(UTC time\)/)
  assert.match(prompt, /the current price in USD as a number/)
  const effectiveRule = /^(\d+)\. effectivePrice is the price/m.exec(prompt)[1]
  assert.match(prompt, new RegExp(`effectivePrice: see rule ${effectiveRule}\\.`))
  assert.match(prompt, /WebFetch opens only the sites under SOURCES/)
})

test('the generic wizard prompts carry no AU scope or retailer rules', () => {
  const input = { request: 'a bike', budget: 500, budgetMode: 'limit' }
  const scope = buildScopePrompt({
    input, existing: [], delivery: null, today: '2026-11-07', region: GENERIC
  })
  const draft = buildResearchPrompt({
    input, rounds: [], delivery: null, today: '2026-11-07', endDate: null,
    questionsAllowed: false, region: GENERIC
  })
  for (const text of ['Australia', 'OzBargain', 'eBay AU', 'EOFY', '.com.au']) {
    assert.ok(!`${scope}${draft}`.includes(text), `generic wizard mentions ${text}`)
  }
  assert.match(draft, /hard limit \$500 per unit/)
})

test('the generic WebFetch allowlist holds only item and direct-entry hosts', () => {
  const urls = ['https://www.myer.com.au/p/x', 'https://shop.example.com/products/y']
  assert.deepEqual(webFetchRules({ urls, region: GENERIC }), [
    'WebSearch', 'WebFetch(domain:www.myer.com.au)', 'WebFetch(domain:shop.example.com)'
  ])
  assert.deepEqual(webFetchRules({ urls: [], region: GENERIC }), ['WebSearch'])
})

test('the generic profile trusts only item-listed sites and direct entries', () => {
  const item = {
    sources: { sites: [{ name: 'Shop', url: 'https://shop.example.com/' }] },
    direct: [{ retailer: 'Brand', url: 'https://brand.example.com/products/x' }]
  }
  const trust = (url, retailer = 'Myer') =>
    listingTrust({ item, listing: { retailer, url }, region: GENERIC }).trusted
  assert.equal(trust('https://www.myer.com.au/p/1'), false)
  assert.equal(trust('https://shop.example.com/p/1', 'Shop'), true)
  assert.equal(trust('https://brand.example.com/products/x', 'Brand'), true)
  assert.equal(listingTrust({
    item, listing: { retailer: 'Myer', url: 'https://www.myer.com.au/p/1' }, region: AU
  }).trusted, true)
})

test('the generic profile holds sale windows for seasonal searches only', () => {
  const item = {
    sources: { seasonalSearches: [{ phrase: 'x sale', from: '2026-11-01', until: '2026-11-10' }] }
  }
  assert.deepEqual(saleWindowAt({ item: {}, today: '2026-11-28', region: GENERIC }), null)
  assert.deepEqual(saleWindowAt({ item, today: '2026-11-05', region: GENERIC }), {
    names: ['seasonal search "x sale"'], until: '2026-11-09'
  })
  assert.ok(saleWindowAt({ item: {}, today: '2026-11-28', region: AU }).names
    .includes('Black Friday'))
})

test('a JSON-LD price in another currency is rejected for the region', () => {
  const body = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'Product', name: 'Demo',
    offers: { price: '899.00', priceCurrency: 'USD', availability: 'InStock' }
  })}</script>`
  const entry = { retailer: 'Shop', url: 'https://shop.example.com/p', category: 'base' }
  const au = parseJsonLd({ body, entry, region: AU })
  assert.equal(au.status, 'error')
  assert.equal(au.note, 'no AUD offer in JSON-LD (found USD)')
  const usd = parseJsonLd({ body, entry, region: GENERIC })
  assert.equal(usd.status, 'ok')
  assert.equal(usd.listings[0].price, 899)
})

test('a Shopify price on a host outside the region currency is rejected', () => {
  const product = { title: 'Demo', variants: [{ title: 'Default Title', price: '899.00' }] }
  const entry = (url) => ({ retailer: 'Shop', url, category: 'base' })
  const home = parseShopifyProduct({
    product, entry: entry('https://shop.example.com.au/products/demo'), region: AU
  })
  assert.equal(home.status, 'ok')
  const abroad = parseShopifyProduct({
    product, entry: entry('https://shop.example.com/products/demo'), region: AU
  })
  assert.equal(abroad.status, 'error')
  assert.equal(abroad.note, 'Shopify price found, but the store currency is not confirmed as AUD')
  const generic = parseShopifyProduct({
    product, entry: entry('https://shop.example.com/products/demo'), region: GENERIC
  })
  assert.equal(generic.status, 'error')
})

test('alerts and reasons format prices in the region currency with plain spaces', () => {
  const euro = regionProfile({ id: 'generic', currency: 'EUR', locale: 'fr-FR' })
  const listing = {
    title: 'Demo', retailer: 'Shop', price: 1049.5, effectivePrice: 1049.5, verified: true,
    url: 'https://shop.example.com/p'
  }
  const message = formatDealMessage({ item: { name: 'Demo' }, listing, region: euro })
  assert.match(message.message, /^Price: 1 049,50 €$/m)
  assert.ok(!/[  ]/.test(message.message))
  const au = formatDealMessage({ item: { name: 'Demo' }, listing, region: AU })
  assert.match(au.message, /^Price: \$1,049\.50$/m)
  const cap = formatPrice({ amount: 1100, currency: 'EUR', locale: 'fr-FR' })
  assert.deepEqual(qualify({ listing, rule: { maxPrice: 1100 }, region: euro }).reasons,
    [`under ${cap} cap`])
})

test('old AUD-named keys still validate and read as the new names', () => {
  const data = {
    checkedAt: '2026-11-07T00:00:00Z',
    sources: [],
    listings: [{
      retailer: 'Myer', title: 'Demo', category: 'base', rejectReason: null, priceAud: 1049,
      wasPriceAud: null, effectivePriceAud: 999, deliveryAud: 0, isClearance: false,
      inStock: true, verified: true, url: 'https://www.myer.com.au/p', evidence: '', notes: ''
    }]
  }
  const { ok, value } = validateResearch({ data, categoryIds: ['base'] })
  assert.equal(ok, true)
  assert.equal(value.contract, 2)
  assert.deepEqual(
    [value.listings[0].price, value.listings[0].effectivePrice, value.listings[0].deliveryCost],
    [1049, 999, 0]
  )
  assert.deepEqual(withCurrentKeys({ priceAud: 1, price: 2, nested: [{ minDropAud: 5 }] }),
    { price: 2, nested: [{ minDrop: 5 }] })
  assert.deepEqual(withCurrentKeys({ watchId: 'k7', watchName: 'K7', watchVersion: 3 }),
    { itemId: 'k7', itemName: 'K7', itemVersion: 3 })
})

test('an item config with dedupe.minDropAud is saved and read as dedupe.minDrop', () => {
  const db = openDb(':memory:')
  const config = { ...goldenItem('karcher-k7'), dedupe: { minDropAud: 40 } }
  const record = createItem({ db, config, now: NOW })
  assert.deepEqual(record.config.dedupe, { minDrop: 40 })
  db.prepare('UPDATE item_versions SET config_json = :json').run({
    json: JSON.stringify({ ...config, dedupe: { minDropAud: 30 } })
  })
  assert.deepEqual(findItem({ db, id: config.id, now: NOW }).config.dedupe, { minDrop: 30 })
})
