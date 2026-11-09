import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import express from 'express'
import { AuthConfigError, createAuth, isSecureRequest, requireSession } from './auth.js'
import { PROJECT_ROOT } from './config.js'
import {
  FEEDBACK_REASONS, dayListings, feedbackFor, getAlert, getRun, historyRows, inTransaction,
  insertFeedback, lastAlert, lastRun, lastSuccessAt, openDb, recentAlerts, recentRuns, runListings
} from './db.js'
import { lowestPerRetailerPerDay } from './decide.js'
import { testDirectEntry } from './direct.js'
import { alertDetail } from './alert-detail.js'
import { buildInsights } from './insights.js'
import { lockHolder } from './lock.js'
import {
  DIRECT_MODE, ObservationError, TICK_LOCK_PATH, claudeLockFor, recordObservation, schedulesFor,
  sendTestNotification
} from './runner.js'
import { capCheck, capReachedMessage, capStatus } from './ai-usage.js'
import { probeClaudeUsage, testClaudeLogin } from './claude-check.js'
import { currentGuard, describeGuard } from './claude-guard.js'
import { claudeUsageView } from './claude-usage-view.js'
import { addBotCheckRoutes } from './bot-check-routes.js'
import { addDraftRoutes } from './draft-routes.js'
import { addSuggestionRoutes } from './suggestion-routes.js'
import { monthlyRuns } from './draft-schedule.js'
import { sendAppTestNotice } from './app-notice.js'
import { deliver as deliverAlert, sendNtfy } from './notify.js'
import { nextSlot } from './schedule.js'
import { gateByMemberships } from './memberships.js'
import { activeRegion } from './region.js'
import { DEFAULT_REGION, publicRegion } from './regions/index.js'
import {
  SettingsError, ensureAppTopic, membershipsFrom, publicSettings, resolveSettings, setSetting,
  setSettings, tokenItem
} from './settings.js'
import {
  ItemError, archiveItem, deleteItem, pauseItem, restoreItem, resumeItem, rulesByVersion,
  saveItemConfig, itemRecords, itemVersionConfig, itemVersions
} from './item-store.js'
import { validateItem } from './item-validate.js'
import { TREND_DAYS, headlinePrices } from './item-trend.js'
import { TuningError, applyTuningChanges, MAX_BY_LENGTH, MAX_REASON_LENGTH } from './tuning.js'

export const DEFAULT_PORT = 4280
export const DEFAULT_HOST = '127.0.0.1'
export const VITE_DEV_PORT = '5173'

export const createApp = ({
  db,
  now = () => new Date(),
  getItems = () => itemRecords({ db, now: now() }),
  spawnImpl = spawn,
  fetchImpl = fetch,
  deliver = deliverAlert,
  sendApp = sendNtfy,
  env = process.env,
  lockPath = TICK_LOCK_PATH,
  claudeLockPath = claudeLockFor(lockPath),
  worker = null,
  claudeSpawnImpl,
  lookupImpl,
  sleep,
  pauseMs,
  distDir = join(PROJECT_ROOT, 'web', 'dist'),
  allowedHosts = parseAllowedHosts(env.ALLOWED_HOSTS),
  auth = createAuth({ env, now })
}) => {
  const app = express()
  app.disable('x-powered-by')
  const proxyHops = trustProxyHops(env.TRUST_PROXY)
  if (proxyHops) app.set('trust proxy', proxyHops)
  app.use(securityHeaders)
  app.get('/health', (req, res) => res.json({ ok: true }))
  app.use('/api', guardStateChanges(allowedHosts))
  app.use('/api', requireSession(auth))
  app.use(express.json({ limit: '2mb' }))
  addAuthRoutes({ app, auth, db, env })
  const findRecord = (id) => getItems().find((record) => record.id === id)
  const findItem = (id) => findRecord(id)?.config
  const configs = () => getItems().map((record) => record.config)

  app.get('/api/items', (req, res) => {
    res.json(getItems().map((record) => describeItem({ db, record, now: now() })))
  })

  addManageRoutes({ app, db, now, findRecord, fetchImpl, env })
  addDraftRoutes({
    app, db, now, worker, claudeLockPath, fetchImpl, lookupImpl, deliver, env, sleep, pauseMs
  })
  addSuggestionRoutes({ app, db, now, getItems })
  addBotCheckRoutes({ app, db, now, getItems })

  app.get('/api/items/:id/history', (req, res) => {
    const item = findItem(req.params.id)
    if (!item) return notFound(res, 'item')
    const rows = historyRows({
      db, itemId: item.id, days: intParam(req.query.days, 30, 365), now: now()
    })
    res.json({
      daily: lowestPerRetailerPerDay(rows, { tz: itemTz({ item, db }) }),
      listings: rows
    })
  })

  app.get('/api/items/:id/insights', (req, res) => {
    const item = findItem(req.params.id)
    if (!item) return notFound(res, 'item')
    const rows = historyRows({
      db, itemId: item.id, days: intParam(req.query.days, 90, 730), now: now()
    })
    const alerts = recentAlerts({ db, itemId: item.id, limit: 500 })
    res.json(buildInsights({
      rows, item, alerts, tz: itemTz({ item, db }), now: now(),
      rulesByVersion: rulesByVersion({ db, itemId: item.id })
    }))
  })

  app.get('/api/items/:id/observations', (req, res) => {
    const item = findItem(req.params.id)
    if (!item) return notFound(res, 'item')
    const day = String(req.query.day ?? '')
    if (!DAY_PATTERN.test(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD' })
    const tz = itemTz({ item, db })
    res.json({ day, observations: dayListings({ db, itemId: item.id, day, tz }) })
  })

  app.post('/api/items/:id/observations', async (req, res) => {
    const record = findRecord(req.params.id)
    if (!record) return notFound(res, 'item')
    try {
      const result = await recordObservation({
        item: record.config, itemVersion: record.version, data: req.body, db
      })
      res.status(201).json({
        runId: result.runId,
        listingCount: result.research.listings.length,
        qualifiedCount: result.decision.qualified.length
      })
    } catch (error) {
      if (!(error instanceof ObservationError)) throw error
      res.status(400).json({ error: error.message, errors: error.errors })
    }
  })

  app.get('/api/items/:id/runs', (req, res) => {
    const item = findItem(req.params.id)
    if (!item) return notFound(res, 'item')
    res.json(recentRuns({ db, itemId: item.id, limit: intParam(req.query.limit, 20, 200) }))
  })

  app.get('/api/runs/:id', (req, res) => {
    const run = getRun({ db, id: intParam(req.params.id, -1, Number.MAX_SAFE_INTEGER) })
    if (!run) return notFound(res, 'run')
    res.json({ ...run, listings: runListings({ db, runId: run.id }) })
  })

  app.get('/api/alerts/:id', (req, res) => {
    const id = intParam(req.params.id, -1, Number.MAX_SAFE_INTEGER)
    const detail = alertDetail({
      db, id, region: activeRegion({ db }),
      tzFor: (itemId) => itemTz({ item: findItem(itemId) ?? {}, db })
    })
    if (!detail) return notFound(res, 'alert')
    const item = findItem(detail.alert.itemId)
    res.json({ ...detail, item: item ? { id: item.id, name: item.name } : null })
  })

  app.get('/api/alerts', (req, res) => {
    res.json(recentAlerts({
      db,
      itemId: req.query.itemId || null,
      limit: intParam(req.query.limit, 50, 500)
    }))
  })

  app.post('/api/items/:id/run', async (req, res) => {
    const record = findRecord(req.params.id)
    if (!record) return notFound(res, 'item')
    if (record.status === 'archived') {
      return res.status(409).json({ error: 'This item is archived. Restore it first.' })
    }
    const item = record.config
    if (await lockHolder(lockPath)) return res.status(409).json({ error: 'A run is in progress' })
    const cap = capStatus({ db, now: now(), env })
    if (cap.reached) return res.status(409).json({ error: capReachedMessage(cap) })
    const aiHolder = await lockHolder(claudeLockPath)
    if (aiHolder) {
      return res.status(409).json({ error: `AI busy: ${aiHolder.label ?? 'another AI run'}` })
    }
    const guard = currentGuard({ db, now: now(), env })
    if (!guard.allow && req.body?.runAnyway !== true) {
      const described = describeGuard(guard)
      return res.status(409).json({ error: described.message, guard: described })
    }
    const dryRun = req.body?.dryRun === true
    startDetachedRun({ spawnImpl, itemId: item.id, dryRun })
    res.status(202).json({ started: true })
  })

  app.post('/api/items/:id/test-notify', async (req, res) => {
    const item = findItem(req.params.id)
    if (!item) return notFound(res, 'item')
    const outcome = await sendTestNotification({ item, db, deliver, env })
    res.json({ delivered: outcome.delivered === true, tokenWithheld: outcome.tokenWithheld })
  })

  app.post('/api/claude/test', async (req, res) => {
    res.json(await testClaudeLogin({ db, env, claudeLockPath, spawnImpl: claudeSpawnImpl }))
  })

  addClaudeUsageRoutes({ app, db, now, env, claudeLockPath, claudeSpawnImpl })

  app.get('/api/about', (req, res) => res.json(aboutApp(db)))

  app.get('/api/settings', (req, res) => {
    ensureAppTopic({ db, env, now: now() })
    res.json(publicSettings({ db, env, item: tokenItem(configs()) }))
  })

  app.put('/api/settings', (req, res) => {
    if (!isPlainObject(req.body)) {
      return res.status(400).json({ error: 'Body must be an object of setting keys' })
    }
    try {
      setSettings({ db, changes: req.body, env })
    } catch (error) {
      if (!(error instanceof SettingsError)) throw error
      return res.status(400).json({ error: error.message, errors: error.errors })
    }
    res.json(publicSettings({ db, env, item: tokenItem(configs()) }))
  })

  app.post('/api/settings/app-topic/test', async (req, res) => {
    res.json(await sendAppTestNotice({ db, now: now(), send: sendApp, env }))
  })

  app.use('/api', (req, res) => notFound(res, 'endpoint'))
  app.use(express.static(distDir))
  app.use((req, res, next) => serveIndex({ req, res, next, distDir }))
  app.use(handleError)
  return app
}

export const securityHeaders = (req, res, next) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  next()
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ')

export const trustProxyHops = (value) => {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text === '0' || text === 'false') return 0
  return /^\d+$/.test(text) ? Number(text) : 1
}

const handleError = (error, req, res, next) => {
  const status = clientErrorStatus(error)
  if (status === null) {
    console.error(error)
    return res.status(500).json({ error: 'Internal server error' })
  }
  res.status(status).json({ error: status === 400 ? 'Invalid request body' : error.message })
}

const clientErrorStatus = (error) => {
  const status = error.status ?? error.statusCode
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : null
}

export const startServer = ({
  db = openDb(),
  port = Number(process.env.PORT ?? DEFAULT_PORT),
  host = process.env.HOST || DEFAULT_HOST,
  ...options
} = {}) => new Promise((resolve, reject) => {
  const refusal = openBindProblem({ host, env: options.env ?? process.env, auth: options.auth })
  if (refusal) return reject(new AuthConfigError(refusal))
  const server = createApp({ db, ...options }).listen(port, host, () => resolve(server))
  server.on('error', reject)
})

const ITEM_ERROR_STATUS = { 'not-found': 404, conflict: 409, invalid: 400, state: 409 }
const LOWEST_DAYS = 90
const DIRECT_TEST_SCHEDULE = { cron: '0 0 * * *', tz: DEFAULT_REGION.timeZone }

const addManageRoutes = ({ app, db, now, findRecord, fetchImpl, env }) => {
  const guarded = (handler) => async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (!(error instanceof ItemError)) throw error
      res.status(ITEM_ERROR_STATUS[error.code] ?? 400)
        .json({ error: error.message, errors: error.errors, ...error.details })
    }
  }
  const describe = (record) => describeItem({ db, record, now: now() })
  const id = (req) => req.params.id

  app.post('/api/items/:id/pause', guarded((req, res) => {
    res.json(describe(pauseItem({
      db, id: id(req), until: req.body?.until, now: now(), tz: activeRegion({ db }).timeZone
    })))
  }))

  app.post('/api/items/:id/resume', guarded((req, res) => {
    res.json(describe(resumeItem({ db, id: id(req), now: now() })))
  }))

  app.post('/api/items/:id/archive', guarded((req, res) => {
    res.json(describe(archiveItem({ db, id: id(req), now: now() })))
  }))

  app.post('/api/items/:id/restore', guarded((req, res) => {
    res.json(describe(restoreItem({ db, id: id(req), now: now() })))
  }))

  app.delete('/api/items/:id', guarded((req, res) => {
    const removed = deleteItem({ db, id: id(req), confirm: req.body?.confirm, now: now() })
    res.json({ deleted: true, removed })
  }))

  app.get('/api/items/:id/config', (req, res) => {
    const record = findRecord(id(req))
    if (!record) return notFound(res, 'item')
    res.json({
      version: record.version,
      status: record.status,
      pausedUntil: record.pausedUntil,
      origin: record.origin,
      config: record.config,
      versions: itemVersions({ db, id: record.id }),
      lowestByCategory: lowestByCategory({ db, itemId: record.id, now: now() })
    })
  })

  app.get('/api/items/:id/versions/:version', (req, res) => {
    const version = intParam(req.params.version, -1, Number.MAX_SAFE_INTEGER)
    const config = itemVersionConfig({ db, id: id(req), version })
    if (!config) return notFound(res, 'version')
    const meta = itemVersions({ db, id: id(req) }).find((entry) => entry.version === version)
    res.json({ ...meta, config })
  })

  app.put('/api/items/:id/config', guarded((req, res) => {
    const { baseVersion, config, note } = req.body ?? {}
    if (!Number.isInteger(baseVersion) || !isPlainObject(config)) {
      return res.status(400).json({ error: 'Body needs baseVersion (number) and config (object)' })
    }
    const overCap = capProblem({ db, record: findRecord(id(req)), config, now: now(), env })
    if (overCap) return res.status(409).json({ error: overCap, errors: [overCap] })
    const record = saveItemConfig({ db, id: id(req), baseVersion, config, note, now: now() })
    res.json({
      version: record.version,
      config: record.config,
      versions: itemVersions({ db, id: record.id })
    })
  }))

  app.post('/api/items/:id/tuning', guarded((req, res) => {
    const record = findRecord(id(req))
    if (!record) return notFound(res, 'item')
    const { baseVersion, changes, by, reason, note, feedback } = req.body ?? {}
    if (!Number.isInteger(baseVersion)) {
      return res.status(400).json({ error: 'Body needs baseVersion (number)' })
    }
    const feedbackError = feedback ? feedbackProblem({ db, record, feedback }) : null
    if (feedbackError) return res.status(400).json({ error: feedbackError })
    try {
      const at = now().toISOString()
      const config = applyTuningChanges({ config: record.config, changes, by, reason, at })
      const saved = inTransaction(db, () => {
        const updated = saveItemConfig({
          db, id: record.id, baseVersion, config, note: note ?? reason, source: 'tune',
          now: now(), transaction: false
        })
        const feedbackId = feedback ? insertFeedback({
          db, itemId: record.id, alertId: feedback.alertId ?? null, reason: feedback.reason,
          note: cleanText(note ?? reason, MAX_REASON_LENGTH), by: cleanText(by, MAX_BY_LENGTH),
          itemVersion: updated.version, changes, at
        }) : null
        return { updated, feedbackId }
      })
      res.json({
        version: saved.updated.version,
        config: saved.updated.config,
        versions: itemVersions({ db, id: record.id }),
        feedbackId: saved.feedbackId
      })
    } catch (error) {
      if (!(error instanceof TuningError)) throw error
      res.status(400).json({ error: error.message, errors: error.errors })
    }
  }))

  app.get('/api/items/:id/feedback', (req, res) => {
    const record = findRecord(id(req))
    if (!record) return notFound(res, 'item')
    res.json(feedbackFor({ db, itemId: record.id, limit: intParam(req.query.limit, 50, 500) }))
  })

  app.post('/api/items/:id/feedback', (req, res) => {
    const record = findRecord(id(req))
    if (!record) return notFound(res, 'item')
    const body = req.body ?? {}
    const problem = feedbackProblem({ db, record, feedback: body })
      ?? (cleanText(body.by, MAX_BY_LENGTH) ? null : 'by: say who gave the feedback')
    if (problem) return res.status(400).json({ error: problem })
    const feedbackId = insertFeedback({
      db, itemId: record.id, alertId: body.alertId ?? null, reason: body.reason,
      note: cleanText(body.note, MAX_REASON_LENGTH) || null, by: cleanText(body.by, MAX_BY_LENGTH),
      itemVersion: record.version, at: now().toISOString()
    })
    res.status(201).json({ feedbackId })
  })

  app.post('/api/items/:id/direct/test', async (req, res) => {
    const record = findRecord(id(req))
    if (!record) return notFound(res, 'item')
    const entry = req.body?.entry
    const errors = directEntryErrors({ config: record.config, entry })
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; '), errors })
    res.json(await testDirectEntry({ entry, fetchImpl, region: activeRegion({ db }) }))
  })
}

const addClaudeUsageRoutes = ({ app, db, now, env, claudeLockPath, claudeSpawnImpl }) => {
  const view = () => claudeUsageView({ db, now: now(), env })

  app.get('/api/claude/usage', (req, res) => res.json(view()))

  app.post('/api/claude/pause', (req, res) => {
    setSetting({ db, key: 'aiPaused', value: 'true', now: now() })
    res.json(view())
  })

  app.post('/api/claude/resume', (req, res) => {
    setSetting({ db, key: 'aiPaused', value: 'false', now: now() })
    res.json(view())
  })

  app.post('/api/claude/usage/refresh', async (req, res) => {
    const outcome = await probeClaudeUsage({
      db, env, claudeLockPath, spawnImpl: claudeSpawnImpl, now: now()
    })
    const status = outcome.ok ? 200 : refreshStatus(outcome)
    res.status(status).json({ ...outcome, usage: view() })
  })
}

const feedbackProblem = ({ db, record, feedback }) => {
  if (!isPlainObject(feedback)) return 'feedback: expected an object'
  if (!FEEDBACK_REASONS.includes(feedback.reason)) {
    return `feedback.reason: expected one of ${FEEDBACK_REASONS.join(', ')}`
  }
  if (feedback.alertId === undefined || feedback.alertId === null) return null
  const alert = Number.isInteger(feedback.alertId) ? getAlert({ db, id: feedback.alertId }) : null
  return alert?.itemId === record.id ? null : 'feedback.alertId: not an alert of this item'
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

const refreshStatus = (outcome) => {
  if (outcome.rateLimited) return 429
  if (outcome.busy) return 409
  return 502
}

const capProblem = ({ db, record, config, now, env }) => {
  if (!record || record.status !== 'active' || !Array.isArray(config.schedules)) return null
  const before = monthlyRuns({ schedules: record.config.schedules ?? [], now })
  const after = monthlyRuns({ schedules: config.schedules, now })
  if (after <= before) return null
  const check = capCheck({ db, config, now, env, excludeId: record.id })
  return check.ok ? null : check.message
}

const directEntryErrors = ({ config, entry }) => {
  if (!isPlainObject(entry)) return ['entry: expected an object']
  const probe = { ...config, direct: [entry], directSchedules: [DIRECT_TEST_SCHEDULE] }
  return validateItem(probe)
    .filter((error) => error.startsWith('direct[0]'))
    .filter((error) => !/^direct\[0\]\.(category|part):/.test(error))
    .map((error) => error.replace(/^direct\[0\]/, 'entry'))
}

const lowestByCategory = ({ db, itemId, now }) => {
  const rows = historyRows({ db, itemId, days: LOWEST_DAYS, now })
  const lowest = {}
  rows.forEach((row) => {
    const current = lowest[row.category]
    if (current && current.effectivePrice <= row.effectivePrice) return
    lowest[row.category] = {
      effectivePrice: row.effectivePrice,
      retailer: row.retailer,
      checkedAt: row.checkedAt,
      days: LOWEST_DAYS
    }
  })
  return lowest
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

const guardStateChanges = (allowedHosts) => (req, res, next) => {
  if (!isAllowedHost({ host: req.headers.host, allowedHosts })) {
    return forbidden(res, 'Host not allowed')
  }
  if (SAFE_METHODS.has(req.method)) return next()
  if (req.headers.origin !== undefined && !isOwnOrigin({ req, allowedHosts })) {
    return forbidden(res, 'Cross-origin request rejected')
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' })
  }
  next()
}

const openBindProblem = ({ host, env, auth }) => {
  if (LOOPBACK_BINDS.has(host) || env.ALLOW_NO_AUTH === '1') return null
  if (auth ? auth.enabled : Boolean(env.APP_PASSWORD)) return null
  return `Refusing to listen on ${host} without APP_PASSWORD; set it or ALLOW_NO_AUTH=1`
}

const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1'])

export const parseAllowedHosts = (value) => new Set(
  String(value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
)

const isAllowedHost = ({ host, allowedHosts }) => {
  const parsed = parseHost(host)
  if (parsed === null) return false
  return LOCAL_HOSTNAMES.has(parsed.hostname) || allowedHosts.has(String(host).toLowerCase())
}

const isOwnOrigin = ({ req, allowedHosts }) => {
  const origin = parseHost(req.headers.origin, { withProtocol: true })
  const host = parseHost(req.headers.host)
  if (!origin || !host) return false
  if (!['http:', 'https:'].includes(origin.protocol)) return false
  if (LOCAL_HOSTNAMES.has(origin.hostname)) {
    return origin.protocol === 'http:'
      && (origin.port === host.port || origin.port === VITE_DEV_PORT)
  }
  return allowedHosts.has(origin.host) && origin.host === String(req.headers.host).toLowerCase()
}

const parseHost = (value, { withProtocol = false } = {}) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(withProtocol ? value : `http://${value}`)
    return { protocol: url.protocol, hostname: url.hostname, port: url.port, host: url.host }
  } catch {
    return null
  }
}

const addAuthRoutes = ({ app, auth, db, env }) => {
  app.get('/api/session', (req, res) => {
    const authenticated = !auth.enabled || auth.isAuthenticated(req)
    const region = publicRegion(activeRegion({ db, env }))
    res.json({ authRequired: auth.enabled, authenticated, region })
  })

  app.post('/api/login', (req, res) => {
    if (!auth.enabled) return res.json({ ok: true })
    if (auth.isRateLimited(req.ip)) {
      return res.status(429).json({ error: 'Too many failed logins. Try again later.' })
    }
    if (!auth.checkPassword(req.body?.password)) {
      auth.recordFailure(req.ip)
      return res.status(401).json({ error: 'Wrong password' })
    }
    auth.clearFailures(req.ip)
    res.setHeader('Set-Cookie', auth.issueCookie({ secure: isSecureRequest(req) }))
    res.json({ ok: true })
  })

  app.post('/api/logout', (req, res) => {
    if (auth.enabled) {
      res.setHeader('Set-Cookie', auth.clearCookie({ secure: isSecureRequest(req) }))
    }
    res.json({ ok: true })
  })
}

const forbidden = (res, error) => res.status(403).json({ error })

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const itemTz = ({ item, db }) => item.schedules?.[0]?.tz ?? activeRegion({ db }).timeZone

const describeItem = ({ db, record, now }) => {
  const item = record.config
  const active = record.status === 'active'
  const resumesAt = record.status === 'paused' && record.pausedUntil
    ? new Date(Math.max(now.getTime(), Date.parse(record.pausedUntil)))
    : null
  const slotFrom = active ? now : resumesAt
  return {
    ...describeConfig({ db, item, now, slotFrom }),
    status: record.status,
    pausedUntil: record.pausedUntil,
    version: record.version,
    origin: record.origin,
    enabled: active
  }
}

const describeConfig = ({ db, item, now, slotFrom }) => ({
  id: item.id,
  name: item.name,
  categories: item.categories,
  rules: item.rules,
  schedules: item.schedules,
  ntfy: { server: item.ntfy.server, topic: item.ntfy.topic },
  lastRun: lastRun({ db, itemId: item.id }),
  lastSuccessAt: lastSuccessAt({ db, itemId: item.id }),
  nextSlot: slotFrom ? isoNextSlot({ schedules: item.schedules, now: slotFrom }) : null,
  directSchedules: item.directSchedules ?? [],
  nextDirectSlot: slotFrom ? nextDirectSlot({ item, now: slotFrom }) : null,
  lastAlert: lastAlert({ db, itemId: item.id }),
  sources: {
    sites: (item.sources?.sites ?? []).map(({ name, url }) => ({ name, url: url ?? null })),
    searches: item.sources?.searches ?? [],
    seasonalSearches: (item.sources?.seasonalSearches ?? []).map(({ phrase }) => ({ phrase }))
  },
  direct: (item.direct ?? []).map(({ retailer, url }) => ({ retailer, url })),
  tuning: item.tuning ?? null,
  ...recentPrices({ db, item, now })
})

const nextDirectSlot = ({ item, now }) => {
  if (!item.direct?.length) return null
  return isoNextSlot({ schedules: schedulesFor({ item, mode: DIRECT_MODE }), now })
}

const isoNextSlot = ({ schedules, now }) => nextSlot({ schedules, now })?.toISOString() ?? null

const recentPrices = ({ db, item, now }) =>
  headlinePrices({ rows: usableRecentRows({ db, item, now }), item, tz: itemTz({ item, db }) })

const usableRecentRows = ({ db, item, now }) => {
  const memberships = membershipsFrom(resolveSettings({ db, item }))
  const itemCategories = new Set(item.categories.map((category) => category.id))
  const rows = historyRows({ db, itemId: item.id, days: TREND_DAYS, now })
    .filter((row) => itemCategories.has(row.category))
  return gateByMemberships({ listings: rows, memberships, region: activeRegion({ db }) })
    .filter((row) => row.category !== 'reject')
}

const aboutApp = (db) => ({
  version: packageVersion(),
  database: typeof db.location === 'function' ? basename(db.location() ?? '') || null : null
})

const packageVersion = () => {
  try {
    return JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

const startDetachedRun = ({ spawnImpl, itemId, dryRun }) => {
  const cliPath = join(PROJECT_ROOT, 'src', 'cli.js')
  const args = [cliPath, 'run', itemId, ...(dryRun ? ['--dry-run'] : [])]
  const child = spawnImpl(process.execPath, args, {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env
  })
  child.unref()
}

const serveIndex = ({ req, res, next, distDir }) => {
  const indexPath = join(distDir, 'index.html')
  if (req.method !== 'GET' || !existsSync(indexPath)) return next()
  res.sendFile(indexPath)
}

const notFound = (res, what) => res.status(404).json({ error: `Unknown ${what}` })

const intParam = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback
}
