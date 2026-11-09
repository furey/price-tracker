import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import {
  DraftStateError, TRANSITIONS, appendEvent, canMove, cancelDraft, createDraft, failJob, getDraft,
  listOpenDrafts, moveDraft, nextQueuedDraft, purgeStaleDrafts, queueJob, recoverInterrupted,
  retryStep, startJob
} from '../src/drafts.js'

const NOW = new Date('2026-11-08T00:00:00Z')
const input = { request: 'A Dyson V15 Detect', budget: 900, budgetMode: 'around', quantity: 1 }

test('a new draft starts scoping with a queued scope job', () => {
  const db = openDb(':memory:')
  const draft = createDraft({ db, input, now: NOW })
  assert.equal(draft.status, 'scoping')
  assert.deepEqual([draft.job, draft.jobState], ['scope', 'queued'])
  assert.deepEqual(draft.input, input)
  assert.equal(nextQueuedDraft({ db }).id, draft.id)
  assert.deepEqual(listOpenDrafts({ db }).map(({ id }) => id), [draft.id])
})

test('the state machine allows only the documented moves', () => {
  assert.equal(canMove({ from: 'scoping', to: 'clarifying' }), true)
  assert.equal(canMove({ from: 'clarifying', to: 'review' }), false)
  assert.equal(canMove({ from: 'saved', to: 'review' }), false)
  assert.deepEqual(TRANSITIONS.cancelled, [])
  const db = openDb(':memory:')
  const draft = createDraft({ db, input, now: NOW })
  assert.throws(() => moveDraft({ db, id: draft.id, to: 'saved' }), DraftStateError)
  moveDraft({ db, id: draft.id, to: 'clarifying', patch: { questions: [{ questions: [] }] } })
  const research = queueJob({ db, id: draft.id, job: 'research' })
  assert.deepEqual([research.status, research.job, research.jobState],
    ['researching', 'research', 'queued'])
})

test('a restart marks running steps as interrupted and keeps queued ones queued', () => {
  const db = openDb(':memory:')
  const running = createDraft({ db, input, now: NOW })
  const queued = createDraft({ db, input, now: NOW })
  startJob({ db, id: running.id, now: NOW })
  assert.equal(recoverInterrupted({ db, now: NOW }), 1)
  const stopped = getDraft({ db, id: running.id })
  assert.deepEqual([stopped.status, stopped.errorKind, stopped.failedStep],
    ['failed', 'interrupted', 'scope'])
  assert.equal(getDraft({ db, id: queued.id }).jobState, 'queued')
  const retried = retryStep({ db, id: running.id, now: NOW })
  assert.deepEqual([retried.status, retried.jobState, retried.error], ['scoping', 'queued', null])
})

test('retry keeps the answers and refuses out-of-scope drafts', () => {
  const db = openDb(':memory:')
  const draft = createDraft({ db, input, now: NOW })
  moveDraft({ db, id: draft.id, to: 'clarifying', patch: { questions: [{ questions: [] }] } })
  queueJob({ db, id: draft.id, job: 'research', patch: { answers: [[{ questionId: 'q1' }]] } })
  failJob({ db, draft: getDraft({ db, id: draft.id }), error: 'timed out', kind: 'timeout' })
  const retried = retryStep({ db, id: draft.id })
  assert.equal(retried.status, 'researching')
  assert.deepEqual(retried.answers, [[{ questionId: 'q1' }]])
  const other = createDraft({ db, input })
  moveDraft({ db, id: other.id, to: 'failed', patch: { failedStep: 'scope',
    errorKind: 'out_of_scope', error: 'Flights' } })
  assert.throws(() => retryStep({ db, id: other.id }), /out of scope/)
})

test('a failed change or test keeps the draft in review', () => {
  const db = openDb(':memory:')
  const draft = createDraft({ db, input, now: NOW })
  moveDraft({ db, id: draft.id, to: 'researching' })
  moveDraft({ db, id: draft.id, to: 'review', patch: { job: null, jobState: null } })
  queueJob({ db, id: draft.id, job: 'change', patch: { pendingChange: { instruction: 'x' } } })
  const afterChange = failJob({ db, draft: getDraft({ db, id: draft.id }), error: 'no' })
  assert.deepEqual([afterChange.status, afterChange.pendingChange.state], ['review', 'failed'])
  queueJob({ db, id: draft.id, job: 'test' })
  const afterTest = failJob({ db, draft: getDraft({ db, id: draft.id }), error: 'boom' })
  assert.deepEqual([afterTest.status, afterTest.test.full.state], ['review', 'failed'])
})

test('events keep a short log and stale drafts are purged', () => {
  const db = openDb(':memory:')
  const draft = createDraft({ db, input, now: NOW })
  for (let index = 0; index < 50; index += 1) {
    appendEvent({ db, id: draft.id, message: `event ${index}`, now: NOW })
  }
  appendEvent({ db, id: draft.id, message: 'event 49', now: NOW })
  assert.equal(getDraft({ db, id: draft.id }).events.length, 40)
  cancelDraft({ db, id: draft.id, now: NOW })
  assert.equal(listOpenDrafts({ db }).length, 0)
  const later = new Date(NOW.getTime() + 15 * 86_400_000)
  assert.equal(purgeStaleDrafts({ db, now: later }), 1)
})
