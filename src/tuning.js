export const SITE_STATES = ['muted', 'weekly']
export const MUTED = 'muted'
export const WEEKLY = 'weekly'
export const DIRECT_OFF = 'off'
export const MAX_BY_LENGTH = 40
export const MAX_REASON_LENGTH = 200
export const MAX_NEVER_RULES = 50
export const PROMPT_NEVER_LIMIT = 10
export const PROMPT_NEVER_LENGTH = 200
export const WEEKLY_DAYS = 7
export const MAX_TITLE_WORDS = 8
export const NEVER_TUNED_PREFIX = 'never:'
export const CATEGORY_TUNED_PREFIX = 'category:'

export const TUNING_CHANGE_KINDS = [
  'mute-category', 'unmute-category', 'mute-site', 'weekly-site', 'restore-site', 'mute-search',
  'restore-search', 'disable-direct', 'restore-direct', 'never', 'restore-never'
]

export class TuningError extends Error {
  constructor(errors) {
    super(`Invalid tuning change: ${errors.join('; ')}`)
    this.errors = errors
  }
}

export const tuningOf = (item) => {
  const tuning = isObject(item?.tuning) ? item.tuning : {}
  return {
    categories: objectOr(tuning.categories),
    sites: objectOr(tuning.sites),
    searches: objectOr(tuning.searches),
    direct: objectOr(tuning.direct),
    never: Array.isArray(tuning.never) ? tuning.never : []
  }
}

export const hasTuning = (item) => {
  const tuning = tuningOf(item)
  return tuning.never.length > 0 || ['categories', 'sites', 'searches', 'direct']
    .some((key) => Object.keys(tuning[key]).length > 0)
}

export const mutedCategoryIds = (item) => Object.entries(tuningOf(item).categories)
  .filter(([, entry]) => entry?.state === MUTED)
  .map(([id]) => id)

export const isCategoryMuted = ({ item, category }) =>
  tuningOf(item).categories[category]?.state === MUTED

export const siteState = ({ item, name }) => tuningOf(item).sites[name]?.state ?? null

export const neverRuleFor = ({ item, listing }) =>
  tuningOf(item).never.find((rule) => matchesNeverRule({ rule, listing })) ?? null

export const matchesNeverRule = ({ rule, listing }) => {
  const match = rule?.match ?? {}
  const productMatchers = [
    match.url ? sameUrl(match.url, listing.url) : null,
    match.partNumber ? hasPartNumber({ partNumber: match.partNumber, listing }) : null,
    match.titleWords?.length ? hasTitleWords({ words: match.titleWords, listing }) : null
  ].filter((result) => result !== null)
  const retailerOk = match.retailer ? sameRetailer(match.retailer, listing.retailer) : true
  if (productMatchers.length === 0) return Boolean(match.retailer) && retailerOk
  return retailerOk && productMatchers.some(Boolean)
}

export const mutedReason = ({ item, listing }) => {
  if (neverRuleFor({ item, listing })) return 'never'
  if (isCategoryMuted({ item, category: listing.category })) return 'category'
  return null
}

export const applyTuning = ({ item, listings }) => listings.map((listing) => {
  const rule = neverRuleFor({ item, listing })
  if (rule) {
    return {
      ...listing,
      tuned: `${NEVER_TUNED_PREFIX}${rule.id}`,
      rejectReason: listing.rejectReason || neverReason(rule)
    }
  }
  if (isCategoryMuted({ item, category: listing.category })) {
    return { ...listing, tuned: `${CATEGORY_TUNED_PREFIX}${listing.category}` }
  }
  return listing
})

export const tuningEntryFor = ({ item, tuned }) => {
  if (typeof tuned !== 'string') return null
  const tuning = tuningOf(item)
  if (tuned.startsWith(NEVER_TUNED_PREFIX)) {
    const id = tuned.slice(NEVER_TUNED_PREFIX.length)
    const rule = tuning.never.find((entry) => entry.id === id)
    return rule ? { kind: 'never', label: rule.label, entry: rule } : null
  }
  if (tuned.startsWith(CATEGORY_TUNED_PREFIX)) {
    const id = tuned.slice(CATEGORY_TUNED_PREFIX.length)
    const entry = tuning.categories[id]
    return entry ? { kind: 'category', label: id, entry } : null
  }
  return null
}

export const priceAlertCandidates = ({ item, listings }) => listings
  .filter((listing) => listing.tuned)
  .filter((listing) => listing.inStock === true && Boolean(listing.url))
  .map((listing) => ({
    listing: { ...listing, effectivePrice: listing.effectivePrice ?? listing.price },
    found: tuningEntryFor({ item, tuned: listing.tuned })
  }))
  .filter(({ listing, found }) => isNumber(listing.effectivePrice)
    && isNumber(found?.entry?.notifyBelow)
    && listing.effectivePrice <= found.entry.notifyBelow)
  .map(({ listing, found }) => ({
    listing, kind: found.kind, label: found.label, limit: found.entry.notifyBelow
  }))
  .sort((a, b) => a.listing.effectivePrice - b.listing.effectivePrice)

export const noticeKey = (listing) => `${listing.retailer.trim().toLowerCase()}|${listing.tuned}`

export const promptCategories = (item) => {
  const muted = new Set(mutedCategoryIds(item))
  return {
    active: item.categories.filter(({ id }) => !muted.has(id)),
    muted: item.categories.filter(({ id }) => muted.has(id))
  }
}

export const promptSites = ({ item, recentSites = [], today }) => {
  const recent = new Set(recentSites.map(siteKey))
  const saleWindow = inSaleWindow({ item, today })
  return item.sources.sites.filter((site) => {
    const state = siteState({ item, name: site.name })
    if (state === MUTED) return false
    if (state !== WEEKLY) return true
    return saleWindow || !recent.has(siteKey(site.name))
  })
}

export const promptSearches = (item) => {
  const searches = tuningOf(item).searches
  return item.sources.searches.filter((phrase) => searches[phrase]?.state !== MUTED)
}

export const promptSeasonalSearches = (item) => {
  const searches = tuningOf(item).searches
  return (item.sources.seasonalSearches ?? [])
    .filter(({ phrase }) => searches[phrase]?.state !== MUTED)
}

export const promptNeverRules = (item) => tuningOf(item).never
  .slice(0, PROMPT_NEVER_LIMIT)
  .map(neverPromptLine)

export const enabledDirect = (item) => {
  const direct = tuningOf(item).direct
  return (item.direct ?? []).filter(({ url }) => direct[url]?.state !== DIRECT_OFF)
}

export const mutedSummary = (item) => {
  const tuning = tuningOf(item)
  const sites = Object.values(tuning.sites)
  const parts = [
    countOf(mutedCategoryIds(item).length, 'model'),
    countOf(tuning.never.length, 'product'),
    countOf(sites.filter(({ state }) => state === MUTED).length, 'site'),
    countOf(Object.keys(tuning.searches).length, 'search phrase'),
    countOf(Object.keys(tuning.direct).length, 'free check')
  ].filter(Boolean)
  const weekly = sites.filter(({ state }) => state === WEEKLY).length
  const lines = [
    parts.length ? `Muted: ${parts.join(', ')}` : null,
    weekly ? `Checked weekly: ${countOf(weekly, 'site')}` : null
  ].filter(Boolean)
  return lines.length ? lines.join('. ') : null
}

export const applyTuningChanges = ({ config, changes, by, reason = '', at }) => {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new TuningError(['changes: expected a non-empty array'])
  }
  const stamp = { at, by: clip(by, MAX_BY_LENGTH), reason: clip(reason, MAX_REASON_LENGTH) }
  if (!stamp.by) throw new TuningError(['by: say who made the change'])
  const next = changes.reduce(
    (current, change) => applyTuningChange({ config: current, change, stamp }),
    cloneJson(config)
  )
  return withCompactTuning(next)
}

export const pruneTuning = (config) => {
  if (!isObject(config?.tuning)) return config
  const tuning = tuningOf(config)
  const categoryIds = new Set((config.categories ?? []).map(({ id }) => id))
  const siteNames = new Set((config.sources?.sites ?? []).map(({ name }) => name))
  const phrases = new Set(allPhrases(config))
  const urls = new Set((config.direct ?? []).map(({ url }) => url))
  return withCompactTuning({
    ...config,
    tuning: {
      categories: pickKeys({ entries: tuning.categories, keep: categoryIds }),
      sites: pickKeys({ entries: tuning.sites, keep: siteNames }),
      searches: pickKeys({ entries: tuning.searches, keep: phrases }),
      direct: pickKeys({ entries: tuning.direct, keep: urls }),
      never: tuning.never
    }
  })
}

export const restoreVersionConfig = ({ oldConfig, currentConfig, restoreTuning = false }) => {
  const { tuning: oldTuning, ...oldRest } = cloneJson(oldConfig)
  const tuning = restoreTuning ? oldTuning : cloneJson(currentConfig?.tuning)
  return pruneTuning(tuning === undefined ? oldRest : { ...oldRest, tuning })
}

export const renameTuningCategory = ({ config, from, to }) => {
  const categories = config.tuning?.categories
  if (!categories?.[from]) return
  categories[to] = categories[from]
  delete categories[from]
}

export const suggestedNotifyBelow = (rule) => {
  const cap = rule?.maxPrice
  if (!isNumber(cap)) return null
  return Math.max(10, Math.round((cap * 0.7) / 10) * 10)
}

export const partNumberIn = (text) => {
  const match = /\b\d+\.\d{2,}-\d{2,}\.\d+\b/.exec(String(text ?? ''))
  return match ? match[0] : null
}

export const neverRuleId = ({ label, existing = [] }) => {
  const base = slug(label) || 'product'
  const taken = new Set(existing.map(({ id }) => id))
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

export const validateTuning = (item) => {
  if (item.tuning === undefined) return []
  if (!isObject(item.tuning)) return ['tuning: expected an object']
  const unknown = Object.keys(item.tuning).filter((key) => !TUNING_KEYS.includes(key))
  const tuning = tuningOf(item)
  return [
    ...unknown.map((key) => `tuning.${key}: not a tuning section`),
    ...sectionShapeErrors(item.tuning),
    ...validateCategoryEntries({ item, entries: tuning.categories }),
    ...validateKeyedEntries({
      label: 'tuning.sites',
      entries: tuning.sites,
      keys: (item.sources?.sites ?? []).map((site) => site?.name),
      states: SITE_STATES,
      what: 'a site name in sources.sites'
    }),
    ...validateKeyedEntries({
      label: 'tuning.searches',
      entries: tuning.searches,
      keys: allPhrases(item),
      states: [MUTED],
      what: 'a search phrase'
    }),
    ...validateKeyedEntries({
      label: 'tuning.direct',
      entries: tuning.direct,
      keys: (item.direct ?? []).map((entry) => entry?.url),
      states: [DIRECT_OFF],
      what: 'a free check URL'
    }),
    ...validateNeverRules(item.tuning.never)
  ]
}

const TUNING_KEYS = ['categories', 'sites', 'searches', 'direct', 'never']
const RULE_ID = /^[a-z0-9][a-z0-9-]*$/

const sectionShapeErrors = (tuning) => [
  ...['categories', 'sites', 'searches', 'direct']
    .filter((key) => tuning[key] !== undefined && !isObject(tuning[key]))
    .map((key) => `tuning.${key}: expected an object`),
  ...(tuning.never !== undefined && !Array.isArray(tuning.never)
    ? ['tuning.never: expected an array']
    : [])
]

const validateCategoryEntries = ({ item, entries }) => {
  const ids = (item.categories ?? []).map((category) => category?.id)
  const errors = validateKeyedEntries({
    label: 'tuning.categories',
    entries,
    keys: ids,
    states: [MUTED],
    what: 'a category id',
    allowNotify: true
  })
  const mutedCount = ids.filter((id) => entries[id]?.state === MUTED).length
  if (ids.length > 0 && mutedCount >= ids.length) {
    errors.push('tuning.categories: keep at least one category unmuted (pause the item instead)')
  }
  return errors
}

const validateKeyedEntries = ({ label, entries, keys, states, what, allowNotify = false }) =>
  Object.entries(entries).flatMap(([key, entry]) => {
    const path = `${label}.${key}`
    if (!keys.includes(key)) return [`${path}: not ${what}`]
    if (!isObject(entry)) return [`${path}: expected an object`]
    return [
      ...(states.includes(entry.state)
        ? []
        : [`${path}.state: expected ${states.join(' or ')}`]),
      ...stampErrors({ entry, path }),
      ...notifyErrors({ entry, path, allowNotify })
    ]
  })

const validateNeverRules = (rules) => {
  if (!Array.isArray(rules)) return []
  if (rules.length > MAX_NEVER_RULES) {
    return [`tuning.never: use at most ${MAX_NEVER_RULES} rules`]
  }
  const ids = rules.map((rule) => rule?.id)
  return rules.flatMap((rule, index) => {
    const path = `tuning.never[${index}]`
    if (!isObject(rule)) return [`${path}: expected an object`]
    const errors = []
    if (typeof rule.id !== 'string' || !RULE_ID.test(rule.id)) {
      errors.push(`${path}.id: use lowercase letters, digits, and hyphens`)
    } else if (ids.indexOf(rule.id) !== index) errors.push(`${path}.id: duplicate`)
    if (!isNonEmptyString(rule.label)) errors.push(`${path}.label: expected a non-empty string`)
    errors.push(...matchErrors({ match: rule.match, path: `${path}.match` }))
    errors.push(...stampErrors({ entry: rule, path }))
    errors.push(...notifyErrors({ entry: rule, path, allowNotify: true }))
    return errors
  })
}

const matchErrors = ({ match, path }) => {
  if (!isObject(match)) return [`${path}: expected an object`]
  const errors = Object.keys(match)
    .filter((key) => !MATCH_KEYS.includes(key))
    .map((key) => `${path}.${key}: not a matcher (use ${MATCH_KEYS.join(', ')})`)
  for (const key of ['url', 'partNumber', 'retailer']) {
    if (match[key] !== undefined && !isNonEmptyString(match[key])) {
      errors.push(`${path}.${key}: expected a non-empty string`)
    }
  }
  if (match.url !== undefined && !/^https?:\/\/\S+$/i.test(String(match.url))) {
    errors.push(`${path}.url: expected an http(s) URL`)
  }
  if (match.titleWords !== undefined && !validTitleWords(match.titleWords)) {
    errors.push(`${path}.titleWords: expected 1 to ${MAX_TITLE_WORDS} non-empty words`)
  }
  if (!MATCH_KEYS.some((key) => match[key] !== undefined)) {
    errors.push(`${path}: set at least one of ${MATCH_KEYS.join(', ')}`)
  }
  return errors
}

const MATCH_KEYS = ['url', 'partNumber', 'titleWords', 'retailer']

const validTitleWords = (words) => Array.isArray(words) && words.length > 0
  && words.length <= MAX_TITLE_WORDS && words.every(isNonEmptyString)

const stampErrors = ({ entry, path }) => {
  const errors = []
  if (typeof entry.at !== 'string' || Number.isNaN(Date.parse(entry.at))) {
    errors.push(`${path}.at: expected an ISO date and time`)
  }
  if (!isNonEmptyString(entry.by) || entry.by.length > MAX_BY_LENGTH) {
    errors.push(`${path}.by: expected a name of 1 to ${MAX_BY_LENGTH} characters`)
  }
  if (entry.reason !== undefined && (typeof entry.reason !== 'string'
    || entry.reason.length > MAX_REASON_LENGTH)) {
    errors.push(`${path}.reason: expected text of up to ${MAX_REASON_LENGTH} characters`)
  }
  return errors
}

const notifyErrors = ({ entry, path, allowNotify }) => {
  const value = entry.notifyBelow
  if (value === undefined || value === null) return []
  if (!allowNotify) return [`${path}.notifyBelow: only categories and never rules take a price`]
  return isNumber(value) && value > 0 ? [] : [`${path}.notifyBelow: expected a positive number`]
}

const applyTuningChange = ({ config, change, stamp }) => {
  if (!isObject(change) || !TUNING_CHANGE_KINDS.includes(change.kind)) {
    throw new TuningError([`kind: expected one of ${TUNING_CHANGE_KINDS.join(', ')}`])
  }
  const tuning = { ...tuningOf(config) }
  const next = { ...config, tuning }
  const handler = CHANGE_HANDLERS[change.kind]
  handler({ config: next, tuning, change, stamp })
  return next
}

const CHANGE_HANDLERS = {
  'mute-category': ({ config, tuning, change, stamp }) => {
    requireKey({ keys: config.categories.map(({ id }) => id), key: change.id, what: 'category' })
    tuning.categories = {
      ...tuning.categories,
      [change.id]: withNotify({ entry: { state: MUTED, ...stamp }, value: change.notifyBelow })
    }
  },
  'unmute-category': ({ tuning, change }) => {
    tuning.categories = without(tuning.categories, change.id)
  },
  'mute-site': ({ config, tuning, change, stamp }) => setSite({
    config, tuning, name: change.name, entry: { state: MUTED, ...stamp }
  }),
  'weekly-site': ({ config, tuning, change, stamp }) => setSite({
    config, tuning, name: change.name, entry: { state: WEEKLY, ...stamp }
  }),
  'restore-site': ({ tuning, change }) => {
    tuning.sites = without(tuning.sites, change.name)
  },
  'mute-search': ({ config, tuning, change, stamp }) => {
    requireKey({ keys: allPhrases(config), key: change.phrase, what: 'search phrase' })
    tuning.searches = { ...tuning.searches, [change.phrase]: { state: MUTED, ...stamp } }
  },
  'restore-search': ({ tuning, change }) => {
    tuning.searches = without(tuning.searches, change.phrase)
  },
  'disable-direct': ({ config, tuning, change, stamp }) => {
    const urls = (config.direct ?? []).map(({ url }) => url)
    requireKey({ keys: urls, key: change.url, what: 'free check URL' })
    tuning.direct = { ...tuning.direct, [change.url]: { state: DIRECT_OFF, ...stamp } }
  },
  'restore-direct': ({ tuning, change }) => {
    tuning.direct = without(tuning.direct, change.url)
  },
  never: ({ tuning, change, stamp }) => {
    const rule = change.rule ?? {}
    const id = neverRuleId({ label: rule.label, existing: tuning.never })
    tuning.never = [...tuning.never, withNotify({
      entry: { id, label: clip(rule.label, 120), match: cleanMatch(rule.match), ...stamp },
      value: rule.notifyBelow
    })]
  },
  'restore-never': ({ tuning, change }) => {
    tuning.never = tuning.never.filter((rule) => rule.id !== change.id)
  }
}

const setSite = ({ config, tuning, name, entry }) => {
  requireKey({ keys: config.sources.sites.map((site) => site.name), key: name, what: 'site' })
  tuning.sites = { ...tuning.sites, [name]: entry }
}

const requireKey = ({ keys, key, what }) => {
  if (!keys.includes(key)) throw new TuningError([`${what} "${key}" is not in this item`])
}

const withNotify = ({ entry, value }) => (isNumber(value) && value > 0
  ? { ...entry, notifyBelow: value }
  : entry)

const cleanMatch = (match = {}) => Object.fromEntries(Object.entries({
  url: isNonEmptyString(match.url) ? match.url.trim() : undefined,
  partNumber: isNonEmptyString(match.partNumber) ? match.partNumber.trim() : undefined,
  titleWords: Array.isArray(match.titleWords)
    ? match.titleWords.map((word) => String(word).trim()).filter(Boolean)
    : undefined,
  retailer: isNonEmptyString(match.retailer) ? match.retailer.trim() : undefined
}).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)))

const withCompactTuning = (config) => {
  const tuning = tuningOf(config)
  const compact = Object.fromEntries([
    ...['categories', 'sites', 'searches', 'direct']
      .filter((key) => Object.keys(tuning[key]).length > 0)
      .map((key) => [key, tuning[key]]),
    ...(tuning.never.length > 0 ? [['never', tuning.never]] : [])
  ])
  const { tuning: dropped, ...rest } = config
  return Object.keys(compact).length > 0 ? { ...rest, tuning: compact } : rest
}

const neverReason = (rule) =>
  `You rejected this product (rule "${rule.label}", ${String(rule.at ?? '').slice(0, 10)})`

const neverPromptLine = (rule) => {
  const match = rule.match ?? {}
  const details = [
    match.partNumber && `part ${match.partNumber}`,
    match.titleWords?.length && `title has "${match.titleWords.join(' ')}"`,
    match.retailer && `at ${match.retailer}`,
    match.url && `URL ${match.url}`
  ].filter(Boolean).join('; ')
  const when = String(rule.at ?? '').slice(0, 10)
  const line = `- ${rule.label}${details ? ` (${details})` : ''}: the buyer rejected it on ${when}`
  return line.length > PROMPT_NEVER_LENGTH ? `${line.slice(0, PROMPT_NEVER_LENGTH - 3)}...` : line
}

const inSaleWindow = ({ item, today }) => Boolean(today) && (item.sources.seasonalSearches ?? [])
  .some(({ from, until }) => String(from).slice(0, 10) <= today
    && today < String(until).slice(0, 10))

const allPhrases = (config) => [
  ...(config.sources?.searches ?? []),
  ...(config.sources?.seasonalSearches ?? []).map((entry) => entry?.phrase)
].filter((phrase) => typeof phrase === 'string')

const pickKeys = ({ entries, keep }) =>
  Object.fromEntries(Object.entries(entries).filter(([key]) => keep.has(key)))

const without = (entries, key) =>
  Object.fromEntries(Object.entries(entries).filter(([name]) => name !== key))

const sameUrl = (a, b) => Boolean(b) && normaliseUrl(a) === normaliseUrl(b)

const normaliseUrl = (url) => String(url ?? '').trim().toLowerCase()
  .replace(/[?#].*$/, '')
  .replace(/\/+$/, '')

const hasPartNumber = ({ partNumber, listing }) => {
  const token = compact(partNumber)
  if (!token) return false
  return [listing.title, listing.evidence, listing.notes].some((text) =>
    compact(text).includes(token))
}

const hasTitleWords = ({ words, listing }) => {
  const titleTokens = new Set(tokens(listing.title))
  return words.every((word) => tokens(word).every((token) => titleTokens.has(token)))
}

const sameRetailer = (a, b) =>
  String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

const tokens = (text) => String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const compact = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, '')

const siteKey = (name) => String(name ?? '').trim().toLowerCase()

const slug = (text) => String(text ?? '').toLowerCase().normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48)
  .replace(/-+$/, '')

const countOf = (count, word) => (count > 0 ? `${count} ${word}${count === 1 ? '' : 's'}` : null)

const clip = (text, max) => String(text ?? '').trim().slice(0, max)

const objectOr = (value) => (isObject(value) ? value : {})

const cloneJson = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== ''
