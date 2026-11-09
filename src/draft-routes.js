import { usageSummary } from './ai-usage.js'
import {
  DraftInputError, answerDraft, decideChange, describeDraft, queueFullTest, requestChange,
  runDirectDryRun, saveDraft, schedulesForPreset, storeConfig, summariseDraft, testDraftEntry,
  validateInput
} from './draft-service.js'
import {
  DraftStateError, allowRunAnyway, cancelDraft, createDraft, listOpenDrafts, requireDraft,
  retryStep
} from './drafts.js'
import { currentGuard, describeGuard } from './claude-guard.js'
import { lockHolder } from './lock.js'
import { activeRegion } from './region.js'
import { ItemError } from './item-store.js'

export const addDraftRoutes = ({
  app, db, now, worker, claudeLockPath, fetchImpl, lookupImpl, deliver, env, sleep, pauseMs
}) => {
  const handle = (handler) => async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof DraftInputError || error instanceof DraftStateError) {
        return res.status(error.status ?? 400).json({ error: error.message, errors: error.errors })
      }
      if (error instanceof ItemError) {
        return res.status(error.code === 'invalid' ? 400 : 409)
          .json({ error: error.message, errors: error.errors })
      }
      throw error
    }
  }
  const kick = () => worker?.kick()
  const held = (draft) => heldBy({ draft, decision: currentGuard({ db, now: now(), env }) })
  const view = async (draft) => ({
    ...describeDraft({
      db, draft, now: now(), env, waitingFor: await waitingLabel({ draft, claudeLockPath })
    }),
    claudeGuard: held(draft)
  })
  const id = (req) => req.params.id

  app.get('/api/drafts', handle((req, res) => {
    res.json(listOpenDrafts({ db }).map((draft) => ({
      ...summariseDraft(draft), claudeGuard: held(draft)
    })))
  }))

  app.post('/api/drafts/:id/run-anyway', handle(async (req, res) => {
    const draft = allowRunAnyway({ db, id: id(req), now: now() })
    kick()
    res.status(202).json(await view(draft))
  }))

  app.get('/api/ai-usage', handle((req, res) => {
    res.json(usageSummary({ db, now: now(), env }))
  }))

  app.post('/api/drafts', handle(async (req, res) => {
    const input = validateInput({
      body: req.body?.input ?? req.body, now: now(), timeZone: activeRegion({ db }).timeZone
    })
    const draft = createDraft({ db, input, now: now() })
    kick()
    res.status(202).json(await view(draft))
  }))

  app.get('/api/drafts/:id', handle(async (req, res) => {
    res.json(await view(requireDraft({ db, id: id(req) })))
  }))

  app.post('/api/drafts/:id/answers', handle(async (req, res) => {
    const draft = answerDraft({ db, id: id(req), answers: req.body?.answers, now: now() })
    kick()
    res.status(202).json(await view(draft))
  }))

  app.put('/api/drafts/:id/config', handle(async (req, res) => {
    const draft = storeConfig({
      db, id: id(req), config: req.body?.config, preset: req.body?.preset, now: now()
    })
    res.json(await view(draft))
  }))

  app.post('/api/drafts/:id/schedules', handle((req, res) => {
    res.json({ schedules: schedulesForPreset({ db, id: id(req), preset: req.body?.preset }) })
  }))

  app.post('/api/drafts/:id/change', handle(async (req, res) => {
    const draft = requestChange({
      db, id: id(req), instruction: req.body?.instruction, config: req.body?.config, now: now()
    })
    kick()
    res.status(202).json(await view(draft))
  }))

  app.post('/api/drafts/:id/change/decision', handle(async (req, res) => {
    const draft = decideChange({ db, id: id(req), approve: req.body?.approve === true, now: now() })
    res.json(await view(draft))
  }))

  app.post('/api/drafts/:id/test', handle(async (req, res) => {
    if (req.body?.kind === 'full') {
      const draft = queueFullTest({ db, id: id(req), config: req.body?.config, now: now() })
      kick()
      return res.status(202).json(await view(draft))
    }
    const direct = await runDirectDryRun({
      db, id: id(req), config: req.body?.config, fetchImpl, sleep, pauseMs, now: now()
    })
    res.json({ direct, draft: await view(requireDraft({ db, id: id(req) })) })
  }))

  app.post('/api/drafts/:id/direct/test', handle(async (req, res) => {
    requireDraft({ db, id: id(req) })
    res.json(await testDraftEntry({
      entry: req.body?.entry, fetchImpl, lookupImpl, region: activeRegion({ db })
    }))
  }))

  app.post('/api/drafts/:id/save', handle(async (req, res) => {
    const saved = await saveDraft({
      db, id: id(req), config: req.body?.config, deliver, now: now(), env
    })
    res.status(201).json(saved)
  }))

  app.post('/api/drafts/:id/cancel', handle(async (req, res) => {
    const draft = cancelDraft({ db, id: id(req), now: now() })
    worker?.cancel(draft.id)
    res.json(await view(draft))
  }))

  app.post('/api/drafts/:id/retry', handle(async (req, res) => {
    const draft = retryStep({
      db, id: id(req), now: now(), separateFrom: req.body?.separate === true
        ? requireDraft({ db, id: id(req) }).duplicateOf
        : null
    })
    kick()
    res.status(202).json(await view(draft))
  }))
}

const heldBy = ({ draft, decision }) => {
  if (draft.jobState !== 'queued' || draft.runAnyway || decision.allow) return null
  return describeGuard(decision)
}

const waitingLabel = async ({ draft, claudeLockPath }) => {
  if (draft.jobState !== 'queued') return null
  const holder = await lockHolder(claudeLockPath)
  return holder?.label ?? null
}
