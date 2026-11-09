import { randomBytes } from 'node:crypto'
import { DRAFT_STATUSES } from './db.js'
import { parseStoredJson } from './legacy-keys.js'

export { DRAFT_STATUSES }

export const OPEN_STATUSES = ['describing', 'scoping', 'clarifying', 'researching', 'review',
  'testing', 'failed']
export const MAX_ROUNDS = 2
export const MAX_EVENTS = 40
export const STALE_DAYS = 14

export const TRANSITIONS = {
  describing: ['scoping', 'cancelled'],
  scoping: ['clarifying', 'researching', 'failed', 'cancelled'],
  clarifying: ['researching', 'cancelled'],
  researching: ['clarifying', 'review', 'failed', 'cancelled'],
  review: ['review', 'testing', 'saved', 'cancelled'],
  testing: ['review', 'cancelled'],
  failed: ['scoping', 'researching', 'cancelled'],
  saved: [],
  cancelled: []
}

export const JOB_STATUS = { scope: 'scoping', research: 'researching', change: 'review',
  test: 'testing' }

export class DraftStateError extends Error {
  constructor(message, status = 409) {
    super(message)
    this.status = status
  }
}

export const canMove = ({ from, to }) => (TRANSITIONS[from] ?? []).includes(to)

export const createDraft = ({ db, input, now = new Date() }) => {
  const id = randomBytes(8).toString('hex')
  const at = now.toISOString()
  db.prepare(`
    INSERT INTO drafts (id, status, input_json, created_at, updated_at, job, job_state,
      events_json, rounds)
    VALUES (:id, 'scoping', :input, :at, :at, 'scope', 'queued', '[]', 0)`)
    .run({ id, input: JSON.stringify(input), at })
  return getDraft({ db, id })
}

export const getDraft = ({ db, id }) => {
  const row = db.prepare('SELECT * FROM drafts WHERE id = :id').get({ id })
  return row ? toDraft(row) : null
}

export const requireDraft = ({ db, id }) => {
  const draft = getDraft({ db, id })
  if (!draft) throw new DraftStateError('Unknown draft', 404)
  return draft
}

export const listOpenDrafts = ({ db }) => db.prepare(`
  SELECT * FROM drafts WHERE status IN (${OPEN_STATUSES.map((s) => `'${s}'`).join(', ')})
  ORDER BY created_at DESC`).all().map(toDraft)

export const moveDraft = ({ db, id, to, patch = {}, now = new Date() }) => {
  const draft = requireDraft({ db, id })
  if (draft.status !== to && !canMove({ from: draft.status, to })) {
    throw new DraftStateError(`A draft in "${draft.status}" cannot move to "${to}"`)
  }
  return updateDraft({ db, id, patch: { ...patch, status: to }, now })
}

export const updateDraft = ({ db, id, patch, now = new Date() }) => {
  const columns = Object.entries(patch).map(([key, value]) => [COLUMN_FOR[key] ?? key, value])
  const unknown = columns.filter(([column]) => !WRITABLE.has(column))
  if (unknown.length > 0) throw new Error(`Unknown draft fields: ${unknown.map(([c]) => c)}`)
  const assignments = columns.map(([column]) => `${column} = :${column}`)
  const params = Object.fromEntries(columns.map(([column, value]) =>
    [column, JSON_COLUMNS.has(column) ? toJson(value) : value ?? null]))
  db.prepare(`UPDATE drafts SET ${[...assignments, 'updated_at = :updatedAt'].join(', ')}
    WHERE id = :id`).run({ ...params, id, updatedAt: now.toISOString() })
  return getDraft({ db, id })
}

export const queueJob = ({ db, id, job, now = new Date(), patch = {} }) =>
  moveDraft({
    db,
    id,
    to: JOB_STATUS[job],
    patch: {
      ...patch, job, jobState: 'queued', jobStartedAt: null, error: null, errorKind: null,
      failedStep: null, resetsAt: null
    },
    now
  })

export const nextQueuedDraft = ({ db, runAnywayOnly = false }) => {
  const row = db.prepare(`
    SELECT * FROM drafts WHERE job_state = 'queued'
      AND status IN ('scoping', 'researching', 'review', 'testing')
      AND (:runAnywayOnly = 0 OR run_anyway = 1)
    ORDER BY updated_at ASC LIMIT 1`).get({ runAnywayOnly: runAnywayOnly ? 1 : 0 })
  return row ? toDraft(row) : null
}

export const startJob = ({ db, id, now = new Date() }) => updateDraft({
  db, id, patch: { jobState: 'running', jobStartedAt: now.toISOString(), runAnyway: 0 }, now
})

export const allowRunAnyway = ({ db, id, now = new Date() }) => {
  const draft = requireDraft({ db, id })
  if (draft.jobState !== 'queued') throw new DraftStateError('This draft is not waiting')
  return updateDraft({ db, id, patch: { runAnyway: 1 }, now })
}

export const appendEvent = ({ db, id, message, now = new Date() }) => {
  const draft = getDraft({ db, id })
  if (!draft) return
  const last = draft.events.at(-1)
  if (last?.message === message) return
  const events = [...draft.events, { at: now.toISOString(), message }].slice(-MAX_EVENTS)
  db.prepare('UPDATE drafts SET events_json = :events WHERE id = :id')
    .run({ id, events: JSON.stringify(events) })
}

export const recoverInterrupted = ({ db, now = new Date() }) => {
  const running = db.prepare(`SELECT * FROM drafts WHERE job_state = 'running'`).all().map(toDraft)
  running.forEach((draft) => failJob({
    db,
    draft,
    error: 'The app restarted while this step was running.',
    kind: 'interrupted',
    now
  }))
  return running.length
}

export const failJob = ({
  db, draft, error, kind = 'error', resetsAt = null, now = new Date()
}) => {
  const step = draft.job
  const cleared = { job: null, jobState: null, jobStartedAt: null }
  if (step === 'change') {
    return updateDraft({
      db,
      id: draft.id,
      patch: {
        ...cleared, pendingChange: { ...draft.pendingChange, state: 'failed', error, kind }
      },
      now
    })
  }
  if (step === 'test') {
    return moveDraft({
      db,
      id: draft.id,
      to: 'review',
      patch: { ...cleared, test: { ...draft.test, full: { state: 'failed', error, kind } } },
      now
    })
  }
  return moveDraft({
    db,
    id: draft.id,
    to: 'failed',
    patch: { ...cleared, error, errorKind: kind, failedStep: step, resetsAt },
    now
  })
}

export const retryStep = ({ db, id, now = new Date(), separateFrom = null }) => {
  const draft = requireDraft({ db, id })
  if (draft.status !== 'failed' || !['scope', 'research'].includes(draft.failedStep)) {
    throw new DraftStateError('Only a stopped draft can be retried')
  }
  if (draft.errorKind === 'out_of_scope') {
    throw new DraftStateError('This request is out of scope. Start a new draft instead.')
  }
  const input = separateFrom ? { ...draft.input, separateFrom } : draft.input
  return queueJob({ db, id, job: draft.failedStep, now, patch: { input, duplicateOf: null } })
}

export const cancelDraft = ({ db, id, now = new Date() }) =>
  moveDraft({
    db, id, to: 'cancelled', patch: { job: null, jobState: null, jobStartedAt: null }, now
  })

export const purgeStaleDrafts = ({ db, now = new Date(), days = STALE_DAYS }) => {
  const before = new Date(now.getTime() - days * 86_400_000).toISOString()
  return Number(db.prepare(`
    DELETE FROM drafts WHERE updated_at < :before
      AND (job_state IS NULL OR job_state != 'running')`).run({ before }).changes)
}

export const addCost = ({ db, id, costUsd }) => {
  if (!Number.isFinite(costUsd) || costUsd <= 0) return
  db.prepare('UPDATE drafts SET cost_usd = cost_usd + :costUsd WHERE id = :id')
    .run({ id, costUsd })
}

const COLUMN_FOR = {
  input: 'input_json',
  questions: 'questions_json',
  answers: 'answers_json',
  config: 'draft_config_json',
  research: 'research_json',
  snapshot: 'snapshot_json',
  sessionId: 'session_id',
  itemId: 'item_id',
  jobState: 'job_state',
  jobStartedAt: 'job_started_at',
  errorKind: 'error_kind',
  failedStep: 'failed_step',
  resetsAt: 'resets_at',
  events: 'events_json',
  pendingChange: 'pending_change_json',
  test: 'test_json',
  costUsd: 'cost_usd',
  duplicateOf: 'duplicate_of',
  runAnyway: 'run_anyway'
}

const JSON_COLUMNS = new Set([
  'input_json', 'questions_json', 'answers_json', 'draft_config_json', 'research_json',
  'snapshot_json', 'events_json', 'pending_change_json', 'test_json'
])

const WRITABLE = new Set([
  ...Object.values(COLUMN_FOR), 'status', 'error', 'job', 'rounds'
])

const toDraft = (row) => ({
  id: row.id,
  status: row.status,
  input: fromJson(row.input_json) ?? {},
  questions: fromJson(row.questions_json) ?? [],
  answers: fromJson(row.answers_json) ?? [],
  config: fromJson(row.draft_config_json),
  research: fromJson(row.research_json),
  snapshot: fromJson(row.snapshot_json),
  sessionId: row.session_id,
  error: row.error,
  errorKind: row.error_kind,
  failedStep: row.failed_step,
  resetsAt: row.resets_at,
  job: row.job,
  jobState: row.job_state,
  jobStartedAt: row.job_started_at,
  rounds: row.rounds ?? 0,
  events: fromJson(row.events_json) ?? [],
  pendingChange: fromJson(row.pending_change_json),
  test: fromJson(row.test_json),
  costUsd: row.cost_usd ?? 0,
  duplicateOf: row.duplicate_of,
  runAnyway: row.run_anyway === 1,
  itemId: row.item_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

const toJson = (value) => (value === null || value === undefined ? null : JSON.stringify(value))

const fromJson = parseStoredJson
