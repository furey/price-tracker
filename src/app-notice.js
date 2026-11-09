import { sendNtfy } from './notify.js'
import { dashboardUrlFrom, ensureAppTopic, ntfyTokenFor, resolveSettings } from './settings.js'
import { settingsLink } from './links.js'
import { itemRecords } from './item-store.js'

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh'

export const sendAppNotice = async ({
  db, title, message, click = null, now = new Date(), send = sendNtfy, env = process.env
}) => {
  const topic = ensureAppTopic({ db, env, now })
  const settings = resolveSettings({ db, env })
  const { server } = ntfyBase(db)
  const { token } = ntfyTokenFor({ settings, item: { ntfy: { server } }, env })
  return send({
    server,
    topic,
    token,
    title,
    message,
    priority: 3,
    ...(click ? { click } : {})
  })
}

export const APP_TEST_NOTICE = {
  title: 'Price Tracker test',
  message: 'App notices (drafts, AI pauses, the monthly cap) will arrive here.'
}

export const sendAppTestNotice = async ({ db, now = new Date(), send, env = process.env }) => {
  const click = settingsLink(dashboardUrlFrom(resolveSettings({ db, env })))
  const outcome = await sendAppNotice({ db, ...APP_TEST_NOTICE, click, now, env, send })
  return {
    delivered: outcome.delivered === true,
    sentAt: now.toISOString(),
    ...(outcome.delivered ? {} : { error: String(outcome.error ?? 'delivery failed') })
  }
}

export const ntfyBase = (db) => {
  const withToken = itemRecords({ db }).find((record) => record.config.ntfy?.tokenEnv)
  if (!withToken) return { server: DEFAULT_NTFY_SERVER }
  const { server, tokenEnv } = withToken.config.ntfy
  return { server, tokenEnv }
}
