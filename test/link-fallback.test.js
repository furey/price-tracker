import assert from 'node:assert/strict'
import { test } from 'node:test'
import { retailerHomeUrl } from '../src/retailers.js'
import { siteStats } from '../src/site-stats.js'

const NOW = new Date('2027-02-10T00:00:00.000Z')
const AT = '2027-02-09T00:00:00.000Z'
const EXACT = 'https://www.harveynorman.com.au/springfree-oval'
const CONFIGURED = 'https://www.binglee.com.au/search?q=springfree'
const DIRECT = 'https://www.myer.com.au/p/springfree'

const item = {
  id: 'tramp',
  name: 'Springfree',
  categories: [{ id: 'base', name: 'Base' }],
  sources: {
    sites: [
      { name: 'Harvey Norman', url: 'https://www.harveynorman.com.au/' },
      { name: 'Bing Lee', url: CONFIGURED },
      { name: 'Temple & Webster' }
    ]
  },
  direct: [{ retailer: 'Myer', url: DIRECT, category: 'base', parser: 'jsonld' }]
}

const run = ({ id, mode = 'research', sources }) => ({
  id, mode, startedAt: AT, itemVersion: 1, research: { sources, listings: [] }
})
const blocked = (name, url) => ({ name, status: 'blocked', note: 'CAPTCHA page', url })

const rowsFor = (runs) => siteStats({ item, runs, now: NOW, days: 30 })
const rowNamed = ({ rows, name }) => rows.find((row) => row.name === name)

test('an exact research url beats the configured site url', () => {
  const rows = rowsFor([run({ id: 1, sources: [blocked('Bing Lee', EXACT)] })])
  const row = rowNamed({ rows, name: 'Bing Lee' })
  assert.deepEqual([row.url, row.urlKind], [EXACT, 'page'])
  assert.deepEqual([row.recent[0].url, row.recent[0].urlKind], [EXACT, 'page'])
})

test('a direct entry links to its own url', () => {
  const rows = rowsFor([run({ id: 1, mode: 'direct', sources: [blocked('Myer direct', null)] })])
  const row = rowNamed({ rows, name: 'Myer' })
  assert.deepEqual([row.url, row.urlKind], [DIRECT, 'page'])
})

test('a run without a url falls back to the configured site url', () => {
  const rows = rowsFor([run({ id: 1, sources: [blocked('Bing Lee', null)] })])
  const row = rowNamed({ rows, name: 'Bing Lee' })
  assert.deepEqual([row.url, row.urlKind], [CONFIGURED, 'page'])
  assert.equal(row.recent[0].urlKind, 'page')
})

test('a retailer with no recorded page falls back to its home page', () => {
  const rows = rowsFor([
    run({ id: 1, sources: [blocked('Temple & Webster', null), blocked('Kogan', null)] })
  ])
  const kogan = rowNamed({ rows, name: 'Kogan' })
  assert.deepEqual([kogan.url, kogan.urlKind], ['https://kogan.com/', 'home'])
  assert.deepEqual([kogan.recent[0].url, kogan.recent[0].urlKind], ['https://kogan.com/', 'home'])
})

test('unknown retailer names get no link', () => {
  const rows = rowsFor([run({ id: 1, sources: [blocked('Nowhere Emporium', null)] })])
  const row = rowNamed({ rows, name: 'Nowhere Emporium' })
  assert.deepEqual([row.url, row.urlKind], [null, null])
  assert.deepEqual([row.recent[0].url, row.recent[0].urlKind], [null, null])
})

test('retailerHomeUrl matches names the way listing trust does', () => {
  assert.equal(retailerHomeUrl({ name: 'Bing Lee' }), 'https://binglee.com.au/')
  assert.equal(retailerHomeUrl({ name: 'bing lee (sold by X)' }), 'https://binglee.com.au/')
  assert.equal(retailerHomeUrl({ name: 'Nowhere Emporium' }), null)
  assert.equal(retailerHomeUrl({ name: '' }), null)
})
