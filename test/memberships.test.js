import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatMemberships, gateByMemberships, parseMemberships, requiredMembership,
  validateMemberships
} from '../src/memberships.js'

const listing = (overrides) => ({
  retailer: 'Bunnings',
  category: 'base',
  rejectReason: null,
  url: 'https://trade.bunnings.com.au/p/widget',
  ...overrides
})

test('requiredMembership matches trade Bunnings and Costco hosts', () => {
  assert.equal(
    requiredMembership({ url: 'https://trade.bunnings.com.au/p/1' }), 'Bunnings PowerPass'
  )
  assert.equal(requiredMembership({ url: 'https://www.costco.com.au/p/1' }), 'Costco')
  assert.equal(requiredMembership({ url: 'https://costco.com.au/p/1' }), 'Costco')
  assert.equal(requiredMembership({ url: 'https://www.bunnings.com.au/p/1' }), null)
  assert.equal(requiredMembership({ url: 'https://notcostco.com.au/p/1' }), null)
  assert.equal(requiredMembership({ url: 'not a url' }), null)
  assert.equal(requiredMembership({ url: null }), null)
})

test('gateByMemberships rejects listings that need a missing membership', () => {
  const [gated] = gateByMemberships({ listings: [listing()], memberships: ['eBay Plus'] })
  assert.equal(gated.category, 'reject')
  assert.equal(gated.rejectReason, 'Needs Bunnings PowerPass (not in your memberships)')
  assert.equal(gated.url, 'https://trade.bunnings.com.au/p/widget')
})

test('gateByMemberships matches membership names case-insensitively', () => {
  const [kept] = gateByMemberships({
    listings: [listing()], memberships: ['bunnings powerpass']
  })
  assert.equal(kept.category, 'base')
})

test('gateByMemberships leaves other listings and existing rejects alone', () => {
  const plain = listing({ url: 'https://www.jbhifi.com.au/p' })
  const rejected = listing({ category: 'reject', rejectReason: 'Used' })
  const result = gateByMemberships({ listings: [plain, rejected], memberships: [] })
  assert.deepEqual(result, [plain, rejected])
})

test('parseMemberships and formatMemberships round-trip, with a none marker', () => {
  assert.deepEqual(parseMemberships('eBay Plus, Costco ,ebay plus,'), ['eBay Plus', 'Costco'])
  assert.deepEqual(parseMemberships('none'), [])
  assert.equal(formatMemberships([]), 'none')
  assert.equal(formatMemberships(['eBay Plus', 'Costco']), 'eBay Plus, Costco')
})

test('validateMemberships limits count and name length', () => {
  assert.equal(validateMemberships('eBay Plus, Costco'), null)
  assert.match(validateMemberships('x'.repeat(41)), /at most 40/)
  assert.match(validateMemberships(Array.from({ length: 21 }, (_, i) => `m${i}`).join(',')),
    /at most 20/)
})
