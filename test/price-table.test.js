import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ENDED_WINDOW_LIMIT, priceTableRows, recentDealWindows } from '../web/src/priceTable.js'

const now = new Date('2026-11-10T06:00:00Z')

const item = {
  categories: [{ id: 'bundle' }, { id: 'base' }, { id: 'accessory' }],
  rules: { bundle: { maxPrice: 1750 }, base: { maxPrice: 1600, rrp: 1999 } },
  tuning: { categories: { accessory: { state: 'muted' } } }
}

const retailer = (name, category, latest, lastSeen = '2026-11-09T20:00:00Z') => ({
  retailer: name, category, latest, lastSeen
})

const bestDay = (category, effectivePrice) => ({
  category, effectivePrice, retailer: 'Myer', day: '2026-11-01', source: 'research'
})

test('priceTableRows gives one row per watched category in item order', () => {
  const rows = priceTableRows({
    item,
    bestDays: [bestDay('base', 1537), bestDay('accessory', 109)],
    retailers: [
      retailer('Myer', 'base', 1798),
      retailer('Temple & Webster', 'base', 1769),
      retailer('Bunnings', 'bundle', 1500, '2026-10-01T00:00:00Z')
    ],
    verdict: { kind: 'gap', category: 'base' },
    now
  })
  assert.deepEqual(rows.map(({ category }) => category), ['bundle', 'base'])
  const [bundle, base] = rows
  assert.equal(bundle.bestNow, null)
  assert.equal(bundle.lowest, null)
  assert.equal(bundle.target, 1750)
  assert.equal(bundle.highlighted, false)
  assert.equal(base.bestNow.retailer, 'Temple & Webster')
  assert.equal(base.bestNow.price, 1769)
  assert.equal(base.lowest.effectivePrice, 1537)
  assert.equal(base.target, 1600)
  assert.equal(base.highlighted, true)
})

test('priceTableRows highlights nothing without a verdict category', () => {
  const rows = priceTableRows({ item, verdict: { kind: 'none' }, now })
  assert.ok(rows.every(({ highlighted }) => !highlighted))
})

test('recentDealWindows keeps live windows and recent ended ones, newest first', () => {
  const window = (endDay, live = false) => ({ endDay, live, retailer: endDay })
  const ended = Array.from({ length: 8 }, (_, index) => window(`2026-11-0${index + 1}`))
    .reverse()
  const shown = recentDealWindows({
    windows: [window('2026-11-10', true), ...ended, window('2026-09-01')], now
  })
  assert.equal(shown[0].live, true)
  assert.equal(shown.length, 1 + ENDED_WINDOW_LIMIT)
  assert.ok(shown.every(({ endDay }) => endDay !== '2026-09-01'))
  assert.deepEqual(recentDealWindows({ windows: [window('2026-09-01')], now }), [])
})
