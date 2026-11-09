import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  FALLBACK_COST_USD, capCheck, monthUsage, perRunAverages, usageSummary
} from '../src/ai-usage.js'
import { finishRun, openDb, startRun } from '../src/db.js'
import {
  aiMonthlyCap, ensureAppTopic, publicSettings, setSetting, validateSetting
} from '../src/settings.js'
import { createItem } from '../src/item-store.js'

const NOW = new Date('2026-11-08T00:00:00Z')

const config = (id, cron) => ({
  id, name: id.toUpperCase(), product: 'x', categories: [{ id: 'a', description: 'a' }],
  rules: {}, schedules: [{ cron, tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: `${id}-topic` }, sources: { sites: [], searches: [] }
})

test('aiMonthlyCap defaults to 150, then the env, then the setting', () => {
  const db = openDb(':memory:')
  assert.equal(aiMonthlyCap({ db, env: {} }), 150)
  assert.equal(aiMonthlyCap({ db, env: { AI_MONTHLY_CAP: '90' } }), 90)
  assert.equal(aiMonthlyCap({ db, env: { AI_MONTHLY_CAP: 'lots' } }), 150)
  setSetting({ db, key: 'aiMonthlyCap', value: '40' })
  assert.equal(aiMonthlyCap({ db, env: { AI_MONTHLY_CAP: '90' } }), 40)
  assert.equal(validateSetting({ key: 'aiMonthlyCap', value: '0' }), null)
  assert.match(validateSetting({ key: 'aiMonthlyCap', value: '1001' }), /from 0 to 1000/)
  const shown = publicSettings({ db: openDb(':memory:'), env: {} })
    .find(({ key }) => key === 'aiMonthlyCap')
  assert.deepEqual([shown.value, shown.source], ['150', 'default'])
})

test('ensureAppTopic generates the app topic once and keeps it', () => {
  const db = openDb(':memory:')
  const topic = ensureAppTopic({ db, env: {}, now: NOW })
  assert.match(topic, /^pt-app-[0-9a-f]{32}$/)
  assert.equal(ensureAppTopic({ db, env: {}, now: NOW }), topic)
  assert.equal(ensureAppTopic({ db: openDb(':memory:'), env: { APP_NTFY_TOPIC: 'mine' } }), 'mine')
})

test('capCheck adds this item to the active items and blocks over the cap', () => {
  const db = openDb(':memory:')
  createItem({ db, config: config('daily', '0 8 * * *'), now: NOW })
  createItem({ db, config: config('paused', '0 9 * * *'), status: 'paused', now: NOW })
  const usage = usageSummary({ db, now: NOW, env: {} })
  assert.deepEqual(usage.items.map(({ id, runs }) => [id, runs]), [['daily', 30]])
  const twice = config('new', '0 7,19 * * *')
  assert.equal(capCheck({ db, config: twice, now: NOW, env: {} }).ok, true)
  const blocked = capCheck({ db, config: twice, now: NOW, env: { AI_MONTHLY_CAP: '80' } })
  assert.deepEqual([blocked.ok, blocked.runs, blocked.total, blocked.cap], [false, 60, 90, 80])
  assert.match(blocked.message, /over the monthly cap of 80/)
})

test('perRunAverages uses recent research runs and falls back when there are none', () => {
  const db = openDb(':memory:')
  assert.equal(perRunAverages(db).costUsd, FALLBACK_COST_USD)
  for (const [cost, minutes] of [[1.2, 8], [1.6, 10]]) {
    const runId = startRun({ db, itemId: 'w', trigger: 'tick', startedAt: NOW.toISOString() })
    finishRun({
      db, runId, status: 'ok', costUsd: cost,
      finishedAt: new Date(NOW.getTime() + minutes * 60_000).toISOString()
    })
  }
  assert.deepEqual(perRunAverages(db), { costUsd: 1.4, minutes: 9, sampleSize: 2 })
})

test('monthUsage counts this month in Sydney time and projects the rest from schedules', () => {
  const db = openDb(':memory:')
  createItem({ db, config: config('daily', '0 8 * * *'), now: NOW })
  for (const at of ['2026-10-31T12:00:00Z', '2026-10-31T14:00:00Z', '2026-11-05T00:00:00Z']) {
    startRun({ db, itemId: 'daily', trigger: 'tick', startedAt: at })
  }
  const usage = monthUsage({ db, now: NOW, env: {} })
  assert.equal(usage.month, '2026-11')
  assert.equal(usage.used, 2)
  assert.equal(usage.scheduled, 22)
  assert.equal(usage.projected, 24)
  assert.equal(usage.reached, false)
  assert.equal(usage.resetsAt, '2026-11-30T13:00:00.000Z')
})
