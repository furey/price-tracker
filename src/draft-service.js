import { capCheck, capReachedMessage, capStatus, usageSummary } from './ai-usage.js'
import { checkDirect, testDirectEntry } from './direct.js'
import { decide, eligibleListings, formatDealMessage, qualify } from './decide.js'
import { presetSchedules } from './draft-build.js'
import { urlProblem } from './draft-direct.js'
import {
  LIMITS, cleanLine, cleanText, protectConfig, publicUrl, remapSnapshotCategories
} from './draft-harden.js'
import { DEFAULT_TIME_ZONE, PRESET_IDS, localToday } from './draft-schedule.js'
import {
  DraftStateError, MAX_ROUNDS, moveDraft, queueJob, requireDraft, updateDraft
} from './drafts.js'
import { activeRegion } from './region.js'
import { recordObservation, sendTestNotification } from './runner.js'
import { BLOCKED_FETCH_NOTE, publicUrlProblem, safeFetch } from './safe-url.js'
import { deliveryFrom, resolveSettings } from './settings.js'
import { ItemError, createItem, findItem } from './item-store.js'
import { validateItem } from './item-validate.js'

export const INPUT_LIMITS = {
  request: 4000, links: 5, mustHaves: 8, mustHave: 60, quantity: 99, instruction: 1000,
  other: 300
}

export const MAX_CONFIG_CHARS = 200_000

export class DraftInputError extends Error {
  constructor(errors, status = 400) {
    super(errors.join('; '))
    this.errors = errors
    this.status = status
  }
}

export const validateInput = ({ body, now = new Date(), timeZone = DEFAULT_TIME_ZONE }) => {
  const errors = []
  const value = isObject(body) ? body : {}
  const request = cleanText(value.request, INPUT_LIMITS.request + 1)
  if (!request || request.length < 3) errors.push('request: describe what you want to track')
  if (request && request.length > INPUT_LIMITS.request) {
    errors.push(`request: keep it under ${INPUT_LIMITS.request} characters`)
  }
  const budget = optionalNumber(value.budget)
  if (budget === undefined || (budget !== null && (budget <= 0 || budget > LIMITS.maxPrice))) {
    errors.push('budget: expected a dollar amount')
  }
  const needBy = value.needBy ? String(value.needBy) : null
  if (needBy && (!/^\d{4}-\d{2}-\d{2}$/.test(needBy) || needBy <= localToday(now, timeZone))) {
    errors.push('needBy: expected a date after today')
  }
  const quantity = value.quantity === undefined || value.quantity === null || value.quantity === ''
    ? 1
    : Number(value.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > INPUT_LIMITS.quantity) {
    errors.push(`quantity: expected a whole number from 1 to ${INPUT_LIMITS.quantity}`)
  }
  const links = asArray(value.links).map((link) => String(link ?? '').trim()).filter(Boolean)
  if (links.length > INPUT_LIMITS.links) errors.push(`links: up to ${INPUT_LIMITS.links} links`)
  links.forEach((link, index) => {
    if (!publicUrl(link)) errors.push(`links[${index}]: expected a public http(s) address`)
  })
  const mustHaves = asArray(value.mustHaves)
    .map((item) => cleanLine(item, INPUT_LIMITS.mustHave))
    .filter(Boolean)
    .slice(0, INPUT_LIMITS.mustHaves)
  if (errors.length > 0) throw new DraftInputError(errors)
  return {
    request,
    budget,
    budgetMode: value.budgetMode === 'limit' ? 'limit' : 'around',
    needBy,
    quantity,
    mustHaves,
    links: links.map(publicUrl)
  }
}

export const answerDraft = ({ db, id, answers, now = new Date() }) => {
  const draft = requireDraft({ db, id })
  if (draft.status !== 'clarifying') throw new DraftStateError('This draft is not asking questions')
  const round = draft.questions.at(-1)
  const cleaned = cleanAnswers({ questions: round.questions, answers })
  const allAnswers = [...draft.answers.slice(0, draft.questions.length - 1), cleaned]
  return queueJob({ db, id, job: 'research', now, patch: { answers: allAnswers } })
}

export const storeConfig = ({ db, id, config, preset = null, now = new Date() }) => {
  const draft = requireDraft({ db, id })
  if (draft.status !== 'review') throw new DraftStateError('Only a draft in review can be edited')
  if (JSON.stringify(config ?? null).length > MAX_CONFIG_CHARS) {
    throw new DraftInputError(['config: too large'])
  }
  const protectedConfig = protectConfig({ config, trusted: draft.config })
  const research = PRESET_IDS.includes(preset)
    ? { ...draft.research, schedulePreset: preset }
    : draft.research
  return updateDraft({ db, id, patch: { config: protectedConfig, research }, now })
}

export const requestChange = ({ db, id, instruction, config, now = new Date() }) => {
  const text = cleanText(instruction, INPUT_LIMITS.instruction)
  if (!text) throw new DraftInputError(['instruction: say what to change'])
  const draft = config ? storeConfig({ db, id, config, now }) : requireDraft({ db, id })
  if (draft.job) throw new DraftStateError('Wait for the current step to finish')
  return queueJob({
    db, id, job: 'change', now, patch: { pendingChange: { instruction: text, state: 'queued' } }
  })
}

export const decideChange = ({ db, id, approve, now = new Date() }) => {
  const draft = requireDraft({ db, id })
  if (draft.status !== 'review' || draft.pendingChange?.state !== 'ready') {
    throw new DraftStateError('There is no change waiting for approval')
  }
  if (!approve) return updateDraft({ db, id, patch: { pendingChange: null }, now })
  const { config, research, snapshot } = draft.pendingChange
  return updateDraft({
    db,
    id,
    patch: {
      config: protectConfig({ config, trusted: draft.config }),
      research: { ...research, title: draft.research?.title ?? research.title },
      snapshot: snapshot ?? draft.snapshot,
      pendingChange: null,
      test: null
    },
    now
  })
}

export const schedulesForPreset = ({ db, id, preset, now = new Date() }) => {
  const draft = requireDraft({ db, id })
  if (!PRESET_IDS.includes(preset)) throw new DraftInputError(['preset: unknown preset'])
  return presetSchedules({ draft, preset, now, tz: activeRegion({ db }).timeZone })
}

export const queueFullTest = ({ db, id, config, now = new Date() }) => {
  const draft = config ? storeConfig({ db, id, config, now }) : requireDraft({ db, id })
  if (draft.job) throw new DraftStateError('Wait for the current step to finish')
  const errors = validateItem(draft.config)
  if (errors.length > 0) throw new DraftInputError(errors)
  const cap = capStatus({ db, now })
  if (cap.reached) throw new DraftInputError([capReachedMessage(cap)], 409)
  return queueJob({
    db, id, job: 'test', now, patch: { test: { ...draft.test, full: { state: 'queued' } } }
  })
}

export const runDirectDryRun = async ({
  db, id, config, fetchImpl = safeFetch, sleep, pauseMs, now = new Date()
}) => {
  const draft = config ? storeConfig({ db, id, config, now }) : requireDraft({ db, id })
  const item = draft.config
  const region = activeRegion({ db })
  assertPublicDirectUrls(item.direct ?? [])
  const data = (item.direct ?? []).length === 0
    ? { checkedAt: now.toISOString(), sources: [], listings: [] }
    : await checkDirect({
      item, fetchImpl, now, region, ...(sleep ? { sleep } : {}),
      ...(pauseMs !== undefined ? { pauseMs } : {})
    })
  const decision = decide({ item, research: data, lastAlerts: new Map(), region })
  const direct = {
    at: now.toISOString(),
    sources: data.sources,
    listings: data.listings.map((listing) => ({
      ...listing,
      ...qualify({ listing, rule: item.rules[listing.category], region }),
      eligible: eligibleListings([listing]).length === 1
    })),
    message: decision.best
      ? formatDealMessage({ item, listing: decision.best.listing, region })
      : null
  }
  updateDraft({ db, id, patch: { test: { ...draft.test, direct } }, now })
  return direct
}

export const testDraftEntry = async ({ entry, fetchImpl = safeFetch, lookupImpl, region }) => {
  assertPublicDirectUrls([entry])
  const problem = await urlProblem({ url: entry.url, lookupImpl })
  if (problem) return { status: 'error', note: `Not tested: ${BLOCKED_FETCH_NOTE}`, listings: [] }
  return testDirectEntry({ entry, fetchImpl, ...(region ? { region } : {}) })
}

export const saveDraft = async ({
  db, id, config, deliver, now = new Date(), env = process.env
}) => {
  const draft = config ? storeConfig({ db, id, config, now }) : requireDraft({ db, id })
  if (draft.status !== 'review') throw new DraftStateError('Only a draft in review can be saved')
  if (draft.job) throw new DraftStateError('Wait for the current step to finish')
  const itemConfig = draft.config
  const errors = validateItem(itemConfig)
  if (errors.length > 0) throw new DraftInputError(errors)
  const cap = capCheck({ db, config: itemConfig, now, env })
  if (!cap.ok) throw new DraftInputError([cap.message], 409)
  if (findItem({ db, id: itemConfig.id, now })) {
    throw new DraftStateError(`An item with id "${itemConfig.id}" already exists`)
  }
  const record = createItem({
    db, config: itemConfig, origin: 'app', source: 'wizard',
    note: 'Created with the new item wizard', now
  })
  const snapshot = await importSnapshot({ db, record, snapshot: draft.snapshot })
  const test = await safeTestAlert({ db, item: record.config, deliver, now })
  moveDraft({ db, id, to: 'saved', patch: { itemId: record.id, job: null, jobState: null }, now })
  return {
    itemId: record.id,
    version: record.version,
    ntfy: { server: record.config.ntfy.server, topic: record.config.ntfy.topic },
    snapshot,
    testDelivered: test.delivered,
    testError: test.error ?? null
  }
}

export const describeDraft = ({ db, draft, now = new Date(), waitingFor = null, env }) => ({
  ...draft,
  sessionId: undefined,
  title: draft.research?.title ?? null,
  duplicateName: draft.duplicateOf
    ? findItem({ db, id: draft.duplicateOf, now })?.config.name ?? null
    : null,
  waitingFor,
  maxRounds: MAX_ROUNDS,
  delivery: deliveryFrom(resolveSettings({ db, env })),
  usage: usageSummary({ db, now, env })
})

export const summariseDraft = (draft) => ({
  id: draft.id,
  status: draft.status,
  title: draft.research?.title ?? null,
  request: draft.input.request,
  job: draft.job,
  jobState: draft.jobState,
  jobStartedAt: draft.jobStartedAt,
  error: draft.error,
  errorKind: draft.errorKind,
  failedStep: draft.failedStep,
  resetsAt: draft.resetsAt,
  duplicateOf: draft.duplicateOf,
  questionCount: draft.questions.at(-1)?.questions.length ?? 0,
  lastEvent: draft.events.at(-1) ?? null,
  createdAt: draft.createdAt,
  updatedAt: draft.updatedAt
})

const importSnapshot = async ({ db, record, snapshot }) => {
  if (!snapshot) return { imported: 0 }
  const categoryIds = record.config.categories.map((category) => category.id)
  try {
    const result = await recordObservation({
      item: record.config,
      itemVersion: record.version,
      data: remapSnapshotCategories({ snapshot, categoryIds }),
      db,
      deps: { log: () => {} }
    })
    return { imported: result.research.listings.length, runId: result.runId }
  } catch (error) {
    return { imported: 0, error: error.message }
  }
}

const safeTestAlert = async ({ db, item, deliver, now }) => {
  try {
    return await sendTestNotification({
      item, db, now, log: () => {}, ...(deliver ? { deliver } : {})
    })
  } catch (error) {
    return { delivered: false, error: error.message }
  }
}

const assertPublicDirectUrls = (entries) => {
  const errors = entries.flatMap((entry, index) => {
    const problem = publicUrlProblem(isObject(entry) ? entry.url : null)
    return problem ? [`direct[${index}].url: ${problem}`] : []
  })
  if (errors.length > 0) throw new DraftInputError(errors)
}

const cleanAnswers = ({ questions, answers }) => {
  const list = asArray(answers)
  return questions.map((question) => {
    const answer = list.find((entry) => entry?.questionId === question.id) ?? {}
    const validIds = question.choices.map(({ id }) => id)
    const choiceIds = [...new Set(asArray(answer.choiceIds).filter((choiceId) =>
      validIds.includes(choiceId)))]
    if (!question.multi && choiceIds.length > 1) {
      throw new DraftInputError([`${question.id}: pick one choice`])
    }
    return {
      questionId: question.id,
      choiceIds,
      other: cleanLine(answer.other, INPUT_LIMITS.other)
    }
  })
}

const optionalNumber = (value) => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : undefined
}

const asArray = (value) => (Array.isArray(value) ? value : [])

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export { ItemError }
