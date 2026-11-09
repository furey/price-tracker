import { categoryStats, sameSiteName, siteStats } from './site-stats.js'
import { localDay, saleWindowAt } from './sale-windows.js'
import { DEFAULT_REGION } from './regions/index.js'
import { formatPrice } from './text.js'
import { MUTED, WEEKLY, mutedCategoryIds, tuningOf } from './tuning.js'
import { publicUrlProblem } from './url-rules.js'

export const RULE_WINDOW_DAYS = 30
export const VALUE_WINDOW_DAYS = 90
export const MIN_CHECKS = 3
export const PRICE_GAP = 0.1
export const PRICE_MIN_SIGHTINGS = 5
export const QUIET_CATEGORY_RUNS = 10
export const DIRECT_FAIL_STREAK = 3
export const RATE_LIMIT_CHECKS = 2
export const SCRAPED_OK_CHECKS = 2
export const DIRECT_OK_RUNS = 3
export const DISMISS_DAYS = 90
export const DISMISSED_REASON = 'suggestion-dismissed'
export const RESTORED_REASON = 'suggestion-restored'
export const DEAL_SITE_WORDS = [
  'ozbargain', 'buywisely', 'pricehipster', 'getprice', 'shopbot', 'staticice', 'priceme',
  'pricespy', 'google shopping', 'slickdeals', 'camelcamelcamel'
]

export const suggestTuning = ({
  item, runs, alerts = [], feedback = [], versions = [], now, region = DEFAULT_REGION
}) => {
  const sites = siteStats({ item, runs, alerts, now, days: RULE_WINDOW_DAYS, region })
  const longSites = siteStats({ item, runs, alerts, now, days: VALUE_WINDOW_DAYS, region })
  const context = {
    item,
    now,
    longByKey: new Map(longSites.map((row) => [`${row.kind}:${row.key}`, row])),
    categories: categoryStats({ item, runs, versions, now, days: RULE_WINDOW_DAYS, region }),
    longCategories: categoryStats({
      item, runs, versions, now, days: VALUE_WINDOW_DAYS, region
    }),
    region,
    alerts,
    feedback
  }
  const candidates = [
    ...sites.filter(({ kind }) => kind === 'site').map((row) => siteCandidate({ context, row })),
    ...sites.filter(({ kind }) => kind === 'direct').map((row) => directCandidate({ row })),
    priceCandidate(context),
    ...feedbackCandidates(context),
    ...quietCategoryCandidates(context)
  ].filter(Boolean)
  const sale = saleWindowAt({
    item, today: localDay({ now, tz: itemTz({ item, region }) }), region
  })
  const dismissals = latestDismissals(feedback)
  const ready = candidates.filter(({ waiting }) => !waiting)
  const held = sale ? ready.filter(isSiteSuggestion) : []
  const open = ready.filter((suggestion) => !held.includes(suggestion))
  const dismissed = open.filter((suggestion) => isDismissed({
    suggestion, dismissal: dismissals.get(suggestion.id), now
  }))
  return {
    suggestions: open.filter((suggestion) => !dismissed.includes(suggestion)).map(publicView),
    waiting: candidates.filter(({ waiting }) => waiting).map(publicView),
    held: held.map(publicView),
    saleWindow: sale,
    dismissed: dismissed.map((suggestion) => ({
      ...publicView(suggestion), dismissal: dismissalView(dismissals.get(suggestion.id))
    }))
  }
}

export const dismissalRecord = ({ suggestion, permanent = false }) => ({
  suggestionId: suggestion.id,
  rule: suggestion.rule,
  checks: suggestion.evidence.checks,
  kinds: suggestion.evidence.kinds,
  permanent: Boolean(permanent)
})

export const latestDismissals = (feedback) => {
  const latest = new Map()
  const rows = feedback
    .filter(({ reason }) => reason === DISMISSED_REASON || reason === RESTORED_REASON)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id)
  rows.forEach((row) => {
    const id = row.changes?.suggestionId
    if (typeof id === 'string') latest.set(id, row)
  })
  return latest
}

export const isDismissed = ({ suggestion, dismissal, now }) => {
  if (!dismissal || dismissal.reason !== DISMISSED_REASON) return false
  const record = dismissal.changes ?? {}
  if (record.permanent) return true
  const at = Date.parse(dismissal.createdAt)
  if (now.getTime() - at > DISMISS_DAYS * DAY_MS) return false
  const known = new Set(record.kinds ?? [])
  if (suggestion.evidence.kinds.some((kind) => !known.has(kind))) return false
  const since = suggestion.evidence.times.filter((time) => Date.parse(time) > at).length
  return since < Math.max(1, Number(record.checks) || 0)
}

export const withGlobalSites = (perItem) => perItem.map(({ item, result }) => ({
  item,
  result: {
    ...result,
    suggestions: result.suggestions.map((suggestion) => ({
      ...suggestion,
      alsoOn: alsoOnFor({ perItem, item, suggestion })
    }))
  }
}))

export const failingEverywhere = (perItem) => {
  const bySite = new Map()
  perItem.forEach(({ item, sites }) => sites
    .filter((row) => row.kind === 'site' && row.checks > 0)
    .forEach((row) => {
      const key = siteWords(row.name)
      bySite.set(key, [...(bySite.get(key) ?? []), { itemId: item.id, row }])
    }))
  return [...bySite.values()]
    .filter((entries) => entries.length >= 2)
    .filter((entries) => entries.every(({ row }) => row.statuses.ok === 0
      && row.statuses.blocked + row.statuses.error === row.checks))
    .filter((entries) => entries.reduce((sum, { row }) => sum + row.checks, 0) >= MIN_CHECKS)
    .map((entries) => ({
      name: entries[0].row.name,
      items: entries.map(({ itemId }) => itemId),
      checks: entries.reduce((sum, { row }) => sum + row.checks, 0)
    }))
}

export const isDealSite = (name) => {
  const words = siteWords(name)
  return DEAL_SITE_WORDS.some((word) => words.replace(/ /g, '').includes(word.replace(/ /g, '')))
}

export const isBrandSite = ({ item, site }) => {
  const brand = siteWords(item.name).split(' ')[0]
  if (!brand || brand.length < 3) return false
  const words = siteWords(site.name).split(' ')
  return words.includes(brand) || siteWords(hostOf(site.url)).replace(/ /g, '').includes(brand)
}

const DAY_MS = 86_400_000
const SITE_KINDS = ['mute-site', 'weekly-site']

const siteCandidate = ({ context, row }) => {
  const { item } = context
  if (row.state === MUTED || row.checks === 0) return null
  const site = item.sources.sites.find(({ name }) => name === row.key) ?? { name: row.key }
  if (isDealSite(row.name)) return null
  const long = context.longByKey.get(`site:${row.key}`) ?? row
  const facts = siteFacts({ row, long })
  const mutable = !isBrandSite({ item, site }) && long.eligible === 0
  const rule = [
    mutable && facts.neverUseful && !facts.manualOk && ['S1', 'mute-site'],
    facts.allFailed && facts.manualOk && ['S2', 'weekly-site'],
    row.rateLimited >= RATE_LIMIT_CHECKS && ['S5', 'weekly-site'],
    facts.allRejected && ['S4', 'weekly-site'],
    directCovers({ context, row }) && ['S3', 'weekly-site']
  ].find(Boolean)
  if (!rule) return null
  const [id, kind] = rule
  if (kind === 'weekly-site' && row.state === WEEKLY) return null
  return {
    id: `${id}:site:${row.key}`,
    rule: id,
    subject: { type: 'site', key: row.key },
    title: kind === 'mute-site' ? `Mute ${row.key}` : `Check ${row.key} weekly`,
    reason: siteReason({ rule: id, row, long }),
    change: kind === 'mute-site'
      ? { kind: 'mute-site', name: row.key }
      : { kind: 'weekly-site', name: row.key },
    action: null,
    waiting: row.checks < MIN_CHECKS ? { needs: MIN_CHECKS - row.checks } : null,
    evidence: { checks: row.checks, times: row.checkTimes, kinds: siteKinds({ row, long }) }
  }
}

const siteFacts = ({ row, long }) => ({
  neverUseful: row.eligible === 0 && row.statuses.ok === 0,
  allFailed: row.checks > 0 && row.statuses.blocked + row.statuses.error === row.checks,
  manualOk: long.manual.ok > 0,
  allRejected: row.statuses.ok >= SCRAPED_OK_CHECKS && row.found > 0
    && row.rejected === row.found && row.eligible === 0
})

const directCovers = ({ context, row }) => {
  const entries = (context.item.direct ?? []).filter((entry) =>
    sameSiteName(entry.retailer, row.key) && !tuningOf(context.item).direct[entry.url])
  if (entries.length === 0 || row.eligible === 0) return false
  const okRuns = entries.map((entry) => context.longByKey.get(`direct:${entry.url}`))
    .filter(Boolean)
    .some((direct) => direct.statuses.ok >= DIRECT_OK_RUNS)
  const urls = entries.map(({ url }) => bareUrl(url))
  return okRuns && row.eligibleUrls.every((url) => urls.includes(bareUrl(url)))
}

const siteReason = ({ rule, row, long }) => {
  const checks = plural(row.checks, 'AI check')
  const statusText = statusSummary(row)
  const manual = manualText(long)
  if (rule === 'S1') {
    return `No eligible listing in ${checks} over ${RULE_WINDOW_DAYS} days (${statusText}), `
      + `and none in ${VALUE_WINDOW_DAYS} days.${manual}`
  }
  if (rule === 'S2') {
    return `The AI was blocked or failed on ${row.checks} of ${checks} (${statusText}), but `
      + 'your Chrome check could read it. Fewer AI visits save time.'
  }
  if (rule === 'S5') {
    return `Rate limited (HTTP 429) on ${row.rateLimited} of ${checks}. Fewer visits help.`
  }
  if (rule === 'S4') {
    return `Read on ${plural(row.statuses.ok, 'check')} and found `
      + `${plural(row.found, 'listing')}, all rejected or muted.`
  }
  return `Research found nothing at ${row.key} that its free check does not already cover `
    + `(${plural(row.eligible, 'eligible listing')} in ${checks}).`
}

const manualText = (long) => {
  if (long.manual.checks === 0) return ''
  return long.manual.ok > 0
    ? ' Your Chrome check could read it.'
    : ' Your Chrome check found nothing.'
}

const statusSummary = (row) => [
  ['ok', 'OK'], ['blocked', 'blocked'], ['error', 'error'], ['not_found', 'not found']
].filter(([status]) => row.statuses[status] > 0)
  .map(([status, label]) => `${label} ${row.statuses[status]}`)
  .join(', ')

const siteKinds = ({ row, long }) => [
  row.statuses.ok > 0 && 'ai-ok',
  row.statuses.blocked > 0 && 'ai-blocked',
  row.statuses.error > 0 && 'ai-error',
  row.statuses.not_found > 0 && 'ai-not-found',
  row.rateLimited > 0 && 'http-429',
  long.manual.ok > 0 && 'manual-ok',
  long.manual.notFound > 0 && 'manual-not-found',
  row.eligible > 0 && 'eligible'
].filter(Boolean)

const directCandidate = ({ row }) => {
  if (row.state === 'off' || publicUrlProblem(row.url)) return null
  const latest = row.recent.slice(0, DIRECT_FAIL_STREAK)
  if (latest.length === 0 || latest.some(({ status }) => status === 'ok')) return null
  const statuses = latest.map(({ status }) => status.replace('_', ' '))
  return {
    id: `D1:direct:${row.key}`,
    rule: 'D1',
    subject: { type: 'direct', key: row.key },
    title: `Turn off the ${row.name} free check`,
    reason: `The free check failed on the last ${plural(latest.length, 'run')} `
      + `(${statuses.join(', ')}).`,
    change: { kind: 'disable-direct', url: row.key },
    action: null,
    waiting: latest.length < DIRECT_FAIL_STREAK
      ? { needs: DIRECT_FAIL_STREAK - latest.length }
      : null,
    evidence: {
      checks: latest.length,
      times: row.checkTimes,
      kinds: [...new Set(latest.map(({ status }) => `direct-${status}`))]
    }
  }
}

const priceCandidate = ({ item, categories, region }) => {
  const muted = new Set(mutedCategoryIds(item))
  const top = item.categories.find(({ id }) => !muted.has(id))
  const cap = item.rules?.[top?.id]?.maxPrice
  const stats = categories.find(({ id }) => id === top?.id)
  if (!top || typeof cap !== 'number' || !stats?.sightings) return null
  if (stats.lowest <= cap * (1 + PRICE_GAP)) return null
  const gap = Math.round(((stats.lowest - cap) / cap) * 100)
  const money = (amount) =>
    formatPrice({ amount, currency: region.currency, locale: region.locale })
  return {
    id: `C1:category:${top.id}`,
    rule: 'C1',
    subject: { type: 'category', key: top.id },
    title: `Review the ${top.id} alert price`,
    reason: `The lowest eligible price for ${top.id} was ${money(stats.lowest)}`
      + `${stats.lowestRetailer ? ` (${stats.lowestRetailer})` : ''} across `
      + `${plural(stats.sightings, 'sighting')} in ${RULE_WINDOW_DAYS} days, ${gap}% over its `
      + `${money(cap)} alert price.`,
    change: null,
    action: 'edit-prices',
    waiting: stats.sightings < PRICE_MIN_SIGHTINGS
      ? { needs: PRICE_MIN_SIGHTINGS - stats.sightings }
      : null,
    evidence: { checks: stats.sightings, times: stats.sightingTimes, kinds: ['over-cap'] }
  }
}

const feedbackCandidates = ({ item, now, alerts, feedback }) => {
  const muted = new Set(mutedCategoryIds(item))
  const since = now.getTime() - VALUE_WINDOW_DAYS * DAY_MS
  const categoryOf = new Map(alerts.map((alert) => [alert.id, alert.category]))
  const rows = feedback
    .filter(({ reason }) => reason === 'not-this-model' || reason === 'not-now')
    .filter(({ changes }) => !Array.isArray(changes) || changes.length === 0)
    .filter(({ createdAt }) => Date.parse(createdAt) >= since)
    .map((row) => ({ ...row, category: categoryOf.get(row.alertId) }))
    .filter(({ category }) => category && !muted.has(category)
      && item.categories.some(({ id }) => id === category))
  return [...new Set(rows.map(({ category }) => category))].map((category) => {
    const mine = rows.filter((row) => row.category === category)
    const notModel = mine.filter(({ reason }) => reason === 'not-this-model')
    const notNow = mine.filter(({ reason }) => reason === 'not-now')
    if (notModel.length === 0 && notNow.length < 2) return null
    const unmutedLeft = item.categories.filter(({ id }) => !muted.has(id)).length
    if (unmutedLeft <= 1) return null
    return {
      id: `C2:category:${category}`,
      rule: 'C2',
      subject: { type: 'category', key: category },
      title: `Mute the ${category} model`,
      reason: notModel.length
        ? `You marked ${plural(notModel.length, 'alert')} for ${category} "Not this model" `
          + 'without muting it.'
        : `You marked ${notNow.length} alerts for ${category} "Just not now".`,
      change: { kind: 'mute-category', id: category },
      action: null,
      waiting: null,
      evidence: {
        checks: mine.length,
        times: mine.map(({ createdAt }) => createdAt),
        kinds: [...new Set(mine.map(({ reason }) => `feedback-${reason}`))]
      }
    }
  })
}

const quietCategoryCandidates = ({ item, longCategories }) => {
  const muted = new Set(mutedCategoryIds(item))
  return longCategories
    .filter(({ id }) => !muted.has(id))
    .filter(({ aiRuns, runsWithListings }) => aiRuns >= QUIET_CATEGORY_RUNS
      && runsWithListings === 0)
    .map(({ id, aiRuns }) => ({
      id: `C3:category:${id}`,
      rule: 'C3',
      subject: { type: 'category', key: id },
      title: `Keep or remove ${id}`,
      reason: `No listing for ${id} in ${aiRuns} AI runs over ${VALUE_WINDOW_DAYS} days.`,
      change: null,
      action: 'edit-categories',
      waiting: null,
      evidence: { checks: aiRuns, times: [], kinds: ['no-sightings'] }
    }))
}

const alsoOnFor = ({ perItem, item, suggestion }) => {
  if (!SITE_KINDS.includes(suggestion.change?.kind)) return []
  const others = perItem.filter((entry) => entry.item.id !== item.id)
    .map((entry) => ({
      entry,
      site: entry.item.sources.sites.find(({ name }) => sameSiteName(name, suggestion.change.name))
    }))
    .filter(({ site }) => site)
  if (others.length === 0) return []
  const matches = others.map(({ entry, site }) => ({
    entry,
    site,
    match: entry.result.suggestions.find((other) => other.change?.kind === suggestion.change.kind
      && other.change.name === site.name)
  }))
  if (!matches.every(({ match }) => match)) return []
  return matches.map(({ entry, site, match }) => ({
    itemId: entry.item.id, itemName: entry.item.name, name: site.name, reason: match.reason
  }))
}

const isSiteSuggestion = (suggestion) => SITE_KINDS.includes(suggestion.change?.kind)

const publicView = ({ waiting, ...suggestion }) => ({
  ...suggestion,
  ...(waiting ? { needs: waiting.needs } : {}),
  evidence: { checks: suggestion.evidence.checks, kinds: suggestion.evidence.kinds }
})

const dismissalView = (row) => ({
  at: row.createdAt,
  by: row.by,
  permanent: Boolean(row.changes?.permanent)
})

const itemTz = ({ item, region }) => item.schedules?.[0]?.tz ?? region.timeZone

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const bareUrl = (url) => String(url ?? '').trim().toLowerCase()
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '')

const siteWords = (name) => String(name ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
