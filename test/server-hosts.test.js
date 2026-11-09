import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { createApp, parseAllowedHosts } from '../src/server.js'

const withServer = async (env, fn) => {
  const app = createApp({
    db: openDb(':memory:'), getItems: () => [], env, distDir: '/nonexistent'
  })
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
  })
  try {
    await fn(server.address().port)
  } finally {
    server.close()
  }
}

const post = ({ port, host, origin }) => new Promise((resolve, reject) => {
  const headers = { 'content-type': 'application/json', host }
  if (origin) headers.origin = origin
  const options = { host: '127.0.0.1', port, path: '/api/logout', method: 'POST', headers }
  const req = request(options, (res) => {
    res.resume()
    res.on('end', () => resolve(res.statusCode))
  })
  req.on('error', reject)
  req.end('{}')
})

test('parseAllowedHosts splits, trims, and lowercases', () => {
  assert.deepEqual(
    [...parseAllowedHosts(' Nas.Local , nas.local:4280,,')],
    ['nas.local', 'nas.local:4280']
  )
  assert.equal(parseAllowedHosts(undefined).size, 0)
})

test('unlisted hosts are refused for writes', async () => {
  await withServer({}, async (port) => {
    assert.equal(await post({ port, host: 'nas.local:4280' }), 403)
    assert.equal(await post({ port, host: `localhost:${port}` }), 200)
  })
})

test('ALLOWED_HOSTS admits listed Host headers and matching Origins', async () => {
  const env = { ALLOWED_HOSTS: 'nas.local:4280,nas.local:4280' }
  await withServer(env, async (port) => {
    assert.equal(await post({ port, host: 'nas.local:4280' }), 200)
    assert.equal(await post({ port, host: 'nas.local:4280', origin: 'http://nas.local:4280' }), 200)
    assert.equal(await post({ port, host: 'other:4280' }), 403)
  })
})

test('ALLOWED_HOSTS rejects foreign and mismatched Origins', async () => {
  const env = { ALLOWED_HOSTS: 'nas.local:4280,evil:4280' }
  await withServer(env, async (port) => {
    const evil = 'http://evil.example'
    assert.equal(await post({ port, host: 'nas.local:4280', origin: evil }), 403)
    assert.equal(await post({ port, host: 'nas.local:4280', origin: 'http://evil:4280' }), 403)
  })
})
