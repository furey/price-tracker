import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'pt_session'
export const SESSION_DAYS = 30
export const MAX_FAILURES = 5
export const FAILURE_WINDOW_MS = 15 * 60 * 1000
export const BASE_DELAY_MS = 30 * 1000
export const MAX_DELAY_MS = 15 * 60 * 1000
export const MIN_SECRET_LENGTH = 32

const DAY_MS = 24 * 60 * 60 * 1000
const OPEN_PATHS = new Set(['/login', '/logout', '/session'])

export class AuthConfigError extends Error {}

export const createAuth = ({ env, now = () => new Date() }) => {
  const password = env.APP_PASSWORD
  if (env.SESSION_SECRET) assertStrongSecret(env.SESSION_SECRET)
  if (!password) return { enabled: false }
  const secret = env.SESSION_SECRET
  if (!secret) {
    throw new AuthConfigError('SESSION_SECRET is required when APP_PASSWORD is set')
  }
  const signingKey = deriveSigningKey({ secret, password })
  const salt = randomBytes(16)
  const expectedHash = hashPassword({ password, salt })
  const failures = new Map()
  return {
    enabled: true,
    checkPassword: (candidate) => passwordMatches({ candidate, salt, expectedHash }),
    issueCookie: ({ secure }) => buildCookie({ secure, secret: signingKey, now: now() }),
    clearCookie: ({ secure }) => serialiseCookie({ value: '', maxAgeSeconds: 0, secure }),
    isAuthenticated: (req) => isValidSession({
      token: readCookie(req, SESSION_COOKIE), secret: signingKey, now: now()
    }),
    isRateLimited: (ip) => isDelayed({ failures, ip, now: now() }),
    recordFailure: (ip) => {
      pruneFailures({ failures, now: now() })
      const recent = recentFailures({ failures, ip, now: now() })
      failures.set(ip, [...recent, now().getTime()])
    },
    clearFailures: (ip) => failures.delete(ip),
    failureCount: () => failures.size
  }
}

export const requireSession = (auth) => (req, res, next) => {
  if (!auth.enabled || OPEN_PATHS.has(req.path)) return next()
  if (auth.isAuthenticated(req)) return next()
  res.status(401).json({ error: 'Login required' })
}

export const isSecureRequest = (req) => req.secure === true

const buildCookie = ({ secure, secret, now }) => {
  const expiresAt = now.getTime() + SESSION_DAYS * DAY_MS
  const value = `${expiresAt}.${sign({ payload: String(expiresAt), secret })}`
  return serialiseCookie({ value, maxAgeSeconds: SESSION_DAYS * 24 * 60 * 60, secure })
}

const serialiseCookie = ({ value, maxAgeSeconds, secure }) => [
  `${SESSION_COOKIE}=${value}`,
  'Path=/',
  'HttpOnly',
  'SameSite=Strict',
  `Max-Age=${maxAgeSeconds}`,
  ...(secure ? ['Secure'] : [])
].join('; ')

const isValidSession = ({ token, secret, now }) => {
  if (!token) return false
  const [payload, signature, ...extra] = token.split('.')
  if (!payload || !signature || extra.length > 0) return false
  if (!safeEqual(signature, sign({ payload, secret }))) return false
  const expiresAt = Number(payload)
  return Number.isFinite(expiresAt) && expiresAt > now.getTime()
}

const sign = ({ payload, secret }) =>
  createHmac('sha256', secret).update(payload).digest('base64url')

const hashPassword = ({ password, salt }) => scryptSync(String(password), salt, 64)

const passwordMatches = ({ candidate, salt, expectedHash }) =>
  timingSafeEqual(hashPassword({ password: candidate ?? '', salt }), expectedHash)

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

const recentFailures = ({ failures, ip, now }) =>
  (failures.get(ip) ?? []).filter((at) => now.getTime() - at < FAILURE_WINDOW_MS)

const isDelayed = ({ failures, ip, now }) => {
  const recent = recentFailures({ failures, ip, now })
  if (recent.length < MAX_FAILURES) return false
  const excess = recent.length - MAX_FAILURES
  const delayMs = Math.min(BASE_DELAY_MS * 2 ** excess, MAX_DELAY_MS)
  return now.getTime() - recent[recent.length - 1] < delayMs
}

const pruneFailures = ({ failures, now }) => {
  for (const ip of failures.keys()) {
    if (recentFailures({ failures, ip, now }).length === 0) failures.delete(ip)
  }
}

const assertStrongSecret = (secret) => {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`)
  }
}

const deriveSigningKey = ({ secret, password }) =>
  createHmac('sha256', secret).update(`password:${password}`).digest()

const readCookie = (req, name) => {
  const header = req.headers.cookie
  if (!header) return null
  const pair = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
  return pair ? pair.slice(name.length + 1) : null
}
