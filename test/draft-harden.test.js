import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseDraftBody,
  DraftReplyError, LIMITS, assembleConfig, cleanLine, cleanText, generateTopic, isPrivateAddress,
  parseResearchReply, parseScopeReply, protectConfig, publicUrl, uniqueSlug
} from '../src/draft-harden.js'
import { validateItem } from '../src/item-validate.js'

const researchData = (overrides = {}) => ({
  outcome: 'draft',
  id: 'evil-id',
  topic: 'attacker-topic',
  ntfy: { server: 'https://evil.example.com', topic: 'stolen' },
  research: { model: 'expensive', maxTurns: 500 },
  name: 'Dyson V15 Detect',
  product: 'A Dyson V15 Detect cordless vacuum.',
  rejects: ['Dyson V12', 'Dyson V15 refurbished'],
  categories: [
    { id: 'V15 Detect Absolute', label: 'V15 Detect Absolute', description: 'The Absolute kit.' },
    { id: 'v15-detect', label: 'V15 Detect', description: 'The base kit.' }
  ],
  rules: {
    'V15 Detect Absolute': { maxPrice: 899, rrp: 1399, minPctBelowRrp: 30 },
    'v15-detect': { maxPrice: 99999, rrp: 1199, minPctBelowRrp: 150 }
  },
  reasoning: {
    'V15 Detect Absolute': {
      rrp: 1399, lowestNow: 949, lowest12Months: 849, why: 'Dropped to $849 in 2025.',
      evidence: ['https://www.ozbargain.com.au/node/1', 'http://192.168.1.1/x', 'file:///etc']
    }
  },
  sites: [
    { name: 'JB Hi-Fi', url: 'https://www.jbhifi.com.au/' },
    { name: 'Router', url: 'http://10.0.0.1/admin' },
    { name: 'JB Hi-Fi' }
  ],
  searches: ['Dyson V15 Detect', 'Dyson V15 Detect'],
  seasonalSearches: [
    { phrase: 'Dyson Black Friday', from: '2026-11-20', until: '2026-12-02' },
    { phrase: 'bad dates', from: '2026-12-02', until: '2026-11-20' }
  ],
  directCandidates: [
    { retailer: 'Dyson AU', url: 'https://www.dyson.com.au/products/v15', category: 'v15-detect' },
    { retailer: 'LAN', url: 'http://127.0.0.1/products/v15', category: 'v15-detect' },
    { retailer: 'Port', url: 'https://shop.example.com.au:8443/p', category: 'v15-detect' },
    { retailer: 'Unknown', url: 'https://shop.com.au/p', category: 'not-a-category' }
  ],
  snapshot: {
    checkedAt: '2026-11-08T10:00:00+11:00',
    sources: [{ name: 'JB Hi-Fi', status: 'ok', note: '' }],
    listings: [{
      retailer: 'JB Hi-Fi', title: 'Dyson V15 Detect Absolute', category: 'V15 Detect Absolute',
      rejectReason: null, price: 949, wasPrice: 1399, effectivePrice: 949,
      deliveryCost: 0, isClearance: false, inStock: true, verified: true,
      url: 'https://www.jbhifi.com.au/products/dyson-v15', evidence: 'page', notes: ''
    }]
  },
  ...overrides
})

test('publicUrl keeps public http(s) URLs and drops private, IP, port, and credential URLs', () => {
  assert.equal(publicUrl('https://www.jbhifi.com.au/x'), 'https://www.jbhifi.com.au/x')
  for (const url of [
    'http://192.168.1.1/', 'http://10.0.0.1/', 'https://127.0.0.1/', 'http://[::1]/',
    'http://localhost:4280/', 'http://nas.local/', 'https://shop.com.au:8443/',
    'https://user:pass@shop.com.au/', 'ftp://shop.com.au/', 'javascript:alert(1)',
    'http://0x7f000001/', 'http://2130706433/', 'http://intranet/', 'https://printer.lan/'
  ]) {
    assert.equal(publicUrl(url), null, url)
  }
  assert.equal(publicUrl(`https://shop.com.au/${'a'.repeat(LIMITS.url)}`), null)
})

test('isPrivateAddress spots private, loopback, link-local, and mapped addresses', () => {
  for (const address of ['10.1.2.3', '172.20.0.1', '192.168.0.9', '127.0.0.1', '169.254.1.1',
    '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1',
    '::ffff:c0a8:5601']) {
    assert.equal(isPrivateAddress(address), true, address)
  }
  for (const address of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(address), false, address)
  }
})

test('cleanLine and cleanText strip control characters and cap the length', () => {
  assert.equal(cleanLine('a\u0000b‮c\nd', 20), 'a b c d')
  assert.equal(cleanLine('x'.repeat(50), 10), 'xxxxxxx...')
  assert.equal(cleanText('line one\r\nline\u0007 two', 100), 'line one\nline two')
  assert.equal(cleanLine({ toString: () => 'x' }, 10), null)
})

test('parseScopeReply assigns its own ids and caps questions and choices', () => {
  const reply = parseScopeReply({
    data: {
      outcome: 'questions',
      title: 'T'.repeat(200),
      questions: Array.from({ length: 6 }, (_, index) => ({
        id: `evil-${index}`,
        text: `Question ${index}?`,
        multi: index === 0,
        choices: Array.from({ length: 7 }, (__, at) => ({ id: 'x', label: `Choice ${at}` }))
      }))
    }
  })
  assert.equal(reply.title.length, LIMITS.title)
  assert.equal(reply.questions.length, 4)
  assert.deepEqual(reply.questions.map(({ id }) => id), ['q1', 'q2', 'q3', 'q4'])
  assert.deepEqual(reply.questions[0].choices.map(({ id }) => id), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(reply.questions[0].multi, true)
})

test('parseScopeReply accepts duplicate only for an existing item id', () => {
  const data = { outcome: 'duplicate', duplicateOf: 'karcher-k7', reason: 'Already tracked' }
  assert.equal(parseScopeReply({ data, existingIds: ['karcher-k7'] }).duplicateOf, 'karcher-k7')
  assert.throws(() => parseScopeReply({ data, existingIds: ['other'] }), DraftReplyError)
  assert.throws(() => parseScopeReply({ data: { outcome: 'maybe' } }), DraftReplyError)
  assert.throws(() => parseScopeReply({ data: { outcome: 'out_of_scope' } }), DraftReplyError)
})

test('parseResearchReply rejects questions once the rounds are used up', () => {
  const data = { outcome: 'questions', questions: [{ text: 'Q?', choices: [{ label: 'a' },
    { label: 'b' }] }] }
  assert.equal(parseResearchReply({ data, questionsAllowed: true }).outcome, 'questions')
  assert.throws(() => parseResearchReply({ data, questionsAllowed: false }), DraftReplyError)
})

test('parseResearchReply hardens categories, rules, URLs, lists, and the snapshot', () => {
  const draft = parseResearchReply({ data: researchData(), questionsAllowed: false })
  assert.deepEqual(draft.categories.map(({ id }) => id), ['v15-detect-absolute', 'v15-detect'])
  assert.equal(draft.rules['v15-detect-absolute'].maxPrice, 899)
  assert.equal(draft.rules['v15-detect'].minPctBelowRrp, null)
  assert.deepEqual(draft.reasoning['v15-detect-absolute'].evidence,
    ['https://www.ozbargain.com.au/node/1'])
  assert.deepEqual(draft.sites, [{ name: 'JB Hi-Fi', url: 'https://www.jbhifi.com.au/' },
    { name: 'Router' }])
  assert.deepEqual(draft.searches, ['Dyson V15 Detect'])
  assert.equal(draft.seasonalSearches.length, 1)
  assert.deepEqual(draft.directCandidates.map(({ retailer }) => retailer), ['Dyson AU'])
  assert.equal(draft.snapshot.listings[0].category, 'v15-detect-absolute')
})

test('parseResearchReply caps array sizes and string lengths', () => {
  const draft = parseResearchReply({
    questionsAllowed: false,
    data: researchData({
      product: 'p'.repeat(5000),
      categories: Array.from({ length: 20 }, (_, index) =>
        ({ id: `c${index}`, label: `C${index}`, description: 'd'.repeat(900) })),
      sites: Array.from({ length: 60 }, (_, index) => ({ name: `Site ${index}` })),
      searches: Array.from({ length: 30 }, (_, index) => `search ${index}`)
    })
  })
  assert.equal(draft.product.length, LIMITS.product)
  assert.equal(draft.categories.length, LIMITS.categories)
  assert.equal(draft.categories[0].description.length, LIMITS.description)
  assert.equal(draft.sites.length, LIMITS.sites)
  assert.equal(draft.searches.length, LIMITS.searches)
})

test('assembleConfig never takes id, topic, ntfy, model, or turn limits from the AI', () => {
  const draft = parseResearchReply({ data: researchData(), questionsAllowed: false })
  const config = assembleConfig({
    draft,
    id: 'dyson-v15-detect',
    topic: 'dyson-v15-detect-0123456789abcdef0123456789abcdef',
    ntfy: { server: 'https://ntfy.sh', tokenEnv: 'NTFY_ACCESS_TOKEN' },
    schedules: [{ cron: '10 7 * * *', tz: 'Australia/Sydney' }],
    directSchedules: [{ cron: '30 7,19 * * *', tz: 'Australia/Sydney' }],
    direct: [],
    input: { budget: 900, budgetMode: 'limit' }
  })
  assert.equal(config.id, 'dyson-v15-detect')
  assert.equal(config.ntfy.server, 'https://ntfy.sh')
  assert.equal(config.ntfy.topic, 'dyson-v15-detect-0123456789abcdef0123456789abcdef')
  assert.deepEqual(config.research, { maxTurns: 80, timeoutMinutes: 15 })
  assert.equal(config.rules['v15-detect'].maxPrice, 900)
  assert.match(config.product, /Reject: Dyson V12; Dyson V15 refurbished\.$/)
  assert.equal(config.direct, undefined)
  assert.deepEqual(validateItem(config), [])
})

test('protectConfig restores the server-owned fields and drops unknown keys', () => {
  const trusted = {
    id: 'a', ntfy: { server: 'https://ntfy.sh', topic: 'a-topic' }, research: { maxTurns: 80 }
  }
  const result = protectConfig({
    trusted,
    config: { id: 'b', name: 'B', ntfy: { topic: 'evil' }, research: { model: 'x' }, extra: 1 }
  })
  assert.deepEqual(result, { id: 'a', name: 'B', ntfy: trusted.ntfy, research: trusted.research })
})

test('variant filters from the AI that could backtrack badly are dropped', () => {
  const draft = parseResearchReply({
    questionsAllowed: false,
    data: researchData({
      directCandidates: [
        { retailer: 'A', url: 'https://a.com.au/products/x', category: 'v15-detect',
          variantFilter: '(a+)+$' },
        { retailer: 'B', url: 'https://b.com.au/products/x', category: 'v15-detect',
          variantFilter: 'absolute' },
        { retailer: 'C', url: 'https://c.com.au/products/x', category: 'v15-detect',
          variantFilter: '(a|a?)+$' },
        { retailer: 'D', url: 'https://d.com.au/products/x', category: 'v15-detect',
          variantFilter: '(.|.?)+QQQ' }
      ]
    })
  })
  assert.equal(draft.directCandidates[0].variantFilter, undefined)
  assert.equal(draft.directCandidates[1].variantFilter, 'absolute')
  assert.equal(draft.directCandidates[2].variantFilter, undefined)
  assert.equal(draft.directCandidates[3].variantFilter, undefined)
})

test('uniqueSlug and generateTopic make safe unique names', () => {
  assert.equal(uniqueSlug({ text: 'Kärcher K7!', taken: new Set() }), 'karcher-k7')
  assert.equal(uniqueSlug({ text: 'Bike', taken: new Set(['bike', 'bike-2']) }), 'bike-3')
  assert.match(generateTopic("Sam's bike"), /^pt-sam-s-bike-[0-9a-f]{32}$/)
  assert.ok(generateTopic('x'.repeat(100)).length <= 64)
})

test('parseDraftBody keeps eBay and drops Gumtree and Facebook Marketplace sites', () => {
  const draft = parseDraftBody({
    name: 'Vacuum',
    product: 'A cordless vacuum',
    categories: [{ id: 'main', description: 'The vacuum' }],
    sites: [
      { name: 'eBay AU', url: 'https://www.ebay.com.au/' },
      { name: 'Gumtree' },
      { name: 'Facebook Marketplace' },
      { name: 'JB Hi-Fi', url: 'https://www.jbhifi.com.au/' }
    ]
  })
  assert.deepEqual(draft.sites.map((site) => site.name), ['eBay AU', 'JB Hi-Fi'])
})
