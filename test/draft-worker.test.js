import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import { createDraftWorker } from '../src/draft-worker.js'
import { answerDraft } from '../src/draft-service.js'
import { createDraft, getDraft } from '../src/drafts.js'
import { withLock } from '../src/lock.js'
import { createItem } from '../src/item-store.js'
import { validateItem } from '../src/item-validate.js'
import {
  fenced, publicLookup, researchDraft, scopeQuestions, scriptedClaude, shopifyFetch
} from './fake-claude.js'

const NOW = new Date('2026-11-08T00:00:00Z')
const input = {
  request: 'Dyson V15 Detect cordless vacuum, around $900', budget: 900, budgetMode: 'around',
  quantity: 1, needBy: '2026-12-20', mustHaves: [], links: []
}

const setup = async ({ replies, fetch = shopifyFetch() }) => {
  const db = openDb(':memory:')
  const dir = await mkdtemp(join(tmpdir(), 'draft-worker-'))
  const claude = scriptedClaude(replies)
  const notices = []
  const worker = createDraftWorker({
    db,
    spawnImpl: claude.spawnImpl,
    fetchImpl: fetch.fetchImpl,
    lookupImpl: publicLookup,
    sleep: async () => {},
    pauseMs: 0,
    now: () => NOW,
    claudeLockPath: join(dir, 'claude.lock'),
    cwd: join(dir, 'work'),
    notify: async ({ draft }) => { notices.push(draft.status) },
    log: () => {}
  })
  return { db, worker, claude, notices, dir, fetch }
}

test('scope asks questions, answers start research, and research gives a valid draft', async () => {
  const { db, worker, claude, notices, fetch } = await setup({
    replies: [
      { resultText: fenced(scopeQuestions), sessionId: 'sess-9',
        toolUses: [['WebSearch', { query: 'Dyson V15 Detect price' }]] },
      { resultText: fenced(researchDraft()), sessionId: 'sess-9',
        toolUses: [['WebFetch', { url: 'https://www.dyson.com.au/v15' }]] }
    ]
  })
  const draft = createDraft({ db, input, now: NOW })
  await worker.kick()
  const clarifying = getDraft({ db, id: draft.id })
  assert.equal(clarifying.status, 'clarifying')
  assert.equal(clarifying.sessionId, 'sess-9')
  assert.equal(clarifying.questions[0].questions[0].id, 'q1')
  const searched = 'Searched "Dyson V15 Detect price"'
  assert.ok(clarifying.events.some(({ message }) => message === searched))
  assert.match(claude.calls[0].args.join(' '), /--output-format stream-json --verbose/)
  assert.ok(!claude.calls[0].args.includes('--resume'))
  answerDraft({ db, id: draft.id, now: NOW,
    answers: [{ questionId: 'q1', choiceIds: ['a'], other: 'black please' }] })
  await worker.kick()
  const review = getDraft({ db, id: draft.id })
  assert.equal(review.status, 'review')
  assert.deepEqual(claude.calls[1].args.slice(-2), ['--resume', 'sess-9'])
  assert.match(claude.calls[1].prompt, /V15 Detect Absolute.*black please/s)
  assert.deepEqual(validateItem(review.config), [])
  assert.equal(review.config.id, 'dyson-v15-detect')
  assert.match(review.config.ntfy.topic, /^pt-dyson-v15-detect-[0-9a-f]{32}$/)
  assert.deepEqual(review.config.direct, [{ retailer: 'Vacuum Shop', category: 'v15-absolute',
    parser: 'shopify', url: 'https://vacuumshop.com.au/products/dyson-v15-absolute' }])
  assert.equal(review.config.schedules[0].until, '2026-12-14')
  const blocked = review.research.candidates.find(({ retailer }) => retailer === 'Private')
  assert.deepEqual([blocked.kept, blocked.note],
    [false, 'The site resolves to a private network address'])
  assert.ok(fetch.requests.every((url) => !url.includes('intranet')))
  assert.equal(review.snapshot.listings[0].category, 'v15-absolute')
  assert.equal(review.costUsd, 0.8)
  assert.deepEqual(notices, ['clarifying', 'review'])
})

test('an invalid reply gets one nudge on the same session', async () => {
  const { db, worker, claude } = await setup({
    replies: [
      { resultText: 'I could not decide.', sessionId: 'sess-2' },
      { resultText: fenced({ ...scopeQuestions, outcome: 'out_of_scope',
        reason: 'Flights are not products.' }), sessionId: 'sess-2' }
    ]
  })
  const draft = createDraft({ db, input, now: NOW })
  await worker.kick()
  assert.match(claude.calls[1].prompt, /Your last reply was not valid/)
  assert.deepEqual(claude.calls[1].args.slice(-2), ['--resume', 'sess-2'])
  const stopped = getDraft({ db, id: draft.id })
  assert.deepEqual([stopped.status, stopped.errorKind, stopped.error],
    ['failed', 'out_of_scope', 'Flights are not products.'])
})

test('a duplicate stops with a link to the existing item', async () => {
  const { db, worker, claude } = await setup({
    replies: [{ resultText: fenced({ outcome: 'duplicate', duplicateOf: 'k7',
      reason: 'Your K7 item covers it.' }) }]
  })
  createItem({ db, now: NOW, config: {
    id: 'k7', name: 'K7', product: 'Karcher K7', categories: [{ id: 'a', description: 'a' }],
    rules: {}, schedules: [], ntfy: { server: 'https://ntfy.sh', topic: 'k7-topic' },
    sources: { sites: [], searches: [] }
  } })
  const draft = createDraft({ db, input, now: NOW })
  await worker.kick()
  assert.match(claude.calls[0].prompt, /- k7: K7\. Karcher K7/)
  const stopped = getDraft({ db, id: draft.id })
  assert.deepEqual([stopped.errorKind, stopped.duplicateOf], ['duplicate', 'k7'])
})

test('a usage limit stops the draft with the reset time and nothing retries', async () => {
  const { db, worker, claude } = await setup({
    replies: [{
      resultText: 'Claude AI usage limit reached', isError: true,
      rateLimit: { status: 'rejected', resetsAt: 1794391200 }
    }]
  })
  const draft = createDraft({ db, input, now: NOW })
  await worker.kick()
  await worker.kick()
  const stopped = getDraft({ db, id: draft.id })
  assert.deepEqual([stopped.status, stopped.errorKind, stopped.resetsAt],
    ['failed', 'limited', new Date(1794391200 * 1000).toISOString()])
  assert.equal(claude.calls.length, 1)
})

test('a draft waits while research holds the AI lock', async () => {
  const { db, worker, claude, dir } = await setup({
    replies: [{ resultText: fenced(scopeQuestions) }]
  })
  const draft = createDraft({ db, input, now: NOW })
  let release
  let acquired
  const ready = new Promise((resolve) => { acquired = resolve })
  const held = withLock({
    path: join(dir, 'claude.lock'),
    label: 'AI research for Kärcher K7',
    fn: () => new Promise((resolve) => {
      release = resolve
      acquired()
    })
  })
  await ready
  await worker.kick()
  const waiting = getDraft({ db, id: draft.id })
  assert.equal(waiting.jobState, 'queued')
  assert.equal(waiting.events.at(-1).message, 'Waiting for AI research for Kärcher K7 to finish')
  assert.equal(claude.calls.length, 0)
  release()
  await held
  await worker.kick()
  assert.equal(getDraft({ db, id: draft.id }).status, 'clarifying')
})
