import { SESSION_WINDOW, latestReadings, percentOf, windowLabel } from './claude-usage.js'
import { claudeLimits, dashboardUrlFrom, resolveSettings } from './settings.js'
import { settingsLink } from './links.js'
import { activeRegion } from './region.js'
import { NOT_CONNECTED, claudeConnection } from './claude-connection.js'

export const GUARD_NOTICE_KEY = 'claudeGuardNotice'

export const guardDecision = ({ readings, limits, now = new Date(), connected = true }) => {
  if (!connected) return { allow: false, reason: 'disconnected', resumesAt: null }
  if (limits.paused) return { allow: false, reason: 'paused', resumesAt: null }
  const blocks = readings
    .filter((reading) => isCurrent({ reading, now }))
    .map((reading) => blockFor({ reading, limits }))
    .filter(Boolean)
  if (blocks.length === 0) return { allow: true, reason: null, resumesAt: null }
  return blocks.reduce((latest, block) =>
    (Date.parse(block.resumesAt ?? 0) > Date.parse(latest.resumesAt ?? 0) ? block : latest))
}

export const reserveFor = ({ window, limits }) => (window === SESSION_WINDOW
  ? limits.sessionReserve
  : limits.weeklyReserve)

export const guardLine = (decision) => {
  if (decision.allow) return 'AI checks running'
  if (decision.reason === 'disconnected') return 'AI checks waiting for Claude'
  if (decision.reason === 'paused') return 'All AI paused by you'
  const until = decision.resumesAt ? ` until ${shortWhen(decision.resumesAt)}` : ''
  if (decision.reason === 'limited') {
    return `AI checks paused: Claude ${windowLabel(decision.window)} limit reached${until}`
  }
  return `AI checks paused: above your ${decision.reserve}% reserve${until}`
}

export const guardMessage = (decision) => {
  if (decision.allow) return null
  if (decision.reason === 'disconnected') return CONNECT_MESSAGE
  if (decision.reason === 'paused') {
    return 'Waiting: all AI is paused by you. Resume AI on the dashboard or in Settings.'
  }
  const resumes = decision.resumesAt ? ` Resumes after ${longWhen(decision.resumesAt)}.` : ''
  return `Waiting: ${usageClause(decision)}.${resumes}`
}

export const skipReason = (decision) => {
  if (decision.reason === 'disconnected') return `Skipped: ${NOT_CONNECTED}`
  if (decision.reason === 'paused') return 'Skipped: all AI paused by you'
  const resumes = decision.resumesAt ? ` (resumes after ${longWhen(decision.resumesAt)})` : ''
  return `Skipped: ${usageClause(decision)}${resumes}`
}

export const stopReason = (decision) => decision.reason === 'limited'
  ? `Stopped early: Claude ${windowLabel(decision.window)} limit reached`
  : `Stopped early: ${windowLabel(decision.window)} usage ${decision.percent}% above `
    + `${decision.reserve}% reserve`

export const describeGuard = (decision) => ({
  ...decision,
  line: guardLine(decision),
  message: guardMessage(decision)
})

export const currentGuard = ({ db, now = new Date(), env = process.env }) => guardDecision({
  readings: latestReadings({ db }),
  limits: claudeLimits({ db, env }),
  now,
  connected: claudeConnection({ db, env }).connected
})

export const CONNECT_MESSAGE = `${NOT_CONNECTED}. Add a Claude login token in Settings to run `
  + 'AI research. Free checks keep running.'

export const noticeGuardChange = async ({ db, decision, now = new Date(), send, log }) => {
  const stored = readNotice(db)
  const notice = noticeFor({ decision, stored })
  if (!notice) return false
  writeNotice({ db, value: notice.state, now })
  try {
    await send({
      db,
      now,
      title: notice.title,
      message: notice.message,
      click: settingsLink(dashboardUrlFrom(resolveSettings({ db })))
    })
  } catch (error) {
    log?.(`Claude usage notice not sent: ${error.message}`)
  }
  return true
}

export const noticeFor = ({ decision, stored }) => {
  const usageBlock = !decision.allow && !['paused', 'disconnected'].includes(decision.reason)
  if (usageBlock) {
    const key = `${decision.window}|${decision.resumesAt ?? ''}`
    if (stored?.skipping && stored.key === key) return null
    return {
      state: { skipping: true, key },
      title: 'AI checks paused',
      message: `${capitalise(usageClause(decision))}. Scheduled AI price checks are paused`
        + `${decision.resumesAt ? ` until ${longWhen(decision.resumesAt)}` : ''}. `
        + 'Free price checks keep running.'
    }
  }
  if (decision.allow && stored?.skipping) {
    return {
      state: { skipping: false, key: null },
      title: 'AI checks resumed',
      message: 'Claude usage is back under your reserve. Scheduled AI price checks run again.'
    }
  }
  return null
}

const isCurrent = ({ reading, now }) =>
  !reading.resetsAt || Date.parse(reading.resetsAt) > now.getTime()

const blockFor = ({ reading, limits }) => {
  const base = { allow: false, window: reading.window, resumesAt: reading.resetsAt }
  if (reading.status && reading.status !== 'allowed') {
    return { ...base, reason: 'limited', percent: percentOf(reading.utilization), reserve: null }
  }
  if (typeof reading.utilization !== 'number') return null
  const reserve = reserveFor({ window: reading.window, limits })
  if (reading.utilization * 100 <= reserve) return null
  return { ...base, reason: 'reserve', percent: percentOf(reading.utilization), reserve }
}

const usageClause = (decision) => (decision.reason === 'limited'
  ? `your Claude ${windowLabel(decision.window)} usage limit is reached`
  : `your Claude ${windowLabel(decision.window)} usage is ${decision.percent}%, `
    + `above your ${decision.reserve}% reserve`)

const capitalise = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

const readNotice = (db) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = :key')
    .get({ key: GUARD_NOTICE_KEY })
  try {
    return row ? JSON.parse(row.value) : null
  } catch {
    return null
  }
}

const writeNotice = ({ db, value, now }) => {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :at)
    ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :at`)
    .run({ key: GUARD_NOTICE_KEY, value: JSON.stringify(value), at: now.toISOString() })
}

const longFormat = () => {
  const { locale, timeZone } = activeRegion()
  return new Intl.DateTimeFormat(locale, {
    timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric',
    minute: '2-digit', hour12: true
  })
}

const shortFormat = () => {
  const { locale, timeZone } = activeRegion()
  return new Intl.DateTimeFormat(locale, {
    timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true
  })
}

const longWhen = (iso) => {
  const part = partsOf({ format: longFormat(), iso })
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('hour')}:${part('minute')} `
    + part('dayPeriod').toLowerCase()
}

const shortWhen = (iso) => {
  const part = partsOf({ format: shortFormat(), iso })
  const minutes = part('minute') === '00' ? '' : `:${part('minute')}`
  return `${part('weekday')} ${part('hour')}${minutes} ${part('dayPeriod').toLowerCase()}`
}

const partsOf = ({ format, iso }) => {
  const parts = format.formatToParts(new Date(iso))
  return (type) => parts.find((entry) => entry.type === type)?.value ?? ''
}
