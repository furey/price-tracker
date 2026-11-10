import { createHash } from 'node:crypto'
import { claudeToken } from './settings.js'

export const CLAUDE_LOGIN_KEY = 'claudeLogin'
export const NOT_CONNECTED = 'Claude is not connected'
export const LOGIN_ERROR_PATTERN = new RegExp([
  'not logged in', 'please run /login', 'invalid api key', 'oauth token (?:has )?expired',
  'authentication_error', 'invalid bearer token', 'token has been revoked'
].join('|'), 'i')

export const isLoginError = (text) => LOGIN_ERROR_PATTERN.test(String(text ?? ''))

export const claudeConnection = ({ db, env = process.env }) => {
  const token = claudeToken({ db, env })
  const login = readLogin(db)
  const sameLogin = login?.fingerprint === fingerprintOf(token)
  const source = token ? 'token' : 'local'
  if (sameLogin && !login.ok) {
    return { connected: false, source, checkedAt: login.at, error: login.error ?? null }
  }
  return { connected: true, source, checkedAt: sameLogin ? login.at : null, error: null }
}

export const recordClaudeLogin = ({
  db, ok, error = null, env = process.env, now = new Date()
}) => {
  const fingerprint = fingerprintOf(claudeToken({ db, env }))
  const stored = readLogin(db)
  if (stored && stored.ok === ok && stored.fingerprint === fingerprint) return false
  const value = JSON.stringify({
    ok, fingerprint, at: now.toISOString(), error: ok ? null : String(error ?? '').slice(0, 300)
  })
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :at)
    ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :at`)
    .run({ key: CLAUDE_LOGIN_KEY, value, at: now.toISOString() })
  return true
}

export const recordClaudeOutcome = ({ db, error = null, env, now }) => {
  if (!error) return recordClaudeLogin({ db, ok: true, env, now })
  if (error.kind !== 'login' && !isLoginError(error.message)) return false
  return recordClaudeLogin({ db, ok: false, error: error.message, env, now })
}

const fingerprintOf = (token) => createHash('sha256')
  .update(token ?? '')
  .digest('hex')
  .slice(0, 16)

const readLogin = (db) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = :key')
    .get({ key: CLAUDE_LOGIN_KEY })
  try {
    return row ? JSON.parse(row.value) : null
  } catch {
    return null
  }
}
