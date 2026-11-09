import { Cron } from 'croner'

const MS_PER_DAY = 86_400_000
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const MAX_SLOTS_PER_SCAN = 100_000

export const slotsBetween = ({ schedule, after, until }) => {
  const { from, until: windowUntil } = windowBounds(schedule)
  const cron = makeCron(schedule)
  const slots = []
  let cursor = from && from.getTime() - 1 > after.getTime() ? new Date(from.getTime() - 1) : after
  while (slots.length < MAX_SLOTS_PER_SCAN) {
    const slot = cron.nextRun(cursor)
    if (!slot || slot > until) break
    if (windowUntil && slot >= windowUntil) break
    if (!from || slot >= from) slots.push(slot)
    cursor = slot
  }
  return slots
}

export const dueSlot = ({ schedules, lastSuccessAt, now, lookbackDays = 14 }) => {
  const lowerBound = lastSuccessAt
    ? new Date(lastSuccessAt)
    : new Date(now.getTime() - lookbackDays * MS_PER_DAY)
  const slots = schedules.flatMap((schedule) =>
    slotsBetween({ schedule, after: lowerBound, until: now }))
  return latest(slots)
}

export const nextSlot = ({ schedules, now, lookaheadDays = 400 }) => {
  const horizon = new Date(now.getTime() + lookaheadDays * MS_PER_DAY)
  const firsts = schedules.map((schedule) => firstSlotAfter({ schedule, now, horizon }))
  return earliest(firsts.filter(Boolean))
}

export const windowBounds = (schedule) => ({
  from: parseBoundary({ value: schedule.from, tz: schedule.tz }),
  until: parseBoundary({ value: schedule.until, tz: schedule.tz })
})

const firstSlotAfter = ({ schedule, now, horizon }) => {
  const { from, until } = windowBounds(schedule)
  const cron = makeCron(schedule)
  const start = from && from.getTime() - 1 > now.getTime() ? new Date(from.getTime() - 1) : now
  const slot = cron.nextRun(start)
  if (!slot || slot > horizon) return null
  if (until && slot >= until) return null
  return slot
}

const makeCron = (schedule) => new Cron(schedule.cron, { timezone: schedule.tz, paused: true })

const parseBoundary = ({ value, tz }) => {
  if (!value) return null
  const dateOnly = DATE_ONLY.exec(value)
  if (!dateOnly) return new Date(value)
  const [, year, month, day] = dateOnly.map(Number)
  return zonedMidnightToUtc({ year, month, day, tz })
}

const zonedMidnightToUtc = ({ year, month, day, tz }) => {
  const asIfUtc = Date.UTC(year, month - 1, day)
  const firstGuess = asIfUtc - zoneOffsetMs({ instantMs: asIfUtc, tz })
  const secondGuess = asIfUtc - zoneOffsetMs({ instantMs: firstGuess, tz })
  return new Date(secondGuess)
}

const zoneOffsetMs = ({ instantMs, tz }) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }).formatToParts(new Date(instantMs))
  const field = (type) => Number(parts.find((part) => part.type === type).value)
  const localAsUtc = Date.UTC(
    field('year'), field('month') - 1, field('day'),
    field('hour'), field('minute'), field('second')
  )
  return localAsUtc - Math.floor(instantMs / 1000) * 1000
}

const latest = (dates) => dates.length
  ? new Date(Math.max(...dates.map((date) => date.getTime())))
  : null

const earliest = (dates) => dates.length
  ? new Date(Math.min(...dates.map((date) => date.getTime())))
  : null
