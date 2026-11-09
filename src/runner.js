import { dirname, join } from 'node:path'
import { STATE_DIR } from './config.js'
import {
  failStaleRuns, finishRun, hasHeartbeatThisMonth, insertAlert, insertListings, lastAlertsFor,
  lastFailedRunAt, lastSkippedAt, lastSuccessAt, recentSiteNames, recordSkippedRun, startRun,
  updateAlertDelivery
} from './db.js'
import {
  decide, formatCheckMessage, formatDealMessage, formatHeartbeatMessage, formatMutedMessage
} from './decide.js'
import { runDirectCheck } from './direct.js'
import { KIT_SOURCE, kitPartIds } from './kits.js'
import { LockHeldError, withLock } from './lock.js'
import { deliver as deliverAlert } from './notify.js'
import { activeRegion } from './region.js'
import { research as researchItem } from './research.js'
import { listingTrust, normaliseListings } from './retailers.js'
import { dueSlot } from './schedule.js'
import {
  claudeToken, dashboardUrlFrom, deliveryFrom, membershipsFrom, ntfyTokenFor, resolveSettings
} from './settings.js'
import { gateByMemberships } from './memberships.js'
import { alertLink, listingActions, settingsLink, itemLink } from './links.js'
import { validateResearch } from './validate.js'
import { findItem, runnableItems } from './item-store.js'
import { capReachedMessage, capStatus, takeCapNotice } from './ai-usage.js'
import { sendAppNotice } from './app-notice.js'
import { currentGuard, noticeGuardChange, skipReason, stopReason } from './claude-guard.js'
import { recordRateLimit } from './claude-usage.js'
import { applyTuning, enabledDirect } from './tuning.js'

export const TICK_LOCK_PATH = join(STATE_DIR, 'tick.lock')
export const CLAUDE_LOCK_PATH = join(STATE_DIR, 'claude.lock')
export const FAILURE_COOLDOWN_MS = 2 * 60 * 60 * 1000

export const RESEARCH_MODE = 'research'
export const DIRECT_MODE = 'direct'
export const MANUAL_MODE = 'manual'

const MUTED_KIND = 'muted'
const CHECK_KIND = 'check'

export const defaultDeps = {
  research: researchItem,
  direct: runDirectCheck,
  deliver: deliverAlert,
  appNotice: sendAppNotice,
  log: (message) => console.log(`${new Date().toISOString()} ${message}`)
}

export const runItem = async ({
  item, trigger = 'manual', dryRun = false, now = new Date(), db, deps = {}, slotAt = null,
  mode = RESEARCH_MODE, itemVersion = null
}) => {
  const { deliver, log, appNotice, ...collectors } = { ...defaultDeps, ...deps }
  const collect = collectors[mode]
  const itemLog = (message) => log(`${item.id} ${message}`)
  const runId = startRun({
    db,
    itemId: item.id,
    trigger: dryRun ? 'dry-run' : trigger,
    slotAt: slotAt ? slotAt.toISOString() : null,
    startedAt: now.toISOString(),
    mode,
    itemVersion
  })
  const region = activeRegion({ db })
  const context = { item, now, db, runId, dryRun, deliver, mode, region, log: itemLog }
  itemLog(`run ${runId} started (${mode}, ${dryRun ? 'dry-run' : trigger})`)
  try {
    const settings = resolveSettings({ db, item })
    const delivery = deliveryFrom(settings)
    const memberships = membershipsFrom(settings)
    const token = mode === RESEARCH_MODE ? claudeToken({ db }) : null
    const onRateLimit = rateLimitHandler({
      db, runId, stopWhenOver: trigger === 'tick' && mode === RESEARCH_MODE && !dryRun
    })
    const recentSites = mode === RESEARCH_MODE
      ? recentSiteNames({ db, item, now })
      : undefined
    const result = await collect({
      item, now, log: itemLog, delivery, memberships, onRateLimit, region,
      ...(recentSites ? { recentSites } : {}),
      ...(token ? { claudeToken: token } : {})
    })
    if (result.skipped) {
      await noticeGuardChange({
        db, decision: currentGuard({ db }), send: appNotice, log: itemLog
      })
      return skipRun({ context, reason: result.skipped, costUsd: result.costUsd })
    }
    if (!result.ok) {
      return failRun({ context, error: describeFailure(result), costUsd: result.costUsd })
    }
    return await completeRun({ context, result })
  } catch (error) {
    return failRun({ context, error: error.message })
  }
}

export const rateLimitHandler = ({ db, runId, stopWhenOver = false }) => {
  let checked = false
  return (event) => {
    recordRateLimit({ db, event, source: 'run', sourceId: runId })
    if (!stopWhenOver || checked) return null
    checked = true
    const decision = currentGuard({ db })
    if (decision.allow || decision.reason === 'paused') return null
    return stopReason(decision)
  }
}

export class ObservationError extends Error {
  constructor(errors) {
    super(`Invalid observations: ${errors.join('; ')}`)
    this.errors = errors
  }
}

export const recordObservation = async ({ item, itemVersion = null, data, db, deps = {} }) => {
  const categoryIds = item.categories.map(({ id }) => id)
  const { ok, errors, value } = validateResearch({
    data, categoryIds, partIds: kitPartIds(item), maxPrice: activeRegion({ db }).maxPrice
  })
  if (!ok) throw new ObservationError(errors)
  const manual = async () => ({ ok: true, data: value, costUsd: null })
  const result = await runItem({
    item,
    trigger: 'manual',
    now: new Date(value.checkedAt),
    db,
    mode: MANUAL_MODE,
    itemVersion,
    deps: { ...deps, manual }
  })
  if (result.status === 'failed') throw new Error(result.error)
  return result
}

export const sendTestNotification = async ({
  item, db, deliver = deliverAlert, log = defaultDeps.log, now = new Date(), env = process.env
}) => {
  const settings = resolveSettings({ db, env, item })
  const alert = {
    title: `${item.name} test`,
    message: `Test notification for topic ${item.ntfy.topic}`,
    priority: 3,
    click: settingsLink(dashboardUrlFrom(settings))
  }
  const { token, withheld } = ntfyTokenFor({ settings, item, env })
  const outcome = await deliver({ item, alert, token, log })
  insertAlert({
    db,
    itemId: item.id,
    kind: 'test',
    sentAt: now.toISOString(),
    title: alert.title,
    message: alert.message,
    delivered: outcome.delivered,
    error: outcome.delivered ? null : String(outcome.error ?? 'delivery failed')
  })
  return { ...outcome, tokenWithheld: withheld }
}

export const claudeLockFor = (lockPath) => join(dirname(lockPath), 'claude.lock')

export const withClaudeLock = ({ path = CLAUDE_LOCK_PATH, label, fn }) =>
  withLock({ path, label, fn })

export const runItemLocked = async ({
  lockPath = TICK_LOCK_PATH, claudeLockPath = claudeLockFor(lockPath), db, ...options
}) =>
  withLock({
    path: lockPath,
    fn: () => {
      failStaleRuns({ db, finishedAt: new Date().toISOString() })
      const run = () => runItem({ db, ...options })
      if ((options.mode ?? RESEARCH_MODE) !== RESEARCH_MODE) return run()
      return withClaudeLock({
        path: claudeLockPath, label: researchLabel(options.item), fn: run
      })
    }
  })

export const researchLabel = (item) => `AI research for ${item.name}`

export const tick = async ({
  now = new Date(), db, deps = {}, log = defaultDeps.log, items, lockPath = TICK_LOCK_PATH,
  claudeLockPath = claudeLockFor(lockPath)
}) => withLock({
  path: lockPath,
  fn: async () => {
    failStaleRuns({ db, finishedAt: new Date().toISOString() })
    await noticeGuardChange({
      db, decision: currentGuard({ db, now }), now, send: deps.appNotice ?? defaultDeps.appNotice,
      log
    })
    const runnable = items ?? runnableItems({ db, now })
    const outcomes = []
    for (const { item, version } of runnable) {
      if (!items && !isStillActive({ db, id: item.id })) continue
      outcomes.push(...await tickItem({
        item, itemVersion: version, now, db, deps: { ...deps, log }, log, claudeLockPath
      }))
    }
    return outcomes
  }
})

const latestOf = (isoTimes) => isoTimes.filter(Boolean).sort().at(-1) ?? null

const isStillActive = ({ db, id }) => findItem({ db, id })?.status === 'active'

const tickItem = async ({ item, itemVersion, now, db, deps, log, claudeLockPath }) => {
  const context = { item, itemVersion, now, db, deps, log, claudeLockPath }
  const outcomes = [await tickMode({ mode: RESEARCH_MODE, ...context })]
  if (hasDirectChecks(item)) outcomes.push(await tickMode({ mode: DIRECT_MODE, ...context }))
  return outcomes
}

const hasDirectChecks = (item) => enabledDirect(item).length > 0
  && (item.directSchedules?.length ?? 0) > 0

const tickMode = async ({ mode, item, itemVersion, now, db, deps, log, claudeLockPath }) => {
  const lowerBound = latestOf([
    lastSuccessAt({ db, itemId: item.id, mode }),
    lastSkippedAt({ db, itemId: item.id, mode })
  ])
  const slot = dueSlot({
    schedules: schedulesFor({ item, mode }),
    lastSuccessAt: lowerBound ? new Date(lowerBound) : null,
    now
  })
  if (!slot) return { itemId: item.id, mode, action: 'not-due' }
  if (hasRecentFailure({ db, item, now, mode })) {
    log(`${item.id} skipped ${mode}: last run failed under 2 hours ago`)
    return { itemId: item.id, mode, action: 'skipped-recent-failure', slotAt: slot }
  }
  const run = () => runItem({
    item, itemVersion, trigger: 'tick', now, db, deps, slotAt: slot, mode
  })
  if (mode !== RESEARCH_MODE) {
    return { itemId: item.id, mode, action: 'ran', slotAt: slot, result: await run() }
  }
  const cap = capStatus({ db, now })
  if (cap.reached) {
    log(`${item.id} skipped research: monthly AI cap reached (${cap.used} of ${cap.cap})`)
    await noticeCapReached({ db, now, cap, deps, log })
    return { itemId: item.id, mode, action: 'skipped-monthly-cap', slotAt: slot }
  }
  const guard = currentGuard({ db, now })
  if (!guard.allow) {
    const reason = skipReason(guard)
    recordSkippedRun({
      db, itemId: item.id, trigger: 'tick', slotAt: slot.toISOString(), at: now.toISOString(),
      mode, itemVersion, reason
    })
    log(`${item.id} skipped research: ${reason}`)
    return { itemId: item.id, mode, action: 'skipped-claude-guard', slotAt: slot, reason }
  }
  try {
    const result = await withClaudeLock({
      path: claudeLockPath, label: researchLabel(item), fn: run
    })
    return { itemId: item.id, mode, action: 'ran', slotAt: slot, result }
  } catch (error) {
    if (!(error instanceof LockHeldError)) throw error
    log(`${item.id} deferred ${mode}: AI busy (${error.label ?? 'another claude run'})`)
    return { itemId: item.id, mode, action: 'deferred-ai-busy', slotAt: slot }
  }
}

const noticeCapReached = async ({ db, now, cap, deps, log }) => {
  if (!takeCapNotice({ db, now })) return
  const send = deps.appNotice ?? defaultDeps.appNotice
  try {
    await send({
      db,
      now,
      title: 'Monthly AI cap reached',
      message: capReachedMessage(cap),
      click: settingsLink(dashboardUrlFrom(resolveSettings({ db })))
    })
  } catch (error) {
    log(`cap notice not sent: ${error.message}`)
  }
}

export const schedulesFor = ({ item, mode }) =>
  mode === DIRECT_MODE ? item.directSchedules ?? [] : item.schedules

const hasRecentFailure = ({ db, item, now, mode }) => {
  const failedAt = lastFailedRunAt({ db, itemId: item.id, mode })
  return failedAt !== null && now.getTime() - new Date(failedAt).getTime() < FAILURE_COOLDOWN_MS
}

const completeRun = async ({ context, result: collected }) => {
  const { item, now, db, runId, dryRun, log, mode, region } = context
  const memberships = membershipsFrom(resolveSettings({ db, item }))
  const result = withTuning({
    item,
    result: withMembershipGate({
      memberships,
      region,
      result: withCanonicalRetailers({ item, result: collected, region })
    })
  })
  const lastAlerts = lastAlertsFor({ db, itemId: item.id })
  const lastMutedAlerts = lastAlertsFor({ db, itemId: item.id, kind: MUTED_KIND })
  const lastCheckAlerts = lastAlertsFor({ db, itemId: item.id, kind: CHECK_KIND })
  const decision = decide({
    item, research: result.data, lastAlerts, lastMutedAlerts, lastCheckAlerts, region
  })
  const sendsAlerts = mode !== MANUAL_MODE
  const messages = {
    deal: sendsAlerts && decision.best
      ? formatDealMessage({ item, listing: decision.best.listing, region })
      : null,
    check: sendsAlerts && decision.checkNotice
      ? formatCheckMessage({ item, notice: decision.checkNotice, region })
      : null,
    muted: sendsAlerts && decision.mutedNotice
      ? formatMutedMessage({ item, notice: decision.mutedNotice, region })
      : null,
    heartbeat: sendsAlerts && heartbeatDue({ context }) ? formatHeartbeatMessage({
      item,
      lowest: decision.lowest,
      failedSources: decision.failedSources,
      qualifiedCount: decision.qualified.length,
      region
    }) : null
  }
  const delivery = { deal: null, check: null, muted: null, heartbeat: null }
  if (!dryRun) {
    const listings = markQualifying({ listings: result.data.listings, decision })
    insertListings({
      db,
      runId,
      itemId: item.id,
      checkedAt: now.toISOString(),
      listings,
      source: mode,
      currency: region.currency
    })
    insertListings({
      db,
      runId,
      itemId: item.id,
      checkedAt: now.toISOString(),
      listings: markQualifying({ listings: decision.kitListings, decision }),
      source: KIT_SOURCE,
      currency: region.currency
    })
    if (messages.deal) {
      delivery.deal = await sendAndRecord({
        context, kind: 'deal', alert: messages.deal, listing: decision.best.listing
      })
    }
    if (messages.check) {
      delivery.check = await sendAndRecord({
        context, kind: CHECK_KIND, alert: messages.check, listing: decision.checkNotice.listing
      })
    }
    if (messages.muted) {
      const { listing } = decision.mutedNotice
      delivery.muted = await sendAndRecord({
        context,
        kind: MUTED_KIND,
        alert: messages.muted,
        listing: { ...listing, category: listing.tuned }
      })
    }
    if (messages.heartbeat) {
      delivery.heartbeat = await sendAndRecord({
        context, kind: 'heartbeat', alert: messages.heartbeat, listing: decision.lowest
      })
    }
  }
  finishRun({
    db,
    runId,
    status: 'ok',
    finishedAt: new Date().toISOString(),
    costUsd: result.costUsd ?? null,
    research: result.data,
    decision
  })
  const dealStatus = describeSend(messages.deal, delivery.deal, dryRun)
  log(`run ${runId} ok: ${decision.qualified.length} qualified, deal ${dealStatus}`)
  return { runId, status: 'ok', dryRun, research: result.data, decision, messages, delivery }
}

const withCanonicalRetailers = ({ item, result, region }) => ({
  ...result,
  data: {
    ...result.data,
    listings: normaliseListings({ item, listings: result.data.listings, region })
  }
})

const withTuning = ({ item, result }) => ({
  ...result,
  data: { ...result.data, listings: applyTuning({ item, listings: result.data.listings }) }
})

const withMembershipGate = ({ memberships, region, result }) => ({
  ...result,
  data: {
    ...result.data,
    listings: gateByMemberships({ listings: result.data.listings, memberships, region })
  }
})

const heartbeatDue = ({ context }) => {
  const { item, db, now, mode, region } = context
  if (mode !== RESEARCH_MODE || !item.heartbeat?.monthly) return false
  const tz = item.schedules?.[0]?.tz ?? region.timeZone
  return !hasHeartbeatThisMonth({ db, itemId: item.id, now, tz })
}

const sendAndRecord = async ({ context, kind, alert, listing }) => {
  const { item, db, runId, now, deliver, log, region } = context
  const alertId = insertAlert({
    db,
    itemId: item.id,
    runId,
    kind,
    sentAt: now.toISOString(),
    retailer: listing?.retailer ?? null,
    category: listing?.category ?? null,
    effectivePrice: listing?.effectivePrice ?? null,
    currency: region.currency,
    url: listing?.url ?? alert.click ?? null,
    title: alert.title,
    message: alert.message,
    delivered: false
  })
  const outbound = withDashboardLink({ alert, kind, alertId, listing, context })
  const outcome = await safeDeliver({ deliver, item, alert: outbound, log, db })
  updateAlertDelivery({
    db,
    id: alertId,
    delivered: outcome.delivered,
    error: outcome.delivered ? null : String(outcome.error ?? 'delivery failed')
  })
  return outcome
}

const withDashboardLink = ({ alert, kind, alertId, listing, context }) => {
  const { item, db, region } = context
  const dashboardUrl = dashboardUrlFrom(resolveSettings({ db, item }))
  if (kind === CHECK_KIND) {
    return { ...alert, click: alertLink({ dashboardUrl, itemId: item.id, alertId }) }
  }
  if (kind === 'deal' || kind === MUTED_KIND) {
    const click = alertLink({ dashboardUrl, itemId: item.id, alertId })
    const trusted = listing && listingTrust({ item, listing, region }).trusted
    return trusted ? { ...alert, click, actions: listingActions(listing.url) } : { ...alert, click }
  }
  return { ...alert, click: itemLink({ dashboardUrl, itemId: item.id }) }
}

const safeDeliver = async ({ deliver, item, alert, log, db }) => {
  try {
    const { token, withheld } = ntfyTokenFor({ settings: resolveSettings({ db, item }), item })
    if (withheld) log(`ntfy token withheld: ${item.ntfy.server} is not the trusted ntfy server`)
    return await deliver({ item, alert, token, log })
  } catch (error) {
    return { delivered: false, error: error.message }
  }
}

const failRun = ({ context, error, costUsd = null }) => {
  const { db, runId, log } = context
  finishRun({
    db,
    runId,
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error,
    costUsd: costUsd ?? null
  })
  log(`run ${runId} failed: ${error}`)
  return { runId, status: 'failed', error, dryRun: context.dryRun }
}

const skipRun = ({ context, reason, costUsd = null }) => {
  const { db, runId, log } = context
  finishRun({
    db,
    runId,
    status: 'skipped',
    finishedAt: new Date().toISOString(),
    error: reason,
    costUsd: costUsd || null
  })
  log(`run ${runId} skipped: ${reason}`)
  return { runId, status: 'skipped', error: reason, dryRun: context.dryRun }
}

const markQualifying = ({ listings, decision }) => {
  const qualifiedKeys = new Set(decision.qualified.map(({ listing }) => listingKey(listing)))
  return listings.map((listing) => ({
    ...listing,
    qualifies: qualifiedKeys.has(listingKey(listing))
  }))
}

const listingKey = ({ retailer, title, url }) => `${retailer}|${title}|${url}`

const describeFailure = (result) => {
  const errors = result.errors?.length ? result.errors.join('; ') : 'research failed'
  return result.attempts ? `${errors} (after ${result.attempts} attempts)` : errors
}

const describeSend = (message, outcome, dryRun) => {
  if (!message) return 'none'
  if (dryRun) return 'not sent (dry-run)'
  return outcome?.delivered ? 'delivered' : 'undelivered'
}
