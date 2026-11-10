import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.js'
import { buildDraftConfig, existingItemSummaries, notifyDraft } from './draft-build.js'
import {
  CHANGE_MAX_TURNS, RESEARCH_MAX_TURNS, SCOPE_MAX_TURNS, buildChangePrompt, buildNudge,
  buildResearchPrompt, buildScopePrompt
} from './draft-prompts.js'
import { configToDraftShape, parseResearchReply, parseScopeReply } from './draft-harden.js'
import { endDateFor, localToday } from './draft-schedule.js'
import {
  MAX_ROUNDS, addCost, appendEvent, failJob, getDraft, moveDraft, nextQueuedDraft,
  purgeStaleDrafts, queueJob, recoverInterrupted, startJob, updateDraft
} from './drafts.js'
import { LockHeldError } from './lock.js'
import {
  describeClaudeEvent, extractJson, research as researchItem, runClaude, itemUrls,
  webFetchRules
} from './research.js'
import { activeRegion } from './region.js'
import { CLAUDE_LOCK_PATH, runItem, withClaudeLock } from './runner.js'
import { claudeToken, deliveryFrom, membershipsFrom, resolveSettings } from './settings.js'
import { currentGuard } from './claude-guard.js'
import { NOT_CONNECTED, recordClaudeOutcome } from './claude-connection.js'
import { failingSites } from './tuning-data.js'
import { itemRecords } from './item-store.js'
import { recordRateLimit } from './claude-usage.js'

export const DRAFT_TIMEOUTS_MS = {
  scope: 8 * 60_000,
  research: 20 * 60_000,
  change: 10 * 60_000,
  nudge: 4 * 60_000
}

export const createDraftWorker = ({
  db,
  spawnImpl,
  fetchImpl = fetch,
  lookupImpl,
  sleep,
  pauseMs,
  notify = notifyDraft,
  now = () => new Date(),
  claudeLockPath = CLAUDE_LOCK_PATH,
  cwd = join(STATE_DIR, 'claude-work'),
  timeouts = DRAFT_TIMEOUTS_MS,
  pollMs = 5000,
  guard = () => currentGuard({ db, now: now() }),
  log = defaultLog
}) => {
  const controllers = new Map()
  const context = {
    db, spawnImpl, fetchImpl, lookupImpl, sleep, pauseMs, notify, now, claudeLockPath, cwd,
    timeouts, log, controllers, guard
  }
  let draining = null
  let stopped = false
  let timer = null

  const kick = () => {
    if (stopped) return Promise.resolve()
    if (!draining) draining = drain(context).finally(() => { draining = null })
    return draining
  }

  const start = () => {
    const recovered = recoverInterrupted({ db, now: now() })
    if (recovered > 0) log(`drafts: marked ${recovered} interrupted step(s) as stopped`)
    purgeStaleDrafts({ db, now: now() })
    timer = setInterval(kick, pollMs)
    timer.unref?.()
    kick()
  }

  const stop = async () => {
    stopped = true
    clearInterval(timer)
    controllers.forEach((controller) => controller.abort())
    await draining
  }

  const cancel = (id) => controllers.get(id)?.abort()

  return { start, stop, kick, cancel }
}

const drain = async (context) => {
  for (;;) {
    const draft = nextQueuedDraft({ db: context.db, runAnywayOnly: !context.guard().allow })
    if (!draft) return
    const outcome = await runJob({ context, draft })
    if (outcome === 'busy') return
  }
}

const runJob = async ({ context: workerContext, draft }) => {
  const context = { ...workerContext, region: activeRegion({ db: workerContext.db }) }
  const { db, now, claudeLockPath, controllers, log } = context
  const step = STEPS[draft.job]
  const controller = new AbortController()
  controllers.set(draft.id, controller)
  try {
    const aiResult = await withClaudeLock({
      path: claudeLockPath,
      label: `New item draft "${draftTitle(draft)}"`,
      fn: async () => {
        const running = startJob({ db, id: draft.id, now: now() })
        appendEvent({ db, id: draft.id, message: step.startMessage, now: now() })
        return step.ai({ context, draft: running, signal: controller.signal })
      }
    })
    recordClaudeOutcome({ db, now: now() })
    if (isCancelled({ db, id: draft.id })) return 'done'
    await step.finish({ context, draft: getDraft({ db, id: draft.id }), result: aiResult })
    return 'done'
  } catch (error) {
    if (error instanceof LockHeldError) {
      const message = `Waiting for ${error.label ?? 'another AI job'} to finish`
      appendEvent({ db, id: draft.id, message, now: now() })
      return 'busy'
    }
    if (isCancelled({ db, id: draft.id })) return 'done'
    recordClaudeOutcome({ db, error, now: now() })
    const loggedOut = error.kind === 'login'
    log(`draft ${draft.id} ${draft.job} failed: ${error.message}`)
    const failed = failJob({
      db,
      draft: getDraft({ db, id: draft.id }),
      error: describeError(error),
      kind: error.kind === 'cancelled' ? 'interrupted' : error.kind ?? 'error',
      resetsAt: error.resetsAt ?? null,
      now: now()
    })
    if (!loggedOut && ['scope', 'research'].includes(draft.job)) {
      await safeNotify({ context, draft: failed })
    }
    return 'done'
  } finally {
    controllers.delete(draft.id)
  }
}

const scopeStep = {
  startMessage: 'Reading your request',
  ai: async ({ context, draft, signal }) => {
    const existing = existingItemSummaries({ db: context.db, now: context.now() })
    const prompt = buildScopePrompt({
      input: draft.input,
      existing,
      delivery: deliveryOf(context.db),
      memberships: membershipsOf(context.db),
      today: localToday(context.now(), context.region.timeZone),
      separateFrom: draft.input.separateFrom ?? null,
      region: context.region
    })
    return askJson({
      context,
      draft,
      prompt,
      signal,
      maxTurns: SCOPE_MAX_TURNS,
      timeoutMs: context.timeouts.scope,
      parse: (data) => parseScopeReply({ data, existingIds: existing.map(({ id }) => id) })
    })
  },
  finish: async ({ context, draft, result }) => {
    const { db, now } = context
    const { value, sessionId } = result
    const research = { title: value.title, understood: value.understood }
    const base = { sessionId, research, job: null, jobState: null, jobStartedAt: null }
    if (value.outcome === 'questions') {
      const updated = moveDraft({
        db, id: draft.id, to: 'clarifying',
        patch: { ...base, questions: [{ questions: value.questions }], answers: [] }, now: now()
      })
      return safeNotify({ context, draft: updated })
    }
    if (value.outcome === 'ready') {
      updateDraft({ db, id: draft.id, patch: { sessionId, research }, now: now() })
      return queueJob({ db, id: draft.id, job: 'research', now: now() })
    }
    const updated = moveDraft({
      db, id: draft.id, to: 'failed',
      patch: {
        ...base, failedStep: 'scope', errorKind: value.outcome, error: value.reason,
        duplicateOf: value.duplicateOf ?? null
      },
      now: now()
    })
    return safeNotify({ context, draft: updated })
  }
}

const researchStep = {
  startMessage: 'Researching models, prices, retailers, and sale dates',
  ai: async ({ context, draft, signal }) => {
    const today = localToday(context.now(), context.region.timeZone)
    const questionsAllowed = draft.questions.length < MAX_ROUNDS && draft.questions.length > 0
    const prompt = buildResearchPrompt({
      input: draft.input,
      rounds: roundsOf(draft),
      delivery: deliveryOf(context.db),
      memberships: membershipsOf(context.db),
      today,
      endDate: endDateFor({ needBy: draft.input.needBy, today }),
      questionsAllowed,
      failingSites: failingSiteNames(context),
      region: context.region
    })
    return askJson({
      context,
      draft,
      prompt,
      signal,
      resume: draft.sessionId,
      maxTurns: RESEARCH_MAX_TURNS,
      timeoutMs: context.timeouts.research,
      parse: (data) => parseResearchReply({ data, questionsAllowed })
    })
  },
  finish: async ({ context, draft, result }) => {
    const { db, now } = context
    const { value, sessionId } = result
    const cleared = { sessionId, job: null, jobState: null, jobStartedAt: null }
    if (value.outcome === 'questions') {
      const updated = moveDraft({
        db, id: draft.id, to: 'clarifying',
        patch: { ...cleared, questions: [...draft.questions, { questions: value.questions }] },
        now: now()
      })
      return safeNotify({ context, draft: updated })
    }
    if (value.outcome === 'out_of_scope') {
      const updated = moveDraft({
        db, id: draft.id, to: 'failed',
        patch: {
          ...cleared, failedStep: 'research', errorKind: 'out_of_scope', error: value.reason
        },
        now: now()
      })
      return safeNotify({ context, draft: updated })
    }
    appendEvent({ db, id: draft.id, message: 'Testing product links', now: now() })
    const built = await buildDraftConfig({ context, draft, parsed: value })
    const updated = moveDraft({
      db, id: draft.id, to: 'review',
      patch: {
        ...cleared, config: built.config, research: built.research, snapshot: built.snapshot,
        test: null
      },
      now: now()
    })
    appendEvent({ db, id: draft.id, message: 'Draft ready to review', now: now() })
    return safeNotify({ context, draft: updated })
  }
}

const changeStep = {
  startMessage: 'Applying your change',
  ai: async ({ context, draft, signal }) => {
    const current = configToDraftShape({
      config: draft.config,
      reasoning: draft.research?.reasoning ?? {},
      categoryLabels: draft.research?.categoryLabels ?? {}
    })
    const prompt = buildChangePrompt({
      instruction: draft.pendingChange.instruction,
      current,
      today: localToday(context.now(), context.region.timeZone),
      region: context.region
    })
    return askJson({
      context,
      draft,
      prompt,
      signal,
      resume: draft.sessionId,
      maxTurns: CHANGE_MAX_TURNS,
      timeoutMs: context.timeouts.change,
      parse: (data) => parseResearchReply({ data, questionsAllowed: false })
    })
  },
  finish: async ({ context, draft, result }) => {
    const { db, now } = context
    const { value, sessionId } = result
    const cleared = { sessionId, job: null, jobState: null, jobStartedAt: null }
    if (value.outcome !== 'draft') {
      const pendingChange = {
        ...draft.pendingChange, state: 'failed', error: value.reason, kind: 'error'
      }
      return updateDraft({ db, id: draft.id, patch: { ...cleared, pendingChange }, now: now() })
    }
    const built = await buildDraftConfig({
      context, draft, parsed: value, keepSnapshot: draft.snapshot
    })
    const pendingChange = {
      instruction: draft.pendingChange.instruction,
      state: 'ready',
      config: built.config,
      research: built.research,
      snapshot: built.snapshot
    }
    appendEvent({ db, id: draft.id, message: 'Change ready to review', now: now() })
    return updateDraft({ db, id: draft.id, patch: { ...cleared, pendingChange }, now: now() })
  }
}

const testStep = {
  startMessage: 'Running one full AI check against this draft',
  ai: async ({ context, draft }) => {
    const { db, now, spawnImpl, log } = context
    const result = await runItem({
      item: { ...draft.config, id: `draft-${draft.id}` },
      trigger: 'manual',
      dryRun: true,
      now: now(),
      db,
      deps: {
        research: (options) => researchItem({ ...options, spawnImpl }),
        log
      }
    })
    if (result.status === 'failed') throw new Error(result.error)
    return result
  },
  finish: async ({ context, draft, result }) => {
    const { db, now } = context
    const full = {
      state: 'done',
      at: now().toISOString(),
      runId: result.runId,
      qualified: result.decision.qualified.map(({ listing, reasons }) => ({ listing, reasons })),
      eligible: result.decision.eligible.length,
      listings: result.research.listings.slice(0, 40),
      sources: result.research.sources,
      message: result.messages.deal
    }
    return moveDraft({
      db, id: draft.id, to: 'review',
      patch: { job: null, jobState: null, jobStartedAt: null, test: { ...draft.test, full } },
      now: now()
    })
  }
}

const STEPS = { scope: scopeStep, research: researchStep, change: changeStep, test: testStep }

const askJson = async ({
  context, draft, prompt, signal, resume = null, maxTurns, timeoutMs, parse
}) => {
  const { db, now, spawnImpl, cwd } = context
  mkdirSync(cwd, { recursive: true })
  const onEvent = (event) => describeClaudeEvent(event)
    .forEach((message) => appendEvent({ db, id: draft.id, message, now: now() }))
  const onRateLimit = (event) => {
    recordRateLimit({ db, event, source: 'draft', sourceId: draft.id, now: now() })
  }
  const token = claudeToken({ db })
  const run = (options) => runClaude({
    prompt, maxTurns, timeoutMs, cwd, onEvent, onRateLimit, signal, claudeToken: token,
    allowedTools: webFetchRules({ urls: draftUrls(draft), region: context.region }),
    ...(spawnImpl ? { spawnImpl } : {}), ...options
  })
  const reply = await runResumable({ run, resume })
  addCost({ db, id: draft.id, costUsd: reply.costUsd })
  try {
    return { value: parse(extractJson(reply.resultText)), sessionId: reply.sessionId ?? resume }
  } catch (error) {
    const errors = error.errors ?? [error.message]
    appendEvent({ db, id: draft.id, message: 'Reply was not valid, asking again', now: now() })
    const second = await run({
      prompt: buildNudge(errors),
      resumeSessionId: reply.sessionId,
      maxTurns: 3,
      timeoutMs: context.timeouts.nudge
    })
    addCost({ db, id: draft.id, costUsd: second.costUsd })
    return {
      value: parse(extractJson(second.resultText)),
      sessionId: second.sessionId ?? reply.sessionId
    }
  }
}

const runResumable = async ({ run, resume }) => {
  if (!resume) return run({})
  try {
    return await run({ resumeSessionId: resume })
  } catch (error) {
    if (!MISSING_SESSION.test(error.message)) throw error
    return run({})
  }
}

const draftUrls = (draft) => [...(draft.input?.links ?? []), ...itemUrls(draft.config)]

const MISSING_SESSION = /no conversation found|session.{0,40}(not found|does not exist)/i

const roundsOf = (draft) => draft.questions.map((round, index) => ({
  questions: round.questions,
  answers: draft.answers[index] ?? []
}))

const deliveryOf = (db) => deliveryFrom(resolveSettings({ db }))

const membershipsOf = (db) => membershipsFrom(resolveSettings({ db }))

const isCancelled = ({ db, id }) => {
  const draft = getDraft({ db, id })
  return !draft || draft.status === 'cancelled'
}

const safeNotify = async ({ context, draft }) => {
  try {
    await context.notify({ db: context.db, draft, now: context.now() })
  } catch (error) {
    context.log(`draft ${draft.id} notice not sent: ${error.message}`)
  }
}

const describeError = (error) => {
  if (error.kind === 'cancelled') return 'The app stopped while this step was running.'
  if (error.kind === 'login') return LOGIN_ADVICE
  if (error.kind === 'timeout') return `${error.message}. Your answers are kept.`
  if (error.errors) return `Claude's reply was not valid: ${error.errors.slice(0, 5).join('; ')}`
  return String(error.message).slice(0, 1000)
}

const LOGIN_ADVICE = `${NOT_CONNECTED}. Add a Claude login token in Settings, then press `
  + 'Try again. You can also add the item by hand.'

export const draftTitle = (draft) => draft.research?.title ?? draft.config?.name
  ?? String(draft.input?.request ?? 'New item').slice(0, 40)

const defaultLog = (message) => console.log(`${new Date().toISOString()} ${message}`)

const failingSiteNames = ({ db, now }) => failingSites({
  db, records: itemRecords({ db, now: now() }), now: now()
}).map(({ name }) => name)
