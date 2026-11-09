import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { probeClaudeUsage, startupProbe } from '../src/claude-check.js'
import {
  guardDecision, guardLine, guardMessage, noticeGuardChange, noticeFor
} from '../src/claude-guard.js'
import {
  formatChanged, latestReadings, parseRateLimitEvent, percentOf, recordRateLimit, usageHistory
} from '../src/claude-usage.js'
import { openDb, recentRuns } from '../src/db.js'
import { createDraftWorker } from '../src/draft-worker.js'
import { createDraft, getDraft } from '../src/drafts.js'
import { capStatus } from '../src/ai-usage.js'
import { research, runClaude } from '../src/research.js'
import { runItem, tick } from '../src/runner.js'
import { createApp } from '../src/server.js'
import { setSetting } from '../src/settings.js'
import { fenced, scopeQuestions, scriptedClaude } from './fake-claude.js'

const NOW = new Date('2026-11-08T00:00:00Z')
const RESETS = 1794391200
const SOON = Math.floor(Date.now() / 1000) + 3 * 86400
const LIMITS = { weeklyReserve: 70, sessionReserve: 90, paused: false }

const realEvent = (overrides = {}) => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    resetsAt: RESETS,
    rateLimitType: 'seven_day',
    overageStatus: 'rejected',
    overageDisabledReason: 'org_level_disabled',
    isUsingOverage: false,
    unifiedWindows: { seven_day: { utilization: 0.41, resetsAt: RESETS } },
    ...overrides
  }
})

const weekly = (utilization, resetsAt = RESETS) =>
  realEvent({ unifiedWindows: { seven_day: { utilization, resetsAt } } })

const reading = (overrides = {}) => ({
  window: 'seven_day', utilization: 0.41, resetsAt: '2026-11-11T10:00:00.000Z',
  status: 'allowed', ...overrides
})

test('parser reads the real seven_day event as a fraction with an ISO reset', () => {
  const parsed = parseRateLimitEvent(realEvent())
  assert.equal(parsed.ok, true)
  assert.equal(parsed.readings.length, 1)
  const [only] = parsed.readings
  assert.equal(only.window, 'seven_day')
  assert.equal(only.utilization, 0.41)
  assert.equal(percentOf(only.utilization), 41)
  assert.equal(only.resetsAt, new Date(RESETS * 1000).toISOString())
  assert.equal(only.status, 'allowed')
  assert.equal(only.isUsingOverage, false)
  assert.equal(only.overageStatus, 'rejected')
})

test('parser handles several windows generically', () => {
  const parsed = parseRateLimitEvent(realEvent({
    unifiedWindows: {
      five_hour: { utilization: 0.93, resetsAt: RESETS - 3600 },
      seven_day: { utilization: 0.5, resetsAt: RESETS },
      seven_day_opus: { utilization: 0.1 }
    }
  }))
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.readings.map(({ window }) => window),
    ['five_hour', 'seven_day', 'seven_day_opus'])
  assert.equal(parsed.readings[0].status, 'allowed')
  assert.equal(parsed.readings[2].resetsAt, null)
})

test('parser keeps a rejected status even without a utilization', () => {
  const parsed = parseRateLimitEvent({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'rejected', resetsAt: RESETS, rateLimitType: 'five_hour' }
  })
  assert.equal(parsed.ok, true)
  assert.equal(parsed.readings[0].window, 'five_hour')
  assert.equal(parsed.readings[0].status, 'rejected')
  assert.equal(parsed.readings[0].utilization, null)
})

test('parser reports unknown shapes instead of guessing', () => {
  assert.equal(parseRateLimitEvent(null).ok, false)
  assert.equal(parseRateLimitEvent({ type: 'rate_limit_event' }).ok, false)
  assert.equal(parseRateLimitEvent({ rate_limit_info: { usage: 41 } }).ok, false)
  assert.equal(parseRateLimitEvent(weekly('41%')).ok, false)
  assert.equal(parseRateLimitEvent(weekly(41)).ok, false)
  assert.equal(parseRateLimitEvent(realEvent({ unifiedWindows: {}, status: undefined })).ok,
    false)
})

test('readings are stored per window, the latest wins, and history keeps every reading', () => {
  const db = openDb(':memory:')
  recordRateLimit({ db, event: weekly(0.3), source: 'run', sourceId: 4,
    now: new Date('2026-11-06T00:00:00Z') })
  recordRateLimit({ db, event: weekly(0.45), source: 'probe', now: NOW })
  const [latest] = latestReadings({ db })
  assert.equal(latest.utilization, 0.45)
  assert.equal(latest.percent, 45)
  assert.equal(latest.source, 'probe')
  assert.deepEqual(usageHistory({ db, now: NOW }).map(({ utilization }) => utilization),
    [0.3, 0.45])
})

test('an unrecognised event flags a format change and keeps the last good reading', () => {
  const db = openDb(':memory:')
  recordRateLimit({ db, event: weekly(0.4), source: 'run', now: NOW })
  recordRateLimit({ db, event: { type: 'rate_limit_event', rate_limit_info: 'odd' },
    source: 'run', now: NOW })
  assert.equal(formatChanged({ db }), true)
  assert.equal(latestReadings({ db })[0].utilization, 0.4)
  recordRateLimit({ db, event: weekly(0.42), source: 'run', now: NOW })
  assert.equal(formatChanged({ db }), false)
})

test('readings older than 90 days are pruned', () => {
  const db = openDb(':memory:')
  recordRateLimit({ db, event: weekly(0.2), source: 'run', now: new Date('2026-07-01T00:00:00Z') })
  recordRateLimit({ db, event: weekly(0.3), source: 'run', now: NOW })
  const count = db.prepare('SELECT COUNT(*) AS n FROM claude_usage').get().n
  assert.equal(count, 1)
})

test('guard allows below the reserve and skips above it', () => {
  assert.equal(guardDecision({ readings: [reading()], limits: LIMITS, now: NOW }).allow, true)
  const above = guardDecision({ readings: [reading({ utilization: 0.74 })], limits: LIMITS,
    now: NOW })
  assert.equal(above.allow, false)
  assert.equal(above.reason, 'reserve')
  assert.equal(above.percent, 74)
  assert.equal(above.reserve, 70)
  assert.equal(above.resumesAt, '2026-11-11T10:00:00.000Z')
  assert.equal(guardLine(above), 'AI checks paused: above your 70% reserve until Wed 9 pm')
  assert.equal(guardMessage(above), 'Waiting: your Claude weekly usage is 74%, above your '
    + '70% reserve. Resumes after Wed 11 Nov 9:00 pm.')
})

test('guard skips everything when paused', () => {
  const decision = guardDecision({ readings: [], limits: { ...LIMITS, paused: true }, now: NOW })
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'paused')
  assert.equal(guardLine(decision), 'All AI paused by you')
})

test('guard ignores a reading whose reset has passed', () => {
  const expired = reading({ utilization: 0.99, resetsAt: '2026-11-07T00:00:00.000Z' })
  assert.equal(guardDecision({ readings: [expired], limits: LIMITS, now: NOW }).allow, true)
})

test('guard skips on a rejected status until the reset', () => {
  const rejected = reading({ utilization: 0.2, status: 'rejected' })
  const decision = guardDecision({ readings: [rejected], limits: LIMITS, now: NOW })
  assert.equal(decision.allow, false)
  assert.equal(decision.reason, 'limited')
  assert.match(guardLine(decision), /weekly limit reached until Wed 9 pm/)
})

test('guard uses the session reserve for a five_hour window', () => {
  const session = reading({ window: 'five_hour', utilization: 0.85 })
  assert.equal(guardDecision({ readings: [session], limits: LIMITS, now: NOW }).allow, true)
  const high = reading({ window: 'five_hour', utilization: 0.95 })
  const decision = guardDecision({ readings: [high], limits: LIMITS, now: NOW })
  assert.equal(decision.allow, false)
  assert.equal(decision.reserve, 90)
})

test('notices fire once when skipping starts in a window and once on resume', async () => {
  const db = openDb(':memory:')
  const sent = []
  const send = async (notice) => { sent.push(notice) }
  const above = guardDecision({ readings: [reading({ utilization: 0.74 })], limits: LIMITS,
    now: NOW })
  assert.equal(await noticeGuardChange({ db, decision: above, now: NOW, send }), true)
  assert.equal(await noticeGuardChange({ db, decision: above, now: NOW, send }), false)
  const allowed = { allow: true, reason: null, resumesAt: null }
  assert.equal(await noticeGuardChange({ db, decision: allowed, now: NOW, send }), true)
  assert.equal(await noticeGuardChange({ db, decision: allowed, now: NOW, send }), false)
  assert.deepEqual(sent.map(({ title }) => title), ['AI checks paused', 'AI checks resumed'])
  assert.match(sent[0].click, /#\/settings$/)
  assert.doesNotMatch(sent[0].message, /[–—]/)
  assert.equal(noticeFor({ decision: { allow: false, reason: 'paused' }, stored: null }), null)
})

test('runClaude stops the child when the rate limit handler returns a reason', async () => {
  const kills = []
  const { spawnImpl } = hangingClaude({ event: weekly(0.74) })
  await assert.rejects(
    runClaude({
      prompt: 'p', timeoutMs: 5000, spawnImpl,
      killImpl: (pid, signal) => kills.push([pid, signal]),
      onRateLimit: () => 'Stopped early: weekly usage 74% above 70% reserve'
    }),
    (error) => error.kind === 'skipped' && /Stopped early/.test(error.message)
  )
  assert.deepEqual(kills[0], [-6161, 'SIGTERM'])
})

test('a scheduled run above the reserve stops early and is marked skipped', async () => {
  const db = openDb(':memory:')
  const { spawnImpl } = hangingClaude({ event: weekly(0.74, SOON) })
  const result = await runItem({
    item: researchItem(), trigger: 'tick', now: NOW, db,
    deps: { log: () => {}, appNotice: async () => {}, research: researchWith({ spawnImpl }) }
  })
  assert.equal(result.status, 'skipped')
  assert.equal(result.error, 'Stopped early: weekly usage 74% above 70% reserve')
  const [run] = recentRuns({ db })
  assert.equal(run.status, 'skipped')
  assert.equal(latestReadings({ db })[0].sourceId, String(run.id))
  assert.equal(capStatus({ db, now: NOW }).used, 0)
})

test('a manual run above the reserve is not stopped', async () => {
  const db = openDb(':memory:')
  const { spawnImpl } = hangingClaude({ event: weekly(0.74, SOON), finishMs: 5 })
  const result = await runItem({
    item: researchItem(), trigger: 'manual', now: NOW, db,
    deps: { log: () => {}, appNotice: async () => {}, research: researchWith({ spawnImpl }) }
  })
  assert.notEqual(result.status, 'skipped')
  assert.equal(latestReadings({ db })[0].utilization, 0.74)
})

test('tick skips research above the reserve without a cooldown or a retry of the slot',
  async () => {
    const db = openDb(':memory:')
    const dir = await mkdtemp(join(tmpdir(), 'guard-tick-'))
    recordRateLimit({ db, event: weekly(0.74), source: 'probe', now: NOW })
    const calls = { research: 0, notices: [] }
    const deps = {
      research: async () => { calls.research += 1; return { ok: false, errors: ['x'] } },
      appNotice: async (notice) => { calls.notices.push(notice.title) }
    }
    const item = researchItem()
    const runnable = [{ item, version: 1 }]
    const at = new Date('2026-11-08T00:00:00Z')
    const run = (now) => tick({
      now, db, deps, log: () => {}, items: runnable, lockPath: join(dir, 'tick.lock')
    })
    const first = await run(at)
    assert.equal(first[0].action, 'skipped-claude-guard')
    assert.match(first[0].reason, /^Skipped: your Claude weekly usage is 74%/)
    const second = await run(new Date(at.getTime() + 15 * 60000))
    assert.equal(second[0].action, 'not-due')
    assert.equal(calls.research, 0)
    assert.deepEqual(calls.notices, ['AI checks paused'])
    assert.equal(recentRuns({ db }).filter(({ status }) => status === 'skipped').length, 1)
  })

test('refresh probes once and is rate limited for 10 minutes', async () => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'probe-'))
  const claude = scriptedClaude([{ resultText: 'ok', rateLimit: weekly(0.41).rate_limit_info }])
  const options = {
    db, env: {}, claudeLockPath: join(dir, 'claude.lock'), spawnImpl: claude.spawnImpl,
    cwd: join(dir, 'work')
  }
  const first = await probeClaudeUsage({ ...options, now: NOW })
  assert.equal(first.ok, true)
  assert.equal(first.readings[0].utilization, 0.41)
  const args = claude.calls[0].args
  assert.equal(args[args.indexOf('-p') + 1], 'Reply with ok')
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2),
    ['--tools', ''])
  assert.equal(args[args.indexOf('--max-turns') + 1], '1')
  const second = await probeClaudeUsage({ ...options, now: new Date(NOW.getTime() + 60000) })
  assert.equal(second.rateLimited, true)
  assert.equal(claude.calls.length, 1)
  assert.equal(latestReadings({ db })[0].source, 'probe')
})

test('startup probe skips when a reading is under 6 hours old', async () => {
  const db = openDb(':memory:')
  recordRateLimit({ db, event: weekly(0.4), source: 'run', now: NOW })
  const outcome = await startupProbe({
    db, now: new Date(NOW.getTime() + 3600000),
    spawnImpl: () => { throw new Error('should not run') }
  })
  assert.equal(outcome, null)
})

test('draft steps wait while the guard skips and run once with run anyway', async () => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'draft-guard-'))
  const claude = scriptedClaude([{ resultText: fenced(scopeQuestions) }])
  const blocked = { allow: false, reason: 'reserve', window: 'seven_day', percent: 74,
    reserve: 70, resumesAt: '2026-11-11T10:00:00.000Z' }
  const worker = createDraftWorker({
    db, spawnImpl: claude.spawnImpl, now: () => NOW, claudeLockPath: join(dir, 'claude.lock'),
    cwd: join(dir, 'work'), notify: async () => {}, log: () => {}, guard: () => blocked
  })
  const draft = createDraft({
    db, now: NOW,
    input: { request: 'Dyson V15', budget: 900, budgetMode: 'around', quantity: 1,
      needBy: null, mustHaves: [], links: [] }
  })
  await worker.kick()
  assert.equal(claude.calls.length, 0)
  assert.equal(getDraft({ db, id: draft.id }).jobState, 'queued')
  db.prepare('UPDATE drafts SET run_anyway = 1 WHERE id = ?').run(draft.id)
  await worker.kick()
  assert.equal(claude.calls.length, 1)
  assert.equal(getDraft({ db, id: draft.id }).status, 'clarifying')
  assert.equal(getDraft({ db, id: draft.id }).runAnyway, false)
})

test('usage API reports readings, the guard, and toggles pause', async () => {
  await withServer(async ({ base, db }) => {
    recordRateLimit({ db, event: weekly(0.41, SOON), source: 'probe', now: new Date() })
    const usage = await (await fetch(`${base}/api/claude/usage`)).json()
    assert.equal(usage.weekly.percent, 41)
    assert.equal(usage.weekly.reserve, 70)
    assert.equal(usage.guard.line, 'AI checks running')
    assert.equal(usage.history.length, 1)
    assert.equal(usage.month.cap, 150)
    const paused = await (await post({ base, path: '/api/claude/pause' })).json()
    assert.equal(paused.guard.line, 'All AI paused by you')
    assert.equal(paused.limits.paused, true)
    const resumed = await (await post({ base, path: '/api/claude/resume' })).json()
    assert.equal(resumed.guard.allow, true)
    const crossSite = await post({ base, path: '/api/claude/pause',
      headers: { origin: 'https://evil.example' } })
    assert.equal(crossSite.status, 403)
  })
})

test('refresh route returns 429 inside the 10-minute window', async () => {
  await withServer(async ({ base, db }) => {
    setSetting({ db, key: 'aiPaused', value: 'false' })
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('claudeProbeAt', :at, :at)`)
      .run({ at: new Date().toISOString() })
    const response = await post({ base, path: '/api/claude/usage/refresh' })
    assert.equal(response.status, 429)
    const body = await response.json()
    assert.match(body.error, /10 minutes/)
    assert.ok(body.usage.guard)
  })
})

test('run now is refused above the reserve and starts with run anyway', async () => {
  const spawned = []
  await withServer(async ({ base, db, dir }) => {
    recordRateLimit({ db, event: weekly(0.74, SOON), source: 'probe', now: new Date() })
    const refused = await post({ base, path: '/api/items/k7/run', body: { dryRun: false } })
    assert.equal(refused.status, 409)
    const body = await refused.json()
    assert.match(body.error, /^Waiting: your Claude weekly usage is 74%/)
    assert.equal(body.guard.reason, 'reserve')
    const forced = await post({ base, path: '/api/items/k7/run', body: { runAnyway: true } })
    assert.equal(forced.status, 202)
    assert.equal(spawned.length, 1)
    assert.ok(dir)
  }, { spawnImpl: (...args) => { spawned.push(args); return { unref: () => {} } } })
})

const researchItem = () => ({
  id: 'k7',
  name: 'Karcher K7',
  enabled: true,
  schedules: [{ cron: '0 8 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'topic-1' },
  categories: [{ id: 'smart', description: 'Smart' }],
  rules: { smart: { maxPrice: 1100 } },
  sources: { sites: [{ name: 'Bunnings' }], searches: ['K7'] },
  dedupe: { minDrop: 25 }
})

const researchWith = ({ spawnImpl }) => (options) => research({
  ...options, spawnImpl, killImpl: spawnImpl.kill
})

const hangingClaude = ({ event, finishMs = null }) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 6161
  const close = () => setImmediate(() => child.emit('close', 143))
  const spawnImpl = () => {
    setImmediate(() => {
      const lines = [{ type: 'system', subtype: 'init', session_id: 's' }, event]
      child.stdout.emit('data', Buffer.from(`${lines.map((l) => JSON.stringify(l)).join('\n')}\n`))
      if (finishMs === null) return
      setTimeout(() => {
        const result = { type: 'result', subtype: 'success', is_error: false,
          result: fenced({ checkedAt: NOW.toISOString(), sources: [], listings: [] }),
          session_id: 's', total_cost_usd: 0.1 }
        child.stdout.emit('data', Buffer.from(`${JSON.stringify(result)}\n`))
        child.emit('close', 0)
      }, finishMs)
    })
    return child
  }
  spawnImpl.kill = close
  return { spawnImpl }
}

const RECORD = { id: 'k7', status: 'active', version: 1, config: researchItem() }

const withServer = async (fn, { spawnImpl } = {}) => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'usage-api-'))
  const app = createApp({
    db, getItems: () => [RECORD], env: {}, distDir: '/nonexistent',
    lockPath: join(dir, 'tick.lock'), ...(spawnImpl ? { spawnImpl } : {})
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, db, dir })
  } finally {
    server.close()
  }
}

const post = ({ base, path, body = {}, headers = {} }) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body)
})
