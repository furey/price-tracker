import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildDirectSchedules, buildPresetSchedules, endDateFor, minuteFor, monthlyRuns, saleWindowsFrom
} from '../src/draft-schedule.js'
import { validateItem } from '../src/item-validate.js'

const NOW = new Date('2026-11-08T00:00:00Z')

test('endDateFor stops a delivery margin before the need-by date', () => {
  assert.equal(endDateFor({ needBy: '2026-12-20', today: '2026-11-08' }), '2026-12-14')
  assert.equal(endDateFor({ needBy: '2026-11-10', today: '2026-11-08' }), '2026-11-10')
  assert.equal(endDateFor({ needBy: null, today: '2026-11-08' }), null)
})

test('presets give the expected AI runs per month', () => {
  const runs = (preset) => monthlyRuns({
    schedules: buildPresetSchedules({ preset, minute: 10 }), now: NOW
  })
  assert.ok(runs('light') >= 8 && runs('light') <= 9)
  assert.equal(runs('normal'), 30)
  assert.equal(runs('keen'), 60)
})

test('a deadline ends every schedule and sale windows add a second daily run', () => {
  const saleWindows = saleWindowsFrom({
    seasonalSearches: [{ phrase: 'Black Friday', from: '2026-11-20', until: '2026-12-02' }],
    today: '2026-11-08',
    endDate: '2026-12-14'
  })
  assert.deepEqual(saleWindows, [{ phrase: 'Black Friday', from: '2026-11-25',
    until: '2026-12-02' }])
  const schedules = buildPresetSchedules({
    preset: 'normal', minute: 40, endDate: '2026-12-14', saleWindows
  })
  assert.deepEqual(schedules, [
    { cron: '40 7 * * *', tz: 'Australia/Sydney', until: '2026-12-14' },
    { cron: '40 19 * * *', tz: 'Australia/Sydney', from: '2026-11-25', until: '2026-12-02' }
  ])
  assert.equal(monthlyRuns({ schedules, now: NOW }), 37)
  const item = {
    id: 'x', name: 'X', product: 'x', categories: [{ id: 'a', description: 'a' }], rules: {},
    schedules, directSchedules: buildDirectSchedules({ endDate: '2026-12-14' }),
    ntfy: { server: 'https://ntfy.sh', topic: 'x' }, sources: { sites: [], searches: [] }
  }
  assert.deepEqual(validateItem(item), [])
})

test('minuteFor spreads items across the hour', () => {
  const minute = minuteFor('dyson-v15-detect')
  assert.ok(minute >= 5 && minute < 55)
  assert.equal(minuteFor('dyson-v15-detect'), minute)
})

test('overlapping sale windows merge into one extra schedule', () => {
  const windows = saleWindowsFrom({
    seasonalSearches: [
      { phrase: 'Black Friday', from: '2026-11-25', until: '2026-12-02' },
      { phrase: 'Cyber Monday', from: '2026-11-28', until: '2026-12-02' },
      { phrase: 'Boxing Day', from: '2026-12-24', until: '2026-12-28' }
    ],
    today: '2026-11-08'
  })
  assert.deepEqual(windows.map(({ from, until }) => [from, until]),
    [['2026-11-25', '2026-12-02'], ['2026-12-24', '2026-12-28']])
})
