import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deliver, notifyMac, sendNtfy } from '../src/notify.js'

const fakeResponse = ({ status, retryAfter }) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) }
})

const scriptedFetch = (statuses) => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) })
    const next = statuses[Math.min(calls.length - 1, statuses.length - 1)]
    if (next instanceof Error) throw next
    return fakeResponse(typeof next === 'number' ? { status: next } : next)
  }
  return { fetchImpl, calls }
}

const recordingSleep = () => {
  const delays = []
  return { sleep: async (ms) => { delays.push(ms) }, delays }
}

const baseArgs = {
  server: 'https://ntfy.sh/',
  topic: 'demo',
  title: 'Kärcher — deal',
  message: 'Price: $900 – great',
  priority: 4,
  click: 'https://example.com.au/p',
  log: () => {}
}

test('delivers on the first try with a JSON body at the server root', async () => {
  const { fetchImpl, calls } = scriptedFetch([200])
  const { sleep, delays } = recordingSleep()
  const result = await sendNtfy({ ...baseArgs, token: 'tok', fetchImpl, sleep })
  assert.deepEqual(result, { delivered: true, attempts: 1, status: 200, error: null })
  assert.equal(calls[0].url, 'https://ntfy.sh')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers.Authorization, 'Bearer tok')
  assert.equal(calls[0].body.topic, 'demo')
  assert.equal(calls[0].body.priority, 4)
  assert.equal(calls[0].body.click, 'https://example.com.au/p')
  assert.deepEqual(delays, [])
})

test('sanitises the title and message in the body', async () => {
  const { fetchImpl, calls } = scriptedFetch([200])
  await sendNtfy({ ...baseArgs, fetchImpl, sleep: recordingSleep().sleep })
  assert.equal(calls[0].body.title, 'Kärcher - deal')
  assert.equal(calls[0].body.message, 'Price: $900 - great')
  assert.equal(calls[0].options.headers.Authorization, undefined)
})

test('retries after a 500 then succeeds', async () => {
  const { fetchImpl, calls } = scriptedFetch([500, 200])
  const { sleep, delays } = recordingSleep()
  const result = await sendNtfy({ ...baseArgs, fetchImpl, sleep })
  assert.equal(result.delivered, true)
  assert.equal(result.attempts, 2)
  assert.equal(calls.length, 2)
  assert.deepEqual(delays, [2000])
})

test('honours Retry-After on a 429 and caps it at 60 seconds', async () => {
  const { fetchImpl } = scriptedFetch([
    { status: 429, retryAfter: '5' },
    { status: 429, retryAfter: '600' },
    200
  ])
  const { sleep, delays } = recordingSleep()
  const result = await sendNtfy({ ...baseArgs, fetchImpl, sleep })
  assert.equal(result.delivered, true)
  assert.deepEqual(delays, [5000, 60000])
})

test('gives up after one try and three retries with backoff delays', async () => {
  const { fetchImpl, calls } = scriptedFetch([500, new Error('network down'), 503, 502])
  const { sleep, delays } = recordingSleep()
  const result = await sendNtfy({ ...baseArgs, fetchImpl, sleep })
  assert.equal(result.delivered, false)
  assert.equal(result.attempts, 4)
  assert.equal(result.status, 502)
  assert.equal(calls.length, 4)
  assert.deepEqual(delays, [2000, 8000, 30000])
})

test('notifyMac builds an escaped osascript call and never throws', () => {
  const calls = []
  notifyMac({
    title: 'Say "hi"',
    message: 'back\\slash "quoted"\nline',
    execImpl: (...args) => calls.push(args)
  })
  assert.equal(calls[0][0], 'osascript')
  assert.deepEqual(calls[0][1][0], '-e')
  assert.equal(
    calls[0][1][1],
    'display notification "back\\\\slash \\"quoted\\" line" with title "Say \\"hi\\""'
  )
  assert.doesNotThrow(() =>
    notifyMac({ title: 't', message: 'm', execImpl: () => { throw new Error('boom') } })
  )
})

test('deliver returns the result and skips the Mac fallback on success', async () => {
  const { fetchImpl } = scriptedFetch([200])
  const macCalls = []
  const result = await deliver({
    item: { name: 'Demo', ntfy: { server: 'https://ntfy.sh', topic: 'demo' } },
    alert: { title: 'Demo deal found', message: 'm', priority: 4 },
    fetchImpl,
    sleep: recordingSleep().sleep,
    log: () => {},
    execImpl: (...args) => macCalls.push(args)
  })
  assert.equal(result.delivered, true)
  assert.equal(macCalls.length, 0)
})

test('deliver falls back to a Mac notification when every attempt fails', async () => {
  const { fetchImpl } = scriptedFetch([500])
  const macCalls = []
  const result = await deliver({
    item: { name: 'Demo', ntfy: { server: 'https://ntfy.sh', topic: 'demo' } },
    alert: { title: 'Demo deal found', message: 'm', priority: 4 },
    fetchImpl,
    sleep: recordingSleep().sleep,
    log: () => {},
    execImpl: (...args) => macCalls.push(args)
  })
  assert.equal(result.delivered, false)
  assert.equal(result.attempts, 4)
  assert.equal(macCalls.length, 1)
  assert.match(macCalls[0][1][1], /Demo deal found/)
})

test('notifyMac does nothing off macOS', () => {
  const calls = []
  notifyMac({
    title: 't', message: 'm', platform: 'linux', execImpl: (...args) => calls.push(args)
  })
  assert.equal(calls.length, 0)
})

test('notifyMac calls osascript on macOS', () => {
  const calls = []
  notifyMac({
    title: 't', message: 'm', platform: 'darwin', execImpl: (...args) => calls.push(args)
  })
  assert.equal(calls[0][0], 'osascript')
})
