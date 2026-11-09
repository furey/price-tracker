import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bestDays, buildInsights, dealWindows, priceChanges, priceSeries, retailerSummaries
} from '../src/insights.js'

const ITEM = {
  rules: { base: { maxPrice: 1600 }, bundle: { maxPrice: 1750 } },
  categories: [{ id: 'bundle' }, { id: 'base' }]
}

const row = (overrides = {}) => ({
  checkedAt: '2026-11-07T02:00:00.000Z',
  retailer: 'Harvey Norman',
  category: 'base',
  title: 'Medium Oval',
  price: 1700,
  effectivePrice: 1700,
  wasPrice: null,
  isClearance: false,
  inStock: true,
  verified: true,
  url: 'https://example.com/hn',
  evidence: 'page text',
  notes: null,
  source: 'research',
  qualifies: false,
  ...overrides
})

const onDay = (day, overrides = {}) => row({ checkedAt: `${day}T02:00:00.000Z`, ...overrides })

test('priceSeries keeps the lowest price per retailer, category and Sydney day', () => {
  const rows = [
    row({ effectivePrice: 1700, source: 'research' }),
    row({ checkedAt: '2026-11-07T08:00:00.000Z', effectivePrice: 1650, source: 'direct' }),
    row({ retailer: 'Myer', effectivePrice: 1800 })
  ]
  const series = priceSeries(rows)
  assert.equal(series.length, 2)
  assert.deepEqual(
    [series[0].retailer, series[0].lowest, series[0].source, series[0].observations],
    ['Harvey Norman', 1650, 'direct', 2]
  )
  assert.deepEqual(series[0].sources, ['direct', 'research'])
})

test('priceSeries buckets by Sydney day, not UTC day', () => {
  const rows = [row({ checkedAt: '2026-11-06T14:30:00.000Z' })]
  assert.equal(priceSeries(rows)[0].day, '2026-11-07')
  assert.equal(priceSeries(rows, { tz: 'UTC' })[0].day, '2026-11-06')
})

test('priceSeries ignores rejects, out of stock and unpriced rows', () => {
  const rows = [
    row({ category: 'reject' }),
    row({ inStock: false }),
    row({ effectivePrice: null })
  ]
  assert.deepEqual(priceSeries(rows), [])
})

test('bestDays returns the lowest price ever per category with its evidence', () => {
  const rows = [
    onDay('2026-11-01', { effectivePrice: 1700 }),
    onDay('2026-11-05', { effectivePrice: 1550, retailer: 'Myer', evidence: 'cheap' }),
    onDay('2026-11-06', { effectivePrice: 1550, retailer: 'Later' }),
    onDay('2026-11-02', { category: 'bundle', effectivePrice: 1900 })
  ]
  const [base, bundle] = bestDays(rows)
  assert.deepEqual(
    [base.category, base.retailer, base.day, base.evidence, base.effectivePrice],
    ['base', 'Myer', '2026-11-05', 'cheap', 1550]
  )
  assert.equal(bundle.effectivePrice, 1900)
})

test('dealWindows groups contiguous qualifying days and marks ended windows', () => {
  const rows = [
    onDay('2026-11-01', { effectivePrice: 1700 }),
    onDay('2026-11-02', { effectivePrice: 1590 }),
    onDay('2026-11-03', { effectivePrice: 1550, evidence: 'best' }),
    onDay('2026-11-04', { effectivePrice: 1700 }),
    onDay('2026-11-07', { effectivePrice: 1700, retailer: 'Myer' })
  ]
  const alerts = [{
    kind: 'deal', delivered: true, retailer: 'harvey norman ', category: 'base',
    sentAt: '2026-11-02T21:31:00.000Z', effectivePrice: 1590
  }]
  const windows = dealWindows({ rows, item: ITEM, alerts })
  assert.equal(windows.length, 1)
  const [window] = windows
  assert.deepEqual(
    [window.startDay, window.endDay, window.live, window.lowest, window.alertSent],
    ['2026-11-02', '2026-11-03', false, 1550, true]
  )
  assert.equal(window.best.evidence, 'best')
  assert.equal(window.alert.sentAt, '2026-11-02T21:31:00.000Z')
})

test('dealWindows reports a window as live when the newest observation qualifies', () => {
  const rows = [
    onDay('2026-11-06', { effectivePrice: 1500 }),
    onDay('2026-11-07', { effectivePrice: 1500 })
  ]
  const [window] = dealWindows({ rows, item: ITEM })
  assert.equal(window.live, true)
  assert.equal(window.alertSent, false)
  assert.equal(window.alert, null)
})

test('dealWindows ends a window when a later non-qualifying day follows', () => {
  const rows = [
    onDay('2026-11-06', { effectivePrice: 1500 }),
    onDay('2026-11-07', { effectivePrice: 1800 })
  ]
  const [window] = dealWindows({ rows, item: ITEM })
  assert.equal(window.live, false)
})

test('dealWindows splits windows across a gap of more than one missing day', () => {
  const rows = [
    onDay('2026-11-01', { effectivePrice: 1500 }),
    onDay('2026-11-03', { effectivePrice: 1500 }),
    onDay('2026-11-07', { effectivePrice: 1500 })
  ]
  const windows = dealWindows({ rows, item: ITEM })
  assert.deepEqual(windows.map((window) => window.startDay), ['2026-11-07', '2026-11-01'])
  assert.equal(windows[1].endDay, '2026-11-03')
})

test('dealWindows ignores undelivered and heartbeat alerts and keeps categories apart', () => {
  const rows = [
    onDay('2026-11-02', { effectivePrice: 1500 }),
    onDay('2026-11-02', { category: 'bundle', effectivePrice: 1500 })
  ]
  const alerts = [
    { kind: 'deal', delivered: false, retailer: 'Harvey Norman', category: 'base',
      sentAt: '2026-11-02T02:00:00.000Z' },
    { kind: 'heartbeat', delivered: true, retailer: 'Harvey Norman', category: 'base',
      sentAt: '2026-11-02T02:00:00.000Z' }
  ]
  const windows = dealWindows({ rows, item: ITEM, alerts })
  assert.equal(windows.length, 2)
  assert.ok(windows.every((window) => !window.alertSent))
})

test('priceChanges lists dated drops and rises per retailer and category', () => {
  const rows = [
    onDay('2026-11-01', { effectivePrice: 1700 }),
    onDay('2026-11-02', { effectivePrice: 1700.4 }),
    onDay('2026-11-03', { effectivePrice: 1600 }),
    onDay('2026-11-04', { effectivePrice: 1750 }),
    onDay('2026-11-01', { retailer: 'Myer', effectivePrice: 1800 })
  ]
  const changes = priceChanges(rows)
  assert.deepEqual(
    changes.map(({ day, direction, from, to }) => [day, direction, from, to]),
    [['2026-11-04', 'rise', 1600, 1750], ['2026-11-03', 'drop', 1700.4, 1600]]
  )
})

test('retailerSummaries gives latest, lowest, highest, last seen, sources and sparkline', () => {
  const rows = [
    onDay('2026-11-01', { effectivePrice: 1700, source: 'research' }),
    onDay('2026-11-02', { effectivePrice: 1600, source: 'manual' }),
    onDay('2026-11-03', { effectivePrice: 1650, source: 'direct' })
  ]
  const [summary] = retailerSummaries(rows)
  assert.equal(summary.latest, 1650)
  assert.equal(summary.lowest, 1600)
  assert.equal(summary.highest, 1700)
  assert.equal(summary.lastSeen, '2026-11-03T02:00:00.000Z')
  assert.deepEqual(summary.sources, ['direct', 'manual', 'research'])
  assert.equal(summary.sparkline.length, 3)
})

test('retailerSummaries and bestDays carry the delivered total', () => {
  const rows = [onDay('2026-11-07', { effectivePrice: 1537.29, deliveryCost: 69 })]
  assert.equal(retailerSummaries(rows)[0].latestDelivered, 1606.29)
  assert.equal(bestDays(rows)[0].deliveredTotal, 1606.29)
  assert.equal(retailerSummaries([onDay('2026-11-07')])[0].latestDelivered, null)
})

test('buildInsights bundles every insight', () => {
  const insights = buildInsights({ rows: [onDay('2026-11-02')], item: ITEM })
  assert.deepEqual(
    Object.keys(insights).sort(),
    ['bestDays', 'dealWindows', 'kits', 'mutedCount', 'priceChanges', 'retailers', 'series']
  )
})
