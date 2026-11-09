import { DEFAULT_REGION } from './regions/index.js'
import { nextSlot } from './schedule.js'

export const DEFAULT_TIME_ZONE = DEFAULT_REGION.timeZone
export const DEFAULT_DELIVERY_DAYS = 6
export const MAX_SALE_WINDOW_DAYS = 7
export const DEFAULT_PRESET = 'normal'
export const MONTH_DAYS = 30

export const SCHEDULE_PRESETS = [
  { id: 'light', label: 'Light', detail: 'AI check Mondays and Thursdays, daily in sale weeks' },
  { id: 'normal', label: 'Normal', detail: 'AI check daily, twice daily in sale weeks' },
  { id: 'keen', label: 'Keen', detail: 'AI check twice daily' }
]

export const PRESET_IDS = SCHEDULE_PRESETS.map(({ id }) => id)

export const buildPresetSchedules = ({
  preset, minute, endDate = null, saleWindows = [], tz = DEFAULT_TIME_ZONE
}) => {
  const base = PRESET_BASE[preset] ?? PRESET_BASE[DEFAULT_PRESET]
  const window = endDate ? { until: endDate } : {}
  const extraHour = PRESET_SALE_HOUR[preset]
  const extras = extraHour === undefined
    ? []
    : clampWindows({ windows: saleWindows, endDate }).map(({ from, until }) => ({
      cron: `${minute} ${extraHour} * * *`, tz, from, until
    }))
  return [{ cron: `${minute} ${base}`, tz, ...window }, ...extras]
}

export const buildDirectSchedules = ({ endDate = null, tz = DEFAULT_TIME_ZONE }) =>
  [{ cron: '30 7,19 * * *', tz, ...(endDate ? { until: endDate } : {}) }]

export const endDateFor = ({ needBy, today, deliveryDays = DEFAULT_DELIVERY_DAYS }) => {
  if (!isDay(needBy)) return null
  const earliest = addDays(today, 2)
  const end = addDays(needBy, -deliveryDays)
  return end < earliest ? earliest : end
}

export const saleWindowsFrom = ({ seasonalSearches = [], today, endDate = null }) =>
  mergeWindows(clampWindows({
    windows: seasonalSearches
      .filter((search) => isDay(search.from) && isDay(search.until))
      .map(({ from, until, phrase }) => ({ from, until, phrase })),
    endDate
  }).filter(({ until }) => until > today))

export const monthlyRuns = ({ schedules = [], now = new Date(), days = MONTH_DAYS }) =>
  runsUntil({ schedules, now, until: new Date(now.getTime() + days * 86_400_000) })

export const runsUntil = ({ schedules = [], now = new Date(), until }) => {
  const days = Math.ceil((until.getTime() - now.getTime()) / 86_400_000) + 1
  let count = 0
  let cursor = now
  while (count < 2000) {
    const slot = safely(() => nextSlot({ schedules, now: cursor, lookaheadDays: days }))
    if (!slot || slot.getTime() > until.getTime()) break
    count += 1
    cursor = slot
  }
  return count
}

export const minuteFor = (id) => {
  const total = [...String(id)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7)
  return 5 + (total % 50)
}

export const addDays = (day, offset) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export const localToday = (now = new Date(), timeZone = DEFAULT_TIME_ZONE) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)

const PRESET_BASE = {
  light: '7 * * 1,4',
  normal: '7 * * *',
  keen: '7,19 * * *'
}

const PRESET_SALE_HOUR = { light: 19, normal: 19 }

const clampWindows = ({ windows, endDate }) => windows
  .map(({ from, until, ...rest }) => {
    const end = endDate && until > endDate ? endDate : until
    const start = from < addDays(end, -MAX_SALE_WINDOW_DAYS)
      ? addDays(end, -MAX_SALE_WINDOW_DAYS)
      : from
    return { ...rest, from: start, until: end }
  })
  .filter(({ from, until }) => from < until)

const mergeWindows = (windows) => [...windows]
  .sort((a, b) => a.from.localeCompare(b.from))
  .reduce((merged, window) => {
    const last = merged.at(-1)
    if (!last || window.from > last.until) return [...merged, { ...window }]
    last.until = window.until > last.until ? window.until : last.until
    last.phrase = `${last.phrase}; ${window.phrase}`
    return merged
  }, [])

const DAY = /^\d{4}-\d{2}-\d{2}$/

const isDay = (value) => typeof value === 'string' && DAY.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const safely = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}
