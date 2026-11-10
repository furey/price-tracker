import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseSweepReply, sweepItem, sweepPrompt } from '../src/sweep.js'

const ITEM = {
  id: 'drill',
  name: 'DeWalt drill',
  product: 'A DeWalt DCD791 drill',
  categories: [{ id: 'kit', description: 'Drill with batteries' }]
}
const BLOCK = {
  at: '2027-02-09T00:00:00Z', mode: 'research', status: 'blocked', note: 'HTTP 503',
  url: 'https://www.homedepot.com/p/1'
}

const row = ({ name, kind = 'site', state = null, recent }) => ({ kind, name, state, recent })

test('a sweep lists site and free-check rows whose latest automatic check was blocked', () => {
  const rows = [
    row({ name: 'Home Depot', recent: [BLOCK] }),
    row({ name: 'Lowes', kind: 'direct', recent: [{ ...BLOCK, note: 'CAPTCHA', url: null }] }),
    row({ name: 'Amazon', recent: [{ ...BLOCK, status: 'ok' }, BLOCK] }),
    row({ name: 'Walmart', recent: [{ ...BLOCK, mode: 'manual', status: 'ok' }, BLOCK] }),
    row({ name: 'Target', state: 'muted', recent: [BLOCK] }),
    row({ name: 'Best Buy', state: 'off', recent: [BLOCK] }),
    row({ name: 'Kogan', kind: 'other', recent: [BLOCK] }),
    row({ name: 'Acme', recent: [] })
  ]
  assert.deepEqual(sweepItem({ item: ITEM, rows }), {
    itemId: 'drill',
    itemName: 'DeWalt drill',
    product: 'A DeWalt DCD791 drill',
    categories: [{ id: 'kit', description: 'Drill with batteries' }],
    delivery: null,
    sources: [
      { kind: 'site', name: 'Home Depot', at: BLOCK.at, note: 'HTTP 503', url: BLOCK.url,
        botCheck: false },
      { kind: 'direct', name: 'Lowes', at: BLOCK.at, note: 'CAPTCHA', url: null, botCheck: true }
    ]
  })
})

test('an item with nothing blocked has no sweep entry', () => {
  assert.equal(sweepItem({ item: ITEM, rows: [row({ name: 'Amazon', recent: [] })] }), null)
})

test('the sweep prompt names each page, the categories, the rules, and the reply shape', () => {
  const item = sweepItem({ item: ITEM, rows: [
    row({ name: 'Home Depot', recent: [BLOCK] }),
    row({ name: 'Lowes', recent: [{ ...BLOCK, url: null }] })
  ] })
  const prompt = sweepPrompt({ items: [item] })
  assert.match(prompt, /Item: DeWalt drill \(id drill\)/)
  assert.match(prompt, /- kit: Drill with batteries/)
  assert.match(prompt, /- Home Depot: https:\/\/www\.homedepot\.com\/p\/1/)
  assert.match(prompt, /- Lowes: no page known; search the site for the item/)
  assert.match(prompt, /stop and ask me to solve it/)
  assert.match(prompt, /Never try to get past a block/)
  assert.match(prompt, /Close newsletter, cookie, and other pop-ups/)
  assert.match(prompt, /Never sign me up/)
  assert.equal(/^- {2,}/m.test(prompt), false)
  assert.match(prompt, /every sign-up\ndiscount you saw/)
  assert.match(prompt, /end your reply with one ```json block per item/)
  assert.match(prompt, /"itemId": "<item id>"/)
  assert.doesNotMatch(prompt, /fetch\(|dashboard/)
})

test('the JSON shape in the prompt passes the observation validator once filled in', async () => {
  const { validateResearch } = await import('../src/validate.js')
  const prompt = sweepPrompt({ items: [] })
  const json = prompt.slice(prompt.indexOf('{\n'), prompt.lastIndexOf('\n}') + 2)
  const filled = JSON.parse(json.replaceAll('<category id>', 'kit')
    .replaceAll('<product page address>', 'https://www.homedepot.com/p/1')
    .replace('<ISO date and time of the check>', '2027-02-09T00:00:00Z')
    .replaceAll('"price": 0', '"price": 199')
    .replaceAll('"effectivePrice": 0', '"effectivePrice": 199'))
  const { itemId, ...data } = filled
  assert.equal(itemId, '<item id>')
  const result = validateResearch({ data, categoryIds: ['kit'] })
  assert.deepEqual(result.errors, [])
})

test('the sweep prompt gives the delivery place and says how to answer location prompts', () => {
  const rows = [row({ name: 'Home Depot', recent: [BLOCK] })]
  const delivery = { suburb: 'Springfield', postcode: '12345' }
  const labels = { postcode: 'ZIP code', locality: 'city' }
  const item = sweepItem({ item: ITEM, rows, delivery })
  const prompt = sweepPrompt({ items: [item], labels })
  assert.match(prompt, /My city and ZIP code: Springfield 12345/)
  assert.match(prompt, /A store or ZIP code prompt is not a block/)
  assert.match(prompt, /pick the one nearest that ZIP code/)
  assert.match(prompt, /inStock, and verified must be true or false, never null/)
  assert.match(prompt, /block it and enter the city and ZIP code instead/)
  const bare = sweepItem({ item: ITEM, rows, delivery: { suburb: null, postcode: '2221' } })
  assert.match(sweepPrompt({ items: [bare] }), /My postcode: 2221/)
})

test('a pasted reply gives one result per json block and names each bad block', () => {
  const reply = [
    'I checked the pages. Mitre 10 asked for a store.',
    '```json',
    '{ "itemId": "drill", "checkedAt": "2027-02-09T00:00:00Z", "sources": [], "listings": [] }',
    '```',
    'Next item:',
    '```',
    '{ "itemId": "saw", "sources": [] }',
    '```',
    '```json',
    '{ "sources": [] }',
    '```',
    '```json',
    '{ not json',
    '```'
  ].join('\n')
  assert.deepEqual(parseSweepReply(reply), {
    results: [
      { itemId: 'drill', data: { checkedAt: '2027-02-09T00:00:00Z', sources: [], listings: [] } },
      { itemId: 'saw', data: { sources: [] } }
    ],
    problems: ['Block 3 has no "itemId".', 'Block 4 is not valid JSON.']
  })
  assert.deepEqual(parseSweepReply('no blocks here'), {
    results: [], problems: ['No ```json block found.']
  })
})
