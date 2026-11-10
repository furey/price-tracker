import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checksStopOn, formatLastChanceMessage, lastChanceDate, lastChanceDue, lastChancePick
} from '../src/last-chance.js'

const DEADLINE = { needBy: '2026-12-20', deliveryDays: 6, lastChanceDays: 3 }
const ITEM = {
  name: 'Kärcher K7',
  categories: [{ id: 'smart' }, { id: 'premium' }],
  rules: { smart: { maxPrice: 950 }, premium: { maxPrice: 1100 } }
}

const listing = (overrides = {}) => ({
  retailer: 'Bunnings', title: 'K7 Smart', category: 'smart', price: 1100, effectivePrice: 1049,
  inStock: true, url: 'https://www.bunnings.com.au/k7', ...overrides
})

test('the last-chance day is the need-by date less delivery and last-chance days', () => {
  assert.equal(lastChanceDate(DEADLINE), '2026-12-11')
  assert.equal(checksStopOn(DEADLINE), '2026-12-14')
  assert.equal(lastChanceDate({ needBy: '2026-12-20' }), '2026-12-11')
  assert.equal(lastChanceDate({ needBy: 'soon' }), null)
  assert.equal(lastChanceDate(undefined), null)
})

test('the last chance is due from its day until the need-by date', () => {
  assert.equal(lastChanceDue({ deadline: DEADLINE, today: '2026-12-10' }), false)
  assert.equal(lastChanceDue({ deadline: DEADLINE, today: '2026-12-11' }), true)
  assert.equal(lastChanceDue({ deadline: DEADLINE, today: '2026-12-19' }), true)
  assert.equal(lastChanceDue({ deadline: DEADLINE, today: '2026-12-20' }), false)
  assert.equal(lastChanceDue({ deadline: undefined, today: '2026-12-12' }), false)
})

test('the pick is the cheapest in-stock listing in the best category, never muted', () => {
  const listings = [
    listing({ category: 'premium', effectivePrice: 900, retailer: 'Total Tools' }),
    listing({ effectivePrice: 1200, retailer: 'Mitre 10' }),
    listing({ effectivePrice: 1049 }),
    listing({ effectivePrice: 999, inStock: false }),
    listing({ effectivePrice: 800, tuned: 'muted' }),
    listing({ effectivePrice: null, price: 1020, retailer: 'Repco' })
  ]
  assert.equal(lastChancePick({ item: ITEM, listings }).retailer, 'Repco')
  assert.equal(lastChancePick({ item: ITEM, listings: [] }), null)
})

test('the message gives the price, the alert price, and the dates, with no dashes', () => {
  const alert = formatLastChanceMessage({ item: ITEM, listing: listing(), deadline: DEADLINE })
  assert.equal(alert.title, 'Kärcher K7 last chance')
  assert.equal(alert.priority, 4)
  assert.equal(alert.click, 'https://www.bunnings.com.au/k7')
  assert.match(alert.message, /Lowest in-stock price: \$1,049 at Bunnings/)
  assert.match(alert.message, /Your alert price: \$950/)
  assert.match(alert.message, /Checks stop on Mon,? 14 Dec\. Buy now to have it by Sun,? 20 Dec\./)
  assert.doesNotMatch(alert.message, /[–—]/)
  const empty = formatLastChanceMessage({ item: ITEM, listing: null, deadline: DEADLINE })
  assert.match(empty.message, /^No in-stock listing found\. Checks stop on Mon,? 14 Dec\.$/)
  assert.equal(empty.click, undefined)
})
