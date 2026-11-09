export const UNRECOGNISED_WINDOW = 'unrecognised'
export const WEEKLY_WINDOW = 'seven_day'
export const SESSION_WINDOW = 'five_hour'
export const KEEP_DAYS = 90
export const HISTORY_DAYS = 14

export const parseRateLimitEvent = (event) => {
  const info = infoFrom(event)
  if (!isObject(info)) return unrecognised('no rate_limit_info object')
  const windows = info.unifiedWindows
  const hasWindows = isObject(windows)
  const hasStatus = typeof info.status === 'string'
  if (!hasWindows && !hasStatus) return unrecognised('no unifiedWindows and no status')
  const shared = sharedFields(info)
  const fromWindows = hasWindows ? Object.entries(windows).map(([name, value]) =>
    windowReading({ name, value, info, shared })) : []
  if (fromWindows.some((reading) => reading === null)) {
    return unrecognised('a window has no usable utilization')
  }
  const named = typeof info.rateLimitType === 'string' ? info.rateLimitType : null
  const statusOnly = hasStatus && named && !fromWindows.some(({ window }) => window === named)
    ? [{ ...shared, window: named, utilization: null, resetsAt: toIso(info.resetsAt),
      status: info.status }]
    : []
  const readings = [...fromWindows, ...statusOnly]
  if (readings.length === 0) return unrecognised('no windows')
  return { ok: true, readings }
}

export const recordRateLimit = ({ db, event, source, sourceId = null, now = new Date() }) => {
  const parsed = parseRateLimitEvent(event)
  const raw = JSON.stringify(infoFrom(event) ?? event ?? null)
  const rows = parsed.ok
    ? parsed.readings
    : [{ window: UNRECOGNISED_WINDOW, utilization: null, resetsAt: null, status: null,
      rateLimitType: null, isUsingOverage: null, overageStatus: null }]
  const insert = db.prepare(`
    INSERT INTO claude_usage (window_name, utilization, resets_at, status, rate_limit_type,
      is_using_overage, overage_status, raw_json, read_at, source, source_id)
    VALUES (:window, :utilization, :resetsAt, :status, :rateLimitType, :isUsingOverage,
      :overageStatus, :raw, :readAt, :source, :sourceId)`)
  rows.forEach((row) => insert.run({
    window: row.window,
    utilization: row.utilization,
    resetsAt: row.resetsAt,
    status: row.status,
    rateLimitType: row.rateLimitType,
    isUsingOverage: row.isUsingOverage === null ? null : Number(row.isUsingOverage),
    overageStatus: row.overageStatus,
    raw,
    readAt: now.toISOString(),
    source,
    sourceId: sourceId === null ? null : String(sourceId)
  }))
  pruneUsage({ db, now })
  return parsed
}

export const usageRecorder = ({ db, source, sourceId = null, now = () => new Date() }) =>
  (event) => recordRateLimit({ db, event, source, sourceId, now: now() })

export const latestReadings = ({ db }) => db.prepare(`
  SELECT * FROM claude_usage u
  WHERE window_name != :unrecognised AND id = (
    SELECT MAX(id) FROM claude_usage WHERE window_name = u.window_name)
  ORDER BY window_name`).all({ unrecognised: UNRECOGNISED_WINDOW }).map(toReading)

export const formatChanged = ({ db }) => {
  const row = db.prepare(`
    SELECT window_name FROM claude_usage ORDER BY id DESC LIMIT 1`).get()
  return row?.window_name === UNRECOGNISED_WINDOW
}

export const lastReadAt = ({ db }) => db.prepare(`
  SELECT MAX(read_at) AS at FROM claude_usage WHERE window_name != :unrecognised`)
  .get({ unrecognised: UNRECOGNISED_WINDOW }).at ?? null

export const usageHistory = ({
  db, window = WEEKLY_WINDOW, days = HISTORY_DAYS, now = new Date()
}) => {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString()
  const rows = db.prepare(`
    SELECT utilization, read_at FROM claude_usage
    WHERE window_name = :window AND read_at >= :since AND utilization IS NOT NULL
    ORDER BY read_at ASC, id ASC`).all({ window, since })
  return rows.map((row) => ({ at: row.read_at, utilization: row.utilization }))
}

export const pruneUsage = ({ db, now = new Date(), days = KEEP_DAYS }) => {
  const before = new Date(now.getTime() - days * DAY_MS).toISOString()
  return Number(db.prepare('DELETE FROM claude_usage WHERE read_at < :before')
    .run({ before }).changes)
}

export const percentOf = (utilization) => (typeof utilization === 'number'
  ? Math.round(utilization * 100)
  : null)

export const windowLabel = (window) => {
  if (window === WEEKLY_WINDOW) return 'weekly'
  if (window === SESSION_WINDOW) return 'five-hour'
  return String(window).replace(/_/g, ' ')
}

const DAY_MS = 86_400_000
const MAX_UTILIZATION = 2

const infoFrom = (event) => (isObject(event) && 'rate_limit_info' in event
  ? event.rate_limit_info
  : event)

const sharedFields = (info) => ({
  rateLimitType: typeof info.rateLimitType === 'string' ? info.rateLimitType : null,
  isUsingOverage: typeof info.isUsingOverage === 'boolean' ? info.isUsingOverage : null,
  overageStatus: typeof info.overageStatus === 'string' ? info.overageStatus : null
})

const windowReading = ({ name, value, info, shared }) => {
  if (!isObject(value)) return null
  const utilization = value.utilization
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null
  if (utilization < 0 || utilization > MAX_UTILIZATION) return null
  const appliesStatus = typeof info.status === 'string' && info.rateLimitType === name
  return {
    ...shared,
    window: name,
    utilization,
    resetsAt: toIso(value.resetsAt ?? (appliesStatus ? info.resetsAt : null)),
    status: appliesStatus ? info.status : statusOf(value)
  }
}

const statusOf = (value) => (typeof value.status === 'string' ? value.status : 'allowed')

const toIso = (seconds) => {
  const value = Number(seconds)
  if (seconds === null || seconds === undefined || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return new Date(value * 1000).toISOString()
}

const unrecognised = (reason) => ({ ok: false, reason, readings: [] })

const toReading = (row) => ({
  window: row.window_name,
  utilization: row.utilization,
  percent: percentOf(row.utilization),
  resetsAt: row.resets_at,
  status: row.status,
  rateLimitType: row.rate_limit_type,
  isUsingOverage: row.is_using_overage === null ? null : row.is_using_overage === 1,
  overageStatus: row.overage_status,
  readAt: row.read_at,
  source: row.source,
  sourceId: row.source_id
})

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
