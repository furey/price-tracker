export const AUTH_REQUIRED_EVENT = 'auth-required'

export const getSession = () => request('/api/session')

export const login = (password) =>
  sendJson({ url: '/api/login', method: 'POST', body: { password } })

export const logout = () => sendJson({ url: '/api/logout', method: 'POST', body: {} })

export const getItems = () => request('/api/items')

export const createHandItem = (input) =>
  sendJson({ url: '/api/items', method: 'POST', body: input })

export const getHistory = ({ id, days }) =>
  request(`/api/items/${encodeURIComponent(id)}/history?days=${days}`)

export const getInsights = ({ id, days }) =>
  request(`/api/items/${encodeURIComponent(id)}/insights?days=${days}`)

export const getObservations = ({ id, day }) =>
  request(`/api/items/${encodeURIComponent(id)}/observations?day=${day}`)

export const getRuns = ({ id, limit = 15 }) =>
  request(`/api/items/${encodeURIComponent(id)}/runs?limit=${limit}`)

export const getRun = (id) => request(`/api/runs/${id}`)

export const getAlerts = ({ itemId, limit = 10 }) =>
  request(`/api/alerts?limit=${limit}&itemId=${encodeURIComponent(itemId)}`)

export const getAlertDetail = (id) => request(`/api/alerts/${id}`)

export const startRun = ({ id, dryRun, runAnyway = false }) =>
  request(`/api/items/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dryRun, runAnyway })
  })

export const getClaudeUsage = () => request('/api/claude/usage', {}, { raw: true })

export const refreshClaudeUsage = () =>
  sendJson({ url: '/api/claude/usage/refresh', method: 'POST', body: {}, raw: true })

export const pauseAi = () =>
  sendJson({ url: '/api/claude/pause', method: 'POST', body: {}, raw: true })

export const resumeAi = () =>
  sendJson({ url: '/api/claude/resume', method: 'POST', body: {}, raw: true })

export const runDraftAnyway = (id) =>
  sendJson({ url: `${draftUrl(id)}/run-anyway`, method: 'POST', body: {}, raw: true })

export const getSettings = () => request('/api/settings')

export const getAbout = () => request('/api/about')

export const saveSettings = (changes) =>
  sendJson({ url: '/api/settings', method: 'PUT', body: changes })

export const sendTestNotification = (id) =>
  sendJson({ url: `/api/items/${encodeURIComponent(id)}/test-notify`, method: 'POST', body: {} })

export const sendAppTopicTest = () =>
  sendJson({ url: '/api/settings/app-topic/test', method: 'POST', body: {} })

export const pauseItem = ({ id, until = null }) =>
  sendJson({ url: `${itemUrl(id)}/pause`, method: 'POST', body: { until } })

export const resumeItem = (id) =>
  sendJson({ url: `${itemUrl(id)}/resume`, method: 'POST', body: {} })

export const archiveItem = (id) =>
  sendJson({ url: `${itemUrl(id)}/archive`, method: 'POST', body: {} })

export const restoreItem = (id) =>
  sendJson({ url: `${itemUrl(id)}/restore`, method: 'POST', body: {} })

export const deleteItem = ({ id, confirm }) =>
  sendJson({ url: itemUrl(id), method: 'DELETE', body: { confirm } })

export const getItemConfig = (id) => request(`${itemUrl(id)}/config`, {}, { raw: true })

export const getItemVersion = ({ id, version }) =>
  request(`${itemUrl(id)}/versions/${version}`, {}, { raw: true })

export const saveItemConfig = ({ id, baseVersion, config, note }) =>
  sendJson({
    url: `${itemUrl(id)}/config`,
    method: 'PUT',
    body: { baseVersion, config, note },
    raw: true
  })

export const tuneItem = ({ id, baseVersion, changes, by, reason, note, feedback = null }) =>
  sendJson({
    url: `${itemUrl(id)}/tuning`,
    method: 'POST',
    body: { baseVersion, changes, by, reason, note, feedback },
    raw: true
  })

export const sendFeedback = ({ id, alertId = null, reason, note, by }) =>
  sendJson({
    url: `${itemUrl(id)}/feedback`,
    method: 'POST',
    body: { alertId, reason, note, by },
    raw: true
  })

export const getSuggestions = (id) => request(`${itemUrl(id)}/suggestions`, {}, { raw: true })

export const getSiteStats = ({ id, days }) =>
  request(`${itemUrl(id)}/site-stats?days=${days}`, {}, { raw: true })

export const getBotChecks = () => request('/api/bot-checks', {}, { raw: true })

export const getSweep = () => request('/api/sweep', {}, { raw: true })

export const recordObservations = ({ id, data }) => sendJson({
  url: `/api/items/${encodeURIComponent(id)}/observations`, method: 'POST', body: data, raw: true
})

export const uploadScreenshot = ({ runId, blob }) => request(`/api/runs/${runId}/screenshots`, {
  method: 'POST',
  headers: { 'content-type': blob.type },
  body: blob
})

export const screenshotUrl = (id) => `/api/screenshots/${id}`

export const markBotChecksSeen = ({ checks, by }) =>
  sendJson({ url: '/api/bot-checks/seen', method: 'POST', body: { checks, by }, raw: true })

export const dismissSuggestion = ({ id, suggestionId, by, permanent = false }) =>
  sendJson({
    url: `${itemUrl(id)}/suggestions/dismiss`,
    method: 'POST',
    body: { suggestionId, by, permanent },
    raw: true
  })

export const restoreSuggestion = ({ id, suggestionId, by }) =>
  sendJson({
    url: `${itemUrl(id)}/suggestions/restore`,
    method: 'POST',
    body: { suggestionId, by },
    raw: true
  })

export const testDirectEntry = ({ id, entry }) =>
  sendJson({ url: `${itemUrl(id)}/direct/test`, method: 'POST', body: { entry } })

export const testClaudeLogin = () =>
  sendJson({ url: '/api/claude/test', method: 'POST', body: {}, raw: true })

export const getAiUsage = () => request('/api/ai-usage', {}, { raw: true })

export const getDrafts = () => request('/api/drafts', {}, { raw: true })

export const getDraft = (id) => request(draftUrl(id), {}, { raw: true })

export const createDraft = (input) =>
  sendJson({ url: '/api/drafts', method: 'POST', body: { input }, raw: true })

export const answerDraft = ({ id, answers }) =>
  sendJson({ url: `${draftUrl(id)}/answers`, method: 'POST', body: { answers }, raw: true })

export const saveDraftConfig = ({ id, config, preset = null }) =>
  sendJson({ url: `${draftUrl(id)}/config`, method: 'PUT', body: { config, preset }, raw: true })

export const draftSchedules = ({ id, preset }) =>
  sendJson({ url: `${draftUrl(id)}/schedules`, method: 'POST', body: { preset }, raw: true })

export const requestDraftChange = ({ id, instruction, config }) =>
  sendJson({
    url: `${draftUrl(id)}/change`, method: 'POST', body: { instruction, config }, raw: true
  })

export const decideDraftChange = ({ id, approve }) =>
  sendJson({ url: `${draftUrl(id)}/change/decision`, method: 'POST', body: { approve }, raw: true })

export const testDraft = ({ id, kind, config }) =>
  sendJson({ url: `${draftUrl(id)}/test`, method: 'POST', body: { kind, config }, raw: true })

export const testDraftEntry = ({ id, entry }) =>
  sendJson({ url: `${draftUrl(id)}/direct/test`, method: 'POST', body: { entry }, raw: true })

export const saveDraft = ({ id, config }) =>
  sendJson({ url: `${draftUrl(id)}/save`, method: 'POST', body: { config }, raw: true })

export const cancelDraft = (id) =>
  sendJson({ url: `${draftUrl(id)}/cancel`, method: 'POST', body: {}, raw: true })

export const retryDraft = ({ id, separate = false }) =>
  sendJson({ url: `${draftUrl(id)}/retry`, method: 'POST', body: { separate }, raw: true })

const draftUrl = (id) => `/api/drafts/${encodeURIComponent(id)}`

const itemUrl = (id) => `/api/items/${encodeURIComponent(id)}`

const sendJson = ({ url, method, body, raw = false }) =>
  request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }, { raw })

const request = async (url, options, { raw = false } = {}) => {
  const response = await fetch(url, options).catch(() => {
    throw new ApiError({ status: 0, message: 'Cannot reach the price tracker server.' })
  })
  const body = await response.json().catch(() => null)
  if (response.status === 401 && url !== '/api/login') {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  }
  if (!response.ok) {
    throw new ApiError({
      status: response.status,
      message: body?.error ?? `Request failed (${response.status}).`,
      body
    })
  }
  return raw ? body : camelizeKeys(body)
}

export class ApiError extends Error {
  constructor({ status, message, body = null }) {
    super(message)
    this.status = status
    this.errors = body?.errors ?? []
    this.body = body
  }
}

const camelizeKeys = (value) => {
  if (Array.isArray(value)) return value.map(camelizeKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [
    camelizeKey(key),
    VERBATIM_KEYS.has(key) ? inner : camelizeKeys(inner)
  ]))
}

const VERBATIM_KEYS = new Set(['tuning'])

const camelizeKey = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
