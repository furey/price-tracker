import { eligibleListings } from './decide.js'
import { directSourceName } from './direct.js'
import { DEFAULT_REGION } from './regions/index.js'
import { canonicalRetailer, knownRetailersFor, listingTrust, retailerHomeUrl } from './retailers.js'
import { DIRECT_OFF, applyTuning, tuningOf } from './tuning.js'
import { linkUrl } from './url-rules.js'

export const STATS_WINDOWS = [30, 90]
export const STATUSES = ['ok', 'blocked', 'error', 'not_found']
export const RESEARCH_MODE = 'research'
export const MANUAL_MODE = 'manual'
export const DIRECT_MODE = 'direct'
export const PAGE_LINK = 'page'
export const HOME_LINK = 'home'
export const RECENT_STATUS_LIMIT = 10
export const NOTE_LENGTH = 160

export const siteStats = ({ item, runs, alerts = [], now, days, region = DEFAULT_REGION }) => {
  const inWindow = runsInWindow({ runs, now, days })
  const configured = item.sources?.sites ?? []
  const sites = configured.map(({ name }) => name)
  const known = knownRetailersFor(item)
  const siteOf = siteResolver({ sites, known })
  const rows = new Map(configured.map(({ name, url }) => [
    name, emptyRow({ key: name, name, kind: 'site', url: linkUrl(url) })
  ]))
  const otherRows = new Map()
  const rowFor = (name) => {
    const site = siteOf(name)
    if (site) return rows.get(site)
    const label = canonicalRetailer({ name, knownRetailers: known })
    if (!otherRows.has(label)) {
      otherRows.set(label, emptyRow({ key: label, name: label, kind: 'other' }))
    }
    return otherRows.get(label)
  }
  inWindow.filter(({ mode }) => mode !== DIRECT_MODE)
    .forEach((run) => addSourceRun({ item, run, rowFor, siteOf, known, region }))
  const directRows = directStats({ item, runs: inWindow, region })
  alertsInWindow({ alerts, now, days }).forEach((alert) => {
    const site = siteOf(alert.retailer)
    if (site) rows.get(site).alerts += 1
  })
  const tuning = tuningOf(item)
  return [
    ...[...rows.values()].map((row) => withState({ row, entry: tuning.sites[row.key] })),
    ...directRows,
    ...[...otherRows.values()].sort((a, b) => a.name.localeCompare(b.name))
  ].map((row) => finishRow({ row, region }))
}

export const categoryStats = ({
  item, runs, versions = [], now, days, region = DEFAULT_REGION
}) => {
  const inWindow = runsInWindow({ runs, now, days })
  const categoriesByVersion = new Map(versions.map(({ version, categoryIds }) => [
    version, new Set(categoryIds)
  ]))
  return item.categories.map(({ id }) => {
    const covering = inWindow.filter((run) => {
      const ids = categoriesByVersion.get(run.itemVersion)
      return !ids || ids.has(id)
    })
    const sightings = covering
      .map((run) => ({ run, lowest: lowestIn({ item, run, category: id, region }) }))
      .filter(({ lowest }) => lowest !== null)
    const seen = covering.filter((run) => runListings(run)
      .some((listing) => listing.category === id)).length
    return {
      id,
      aiRuns: covering.filter(({ mode }) => mode === RESEARCH_MODE).length,
      runsWithListings: seen,
      sightings: sightings.length,
      sightingTimes: sightings.map(({ run }) => run.startedAt),
      lowest: sightings.length ? Math.min(...sightings.map(({ lowest }) => lowest)) : null,
      lowestRetailer: lowestRetailer({
        item, runs: sightings.map(({ run }) => run), category: id, region
      })
    }
  })
}

export const runsInWindow = ({ runs, now, days }) => {
  const since = now.getTime() - days * DAY_MS
  return runs
    .filter((run) => Date.parse(run.startedAt) >= since
      && Date.parse(run.startedAt) <= now.getTime())
    .filter((run) => Array.isArray(run.research?.sources))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

export const sameSiteName = (a, b) => nameKey(a) === nameKey(b)

const DAY_MS = 86_400_000
const RATE_LIMITED = /\b429\b|rate[- ]limit/i

const emptyRow = ({ key, name, kind, url = null }) => ({
  key,
  name,
  kind,
  url,
  state: null,
  stateSince: null,
  checks: 0,
  statuses: Object.fromEntries(STATUSES.map((status) => [status, 0])),
  rateLimited: 0,
  manual: { checks: 0, ok: 0, notFound: 0 },
  found: 0,
  rejected: 0,
  eligible: 0,
  eligibleUrls: [],
  qualifying: 0,
  alerts: 0,
  lastUseful: null,
  lastChecked: null,
  checkTimes: [],
  recent: []
})

const addSourceRun = ({ item, run, rowFor, siteOf, known, region }) => {
  const manual = run.mode === MANUAL_MODE
  const touched = new Set()
  run.research.sources.forEach((source) => {
    const row = rowFor(source.name)
    if (touched.has(row)) return
    touched.add(row)
    const status = STATUSES.includes(source.status) ? source.status : 'error'
    if (manual) addManual({ row, status })
    else addAiCheck({ row, status, note: source.note, at: run.startedAt })
    row.lastChecked = run.startedAt
    row.recent.push(recentEntry({ run, status, source, fallbackUrl: row.url }))
  })
  const listings = applyTuning({ item, listings: runListings(run) })
  listings.forEach((listing) => {
    const site = siteOf(listing.retailer)
    const row = site ? rowFor(site) : rowFor(canonicalRetailer({
      name: listing.retailer, knownRetailers: known
    }))
    row.found += 1
    if (listing.category === 'reject' || listing.tuned) row.rejected += 1
  })
  usefulListings({ item, listings, region }).forEach((listing) => {
    const row = rowFor(listing.retailer)
    row.eligible += 1
    row.eligibleUrls.push(listing.url)
    row.lastUseful = run.startedAt
  })
  const qualified = (run.decision?.qualified ?? []).map(({ listing }) => listing)
    .filter((listing) => typeof listing?.retailer === 'string')
  applyTuning({ item, listings: qualified })
    .filter((listing) => !listing.tuned)
    .forEach((listing) => {
      rowFor(listing.retailer).qualifying += 1
    })
}

const recentEntry = ({ run, status, source, fallbackUrl }) => ({
  runId: run.id,
  at: run.startedAt,
  mode: run.mode,
  status,
  note: clipNote(source.note),
  url: linkUrl(source.url) ?? fallbackUrl,
  urlKind: linkUrl(source.url) ?? fallbackUrl ? PAGE_LINK : null
})

const addManual = ({ row, status }) => {
  row.manual.checks += 1
  if (status === 'ok') row.manual.ok += 1
  else row.manual.notFound += 1
}

const addAiCheck = ({ row, status, note, at }) => {
  row.checks += 1
  row.statuses[status] += 1
  row.checkTimes.push(at)
  if (status !== 'ok' && RATE_LIMITED.test(String(note ?? ''))) row.rateLimited += 1
}

const directStats = ({ item, runs, region }) => {
  const off = tuningOf(item).direct
  const directRuns = runs.filter(({ mode }) => mode === DIRECT_MODE)
  return (item.direct ?? []).map((entry) => {
    const row = emptyRow({
      key: entry.url, name: entry.retailer, kind: 'direct', url: linkUrl(entry.url)
    })
    const sourceName = directSourceName(entry)
    directRuns.forEach((run) => {
      const source = run.research.sources.find(({ name }) => name === sourceName)
      if (!source) return
      const status = STATUSES.includes(source.status) ? source.status : 'error'
      addAiCheck({ row, status, note: source.note, at: run.startedAt })
      row.lastChecked = run.startedAt
      row.recent.push(recentEntry({ run, status, source, fallbackUrl: row.url }))
      const mine = runListings(run).filter((listing) => belongsToEntry({ entry, listing, item }))
      row.found += mine.length
      const useful = usefulListings({
        item, listings: applyTuning({ item, listings: mine }), region
      })
      row.eligible += useful.length
      if (useful.length) row.lastUseful = run.startedAt
    })
    return withState({ row, entry: off[entry.url], offState: DIRECT_OFF })
  })
}

const belongsToEntry = ({ entry, listing, item }) => {
  const sameRetailerEntries = (item.direct ?? [])
    .filter((other) => sameSiteName(other.retailer, listing.retailer))
  if (sameRetailerEntries.length === 1) return sameRetailerEntries[0].url === entry.url
  return bareUrl(listing.url).startsWith(bareUrl(entry.url))
}

const usefulListings = ({ item, listings, region }) => eligibleListings(listings)
  .filter((listing) => !listing.tuned)
  .filter((listing) => listingTrust({ item, listing, region }).trusted)

const lowestIn = ({ item, run, category, region }) => {
  const prices = tunedUseful({ item, run, region })
    .filter((listing) => listing.category === category)
    .map((listing) => listing.effectivePrice)
    .filter((price) => typeof price === 'number')
  return prices.length ? Math.min(...prices) : null
}

const lowestRetailer = ({ item, runs, category, region }) => {
  const listings = runs.flatMap((run) => tunedUseful({ item, run, region }))
    .filter((listing) => listing.category === category)
  const best = listings.reduce((low, listing) =>
    (!low || listing.effectivePrice < low.effectivePrice ? listing : low), null)
  return best?.retailer ?? null
}

const tunedUseful = ({ item, run, region }) => usefulListings({
  item, listings: applyTuning({ item, listings: runListings(run) }), region
})

const withState = ({ row, entry, offState = null }) => {
  if (!entry) return row
  const state = offState && entry.state === offState ? 'off' : entry.state
  return { ...row, state, stateSince: entry.at ?? null }
}

const finishRow = ({ row, region }) => {
  const home = retailerHomeUrl({ name: row.name, region })
  const recent = row.recent.slice(-RECENT_STATUS_LIMIT).reverse()
    .map((entry) => entry.url || !home ? entry : { ...entry, url: home, urlKind: HOME_LINK })
  const url = recent.find((entry) => entry.urlKind === PAGE_LINK)?.url ?? row.url
  if (url) return { ...row, url, urlKind: PAGE_LINK, recent }
  return { ...row, url: home, urlKind: home ? HOME_LINK : null, recent }
}

const siteResolver = ({ sites, known }) => {
  const byKey = new Map(sites.map((name) => [nameKey(name), name]))
  return (name) => {
    const canonical = canonicalRetailer({ name, knownRetailers: known })
    return byKey.get(nameKey(canonical)) ?? byKey.get(nameKey(name)) ?? null
  }
}

const alertsInWindow = ({ alerts, now, days }) => {
  const since = now.getTime() - days * DAY_MS
  return alerts.filter((alert) => alert.kind === 'deal' && Date.parse(alert.sentAt) >= since)
}

const runListings = (run) => (Array.isArray(run.research?.listings) ? run.research.listings : [])

const clipNote = (note) => {
  const text = String(note ?? '').replace(/\s+/g, ' ').trim()
  return text.length > NOTE_LENGTH ? `${text.slice(0, NOTE_LENGTH - 3)}...` : text
}

const bareUrl = (url) => String(url ?? '').trim().toLowerCase()
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '')

const nameKey = (name) => String(name ?? '')
  .normalize('NFD')
  .replace(/\p{M}/gu, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
