import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb, recentRuns, startRun } from '../src/db.js'
import { setSetting } from '../src/settings.js'
import { LockHeldError, withLock } from '../src/lock.js'
import { claudeLockFor, runItemLocked, tick } from '../src/runner.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')

const item = {
  id: 'k7',
  name: 'Kärcher K7',
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  direct: [
    { retailer: 'Shop', url: 'https://shop.com.au/k7', category: 'smart', parser: 'jsonld' }
  ],
  directSchedules: [{ cron: '30 9 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'k7-topic' },
  categories: [{ id: 'smart', description: 'Smart' }],
  rules: { smart: { maxPrice: 1100 } },
  heartbeat: { monthly: false }
}

const okData = {
  checkedAt: NOW.toISOString(),
  sources: [{ name: 'Shop', status: 'ok', note: '' }],
  listings: []
}

const makeDeps = () => {
  const calls = { research: 0, direct: 0 }
  return {
    calls,
    log: () => {},
    research: async () => {
      calls.research += 1
      return { ok: true, data: okData, costUsd: 1 }
    },
    direct: async () => {
      calls.direct += 1
      return { ok: true, data: okData, costUsd: null }
    },
    deliver: async () => ({ delivered: true })
  }
}

const holdLock = async ({ path, label }) => {
  let release
  let acquired
  const ready = new Promise((resolve) => { acquired = resolve })
  const held = withLock({
    path,
    label,
    fn: () => new Promise((resolve) => {
      release = resolve
      acquired()
    })
  })
  await ready
  return { done: async () => { release(); await held } }
}

test('tick defers research while a draft holds the AI lock, without a failed run', async () => {
  const db = openDb(':memory:')
  const lockPath = join(await mkdtemp(join(tmpdir(), 'ai-lock-')), 'tick.lock')
  const deps = makeDeps()
  const runTick = (now) => tick({
    now, db, deps, log: () => {}, items: [{ item, version: 1 }], lockPath
  })
  const draft = await holdLock({ path: claudeLockFor(lockPath), label: 'New item draft "Bike"' })
  const first = await runTick(NOW)
  assert.deepEqual(first.map(({ mode, action }) => [mode, action]),
    [['research', 'deferred-ai-busy'], ['direct', 'ran']])
  assert.equal(deps.calls.research, 0)
  assert.equal(deps.calls.direct, 1)
  const researchRuns = recentRuns({ db, itemId: 'k7' }).filter(({ mode }) => mode === 'research')
  assert.equal(researchRuns.length, 0)
  await draft.done()
  const soon = new Date(NOW.getTime() + 15 * 60_000)
  const second = await runTick(soon)
  assert.equal(second[0].action, 'ran')
  assert.equal(deps.calls.research, 1)
})

test('a manual research run refuses to start while the AI lock is held', async () => {
  const db = openDb(':memory:')
  const lockPath = join(await mkdtemp(join(tmpdir(), 'ai-lock-')), 'tick.lock')
  const draft = await holdLock({ path: claudeLockFor(lockPath), label: 'New item draft "Bike"' })
  await assert.rejects(
    runItemLocked({ lockPath, db, item, deps: makeDeps(), now: NOW }),
    (error) => error instanceof LockHeldError && error.label === 'New item draft "Bike"'
  )
  const direct = await runItemLocked({
    lockPath, db, item, deps: makeDeps(), now: NOW, mode: 'direct'
  })
  assert.equal(direct.status, 'ok')
  await draft.done()
})

test('tick skips research at the monthly cap, keeps free checks, and warns once', async () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'aiMonthlyCap', value: '1' })
  startRun({ db, itemId: 'other', trigger: 'tick', startedAt: NOW.toISOString() })
  const lockPath = join(await mkdtemp(join(tmpdir(), 'ai-cap-')), 'tick.lock')
  const notices = []
  const deps = { ...makeDeps(), appNotice: async (notice) => { notices.push(notice.title) } }
  const runTick = (now) => tick({
    now, db, deps, log: () => {}, items: [{ item, version: 1 }], lockPath
  })
  const first = await runTick(NOW)
  assert.deepEqual(first.map(({ mode, action }) => [mode, action]),
    [['research', 'skipped-monthly-cap'], ['direct', 'ran']])
  await runTick(new Date(NOW.getTime() + 15 * 60_000))
  assert.equal(deps.calls.research, 0)
  assert.deepEqual(notices, ['Monthly AI cap reached'])
  setSetting({ db, key: 'aiMonthlyCap', value: '5' })
  const raised = await runTick(new Date(NOW.getTime() + 30 * 60_000))
  assert.equal(raised[0].action, 'ran')
})
