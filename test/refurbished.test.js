import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateItem } from '../src/item-validate.js'
import { REFURBISHED_CATEGORY, acceptsRefurbished, applyRefurbished } from '../src/refurbished.js'
import { buildPrompt } from '../src/research.js'
import { regionProfile } from '../src/regions/index.js'

const config = () => ({
  id: 'k7',
  name: 'K7',
  product: 'A Karcher K7',
  categories: [{ id: 'smart', description: 'Smart Control' }],
  rules: { smart: { maxPrice: 1100 } },
  schedules: [],
  ntfy: { server: 'https://ntfy.sh', topic: 'topic-1' },
  sources: { sites: [{ name: 'Bunnings' }], searches: ['karcher k7'] }
})

test('turning refurbished on adds the flag, a category, and a cap of 85% of the first', () => {
  const item = config()
  applyRefurbished({ config: item, accepted: true })
  assert.equal(acceptsRefurbished(item), true)
  assert.deepEqual(item.categories.map(({ id }) => id), ['smart', REFURBISHED_CATEGORY])
  assert.deepEqual(item.rules.refurbished, { maxPrice: 940 })
  applyRefurbished({ config: item, accepted: true })
  assert.equal(item.categories.length, 2)
  assert.deepEqual(validateItem(item), [])
})

test('turning refurbished off removes the flag, the category, and its rule', () => {
  const item = config()
  applyRefurbished({ config: item, accepted: true })
  applyRefurbished({ config: item, accepted: false })
  assert.equal(item.accept, undefined)
  assert.deepEqual(item.categories.map(({ id }) => id), ['smart'])
  assert.equal(item.rules.refurbished, undefined)
})

test('the flag needs a refurbished category and must be true or false', () => {
  assert.deepEqual(validateItem({ ...config(), accept: { refurbished: true } }),
    ['accept.refurbished: add a "refurbished" category for refurbished stock'])
  assert.deepEqual(validateItem({ ...config(), accept: { refurbished: 'yes' } }),
    ['accept.refurbished: expected true or false'])
  assert.deepEqual(validateItem({ ...config(), accept: 'all' }), ['accept: expected an object'])
})

test('the prompt allows refurbished stock only for an item that accepts it', () => {
  const now = new Date('2026-11-10T00:00:00Z')
  const plain = buildPrompt({ item: config(), now })
  assert.match(plain, /and any refurbished, used, or open-box item\./)
  assert.doesNotMatch(plain, /accepts refurbished stock/)
  const item = config()
  applyRefurbished({ config: item, accepted: true })
  const prompt = buildPrompt({ item, now })
  const ruleNumber = prompt.match(/^(\d+)\. This item accepts refurbished stock/m)?.[1]
  assert.ok(ruleNumber)
  assert.match(prompt, new RegExp(`any used or open-box item \\(refurbished stock follows rule ${
    ruleNumber}\\)\\.`))
  assert.match(prompt, /Put every such unit in category "refurbished"/)
  const us = buildPrompt({ item, now, region: regionProfile({ id: 'us' }) })
  assert.match(us, /any used, renewed, or open-box item \(refurbished stock follows rule \d+\)/)
})

test('a wizard draft with Refurbished OK gets the flag, the category, and a deadline', async () => {
  const { assembleConfig } = await import('../src/draft-harden.js')
  const config = assembleConfig({
    draft: {
      name: 'K7',
      product: 'A Karcher K7',
      categories: [{ id: 'smart', description: 'Smart Control' }],
      rules: { smart: { maxPrice: 1000 } },
      reasoning: {},
      rejects: [],
      sites: [{ name: 'Bunnings' }],
      searches: ['karcher k7'],
      seasonalSearches: []
    },
    id: 'k7',
    topic: 'pt-k7-0123',
    ntfy: { server: 'https://ntfy.sh' },
    schedules: [],
    directSchedules: [],
    direct: [],
    input: { refurbished: true, needBy: '2026-12-20' }
  })
  assert.equal(config.accept.refurbished, true)
  assert.deepEqual(config.categories.map(({ id }) => id), ['smart', 'refurbished'])
  assert.equal(config.rules.refurbished.maxPrice, 850)
  assert.deepEqual(config.deadline, { needBy: '2026-12-20', deliveryDays: 6, lastChanceDays: 3 })
})
