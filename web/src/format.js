import { DEFAULT_REGION, publicRegion } from '../../src/regions/index.js'
import { formatPrice } from '../../src/text.js'

const active = { region: publicRegion(DEFAULT_REGION), formats: null }

export const configureRegion = (region) => {
  const base = publicRegion(DEFAULT_REGION)
  active.region = {
    ...base,
    ...Object.fromEntries(Object.entries(region ?? {}).filter(([, value]) => value))
  }
  active.formats = null
}

export const currentRegion = () => active.region

export const formatMoney = (value) => {
  if (typeof value !== 'number') return '-'
  const { currency, locale } = active.region
  return formatPrice({ amount: value, currency, locale })
}

export const currencySymbol = () => {
  const { currency, locale } = active.region
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0)
    .find(({ type }) => type === 'currency')?.value ?? currency
}

export const timeZoneLabel = () => {
  const city = active.region.timeZone.split('/').at(-1).replaceAll('_', ' ')
  return city === 'UTC' ? 'UTC' : `${city} time`
}

export const formatDateTime = (iso) => {
  if (!iso) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '-' : formats().dateTime.format(date)
}

export const dayToMs = (day) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`)

export const formatShortDay = (ms) => formats().shortDay.format(new Date(ms))

export const formatLongDay = (ms) => formats().longDay.format(new Date(ms))

export const formatRelative = (iso) => {
  if (!iso) return ''
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ]
  const [unit, size] = units.find(([, unitSize]) => Math.abs(seconds) >= unitSize) ?? units[2]
  return formats().relative.format(Math.round(seconds / size), unit)
}

export const formatCost = (value) =>
  typeof value === 'number' ? `$${value.toFixed(2)}` : '-'

export const formatFullDay = (day) => formats().fullDay.format(new Date(dayToMs(day)))

export const formatDayMonth = (day) => formats().dayMonth.format(new Date(dayToMs(day)))

export const formatDayMonthTime = (iso) =>
  compactMeridiem(formats().localDayMonthTime.format(new Date(iso)))

export const formatTime = (iso) => compactMeridiem(formats().localTime.format(new Date(iso)))

export const formatPausedUntil = (iso) => formats().localDayMonth.format(new Date(iso))

export const pauseLabel = ({ status, pausedUntil }) => {
  if (status === 'archived') return 'Archived'
  if (status !== 'paused') return null
  return pausedUntil ? `Paused until ${formatPausedUntil(pausedUntil)}` : 'Paused'
}

export const SOURCE_LABELS = {
  research: 'AI research',
  direct: 'Free check',
  manual: 'Chrome',
  kit: 'Kit'
}

export const sourceLabel = (source) => SOURCE_LABELS[source] ?? source ?? 'Unknown'

export const formatShortWhen = (iso) => {
  if (!iso) return ''
  const parts = formats().localWeekdayTime.formatToParts(new Date(iso))
  const part = (type) => parts.find((entry) => entry.type === type)?.value ?? ''
  const minutes = part('minute') === '00' ? '' : `:${part('minute')}`
  return `${part('weekday')} ${part('hour')}${minutes} ${part('dayPeriod').toLowerCase()}`
}

const formats = () => {
  if (!active.formats) active.formats = buildFormats(active.region)
  return active.formats
}

const buildFormats = ({ locale, timeZone }) => {
  const date = (options) => new Intl.DateTimeFormat(locale, options)
  return {
    dateTime: date({
      timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric',
      minute: '2-digit'
    }),
    shortDay: date({ timeZone: 'UTC', day: 'numeric', month: 'short' }),
    longDay: date({
      timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    }),
    relative: new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }),
    fullDay: date({
      timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }),
    dayMonth: date({ timeZone: 'UTC', day: 'numeric', month: 'short' }),
    localDayMonthTime: date({
      timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'
    }),
    localTime: date({ timeZone, hour: 'numeric', minute: '2-digit' }),
    localDayMonth: date({ timeZone, day: 'numeric', month: 'short' }),
    localWeekdayTime: date({
      timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true
    })
  }
}

const compactMeridiem = (text) =>
  text.replace(/\s(am|pm)/i, (_, meridiem) => meridiem.toLowerCase())
