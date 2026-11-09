import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { createApp } from '../src/server.js'
import { appTestOutcome } from '../web/src/appTopicTest.js'

const AUTH_ENV = { APP_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(40) }
const PATH = '/api/settings/app-topic/test'
const NOW = new Date('2026-11-09T01:02:03.000Z')

const withServer = async ({ env = {}, sendApp }, fn) => {
  const db = openDb(':memory:')
  const app = createApp({
    db, getItems: () => [], env, sendApp, now: () => NOW, distDir: '/nonexistent'
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, db })
  } finally {
    server.close()
  }
}

const post = ({ base, headers = {} }) => fetch(`${base}${PATH}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: '{}'
})

test('app topic test sends one priority 3 notice and reports delivery', async () => {
  const calls = []
  const sendApp = async (call) => (calls.push(call), { delivered: true })
  await withServer({ sendApp }, async ({ base, db }) => {
    const body = await (await post({ base })).json()
    assert.deepEqual(body, { delivered: true, sentAt: NOW.toISOString() })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].title, 'Price Tracker test')
    assert.equal(calls[0].priority, 3)
    assert.match(calls[0].click, /#\/settings$/)
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'appTopic'").get()
    assert.ok(stored)
    assert.match(calls[0].topic, /^pt-app-/)
  })
})

test('app topic test reports a failed delivery with its error', async () => {
  const sendApp = async () => ({ delivered: false, error: 'HTTP 503' })
  await withServer({ sendApp }, async ({ base }) => {
    const body = await (await post({ base })).json()
    assert.deepEqual(body, { delivered: false, sentAt: NOW.toISOString(), error: 'HTTP 503' })
  })
})

test('app topic test sends the ntfy token to the trusted server', async () => {
  const calls = []
  const sendApp = async (call) => (calls.push(call), { delivered: true })
  const env = { NTFY_ACCESS_TOKEN: 'tk_secret' }
  await withServer({ env, sendApp }, async ({ base }) => {
    await post({ base })
    assert.equal(calls[0].server, 'https://ntfy.sh')
    assert.equal(calls[0].token, 'tk_secret')
  })
})

test('app topic test needs a session', async () => {
  const sendApp = async () => ({ delivered: true })
  await withServer({ env: AUTH_ENV, sendApp }, async ({ base }) => {
    assert.equal((await post({ base })).status, 401)
  })
})

test('app topic test rejects a foreign Origin', async () => {
  const calls = []
  const sendApp = async (call) => (calls.push(call), { delivered: true })
  await withServer({ sendApp }, async ({ base }) => {
    const response = await post({ base, headers: { origin: 'https://evil.example' } })
    assert.equal(response.status, 403)
    assert.equal(calls.length, 0)
  })
})

test('appTestOutcome words each state', () => {
  const sentAt = NOW.toISOString()
  assert.equal(appTestOutcome({ delivered: true, sentAt }).tone, 'good')
  assert.match(
    appTestOutcome({ delivered: true, sentAt }).text,
    /^Test notice sent to the app topic at /
  )
  const failed = appTestOutcome({ delivered: false, sentAt, error: 'HTTP 503' })
  assert.deepEqual(failed, {
    tone: 'bad', text: 'Test notice to the app topic was not delivered: HTTP 503'
  })
  assert.equal(
    appTestOutcome({ delivered: false, sentAt }).text,
    'Test notice to the app topic was not delivered.'
  )
})
