export const DEFAULT_DASHBOARD_URL = 'http://localhost:4280'

export const normaliseDashboardUrl = (value) => String(value).trim().replace(/\/+$/, '')

export const validateDashboardUrl = (value) => {
  try {
    const { protocol } = new URL(value)
    return ['http:', 'https:'].includes(protocol) ? null : 'must start with http:// or https://'
  } catch {
    return 'must be a full URL such as http://nas.local:4280'
  }
}

export const alertLink = ({ dashboardUrl, itemId, alertId }) =>
  `${itemLink({ dashboardUrl, itemId })}/alert/${alertId}`

export const itemLink = ({ dashboardUrl, itemId }) =>
  `${dashboardUrl}/#/item/${encodeURIComponent(itemId)}`

export const settingsLink = (dashboardUrl) => `${dashboardUrl}/#/settings`

export const draftPageLink = ({ dashboardUrl, draftId }) => `${dashboardUrl}/#/new/${draftId}`

export const listingActions = (url) => url
  ? [{ action: 'view', label: 'Open listing', url, clear: false }]
  : []
