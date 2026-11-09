import { monthlyRuns, runsUntil, localToday } from './draft-schedule.js'
import { activeRegion } from './region.js'
import { windowBounds } from './schedule.js'
import { aiMonthlyCap } from './settings.js'
import { itemRecords } from './item-store.js'

export const FALLBACK_COST_USD = 1.4
export const FALLBACK_MINUTES = 9
export const SAMPLE_RUNS = 10

export const CAP_NOTICE_KEY = 'aiCapNoticeMonth'

export const capStatus = ({ db, now = new Date(), env = process.env }) => {
  const { key, start, end } = monthBounds({ now, tz: activeRegion({ db, env }).timeZone })
  const used = Number(db.prepare(`
    SELECT COUNT(*) AS count FROM runs
    WHERE mode = 'research' AND status != 'skipped'
      AND started_at >= :start AND started_at < :end`)
    .get({ start: start.toISOString(), end: end.toISOString() }).count)
  const cap = aiMonthlyCap({ db, env })
  return { month: key, used, cap, reached: used >= cap, resetsAt: end.toISOString() }
}

export const monthUsage = ({ db, now = new Date(), env = process.env }) => {
  const status = capStatus({ db, now, env })
  const end = new Date(status.resetsAt)
  const scheduled = itemRecords({ db, now })
    .filter((record) => record.status === 'active')
    .reduce((sum, record) => sum + runsUntil({
      schedules: record.config.schedules ?? [], now, until: new Date(end.getTime() - 1)
    }), 0)
  return { ...status, scheduled, projected: status.used + scheduled }
}

export const takeCapNotice = ({ db, now = new Date() }) => {
  const { key } = monthBounds(now)
  const row = db.prepare('SELECT value FROM settings WHERE key = :key')
    .get({ key: CAP_NOTICE_KEY })
  if (row?.value === key) return false
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :at)
    ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :at`)
    .run({ key: CAP_NOTICE_KEY, value: key, at: now.toISOString() })
  return true
}

export const capReachedMessage = (usage) =>
  `This month's AI research cap is used up (${usage.used} of ${usage.cap} runs). `
  + 'Scheduled AI checks pause until the 1st of next month; free checks continue. '
  + 'Raise the cap in Settings to resume now.'

export const usageSummary = ({ db, now = new Date(), env = process.env, excludeId = null }) => {
  const items = itemRecords({ db, now })
    .filter((record) => record.status === 'active' && record.id !== excludeId)
    .map((record) => ({
      id: record.id,
      name: record.config.name,
      runs: monthlyRuns({ schedules: record.config.schedules ?? [], now })
    }))
  return {
    cap: aiMonthlyCap({ db, env }),
    items,
    total: items.reduce((sum, { runs }) => sum + runs, 0),
    perRun: perRunAverages(db),
    month: monthUsage({ db, now, env })
  }
}

export const capCheck = ({ db, config, now = new Date(), env = process.env, excludeId = null }) => {
  const usage = usageSummary({ db, now, env, excludeId })
  const runs = monthlyRuns({ schedules: config.schedules ?? [], now })
  const total = usage.total + runs
  return {
    ok: total <= usage.cap,
    runs,
    others: usage.total,
    total,
    cap: usage.cap,
    message: total <= usage.cap ? null : capMessage({ runs, total, cap: usage.cap })
  }
}

export const perRunAverages = (db) => {
  const rows = db.prepare(`
    SELECT cost_usd, started_at, finished_at FROM runs
    WHERE mode = 'research' AND status = 'ok' AND cost_usd IS NOT NULL AND cost_usd > 0
      AND finished_at IS NOT NULL
    ORDER BY id DESC LIMIT :limit`).all({ limit: SAMPLE_RUNS })
  if (rows.length === 0) {
    return { costUsd: FALLBACK_COST_USD, minutes: FALLBACK_MINUTES, sampleSize: 0 }
  }
  const minutes = rows.map((row) =>
    (Date.parse(row.finished_at) - Date.parse(row.started_at)) / 60000)
  return {
    costUsd: round(average(rows.map((row) => row.cost_usd)), 2),
    minutes: round(average(minutes), 1),
    sampleSize: rows.length
  }
}

const monthBounds = ({ now, tz }) => {
  const [year, month] = localToday(now, tz).split('-').map(Number)
  const next = month === 12 ? [year + 1, 1] : [year, month + 1]
  const first = ([y, m]) => `${y}-${String(m).padStart(2, '0')}-01`
  return {
    key: first([year, month]).slice(0, 7),
    start: windowBounds({ from: first([year, month]), tz }).from,
    end: windowBounds({ from: first(next), tz }).from
  }
}

const capMessage = ({ runs, total, cap }) =>
  `This item needs ${runs} AI runs in the next 30 days. With your other items that makes `
  + `${total}, over the monthly cap of ${cap}. Pick a lighter schedule, pause another item, `
  + 'or raise the cap in Settings.'

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places
