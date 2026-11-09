import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TICK_INTERVAL_MS, startDaemon } from '../src/daemon.js'

const fakeTimers = () => {
  const scheduled = []
  return {
    scheduled,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      scheduled.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      if (timer) timer.cleared = true
    }
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('runs a tick at once and schedules the next after it finishes', async () => {
  const timers = fakeTimers()
  let ticks = 0
  startDaemon({ runTick: async () => { ticks += 1 }, log: () => {}, ...timers })
  assert.equal(ticks, 1)
  await settle()
  assert.equal(timers.scheduled.length, 1)
  assert.equal(timers.scheduled[0].ms, TICK_INTERVAL_MS)
  timers.scheduled[0].fn()
  await settle()
  assert.equal(ticks, 2)
  assert.equal(timers.scheduled.length, 2)
})

test('does not schedule the next tick until the running one ends', async () => {
  const timers = fakeTimers()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  startDaemon({ runTick: () => gate, log: () => {}, ...timers })
  await settle()
  assert.equal(timers.scheduled.length, 0)
  release()
  await settle()
  assert.equal(timers.scheduled.length, 1)
})

test('logs a failed tick and keeps scheduling', async () => {
  const timers = fakeTimers()
  const lines = []
  startDaemon({
    runTick: async () => { throw new Error('boom') },
    log: (line) => lines.push(line),
    ...timers
  })
  await settle()
  assert.deepEqual(lines, ['tick failed: boom'])
  assert.equal(timers.scheduled.length, 1)
})

test('stop clears the timer and prevents further scheduling', async () => {
  const timers = fakeTimers()
  const daemon = startDaemon({ runTick: async () => {}, log: () => {}, ...timers })
  await settle()
  await daemon.stop()
  assert.equal(timers.scheduled[0].cleared, true)
  timers.scheduled[0].fn()
  await settle()
  assert.equal(timers.scheduled.length, 1)
})

test('stop waits for a tick in flight and schedules nothing after it', async () => {
  const timers = fakeTimers()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const daemon = startDaemon({ runTick: () => gate, log: () => {}, ...timers })
  const stopped = daemon.stop()
  release()
  await stopped
  assert.equal(timers.scheduled.length, 0)
})
