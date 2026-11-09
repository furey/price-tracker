import { nextSlot, slotsBetween } from '../../src/schedule.js'
import { currentRegion } from './format.js'

export const regionTimeZone = () => currentRegion().timeZone

export const PRESETS = [
  { id: 'daily', label: 'Daily' },
  { id: 'twice-daily', label: 'Twice daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'days', label: 'On chosen days' },
  { id: 'custom', label: 'Custom cron' }
]

export const DAYS = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' }
]

export const parseSchedule = (schedule) => {
  const base = {
    cron: schedule.cron,
    tz: schedule.tz ?? regionTimeZone(),
    from: dateOnly(schedule.from),
    until: dateOnly(schedule.until)
  }
  const match = SIMPLE_CRON.exec(schedule.cron?.trim() ?? '')
  if (!match) return { ...base, preset: 'custom', times: ['07:30', '19:30'], days: [2, 5] }
  const [, minute, hourList, dayList] = match
  const hours = hourList.split(',').map(Number)
  const times = hours.map((hour) => toTime({ hour, minute: Number(minute) }))
  const preset = presetFor({ hours, dayList })
  if (!preset) return { ...base, preset: 'custom', times: ['07:30', '19:30'], days: [2, 5] }
  const days = preset === 'days' ? dayList.split(',').map(Number) : [2, 5]
  const paddedTimes = times.length === 1 ? [times[0], laterTime(times[0])] : times
  return { ...base, preset, times: paddedTimes, days }
}

export const buildSchedule = (row) => {
  const cron = buildCron(row)
  const schedule = { cron: cron ?? row.cron ?? '', tz: row.tz ?? regionTimeZone() }
  if (row.from) schedule.from = row.from
  if (row.until) schedule.until = row.until
  return schedule
}

export const buildCron = ({ preset, times, days, cron }) => {
  if (preset === 'custom') return cron?.trim() ?? ''
  const [first, second] = times.map(fromTime)
  if (!first) return null
  if (preset === 'daily') return `${first.minute} ${first.hour} * * *`
  if (preset === 'weekdays') return `${first.minute} ${first.hour} * * 1-5`
  if (preset === 'days') {
    if (days.length === 0) return null
    return `${first.minute} ${first.hour} * * ${[...days].sort((a, b) => a - b).join(',')}`
  }
  if (!second || second.minute !== first.minute || second.hour === first.hour) return null
  const hours = [first.hour, second.hour].sort((a, b) => a - b).join(',')
  return `${first.minute} ${hours} * * *`
}

export const presetProblem = (row) => {
  if (row.preset === 'custom') return row.cron?.trim() ? null : 'Enter a cron pattern.'
  if (row.preset === 'days' && row.days.length === 0) return 'Pick at least one day.'
  if (row.preset !== 'twice-daily') return null
  const [first, second] = row.times.map(fromTime)
  if (!first || !second) return 'Pick both times.'
  if (first.hour === second.hour) return 'Pick two different hours.'
  if (first.minute !== second.minute) return 'Both times need the same minutes past the hour.'
  return null
}

export const describeSchedule = (schedule) => {
  const parsed = parseSchedule(schedule)
  const when = describeWhen(parsed)
  const window = [
    parsed.from && `from ${formatDay(parsed.from)}`,
    parsed.until && `until ${formatDay(parsed.until)}`
  ].filter(Boolean)
  return [when, ...window].join(', ')
}

export const upcomingSlots = ({ schedules, now = new Date(), count = 3 }) => {
  const slots = []
  let cursor = now
  while (slots.length < count) {
    const slot = safely(() => nextSlot({ schedules, now: cursor }))
    if (!slot) break
    slots.push(slot)
    cursor = slot
  }
  return slots
}

export const slotCount = ({ schedules, now = new Date(), days = 30 }) => {
  const until = new Date(now.getTime() + days * 86_400_000)
  const instants = new Set(schedules.flatMap((schedule) =>
    safely(() => slotsBetween({ schedule, after: now, until })) ?? [])
    .map((slot) => slot.getTime()))
  return instants.size
}

export const formatTime12 = (time) => {
  const parsed = fromTime(time)
  if (!parsed) return time
  const suffix = parsed.hour < 12 ? 'am' : 'pm'
  const hour = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12
  return `${hour}:${String(parsed.minute).padStart(2, '0')} ${suffix}`
}

const SIMPLE_CRON = /^(\d{1,2}) (\d{1,2}(?:,\d{1,2})?) \* \* (\*|1-5|[0-6](?:,[0-6])*)$/

const presetFor = ({ hours, dayList }) => {
  if (dayList === '*') return hours.length === 1 ? 'daily' : 'twice-daily'
  if (hours.length !== 1) return null
  return dayList === '1-5' ? 'weekdays' : 'days'
}

const describeWhen = (parsed) => {
  const [first, second] = parsed.times.map(formatTime12)
  if (parsed.preset === 'daily') return `Daily at ${first}`
  if (parsed.preset === 'twice-daily') return `Twice daily at ${first} and ${second}`
  if (parsed.preset === 'weekdays') return `Weekdays at ${first}`
  if (parsed.preset === 'days') return `${dayNames(parsed.days)} at ${first}`
  return `Cron ${parsed.cron}`
}

const dayNames = (days) => DAYS
  .filter((day) => days.includes(day.value))
  .map((day) => day.short)
  .join(', ')

const formatDay = (day) => new Intl.DateTimeFormat(currentRegion().locale, {
  timeZone: 'UTC', day: 'numeric', month: 'short'
}).format(new Date(`${day}T00:00:00Z`))

const dateOnly = (value) => (value ? String(value).slice(0, 10) : '')

const toTime = ({ hour, minute }) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

const fromTime = (time) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time ?? '')
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

const laterTime = (time) => {
  const parsed = fromTime(time)
  return toTime({ hour: (parsed.hour + 12) % 24, minute: parsed.minute })
}

const safely = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}
