import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canonicalRetailer, knownRetailersFor, listingTrust, normaliseListings, sellerNote
} from '../src/retailers.js'

const knownRetailers = [
  'Springfree Trampoline AU', 'Myer', 'Harvey Norman', 'Amazon.com.au', 'Bunnings',
  'Kärcher Australia'
]
const canon = (name) => canonicalRetailer({ name, knownRetailers })

test('canonicalRetailer merges variants into the configured name', () => {
  assert.equal(canon('Bunnings Warehouse (sold by Springfree Trampoline Aust Pty Ltd)'), 'Bunnings')
  assert.equal(canon('Myer (sold by Springfree Trampoline)'), 'Myer')
  assert.equal(canon('Springfree Trampoline AU (https://www.springfreetrampoline.com.au/)'),
    'Springfree Trampoline AU')
  assert.equal(canon('springfree trampoline'), 'Springfree Trampoline AU')
  assert.equal(canon('Amazon AU'), 'Amazon.com.au')
  assert.equal(canon('Amazon.com.au'), 'Amazon.com.au')
  assert.equal(canon('www.amazon.com.au'), 'Amazon.com.au')
  assert.equal(canon('Kärcher'), 'Kärcher Australia')
  assert.equal(canon('Kärcher Australia'), 'Kärcher Australia')
})

test('canonicalRetailer keeps country markers distinct', () => {
  assert.equal(canon('Harvey Norman NZ'), 'Harvey Norman NZ')
  assert.equal(canon('Myer US'), 'Myer US')
})

test('canonicalRetailer returns the cleaned name for an unknown retailer', () => {
  assert.equal(canon('Total Tools Australia'), 'Total Tools')
  assert.equal(canon('Sydney Tools Online Store'), 'Sydney Tools')
  assert.equal(canon('toolkitdepot.com.au'), 'toolkitdepot')
  assert.equal(canon('Online'), 'Online')
})

test('sellerNote reads only a sold-by parenthetical', () => {
  assert.equal(sellerNote('Myer (sold by Springfree Trampoline)'), 'Sold by Springfree Trampoline')
  assert.equal(sellerNote('Bunnings Warehouse (Sold By ACME Pty Ltd)'), 'Sold by ACME Pty Ltd')
  assert.equal(sellerNote('Springfree Trampoline AU (https://x.com.au)'), null)
  assert.equal(sellerNote('Myer'), null)
})

test('knownRetailersFor collects site and direct names', () => {
  const item = { sources: { sites: [{ name: 'Myer' }] }, direct: [{ retailer: 'Tool Kit Depot' }] }
  assert.deepEqual(knownRetailersFor(item), ['Myer', 'Tool Kit Depot'])
})

test('normaliseListings rewrites retailer and prepends notes', () => {
  const item = { sources: { sites: [{ name: 'Myer' }] } }
  const [changed, same] = normaliseListings({
    item,
    listings: [
      { retailer: 'Myer (sold by Springfree Trampoline)', notes: 'Black' },
      { retailer: 'Myer', notes: 'Black' }
    ]
  })
  assert.equal(changed.retailer, 'Myer')
  assert.equal(
    changed.notes,
    'Sold by Springfree Trampoline; Listed as: Myer (sold by Springfree Trampoline); Black'
  )
  assert.deepEqual(same, { retailer: 'Myer', notes: 'Black' })
})

test('normaliseListings maps eBay sellers to one eBay AU retailer', () => {
  const item = { sources: { sites: [{ name: 'eBay AU' }, { name: 'Bunnings' }] } }
  const run = (retailer, url = 'https://example.com.au/x', notes = 'Black') =>
    normaliseListings({ item, listings: [{ retailer, url, notes }] })[0]
  assert.deepEqual(run('eBay AU'), {
    retailer: 'eBay AU', url: 'https://example.com.au/x', notes: 'Black'
  })
  assert.equal(run('eBay (sold by Foo Pty Ltd)').retailer, 'eBay AU')
  assert.equal(run('eBay (sold by Foo Pty Ltd)').notes, 'Sold by Foo Pty Ltd on eBay; Black')
  assert.equal(run('eBay AU - Foo Store').notes, 'Sold by Foo Store on eBay; Black')
  const byHost = run('Foo Store', 'https://www.ebay.com.au/itm/123')
  assert.equal(byHost.retailer, 'eBay AU')
  assert.equal(byHost.notes, 'Sold by Foo Store on eBay; Black')
  assert.equal(run('Bunnings').retailer, 'Bunnings')
})

const trustItem = {
  sources: {
    sites: [{ name: 'Bunnings' }, { name: 'Springfree', url: 'https://www.springfree.example/' }]
  },
  direct: [{ retailer: 'Tool Kit Depot', url: 'https://toolkitdepot.example/k7' }]
}

const trustOf = (retailer, url) => listingTrust({ item: trustItem, listing: { retailer, url } })

test('listingTrust trusts curated retailers, item site URLs, and direct-check hosts', () => {
  assert.deepEqual(trustOf('Bunnings', 'https://www.bunnings.com.au/k7_p1'),
    { trusted: true, host: 'bunnings.com.au', reason: null })
  assert.equal(trustOf('Bunnings', 'https://trade.bunnings.com.au/k7').trusted, true)
  assert.equal(trustOf('Springfree', 'https://springfree.example/products/x').trusted, true)
  assert.equal(trustOf('Tool Kit Depot', 'https://toolkitdepot.example/other').trusted, true)
  assert.equal(trustOf('Kärcher Australia', 'https://kaercher.com/au/k7').trusted, true)
  assert.equal(trustOf('Amazon.com.au', 'https://www.amazon.com.au/dp/B0').trusted, true)
})

test('listingTrust flags an unknown host and names it', () => {
  assert.deepEqual(trustOf('Shady Deals', 'https://evil.example/k7'),
    { trusted: false, host: 'evil.example', reason: 'unrecognised site evil.example' })
  assert.equal(trustOf('Bunnings', 'https://notbunnings.com.au/x').trusted, false)
  assert.equal(trustOf('Bunnings', 'https://bunnings.com.au.evil.example/x').trusted, false)
})

test('listingTrust flags a known retailer name on another host, even a trusted one', () => {
  const fake = trustOf('Bunnings', 'https://evil.example/k7')
  assert.equal(fake.trusted, false)
  assert.equal(fake.reason, 'Bunnings named but the site is evil.example')
  assert.equal(trustOf('Bunnings Warehouse', 'https://www.jbhifi.com.au/k7').trusted, false)
  assert.equal(trustOf('Bunnings', 'https://bunnings.com.au@evil.example/k7').host,
    'evil.example')
  assert.equal(trustOf('Big Wally Tools', 'https://www.bigw.com.au/x').trusted, true)
})

test('listingTrust refuses a listing without a parseable URL', () => {
  assert.equal(trustOf('Bunnings', 'not a url').trusted, false)
  assert.equal(trustOf('Bunnings', null).host, null)
})
