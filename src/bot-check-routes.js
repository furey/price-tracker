import { BOT_CHECK_SEEN_REASON, botCheckFlags, seenKey, seenRecord } from './bot-checks.js'
import { inTransaction, insertFeedback } from './db.js'
import { activeRegion } from './region.js'
import { siteStats } from './site-stats.js'
import { loadTuningInputs } from './tuning-data.js'
import { MAX_BY_LENGTH } from './tuning.js'

export const BOT_CHECK_DAYS = 30
export const MAX_SEEN_CHECKS = 200
export const DEFAULT_SEEN_BY = 'Dashboard'

export const addBotCheckRoutes = ({ app, db, now, getItems }) => {
  const openFlags = () => unseenBotChecks({ db, records: getItems(), now: now() })

  app.get('/api/bot-checks', (req, res) => {
    res.json({ checks: openFlags() })
  })

  app.post('/api/bot-checks/seen', (req, res) => {
    const { checks, by } = req.body ?? {}
    if (!Array.isArray(checks) || checks.length === 0 || checks.length > MAX_SEEN_CHECKS) {
      return res.status(400).json({ error: `checks: expected 1 to ${MAX_SEEN_CHECKS} bot checks` })
    }
    const open = new Map(openFlags().map((flag) => [seenKey(flag), flag]))
    const matched = [...new Set(checks.map((check) => seenKey(check ?? {})))]
      .map((key) => open.get(key))
      .filter(Boolean)
    const who = cleanText(by, MAX_BY_LENGTH) || DEFAULT_SEEN_BY
    const at = now().toISOString()
    inTransaction(db, () => matched.forEach((flag) => insertFeedback({
      db, itemId: flag.itemId, reason: BOT_CHECK_SEEN_REASON, note: flag.name.slice(0, 200),
      by: who, changes: seenRecord(flag), at
    })))
    res.status(201).json({ seen: matched.length })
  })
}

export const unseenBotChecks = ({ db, records, now }) => {
  const region = activeRegion({ db })
  return records
    .filter(({ status }) => status === 'active')
    .flatMap((record) => {
      const inputs = loadTuningInputs({ db, itemId: record.id, now })
      const rows = siteStats({
        item: record.config, runs: inputs.runs, now, days: BOT_CHECK_DAYS, region
      })
      return botCheckFlags({ item: record.config, rows, feedback: inputs.feedback })
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
