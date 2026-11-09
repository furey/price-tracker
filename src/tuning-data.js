import { feedbackFor } from './db.js'
import { withCurrentKeys } from './legacy-keys.js'
import { activeRegion } from './region.js'
import { siteStats } from './site-stats.js'
import {
  RULE_WINDOW_DAYS, failingEverywhere, suggestTuning, withGlobalSites
} from './suggestions.js'

export const INPUT_DAYS = 90
export const FEEDBACK_LIMIT = 1000

export const loadTuningInputs = ({ db, itemId, now, days = INPUT_DAYS }) => {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  return {
    runs: statsRuns({ db, itemId, since }),
    alerts: statsAlerts({ db, itemId, since }),
    feedback: feedbackFor({ db, itemId, limit: FEEDBACK_LIMIT }),
    versions: versionCategories({ db, itemId })
  }
}

export const tuningReports = ({ db, records, now }) => {
  const region = activeRegion({ db })
  const perItem = records.map((record) => {
    const inputs = loadTuningInputs({ db, itemId: record.id, now })
    return {
      item: record.config,
      active: record.status === 'active',
      inputs,
      result: suggestTuning({ item: record.config, ...inputs, now, region })
    }
  })
  const active = perItem.filter(({ active }) => active)
  const global = new Map(withGlobalSites(active).map(({ item, result }) => [item.id, result]))
  return perItem.map((entry) => ({ ...entry, result: global.get(entry.item.id) ?? entry.result }))
}

export const failingSites = ({ db, records, now }) => failingEverywhere(records
  .filter(({ status }) => status === 'active')
  .map((record) => ({
    item: record.config,
    sites: siteStats({
      item: record.config,
      runs: loadTuningInputs({ db, itemId: record.id, now }).runs,
      now,
      days: RULE_WINDOW_DAYS,
      region: activeRegion({ db })
    })
  })))

const DAY_MS = 86_400_000

const statsRuns = ({ db, itemId, since }) => db.prepare(`
  SELECT id, mode, "trigger", status, started_at, item_version, cost_usd, research_json,
    decision_json
  FROM runs
  WHERE item_id = :itemId AND started_at >= :since AND status IN ('ok', 'failed')
  ORDER BY started_at, id`).all({ itemId, since })
  .map((row) => ({
    id: row.id,
    mode: row.mode,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.started_at,
    itemVersion: row.item_version,
    costUsd: row.cost_usd,
    research: parseJson(row.research_json),
    decision: parseJson(row.decision_json)
  }))

const statsAlerts = ({ db, itemId, since }) => db.prepare(`
  SELECT id, kind, sent_at, retailer, category, delivered
  FROM alerts
  WHERE item_id = :itemId AND sent_at >= :since
  ORDER BY sent_at, id`).all({ itemId, since })
  .map((row) => ({
    id: row.id,
    kind: row.kind,
    sentAt: row.sent_at,
    retailer: row.retailer,
    category: row.category,
    delivered: row.delivered === 1
  }))

const versionCategories = ({ db, itemId }) => db.prepare(`
  SELECT version, config_json FROM item_versions WHERE item_id = :itemId ORDER BY version`)
  .all({ itemId })
  .map((row) => ({
    version: row.version,
    categoryIds: (parseJson(row.config_json)?.categories ?? []).map(({ id }) => id)
  }))

const parseJson = (text) => {
  if (typeof text !== 'string') return null
  try {
    return withCurrentKeys(JSON.parse(text))
  } catch {
    return null
  }
}
