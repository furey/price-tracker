import { randomBytes } from 'node:crypto'
import {
  DEFAULT_DASHBOARD_URL, normaliseDashboardUrl, validateDashboardUrl
} from './links.js'
import {
  defaultMemberships, formatMemberships, parseMemberships, validateMemberships
} from './memberships.js'
import { regionProfile } from './regions/index.js'

const DEFAULT_TOKEN_ENV = 'NTFY_ACCESS_TOKEN'
const TOKEN_ENV_PATTERN = /^NTFY_[A-Z0-9_]*$/
const DEFAULT_NTFY_ORIGIN = 'https://ntfy.sh'
const MASK = '••••••'
const MAX_TOKEN_LENGTH = 256
const MAX_SUBURB_LENGTH = 80
const MAX_AI_CAP = 1000
const MAX_CLAUDE_TOKEN_LENGTH = 512
const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/

export const DEFAULT_AI_MONTHLY_CAP = 150
export const DEFAULT_CLAUDE_RESERVE_PERCENT = 70
export const DEFAULT_CLAUDE_SESSION_RESERVE_PERCENT = 90
export const APP_TOPIC_PREFIX = 'pt-app'

export class SettingsError extends Error {
  constructor(errors) {
    super(`Invalid settings: ${errors.join('; ')}`)
    this.errors = errors
  }
}

export const SETTING_KEYS = [
  'ntfyToken', 'claudeOauthToken', 'deliveryPostcode', 'deliverySuburb', 'aiMonthlyCap',
  'claudeReservePercent', 'claudeSessionReservePercent', 'aiPaused', 'appTopic', 'memberships',
  'dashboardUrl', 'currency', 'locale', 'timeZone'
]

export const resolveSettings = ({ db, env = process.env, item }) => {
  const overrides = readOverrides(db)
  return Object.fromEntries(SETTING_KEYS.map((key) => [
    key,
    resolveOne({ key, overrides, env, item })
  ]))
}

export const setSetting = ({ db, key, value, now = new Date(), env = process.env }) => {
  const error = validateSetting({ key, value, env })
  if (error) throw new SettingsError([error])
  const cleaned = normaliseFor({ key, value: cleanValue(value) })
  if (cleaned === null) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    return
  }
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :updatedAt)
    ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :updatedAt`)
    .run({ key, value: cleaned, updatedAt: now.toISOString() })
}

export const setSettings = ({ db, changes, now = new Date(), env = process.env }) => {
  const errors = Object.entries(changes)
    .map(([key, value]) => validateSetting({ key, value, env }))
    .filter(Boolean)
  if (errors.length > 0) throw new SettingsError(errors)
  db.exec('BEGIN')
  try {
    for (const [key, value] of Object.entries(changes)) setSetting({ db, key, value, now, env })
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export const validateSetting = ({ key, value, env = process.env }) => {
  const definition = DEFINITIONS[key]
  if (!definition) return `${key}: unknown setting`
  if (value !== null && value !== undefined && typeof value !== 'string') {
    return `${key}: expected a string or null`
  }
  const cleaned = cleanValue(value)
  if (cleaned === null) return null
  const problem = definition.validate(cleaned, env)
  return problem ? `${key}: ${problem}` : null
}

export const publicSettings = ({ db, env = process.env, item }) => {
  const resolved = resolveSettings({ db, env, item })
  return SETTING_KEYS.map((key) => describeSetting({
    key,
    resolved: resolved[key],
    envName: envNameFor({ key, item }),
    env
  }))
}

export const maskSecret = () => MASK

export const isAllowedTokenEnv = (name) => TOKEN_ENV_PATTERN.test(name)

export const trustedNtfyOrigin = (env = process.env) =>
  originOf(env.NTFY_TRUSTED_SERVER) ?? DEFAULT_NTFY_ORIGIN

export const ntfyTokenFor = ({ settings, item, env = process.env }) => {
  const token = settings.ntfyToken.value
  if (!token) return { token: null, withheld: false }
  const trusted = originOf(item.ntfy?.server) === trustedNtfyOrigin(env)
  return trusted ? { token, withheld: false } : { token: null, withheld: true }
}

export const deliveryFrom = (settings) => {
  const postcode = settings.deliveryPostcode.value
  if (!postcode) return null
  return { postcode, suburb: settings.deliverySuburb.value }
}

export const membershipsFrom = (settings) => parseMemberships(settings.memberships.value)

export const dashboardUrlFrom = (settings) => settings.dashboardUrl.value

export const tokenItem = (items) => items.find((item) => item.ntfy?.tokenEnv)

export const claudeToken = ({ db, env = process.env }) =>
  resolveSettings({ db, env }).claudeOauthToken.value

export const aiMonthlyCap = ({ db, env = process.env }) =>
  Number(resolveSettings({ db, env }).aiMonthlyCap.value)

export const claudeLimits = ({ db, env = process.env }) => {
  const resolved = resolveSettings({ db, env })
  return {
    weeklyReserve: Number(resolved.claudeReservePercent.value),
    sessionReserve: Number(resolved.claudeSessionReservePercent.value),
    paused: resolved.aiPaused.value === 'true'
  }
}

export const ensureAppTopic = ({ db, env = process.env, now = new Date() }) => {
  const current = resolveSettings({ db, env }).appTopic.value
  if (current) return current
  const topic = `${APP_TOPIC_PREFIX}-${randomBytes(16).toString('hex')}`
  setSetting({ db, key: 'appTopic', value: topic, now })
  return topic
}

export const rotateAppTopic = ({ db, now = new Date() }) => {
  const topic = `${APP_TOPIC_PREFIX}-${randomBytes(16).toString('hex')}`
  setSetting({ db, key: 'appTopic', value: topic, now })
  return topic
}

const validatePercent = (value) => {
  const number = Number(value)
  return /^\d+$/.test(value) && number >= 0 && number <= 100
    ? null
    : 'must be a whole number from 0 to 100'
}

const baseRegion = (env = process.env) => regionProfile({ id: env.REGION })

const validateCurrency = (value) => {
  if (!/^[A-Za-z]{3}$/.test(value)) return 'use a three-letter ISO 4217 code such as AUD'
  return Intl.supportedValuesOf('currency').includes(value.toUpperCase())
    ? null
    : 'unknown currency code'
}

const validateLocale = (value) => {
  try {
    return Intl.getCanonicalLocales(value).length === 1 ? null : 'use one locale such as en-AU'
  } catch {
    return 'use a locale such as en-AU'
  }
}

const validateTimeZone = (value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
    return null
  } catch {
    return 'use an IANA time zone such as Australia/Sydney'
  }
}

const DEFINITIONS = {
  dashboardUrl: {
    label: 'Dashboard URL',
    secret: false,
    envName: () => 'DASHBOARD_URL',
    defaultValue: DEFAULT_DASHBOARD_URL,
    normalise: normaliseDashboardUrl,
    validate: validateDashboardUrl
  },
  memberships: {
    label: 'Memberships',
    secret: false,
    envName: () => 'MEMBERSHIPS',
    defaultValue: (env) => formatMemberships(defaultMemberships(baseRegion(env))),
    validate: validateMemberships
  },
  currency: {
    label: 'Currency',
    secret: false,
    envName: () => 'CURRENCY',
    defaultValue: (env) => baseRegion(env).currency,
    normalise: (value) => value.toUpperCase(),
    validate: validateCurrency
  },
  locale: {
    label: 'Number and date format',
    secret: false,
    envName: () => 'LOCALE',
    defaultValue: (env) => baseRegion(env).locale,
    validate: validateLocale
  },
  timeZone: {
    label: 'Time zone',
    secret: false,
    envName: () => 'TIME_ZONE',
    defaultValue: (env) => baseRegion(env).timeZone,
    validate: validateTimeZone
  },
  ntfyToken: {
    label: 'ntfy access token',
    secret: true,
    envName: (item) => allowedTokenEnv(item?.ntfy?.tokenEnv),
    validate: (value) => {
      if (/\s/.test(value)) return 'must not contain whitespace'
      if (value.length > MAX_TOKEN_LENGTH) return `must be at most ${MAX_TOKEN_LENGTH} characters`
      return null
    }
  },
  claudeOauthToken: {
    label: 'Claude login token',
    secret: true,
    envName: () => 'CLAUDE_CODE_OAUTH_TOKEN',
    validate: (value) => {
      if (/\s/.test(value)) return 'must not contain whitespace'
      if (value.length > MAX_CLAUDE_TOKEN_LENGTH) {
        return `must be at most ${MAX_CLAUDE_TOKEN_LENGTH} characters`
      }
      return null
    }
  },
  deliveryPostcode: {
    label: (env) => `Delivery ${baseRegion(env).deliveryLabels.postcode}`,
    secret: false,
    envName: () => 'DELIVERY_POSTCODE',
    validate: (value, env) => {
      const { pattern, problem } = baseRegion(env).postcode
      return pattern.test(value) ? null : problem
    }
  },
  deliverySuburb: {
    label: (env) => `Delivery ${baseRegion(env).deliveryLabels.locality}`,
    secret: false,
    envName: () => 'DELIVERY_SUBURB',
    validate: (value) => {
      if (/[\u0000-\u001f]/.test(value)) return 'must not contain control characters'
      if (value.length > MAX_SUBURB_LENGTH) return `must be at most ${MAX_SUBURB_LENGTH} characters`
      return null
    }
  },
  aiMonthlyCap: {
    label: 'Monthly AI research cap',
    secret: false,
    envName: () => 'AI_MONTHLY_CAP',
    defaultValue: String(DEFAULT_AI_MONTHLY_CAP),
    validate: (value) => {
      const number = Number(value)
      return /^\d+$/.test(value) && number >= 0 && number <= MAX_AI_CAP
        ? null
        : `must be a whole number from 0 to ${MAX_AI_CAP}`
    }
  },
  claudeReservePercent: {
    label: 'Claude weekly reserve',
    secret: false,
    envName: () => 'CLAUDE_RESERVE_PERCENT',
    defaultValue: String(DEFAULT_CLAUDE_RESERVE_PERCENT),
    validate: validatePercent
  },
  claudeSessionReservePercent: {
    label: 'Claude five-hour reserve',
    secret: false,
    envName: () => 'CLAUDE_SESSION_RESERVE_PERCENT',
    defaultValue: String(DEFAULT_CLAUDE_SESSION_RESERVE_PERCENT),
    validate: validatePercent
  },
  aiPaused: {
    label: 'Pause all AI',
    secret: false,
    envName: () => 'AI_PAUSED',
    defaultValue: 'false',
    normalise: (value) => value.toLowerCase(),
    validate: (value) => (['true', 'false'].includes(value.toLowerCase())
      ? null
      : 'must be true or false')
  },
  appTopic: {
    label: 'App ntfy topic',
    secret: false,
    envName: () => 'APP_NTFY_TOPIC',
    validate: (value) => (NTFY_TOPIC.test(value)
      ? null
      : 'use letters, digits, hyphens, and underscores (up to 64)')
  }
}

const resolveOne = ({ key, overrides, env, item }) => {
  const override = overrides.get(key)
  if (override) return { value: override, source: 'settings' }
  const fromEnv = env[envNameFor({ key, item })]?.trim()
  if (fromEnv && !validateSetting({ key, value: fromEnv, env })) {
    return { value: normaliseFor({ key, value: fromEnv }), source: 'env' }
  }
  const { defaultValue } = DEFINITIONS[key]
  const fallback = typeof defaultValue === 'function' ? defaultValue(env) : defaultValue
  if (fallback) return { value: fallback, source: 'default' }
  return { value: null, source: null }
}

const describeSetting = ({ key, resolved, envName, env }) => {
  const { secret } = DEFINITIONS[key]
  const label = labelFor({ key, env })
  const isSet = resolved.value !== null
  const shown = secret && isSet ? maskSecret(resolved.value) : resolved.value
  return { key, label, secret, envName, isSet, source: resolved.source, value: shown }
}

const allowedTokenEnv = (name) =>
  typeof name === 'string' && isAllowedTokenEnv(name) ? name : DEFAULT_TOKEN_ENV

const originOf = (value) => {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const envNameFor = ({ key, item }) => DEFINITIONS[key].envName(item)

const labelFor = ({ key, env }) => {
  const { label } = DEFINITIONS[key]
  return typeof label === 'function' ? label(env) : label
}

const readOverrides = (db) => (db
  ? new Map(db.prepare('SELECT key, value FROM settings').all()
    .map(({ key, value }) => [key, value]))
  : new Map())
const normaliseFor = ({ key, value }) =>
  value === null ? null : (DEFINITIONS[key].normalise?.(value) ?? value)

const cleanValue = (value) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
