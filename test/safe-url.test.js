import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import zlib from 'node:zlib'
import { testDirectEntry } from '../src/direct.js'
import { isBlockedAddress, isUnsafeUrlError, publicUrlProblem, safeFetch } from '../src/safe-url.js'

const MIB = 1024 * 1024

test('isBlockedAddress allows public addresses and blocks private and embedded forms', () => {
  for (const address of ['8.8.8.8', '104.16.0.1', '2606:4700::1111', '64:ff9b::808:808',
    '2002:808:808::1', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(address), false, address)
  }
  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.20.0.1',
    '192.0.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fd00::1', 'fc00::1', 'fe80::1', 'fe80::1%en0', 'ff02::1',
    '::ffff:192.168.1.1', '::ffff:c0a8:5601', '::ffff:7f00:1', '64:ff9b::c0a8:5601',
    '::c0a8:5601', '2002:c0a8:5601::1', '2002:7f00:1::', 'not-an-ip'
  ]) {
    assert.equal(isBlockedAddress(address), true, address)
  }
})

test('publicUrlProblem accepts public web addresses', () => {
  for (const url of [
    'https://www.myer.com.au/p/springfree', 'http://shop.com.au/x', 'https://shop.com.au:443/',
    'http://8.8.8.8/', 'http://[2606:4700::1111]/', 'https://SHOP.com.au./'
  ]) {
    assert.equal(publicUrlProblem(url), null, url)
  }
})

test('publicUrlProblem rejects private, odd, and credential URL forms', () => {
  for (const url of [
    'http://192.168.1.1:5000/', 'http://192.168.1.1/', 'http://2130706433/',
    'http://0x7f.1/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/',
    'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:c0a8:5601]/', 'http://0.0.0.0/',
    'http://user:pw@shop.com.au/', 'https://bunnings.com.au@evil.com/', 'http://localhost/',
    'http://localhost:4280/', 'http://shop.localhost/', 'http://nas.local/', 'http://x.internal/',
    'http://router.lan/', 'http://a.home.arpa/', 'http://intranet/', 'https://shop.com.au:8443/',
    'ftp://shop.com.au/', 'javascript:alert(1)', 'not a url', '', null,
    `https://shop.com.au/${'a'.repeat(2000)}`
  ]) {
    assert.ok(publicUrlProblem(url), String(url))
  }
})

test('safeFetch returns a fetch-like response and decodes gzip', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
    res.end(zlib.gzipSync(JSON.stringify({ ok: true, path: req.url })))
  }, async ({ options }) => {
    const response = await safeFetch('http://shop.example.com.au/a?b=1', options)
    assert.equal(response.status, 200)
    assert.equal(response.ok, true)
    assert.equal(response.headers.get('Content-Type'), 'application/json')
    assert.deepEqual(await response.json(), { ok: true, path: '/a?b=1' })
  })
})

test('safeFetch stops a gzip bomb at the decoded byte cap', async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(16 * MIB))
  await withServer((req, res) => {
    res.writeHead(200, { 'content-encoding': 'gzip' })
    res.end(bomb)
  }, async ({ options }) => {
    await assert.rejects(
      safeFetch('http://shop.example.com.au/', { ...options, maxBytes: MIB }),
      /response too large/
    )
    const entry = { retailer: 'Shop', url: 'http://shop.example.com.au/p', parser: 'jsonld' }
    const fetchImpl = (url, init) => safeFetch(url, { ...init, ...options })
    const result = await testDirectEntry({ entry, fetchImpl })
    assert.deepEqual(result, {
      status: 'error', note: 'response too large', url: entry.url, listings: []
    })
  })
})

test('safeFetch rejects a redirect to a private address without contacting it', async () => {
  for (const location of ['http://192.168.1.1/x', 'http://nas.example.com.au/x']) {
    await withServer((req, res) => {
      res.writeHead(302, { location })
      res.end()
    }, async ({ options, requests }) => {
      await assert.rejects(safeFetch('http://shop.example.com.au/', options), isUnsafeUrlError)
      assert.equal(requests.length, 1, location)
    }, { answers: { 'nas.example.com.au': '192.168.1.1' } })
  }
})

test('safeFetch follows a public redirect and reports the final url', async () => {
  await withServer((req, res) => {
    if (req.url === '/old') {
      res.writeHead(301, { location: '/new' })
      return res.end()
    }
    res.end('moved here')
  }, async ({ options, requests }) => {
    const response = await safeFetch('http://shop.example.com.au/old', options)
    assert.equal(await response.text(), 'moved here')
    assert.equal(response.url, 'http://shop.example.com.au/new')
    assert.deepEqual(requests, ['/old', '/new'])
  })
})

test('safeFetch stops after too many redirects', async () => {
  await withServer((req, res) => {
    res.writeHead(302, { location: '/again' })
    res.end()
  }, async ({ options, requests }) => {
    await assert.rejects(
      safeFetch('http://shop.example.com.au/', { ...options, maxRedirects: 2 }),
      /too many redirects/
    )
    assert.equal(requests.length, 3)
  })
})

test('safeFetch checks the address at connect time, so DNS rebinding fails', async () => {
  const sequence = ['127.0.0.1', '192.168.1.1']
  await withServer((req, res) => {
    res.writeHead(302, { location: '/second' })
    res.end()
  }, async ({ options, requests }) => {
    await assert.rejects(
      safeFetch('http://rebind.example.com.au/', options),
      /private network address/
    )
    assert.deepEqual(requests, ['/'])
  }, { answer: () => sequence.shift() })
})

test('safeFetch with the real block list refuses a name that resolves to the LAN', async () => {
  const lookupImpl = (hostname, options, callback) =>
    callback(null, [{ address: '192.168.1.5', family: 4 }])
  await assert.rejects(
    safeFetch('http://shop.example.com.au/', { lookupImpl, timeoutMs: 2000 }),
    isUnsafeUrlError
  )
  await assert.rejects(safeFetch('http://192.168.1.1:5000/'), isUnsafeUrlError)
})

test('safeFetch aborts on timeout', async () => {
  await withServer(() => {}, async ({ options }) => {
    await assert.rejects(
      safeFetch('http://shop.example.com.au/', { ...options, timeoutMs: 100 }),
      (error) => error.name === 'TimeoutError'
    )
  })
})

const withServer = async (handler, fn, { answers = {}, answer } = {}) => {
  const requests = []
  const server = http.createServer((req, res) => {
    requests.push(req.url)
    handler(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const lookupImpl = (hostname, lookupOptions, callback) => {
    const address = answer?.() ?? answers[hostname] ?? '127.0.0.1'
    callback(null, [{ address, family: 4 }])
  }
  const options = {
    timeoutMs: 5000,
    lookupImpl,
    isBlocked: (address) => address !== '127.0.0.1' && isBlockedAddress(address),
    requestImpl: (url, requestOptions, callback) =>
      http.request(url, { ...requestOptions, port }, callback)
  }
  try {
    await fn({ options, requests })
  } finally {
    server.closeAllConnections()
    server.close()
  }
}
