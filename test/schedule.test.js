import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueSlot, nextSlot, slotsBetween, windowBounds } from '../src/schedule.js'

const TZ = 'Australia/Sydney'
const daily = { cron: '45 7 * * *', tz: TZ, until: '2026-12-02' }
const twiceWeekly = { cron: '45 7 * * 2,5', tz: TZ, from: '2026-12-02' }
const springfree = [daily, twiceWeekly]
const iso = (date) => date?.toISOString() ?? null

test('windowBounds converts date-only values to local midnight in AEDT', () => {
  const { from, until } = windowBounds({ ...daily, from: '2026-11-01' })
  assert.equal(iso(until), '2026-12-01T13:00:00.000Z')
  assert.equal(iso(from), '2026-10-31T13:00:00.000Z')
})

test('windowBounds uses AEST outside daylight saving', () => {
  const { from } = windowBounds({ cron: '* * * * *', tz: TZ, from: '2026-07-01' })
  assert.equal(iso(from), '2026-06-30T14:00:00.000Z')
})

test('windowBounds handles the DST switch day', () => {
  const { from } = windowBounds({ cron: '* * * * *', tz: TZ, from: '2026-10-04' })
  assert.equal(iso(from), '2026-10-03T14:00:00.000Z')
})

test('windowBounds returns nulls when no window is set', () => {
  assert.deepEqual(windowBounds({ cron: '* * * * *', tz: TZ }), { from: null, until: null })
})

test('windowBounds keeps full ISO values as given', () => {
  const { until } = windowBounds({ cron: '* * * * *', tz: TZ, until: '2026-12-02T00:00:00Z' })
  assert.equal(iso(until), '2026-12-02T00:00:00.000Z')
})

test('slotsBetween lists slots in (after, until]', () => {
  const slots = slotsBetween({
    schedule: { cron: '45 7 * * *', tz: TZ },
    after: new Date('2026-11-29T20:45:00Z'),
    until: new Date('2026-12-01T20:45:00Z')
  })
  assert.deepEqual(slots.map(iso), ['2026-11-30T20:45:00.000Z', '2026-12-01T20:45:00.000Z'])
})

test('slotsBetween 2026-12-01 07:45 Sydney is a daily slot', () => {
  const slots = slotsBetween({
    schedule: daily,
    after: new Date('2026-11-30T00:00:00Z'),
    until: new Date('2026-12-02T21:00:00Z')
  })
  assert.deepEqual(slots.map(iso), ['2026-11-30T20:45:00.000Z'])
})

test('slotsBetween has no daily slot on or after the until date', () => {
  const slots = slotsBetween({
    schedule: daily,
    after: new Date('2026-11-30T21:00:00Z'),
    until: new Date('2026-12-10T00:00:00Z')
  })
  assert.deepEqual(slots, [])
})

test('slotsBetween skips Thursday 2026-12-03 and includes Friday 2026-12-04', () => {
  const slots = slotsBetween({
    schedule: twiceWeekly,
    after: new Date('2026-12-01T00:00:00Z'),
    until: new Date('2026-12-05T00:00:00Z')
  })
  assert.deepEqual(slots.map(iso), ['2026-12-03T20:45:00.000Z'])
})

test('slotsBetween honours an inclusive from boundary', () => {
  const schedule = { cron: '0 0 * * *', tz: TZ, from: '2026-12-03' }
  const slots = slotsBetween({
    schedule,
    after: new Date('2026-12-01T00:00:00Z'),
    until: new Date('2026-12-04T00:00:00Z')
  })
  assert.deepEqual(slots.map(iso), ['2026-12-02T13:00:00.000Z', '2026-12-03T13:00:00.000Z'])
})

test('dueSlot returns the latest slot within lookback when never run', () => {
  const now = new Date('2026-11-20T03:00:00Z')
  const slot = dueSlot({
    schedules: [{ cron: '45 7 * * *', tz: TZ }],
    lastSuccessAt: null,
    now
  })
  assert.equal(iso(slot), '2026-11-19T20:45:00.000Z')
})

test('dueSlot never-run respects lookbackDays', () => {
  const slot = dueSlot({
    schedules: [{ cron: '45 7 * * 1', tz: TZ }],
    lastSuccessAt: null,
    now: new Date('2026-11-20T03:00:00Z'),
    lookbackDays: 1
  })
  assert.equal(slot, null)
})

test('dueSlot returns a slot passed since the last success', () => {
  const slot = dueSlot({
    schedules: [{ cron: '45 7 * * *', tz: TZ }],
    lastSuccessAt: new Date('2026-11-19T20:50:00Z'),
    now: new Date('2026-11-20T21:00:00Z')
  })
  assert.equal(iso(slot), '2026-11-20T20:45:00.000Z')
})

test('dueSlot returns null when no slot passed since the last success', () => {
  const slot = dueSlot({
    schedules: [{ cron: '45 7 * * *', tz: TZ }],
    lastSuccessAt: new Date('2026-11-19T20:50:00Z'),
    now: new Date('2026-11-20T10:00:00Z')
  })
  assert.equal(slot, null)
})

test('dueSlot returns null when the last success was after the latest slot', () => {
  const slot = dueSlot({
    schedules: [{ cron: '45 7 * * *', tz: TZ }],
    lastSuccessAt: new Date('2026-11-19T21:30:00Z'),
    now: new Date('2026-11-20T10:00:00Z')
  })
  assert.equal(slot, null)
})

test('dueSlot catch-up after several missed slots returns exactly one, the latest', () => {
  const slot = dueSlot({
    schedules: [{ cron: '45 7 * * *', tz: TZ }],
    lastSuccessAt: new Date('2026-11-10T00:00:00Z'),
    now: new Date('2026-11-16T05:00:00Z')
  })
  assert.ok(slot instanceof Date)
  assert.equal(iso(slot), '2026-11-15T20:45:00.000Z')
})

test('dueSlot takes the latest across multiple schedules', () => {
  const slot = dueSlot({
    schedules: [
      { cron: '0 9 * * *', tz: TZ },
      { cron: '30 10 * * *', tz: TZ }
    ],
    lastSuccessAt: new Date('2026-11-19T00:00:00Z'),
    now: new Date('2026-11-20T00:00:00Z')
  })
  assert.equal(iso(slot), '2026-11-19T23:30:00.000Z')
})

test('dueSlot ignores schedules outside their window', () => {
  const slot = dueSlot({
    schedules: springfree,
    lastSuccessAt: new Date('2026-12-04T00:00:00Z'),
    now: new Date('2026-12-04T05:00:00Z')
  })
  assert.equal(slot, null)
})

test('dueSlot finds the Friday slot after the window switch', () => {
  const slot = dueSlot({
    schedules: springfree,
    lastSuccessAt: new Date('2026-12-01T21:00:00Z'),
    now: new Date('2026-12-04T05:00:00Z')
  })
  assert.equal(iso(slot), '2026-12-03T20:45:00.000Z')
})

test('nextSlot returns the earliest future slot across schedules', () => {
  const slot = nextSlot({
    schedules: [
      { cron: '0 9 * * *', tz: TZ },
      { cron: '30 10 * * *', tz: TZ }
    ],
    now: new Date('2026-11-19T22:30:00Z')
  })
  assert.equal(iso(slot), '2026-11-19T23:30:00.000Z')
})

test('nextSlot crosses the window switch from daily to Tue/Fri', () => {
  const slot = nextSlot({ schedules: springfree, now: new Date('2026-11-30T20:45:00Z') })
  assert.equal(iso(slot), '2026-12-03T20:45:00.000Z')
})

test('nextSlot before a from window starts at the window', () => {
  const slot = nextSlot({
    schedules: [twiceWeekly],
    now: new Date('2026-11-07T00:00:00Z')
  })
  assert.equal(iso(slot), '2026-12-03T20:45:00.000Z')
})

test('nextSlot returns null when every window has closed', () => {
  const slot = nextSlot({
    schedules: [daily],
    now: new Date('2026-12-05T00:00:00Z')
  })
  assert.equal(slot, null)
})
