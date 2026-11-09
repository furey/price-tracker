import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  focusedSeries, keepFocus, priceDomain, toggleFocus
} from '../web/src/chartFocus.js'

const line = (name, ...values) => ({ name, points: values.map((value) => ({ value })) })
const series = [line('A', 100, 120), line('B', 900, 950), line('C', 500)]

test('toggleFocus focuses, unfocuses, and switches', () => {
  assert.equal(toggleFocus({ current: null, name: 'A' }), 'A')
  assert.equal(toggleFocus({ current: 'A', name: 'A' }), null)
  assert.equal(toggleFocus({ current: 'A', name: 'B' }), 'B')
})

test('keepFocus drops a series that no longer exists', () => {
  assert.equal(keepFocus({ focused: 'A', names: ['A', 'B'] }), 'A')
  assert.equal(keepFocus({ focused: 'Z', names: ['A', 'B'] }), null)
  assert.equal(keepFocus({ focused: null, names: ['A'] }), null)
})

test('focusedSeries returns all series or only the focused one', () => {
  assert.equal(focusedSeries({ series, focused: null }).length, 3)
  assert.deepEqual(focusedSeries({ series, focused: 'B' }).map(({ name }) => name), ['B'])
})

test('priceDomain rescales to the focused series', () => {
  const all = priceDomain({ series, capValues: [] })
  const one = priceDomain({ series: focusedSeries({ series, focused: 'A' }), capValues: [] })
  assert.ok(all[1] >= 950)
  assert.ok(one[1] < 200)
  assert.ok(one[0] <= 100)
})

test('priceDomain keeps the alert price in range', () => {
  const [, high] = priceDomain({ series: [line('A', 100, 120)], capValues: [400] })
  assert.ok(high >= 400)
})
