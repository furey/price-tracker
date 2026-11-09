import { regionProfile } from './regions/index.js'
import { resolveSettings } from './settings.js'

export const activeRegion = ({ db = null, env = process.env } = {}) => {
  const settings = resolveSettings({ db, env })
  return regionProfile({
    id: env.REGION,
    currency: settings.currency.value,
    locale: settings.locale.value,
    timeZone: settings.timeZone.value
  })
}
