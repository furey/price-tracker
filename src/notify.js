import { execFile } from 'node:child_process'
import { sanitizeOutgoing } from './text.js'

const RETRY_DELAYS_MS = [2000, 8000, 30000]
const MAX_RETRY_AFTER_MS = 60000
const REQUEST_TIMEOUT_MS = 20000

export const sendNtfy = async ({
  server,
  topic,
  token,
  title,
  message,
  priority,
  click,
  tags,
  actions,
  fetchImpl = fetch,
  sleep = defaultSleep,
  log = defaultLog
}) => {
  const request = buildRequest({ topic, token, title, message, priority, click, tags, actions })
  const url = server.replace(/\/+$/, '')
  let last = { status: null, error: null, retryAfterMs: null }
  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt += 1) {
    last = await attemptPost({ fetchImpl, url, request })
    if (last.ok) return { delivered: true, attempts: attempt, status: last.status, error: null }
    log(`ntfy attempt ${attempt} failed (${last.error}) for topic ${topic}`)
    if (attempt > RETRY_DELAYS_MS.length) {
      return { delivered: false, attempts: attempt, status: last.status, error: last.error }
    }
    await sleep(retryDelayMs({ last, attempt }))
  }
}

export const notifyMac = ({
  title, message, execImpl = execFile, platform = process.platform
}) => {
  if (platform !== 'darwin') return
  try {
    const script = macScript({ title, message })
    execImpl('osascript', ['-e', script], () => {})
  } catch {
    return
  }
}

export const deliver = async ({ item, alert, token, ...deps }) => {
  const { execImpl, ...sendDeps } = deps
  const result = await sendNtfy({
    server: item.ntfy.server,
    topic: item.ntfy.topic,
    token,
    ...alert,
    ...sendDeps
  })
  if (result.delivered) return result
  notifyMac({
    title: `${item.name}: alert not delivered`,
    message: alert.title,
    execImpl
  })
  return { ...result, delivered: false }
}

const buildRequest = ({ topic, token, title, message, priority, click, tags, actions }) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const payload = {
    topic,
    title: sanitizeOutgoing(title),
    message: sanitizeOutgoing(message),
    priority,
    click,
    tags: tags?.map(sanitizeOutgoing),
    actions: actions?.map(cleanAction)
  }
  return { method: 'POST', headers, body: JSON.stringify(payload) }
}

const cleanAction = (action) => ({ ...action, label: sanitizeOutgoing(action.label) })

const attemptPost = async ({ fetchImpl, url, request }) => {
  try {
    const response = await fetchImpl(url, {
      ...request,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (response.ok) return { ok: true, status: response.status }
    return {
      ok: false,
      status: response.status,
      error: `HTTP ${response.status}`,
      retryAfterMs: response.status === 429 ? parseRetryAfter(response) : null
    }
  } catch (error) {
    return { ok: false, status: null, error: error.message, retryAfterMs: null }
  }
}

const parseRetryAfter = (response) => {
  const seconds = Number(response.headers?.get('retry-after'))
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
}

const retryDelayMs = ({ last, attempt }) => last.retryAfterMs ?? RETRY_DELAYS_MS[attempt - 1]

const macScript = ({ title, message }) =>
  `display notification "${escapeAppleScript(message)}" with title "${escapeAppleScript(title)}"`

const escapeAppleScript = (text) =>
  sanitizeOutgoing(String(text ?? ''))
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const defaultLog = (line) => console.error(line)
