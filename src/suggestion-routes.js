import { botCheckOf } from './bot-checks.js'
import { insertFeedback } from './db.js'
import { activeRegion } from './region.js'
import { STATS_WINDOWS, categoryStats, siteStats } from './site-stats.js'
import {
  DISMISSED_REASON, RESTORED_REASON, dismissalRecord, latestDismissals
} from './suggestions.js'
import { failingSites, loadTuningInputs, tuningReports } from './tuning-data.js'
import { MAX_BY_LENGTH } from './tuning.js'
import { publicUrlProblem } from './url-rules.js'

export const MAX_SUGGESTION_ID_LENGTH = 400

export const addSuggestionRoutes = ({ app, db, now, getItems }) => {
  const findRecord = (id) => getItems().find((record) => record.id === id)
  const reportFor = (record) => tuningReports({ db, records: reportRecords(record), now: now() })
    .find(({ item }) => item.id === record.id).result
  const reportRecords = (record) => {
    const records = getItems().filter(({ status }) => status === 'active')
    return records.some(({ id }) => id === record.id) ? records : [...records, record]
  }

  app.get('/api/items/:id/suggestions', (req, res) => {
    const record = findRecord(req.params.id)
    if (!record) return notFound(res)
    res.json({ version: record.version, ...reportFor(record) })
  })

  app.get('/api/items/:id/site-stats', (req, res) => {
    const record = findRecord(req.params.id)
    if (!record) return notFound(res)
    const days = STATS_WINDOWS.includes(Number(req.query.days)) ? Number(req.query.days) : 30
    const at = now()
    const inputs = loadTuningInputs({ db, itemId: record.id, now: at })
    const item = record.config
    const region = activeRegion({ db })
    res.json({
      days,
      sites: siteStats({ item, runs: inputs.runs, alerts: inputs.alerts, now: at, days, region })
        .filter(({ kind, url }) => kind !== 'direct' || !publicUrlProblem(url))
        .map(({ checkTimes, eligibleUrls, ...row }) => ({ ...row, botCheck: botCheckOf(row) })),
      categories: categoryStats({ item, runs: inputs.runs, versions: inputs.versions, now: at,
        days, region }).map(({ sightingTimes, ...row }) => row)
    })
  })

  app.post('/api/items/:id/suggestions/dismiss', (req, res) => {
    const record = findRecord(req.params.id)
    if (!record) return notFound(res)
    const { suggestionId, by, permanent } = req.body ?? {}
    const who = cleanText(by, MAX_BY_LENGTH)
    if (!who) return res.status(400).json({ error: 'by: say who dismissed it' })
    const report = reportFor(record)
    const suggestion = [...report.suggestions, ...report.held, ...report.waiting]
      .find(({ id }) => id === suggestionId)
    if (!suggestion) return res.status(404).json({ error: 'No open suggestion with that id' })
    const feedbackId = insertFeedback({
      db, itemId: record.id, reason: DISMISSED_REASON, note: suggestion.title.slice(0, 200),
      by: who, itemVersion: record.version,
      changes: dismissalRecord({ suggestion, permanent: permanent === true }),
      at: now().toISOString()
    })
    res.status(201).json({ feedbackId })
  })

  app.post('/api/items/:id/suggestions/restore', (req, res) => {
    const record = findRecord(req.params.id)
    if (!record) return notFound(res)
    const { suggestionId, by } = req.body ?? {}
    const who = cleanText(by, MAX_BY_LENGTH)
    if (!who) return res.status(400).json({ error: 'by: say who restored it' })
    if (typeof suggestionId !== 'string' || suggestionId.length > MAX_SUGGESTION_ID_LENGTH) {
      return res.status(400).json({ error: 'suggestionId: expected a suggestion id' })
    }
    const inputs = loadTuningInputs({ db, itemId: record.id, now: now() })
    const latest = latestDismissals(inputs.feedback).get(suggestionId)
    if (latest?.reason !== DISMISSED_REASON) {
      return res.status(404).json({ error: 'That suggestion is not dismissed' })
    }
    const feedbackId = insertFeedback({
      db, itemId: record.id, reason: RESTORED_REASON, note: latest.note, by: who,
      itemVersion: record.version, changes: { suggestionId }, at: now().toISOString()
    })
    res.status(201).json({ feedbackId })
  })

  app.get('/api/tuning/failing-sites', (req, res) => {
    res.json(failingSites({ db, records: getItems(), now: now() }))
  })
}

const notFound = (res) => res.status(404).json({ error: 'Unknown item' })

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
