import { DEFAULT_REGION } from './regions/index.js'

export const SALE_LEAD_DAYS = 14
export const SALE_TAIL_DAYS = 7

export const saleEventsFor = ({ year, region = DEFAULT_REGION }) =>
  region.saleEvents({ year, nthWeekday, addDays })

export const saleWindows = ({ item, year, region = DEFAULT_REGION }) => [
  ...[year - 1, year, year + 1]
    .flatMap((eventYear) => saleEventsFor({ year: eventYear, region }))
    .map(({ name, date }) => ({
      name, from: addDays(date, -SALE_LEAD_DAYS), until: addDays(date, SALE_TAIL_DAYS)
    })),
  ...(item?.sources?.seasonalSearches ?? []).map(({ phrase, from, until }) => ({
    name: `seasonal search "${phrase}"`,
    from: String(from).slice(0, 10),
    until: addDays(String(until).slice(0, 10), -1)
  }))
].filter(({ from, until }) => isDay(from) && isDay(until) && from <= until)

export const saleWindowAt = ({ item, today, region = DEFAULT_REGION }) => {
  const windows = saleWindows({ item, year: Number(today.slice(0, 4)), region })
  const covering = windows.filter(({ from, until }) => from <= today && today <= until)
  if (covering.length === 0) return null
  const names = new Set(covering.map(({ name }) => name))
  let until = covering.reduce((latest, window) => maxDay(latest, window.until), today)
  let extended = true
  while (extended) {
    const next = windows.filter((window) => window.from <= addDays(until, 1)
      && window.until > until)
    extended = next.length > 0
    next.forEach((window) => names.add(window.name))
    until = next.reduce((latest, window) => maxDay(latest, window.until), until)
  }
  return { names: [...names], until }
}

export const localDay = ({ now, tz = DEFAULT_REGION.timeZone }) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)

export const addDays = (day, count) => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

const nthWeekday = ({ year, month, weekday, n }) => {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)).toISOString().slice(0, 10)
}

const maxDay = (a, b) => (a > b ? a : b)

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
