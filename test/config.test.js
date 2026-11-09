import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  DB_PATH,
  PROJECT_ROOT,
  ITEMS_DIR,
  getItem,
  loadItems,
  validateItem
} from '../src/config.js'

const validItem = () => ({
  id: 'demo',
  name: 'Demo',
  product: 'A demo product',
  schedules: [{ cron: '45 7 * * *', tz: 'Australia/Sydney' }],
  ntfy: { server: 'https://ntfy.sh', topic: 'demo-topic' },
  categories: [{ id: 'a', description: 'Category A' }],
  rules: { a: { maxPrice: 100 } },
  sources: { sites: [{ name: 'Shop' }], searches: ['demo'] }
})

const writeItemDir = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'items-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(path.join(dir, name), content)
  return dir
}

test('constants resolve from the project root', () => {
  assert.equal(ITEMS_DIR, path.join(PROJECT_ROOT, 'items'))
  assert.equal(DB_PATH, path.join(PROJECT_ROOT, 'state', 'price-tracker.db'))
})

test('the real item files load and validate', () => {
  const items = loadItems()
  assert.ok(items.length >= 2)
  assert.deepEqual(items.map((item) => item.id), [...items.map((w) => w.id)].sort())
})

test('loadItems sorts by id', () => {
  const dir = writeItemDir({
    'zed.json': JSON.stringify({ ...validItem(), id: 'zed' }),
    'alpha.json': JSON.stringify({ ...validItem(), id: 'alpha' })
  })
  assert.deepEqual(loadItems({ dir }).map((item) => item.id), ['alpha', 'zed'])
})

test('loadItems names the file on invalid JSON', () => {
  const dir = writeItemDir({ 'broken.json': '{ nope' })
  assert.throws(() => loadItems({ dir }), /broken\.json/)
})

test('loadItems names the file on a validation failure', () => {
  const dir = writeItemDir({ 'other.json': JSON.stringify(validItem()) })
  assert.throws(() => loadItems({ dir }), /other\.json[\s\S]*does not match/)
})

test('getItem lists known ids for an unknown id', () => {
  assert.throws(() => getItem('nope'), /Unknown item "nope"\. Known: karcher-k7, springfree/)
  assert.equal(getItem('karcher-k7').id, 'karcher-k7')
})

test('validateItem accepts a valid item', () => {
  assert.deepEqual(validateItem(validItem(), 'demo'), [])
})

test('validateItem reports each problem', () => {
  const item = {
    ...validItem(),
    categories: [],
    rules: { missing: { maxPrice: 1 } },
    schedules: [{ cron: 'not a cron', tz: 'Australia/Sydney' }, { cron: '* * * * *' }],
    ntfy: { server: 'https://ntfy.sh' }
  }
  const errors = validateItem(item)
  assert.ok(errors.some((error) => error.startsWith('categories')))
  assert.ok(errors.some((error) => error.startsWith('rules.missing')))
  assert.ok(errors.some((error) => error.startsWith('schedules[0]')))
  assert.ok(errors.some((error) => error.startsWith('schedules[1]')))
  assert.ok(errors.some((error) => error.startsWith('ntfy.topic')))
})

test('validateItem rejects a bad window date', () => {
  const item = validItem()
  item.schedules[0].until = 'soon'
  assert.ok(validateItem(item).some((error) => error.includes('until')))
})

const withDirect = (overrides = {}) => ({
  ...validItem(),
  direct: [{
    retailer: 'Shop', url: 'https://shop.example/p/1', category: 'a', parser: 'shopify'
  }],
  directSchedules: [{ cron: '30 7,19 * * *', tz: 'Australia/Sydney' }],
  ...overrides
})

test('validateItem accepts direct entries with directSchedules', () => {
  const item = withDirect()
  item.direct[0].variantFilter = 'medium oval'
  assert.deepEqual(validateItem(item), [])
})

test('validateItem accepts an empty direct list without directSchedules', () => {
  assert.deepEqual(validateItem({ ...validItem(), direct: [] }), [])
})

test('validateItem reports each direct problem', () => {
  const item = withDirect({
    direct: [
      { retailer: '', url: 'ftp://x', category: 'zzz', parser: 'regex', variantFilter: '(' },
      'text'
    ],
    directSchedules: [{ cron: 'nope', tz: 'Australia/Sydney' }]
  })
  const errors = validateItem(item)
  for (const prefix of [
    'direct[0].retailer', 'direct[0].url', 'direct[0].category', 'direct[0].parser',
    'direct[0].variantFilter', 'direct[1]', 'directSchedules[0]'
  ]) {
    assert.ok(errors.some((error) => error.startsWith(prefix)), prefix)
  }
})

test('validateItem requires directSchedules when direct has entries; empty means off', () => {
  const { directSchedules, ...item } = withDirect()
  assert.ok(validateItem(item).some((error) => error.startsWith('directSchedules')))
  assert.deepEqual(validateItem({ ...item, directSchedules: [] }), [])
  assert.deepEqual(validateItem({ ...item, directSchedules: [], schedules: [] }), [])
})

test('validateItem checks rule numbers, category ids, sources, and research options', () => {
  const item = {
    ...validItem(),
    categories: [{ id: 'a', description: 'A' }, { id: 'a', description: 'Again' },
      { id: 'Bad Id', description: 'B' }],
    rules: { a: { maxPrice: 0, rrp: 'x', minPctBelowRrp: 120 } },
    sources: {
      sites: [{ name: '', url: 'nope' }],
      searches: [''],
      seasonalSearches: [{ phrase: 'Sale', from: '2026-12-01', until: '2026-11-01' }]
    },
    dedupe: { minDrop: -1 },
    heartbeat: { monthly: 'yes' },
    research: { maxTurns: 0, timeoutMinutes: 500, model: '' },
    ntfy: { server: 'ntfy.sh', topic: 'has space' }
  }
  const errors = validateItem(item)
  for (const prefix of [
    'categories[1].id: duplicate', 'categories[2].id', 'rules.a.maxPrice', 'rules.a.rrp',
    'rules.a.minPctBelowRrp', 'sources.sites[0].name', 'sources.sites[0].url',
    'sources.searches[0]', 'sources.seasonalSearches[0].until', 'dedupe.minDrop',
    'heartbeat.monthly', 'research.maxTurns', 'research.timeoutMinutes', 'research.model',
    'ntfy.server', 'ntfy.topic'
  ]) {
    assert.ok(errors.some((error) => error.startsWith(prefix)), prefix)
  }
})

const kitConfig = () => ({
  ...validItem(),
  categories: [{ id: 'a', description: 'A' }, { id: 'kit', description: 'Kit' }],
  rules: { a: { maxPrice: 100 }, kit: { maxPrice: 300 } },
  kits: [{
    id: 'k',
    name: 'Kit',
    category: 'kit',
    parts: [{ id: 'base', match: 'a' }, { id: 'shade', description: 'Shade' }]
  }],
  directSchedules: [{ cron: '30 7 * * *', tz: 'Australia/Sydney' }],
  direct: [{
    retailer: 'Shop', url: 'https://shop.example/products/shade', part: 'shade',
    parser: 'shopify'
  }]
})

test('an item with kits and an accessory direct entry validates', () => {
  assert.deepEqual(validateItem(kitConfig()), [])
})

test('kit problems are reported with paths', () => {
  const item = kitConfig()
  item.kits[0].category = 'nope'
  item.kits[0].parts.push({ id: 'shade', description: '' }, { id: 'x', match: 'zzz' })
  const errors = validateItem(item)
  assert.ok(errors.includes('kits[0].category: not a category id'))
  assert.ok(errors.some((error) => /parts\[1\]\.id: duplicate/.test(error)))
  assert.ok(errors.some((error) => /parts\[2\]\.description/.test(error)))
  assert.ok(errors.includes('kits[0].parts[3].match: not a category id'))
})

test('a direct entry part must name an accessory kit part', () => {
  const item = kitConfig()
  item.direct[0].part = 'base'
  assert.match(validateItem(item)[0], /direct\[0\]\.part: expected one of shade/)
  delete item.direct[0].part
  assert.match(validateItem(item)[0], /direct\[0\]\.category: not a category id/)
})
