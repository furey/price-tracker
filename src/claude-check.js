import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.js'
import { LockHeldError } from './lock.js'
import { runClaude } from './research.js'
import { CLAUDE_LOCK_PATH, withClaudeLock } from './runner.js'
import { claudeToken } from './settings.js'
import { lastReadAt, recordRateLimit } from './claude-usage.js'

export const LOGIN_TEST_PROMPT = 'Reply with the word ok'
export const LOGIN_TEST_TIMEOUT_MS = 90_000
export const PROBE_PROMPT = 'Reply with ok'
export const PROBE_INTERVAL_MS = 10 * 60_000
export const STARTUP_PROBE_MAX_AGE_MS = 6 * 3_600_000
export const PROBE_KEY = 'claudeProbeAt'

export const testClaudeLogin = async ({
  db, env = process.env, claudeLockPath = CLAUDE_LOCK_PATH, spawnImpl,
  cwd = join(STATE_DIR, 'claude-work')
}) => {
  const token = claudeToken({ db, env })
  try {
    return await withClaudeLock({
      path: claudeLockPath,
      label: 'Claude login test',
      fn: async () => {
        mkdirSync(cwd, { recursive: true })
        const reply = await runClaude({
          prompt: LOGIN_TEST_PROMPT,
          maxTurns: 1,
          tools: '',
          timeoutMs: LOGIN_TEST_TIMEOUT_MS,
          cwd,
          claudeToken: token,
          onRateLimit: (event) => { recordRateLimit({ db, event, source: 'login-test' }) },
          ...(spawnImpl ? { spawnImpl } : {})
        })
        return { ok: true, reply: hide(reply.resultText.trim().slice(0, 200), token) }
      }
    })
  } catch (error) {
    if (error instanceof LockHeldError) {
      return {
        ok: false,
        busy: true,
        error: `AI busy: ${error.label ?? 'another AI run'}. Try again when it finishes.`
      }
    }
    const message = hide(String(error.message).slice(0, 500), token)
    return { ok: false, error: message, hint: hintFor(message) }
  }
}

export const probeClaudeUsage = async ({
  db, env = process.env, claudeLockPath = CLAUDE_LOCK_PATH, spawnImpl, now = new Date(),
  cwd = join(STATE_DIR, 'claude-work')
}) => {
  const retryAt = nextProbeAt({ db })
  if (retryAt && Date.parse(retryAt) > now.getTime()) {
    return {
      ok: false,
      rateLimited: true,
      retryAt,
      error: 'Usage was refreshed less than 10 minutes ago. Try again later.'
    }
  }
  const token = claudeToken({ db, env })
  const seen = { parsed: null }
  try {
    await withClaudeLock({
      path: claudeLockPath,
      label: 'Claude usage refresh',
      fn: async () => {
        markProbe({ db, now })
        mkdirSync(cwd, { recursive: true })
        await runClaude({
          prompt: PROBE_PROMPT,
          maxTurns: 1,
          tools: '',
          timeoutMs: LOGIN_TEST_TIMEOUT_MS,
          cwd,
          claudeToken: token,
          onRateLimit: (event) => {
            seen.parsed = recordRateLimit({ db, event, source: 'probe', now })
          },
          ...(spawnImpl ? { spawnImpl } : {})
        })
      }
    })
  } catch (error) {
    if (error instanceof LockHeldError) {
      return { ok: false, busy: true, error: `AI busy: ${error.label ?? 'another AI run'}.` }
    }
    if (!seen.parsed) return { ok: false, error: hide(String(error.message).slice(0, 300), token) }
  }
  if (!seen.parsed) return { ok: false, error: 'Claude replied but sent no usage reading.' }
  if (!seen.parsed.ok) return { ok: false, formatChanged: true, error: FORMAT_CHANGED }
  return { ok: true, readings: seen.parsed.readings }
}

export const nextProbeAt = ({ db }) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = :key').get({ key: PROBE_KEY })
  if (!row?.value) return null
  return new Date(Date.parse(row.value) + PROBE_INTERVAL_MS).toISOString()
}

export const startupProbe = async ({ db, now = new Date(), log = () => {}, ...options }) => {
  const readAt = lastReadAt({ db })
  if (readAt && now.getTime() - Date.parse(readAt) < STARTUP_PROBE_MAX_AGE_MS) return null
  const outcome = await probeClaudeUsage({ db, now, ...options })
  log(outcome.ok
    ? `Claude usage read at startup: ${describeReadings(outcome.readings)}`
    : `Claude usage startup probe: ${outcome.error ?? 'not run'}`)
  return outcome
}

const FORMAT_CHANGED = 'Claude Code sent a usage reading in a shape this app does not know. '
  + 'The card keeps the last good reading.'

const markProbe = ({ db, now }) => {
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (:key, :value, :value)
    ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :value`)
    .run({ key: PROBE_KEY, value: now.toISOString() })
}

const describeReadings = (readings) => readings
  .map(({ window, utilization }) => `${window} ${Math.round((utilization ?? 0) * 100)}%`)
  .join(', ')

const AUTH_PATTERN = /401|authenticat|oauth|token|log ?in|credential|unauthori[sz]ed/i

const hintFor = (message) => (AUTH_PATTERN.test(message)
  ? 'The login token is missing, wrong, or expired. Run claude setup-token on your Mac, '
    + 'then paste the new token into Claude login token above.'
  : null)

const hide = (text, token) => (token ? text.split(token).join('••••••') : text)
