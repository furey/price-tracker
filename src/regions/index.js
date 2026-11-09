import { au } from './au.js'
import { generic } from './generic.js'
import { us } from './us.js'

export const DEFAULT_REGION = au

export const regionProfile = ({ id, currency, locale, timeZone } = {}) => {
  const key = String(id ?? '').trim().toLowerCase() || DEFAULT_REGION_ID
  const base = REGIONS[key]
  if (!base) {
    throw new Error(`Unknown REGION "${id}". Known: ${Object.keys(REGIONS).join(', ')}`)
  }
  return {
    ...base,
    currency: currency || base.currency,
    locale: locale || base.locale,
    timeZone: timeZone || base.timeZone
  }
}

export const isHomeHost = ({ region = DEFAULT_REGION, url }) => {
  const host = hostnameOf(url)
  return Boolean(host) && region.homeHostSuffixes.some((suffix) => host.endsWith(suffix))
}

export const publicRegion = (region = DEFAULT_REGION) => ({
  id: region.id,
  country: region.country,
  currency: region.currency,
  locale: region.locale,
  timeZone: region.timeZone
})

const hostnameOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

const REGIONS = { au, us, generic }

const DEFAULT_REGION_ID = 'au'
