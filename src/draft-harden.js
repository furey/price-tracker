import { randomBytes } from 'node:crypto'
import { DEFAULT_LAST_CHANCE_DAYS } from './last-chance.js'
import { applyRefurbished } from './refurbished.js'
import { DEFAULT_DELIVERY_DAYS } from './draft-schedule.js'
import { topicName } from './topics.js'
import { publicUrl as sharedPublicUrl } from './url-rules.js'
import { validateResearch } from './validate.js'
import { variantFilterProblem } from './variant-filter.js'

export const LIMITS = {
  title: 60,
  understood: 300,
  reason: 600,
  questions: 4,
  choicesMin: 2,
  choicesMax: 5,
  questionText: 200,
  choiceLabel: 100,
  choiceDetail: 200,
  product: 2000,
  productWithRejects: 3200,
  rejects: 12,
  rejectText: 160,
  categories: 8,
  categoryId: 40,
  categoryLabel: 80,
  description: 300,
  why: 600,
  evidence: 5,
  sites: 25,
  siteName: 80,
  note: 200,
  searches: 8,
  searchText: 100,
  seasonal: 6,
  candidates: 12,
  variantFilter: 80,
  url: 500,
  warnings: 8,
  warning: 240,
  snapshotListings: 60,
  snapshotSources: 40,
  listingText: 300,
  name: 60,
  itemId: 48,
  maxPrice: 200_000
}

export class DraftReplyError extends Error {
  constructor(errors) {
    super(`Invalid reply: ${errors.join('; ')}`)
    this.errors = errors
  }
}

export const cleanLine = (value, max) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
  return text ? clip(text, max) : null
}

export const cleanText = (value, max) => {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS_KEEP_NEWLINE, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? clip(text, max) : null
}

export const publicUrl = (value) => sharedPublicUrl(value, LIMITS.url)

export { isPublicHostname, isBlockedAddress as isPrivateAddress } from './url-rules.js'

export const slugify = (text, max = LIMITS.itemId) => String(text ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, max)
  .replace(/-+$/g, '')

export const uniqueSlug = ({ text, taken, fallback = 'item', max = LIMITS.itemId }) => {
  const base = slugify(text, max - 3) || fallback
  if (!taken.has(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return `${base}-${randomBytes(3).toString('hex')}`
}

export const generateTopic = (name) => {
  const slug = slugify(name, 27) || 'item'
  return topicName({ slug, hex: randomBytes(16).toString('hex') })
}

export const parseScopeReply = ({ data, existingIds = [] }) => {
  if (!isObject(data)) throw new DraftReplyError(['root: expected an object'])
  const outcome = data.outcome
  if (!SCOPE_OUTCOMES.includes(outcome)) {
    throw new DraftReplyError([`outcome: expected one of ${SCOPE_OUTCOMES.join(', ')}`])
  }
  const base = {
    outcome,
    title: cleanLine(data.title, LIMITS.title),
    understood: cleanLine(data.understood, LIMITS.understood),
    reason: cleanText(data.reason, LIMITS.reason)
  }
  if (outcome === 'duplicate') {
    const duplicateOf = existingIds.includes(data.duplicateOf) ? data.duplicateOf : null
    if (!duplicateOf) throw new DraftReplyError(['duplicateOf: expected an existing item id'])
    return { ...base, duplicateOf }
  }
  if (outcome === 'questions') return { ...base, questions: parseQuestions(data.questions) }
  if (outcome === 'out_of_scope' && !base.reason) {
    throw new DraftReplyError(['reason: expected a short explanation'])
  }
  return base
}

export const parseResearchReply = ({ data, questionsAllowed }) => {
  if (!isObject(data)) throw new DraftReplyError(['root: expected an object'])
  if (data.outcome === 'questions' && questionsAllowed) {
    return {
      outcome: 'questions',
      understood: cleanLine(data.understood, LIMITS.understood),
      questions: parseQuestions(data.questions)
    }
  }
  if (data.outcome === 'out_of_scope') {
    const reason = cleanText(data.reason, LIMITS.reason)
    if (!reason) throw new DraftReplyError(['reason: expected a short explanation'])
    return { outcome: 'out_of_scope', reason }
  }
  if (data.outcome !== 'draft') {
    const allowed = questionsAllowed ? 'draft, questions, out_of_scope' : 'draft, out_of_scope'
    throw new DraftReplyError([`outcome: expected one of ${allowed}`])
  }
  return { outcome: 'draft', ...parseDraftBody(data) }
}

export const parseDraftBody = (data) => {
  const errors = []
  const categories = parseCategories(data.categories)
  if (categories.length === 0) errors.push('categories: expected 1 to 8 categories')
  const product = cleanText(data.product, LIMITS.product)
  if (!product) errors.push('product: expected the product description')
  const name = cleanLine(data.name, LIMITS.name)
  if (!name) errors.push('name: expected a short item name')
  if (errors.length > 0) throw new DraftReplyError(errors)
  const idMap = new Map(categories.map((category) => [category.sourceId, category.id]))
  return {
    name,
    product,
    rejects: cleanList({ value: data.rejects, max: LIMITS.rejects, length: LIMITS.rejectText }),
    categories: categories.map(({ sourceId, ...category }) => category),
    rules: parseRules({ rules: data.rules, idMap }),
    reasoning: parseReasoning({ reasoning: data.reasoning, idMap }),
    sites: parseSites(data.sites ?? data.sources?.sites),
    searches: cleanList({
      value: data.searches ?? data.sources?.searches, max: LIMITS.searches,
      length: LIMITS.searchText
    }),
    seasonalSearches: parseSeasonal(data.seasonalSearches ?? data.sources?.seasonalSearches),
    directCandidates: parseCandidates({ value: data.directCandidates, idMap }),
    snapshot: parseSnapshot({ snapshot: data.snapshot, idMap }),
    schedulePreset: ['light', 'normal', 'keen'].includes(data.schedulePreset)
      ? data.schedulePreset
      : null,
    warnings: cleanList({ value: data.warnings, max: LIMITS.warnings, length: LIMITS.warning })
  }
}

export const assembleConfig = ({
  draft, id, topic, ntfy, schedules, directSchedules, direct, input
}) => {
  const categoryIds = draft.categories.map((category) => category.id)
  const rules = Object.fromEntries(categoryIds.map((categoryId) => [
    categoryId,
    hardenRule({ rule: draft.rules[categoryId], reasoning: draft.reasoning[categoryId], input })
  ]))
  const config = {
    id,
    name: draft.name,
    product: productText(draft),
    categories: draft.categories.map(({ id: categoryId, description }) =>
      ({ id: categoryId, description })),
    rules,
    sources: {
      sites: draft.sites,
      searches: draft.searches.length > 0 ? draft.searches : [draft.name],
      seasonalSearches: draft.seasonalSearches
    },
    schedules,
    ntfy: { ...ntfy, topic },
    research: { maxTurns: 80, timeoutMinutes: 15 },
    dedupe: { minDrop: suggestedDrop(rules) },
    heartbeat: { monthly: true }
  }
  if (direct.length > 0) {
    config.direct = direct
    config.directSchedules = directSchedules
  }
  if (input?.refurbished) applyRefurbished({ config, accepted: true })
  if (input?.unit) config.unit = { name: input.unit }
  if (input?.needBy) {
    config.deadline = {
      needBy: input.needBy,
      deliveryDays: DEFAULT_DELIVERY_DAYS,
      lastChanceDays: DEFAULT_LAST_CHANCE_DAYS
    }
  }
  return config
}

export const protectConfig = ({ config, trusted }) => ({
  ...stripUnknown(config),
  id: trusted.id,
  ntfy: trusted.ntfy,
  research: trusted.research
})

export const configToDraftShape = ({ config, reasoning = {}, categoryLabels = {} }) => ({
  name: config.name,
  product: config.product,
  rejects: [],
  categories: config.categories.map(({ id, description }) =>
    ({ id, label: categoryLabels[id] ?? id, description })),
  rules: config.rules,
  reasoning,
  sites: config.sources?.sites ?? [],
  searches: config.sources?.searches ?? [],
  seasonalSearches: config.sources?.seasonalSearches ?? [],
  directCandidates: (config.direct ?? []).map(({ retailer, url, category, variantFilter }) =>
    ({ retailer, url, category, ...(variantFilter ? { variantFilter } : {}) }))
})

export const remapSnapshotCategories = ({ snapshot, categoryIds }) => {
  if (!snapshot) return null
  const listings = snapshot.listings.map((listing) => (
    categoryIds.includes(listing.category) || listing.category === 'reject'
      ? listing
      : { ...listing, category: 'reject', rejectReason: listing.rejectReason ?? 'category removed' }
  ))
  return { ...snapshot, listings }
}

const SCOPE_OUTCOMES = ['questions', 'ready', 'out_of_scope', 'duplicate']

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g
const CONTROL_CHARS_KEEP_NEWLINE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g

const KNOWN_KEYS = [
  'id', 'name', 'product', 'categories', 'rules', 'sources', 'schedules', 'direct',
  'directSchedules', 'ntfy', 'research', 'dedupe', 'heartbeat', 'kits', 'deadline',
  'accept', 'unit'
]

const parseQuestions = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DraftReplyError(['questions: expected 1 to 4 questions'])
  }
  const questions = value.slice(0, LIMITS.questions).map(parseQuestion).filter(Boolean)
  if (questions.length === 0) {
    throw new DraftReplyError(['questions: each question needs text and 2 to 5 choices'])
  }
  return questions.map((question, index) => ({ ...question, id: `q${index + 1}` }))
}

const parseQuestion = (question) => {
  if (!isObject(question)) return null
  const text = cleanLine(question.text, LIMITS.questionText)
  const choices = (Array.isArray(question.choices) ? question.choices : [])
    .slice(0, LIMITS.choicesMax)
    .map((choice) => isObject(choice) ? {
      label: cleanLine(choice.label, LIMITS.choiceLabel),
      detail: cleanLine(choice.detail, LIMITS.choiceDetail),
      recommended: choice.recommended === true
    } : null)
    .filter((choice) => choice?.label)
    .map((choice, index) => ({ ...choice, id: CHOICE_IDS[index] }))
  if (!text || choices.length < LIMITS.choicesMin) return null
  return { text, multi: question.multi === true, choices }
}

const CHOICE_IDS = ['a', 'b', 'c', 'd', 'e']

const parseCategories = (value) => {
  if (!Array.isArray(value)) return []
  const taken = new Set(['reject', 'accessory'])
  return value.slice(0, LIMITS.categories).flatMap((category) => {
    if (!isObject(category)) return []
    const description = cleanLine(category.description, LIMITS.description)
    const label = cleanLine(category.label ?? category.id, LIMITS.categoryLabel)
    if (!description || !label) return []
    const id = uniqueSlug({
      text: category.id || label, taken, fallback: 'model', max: LIMITS.categoryId
    })
    taken.add(id)
    return [{ sourceId: String(category.id ?? id), id, label, description }]
  })
}

const parseRules = ({ rules, idMap }) => Object.fromEntries([...idMap].map(([sourceId, id]) => {
  const rule = isObject(rules) ? rules[sourceId] ?? rules[id] : null
  return [id, isObject(rule) ? {
    maxPrice: positive(rule.maxPrice),
    maxPriceIfClearance: positive(rule.maxPriceIfClearance),
    rrp: positive(rule.rrp),
    minPctBelowRrp: percent(rule.minPctBelowRrp),
    maxPricePerUnit: positive(rule.maxPricePerUnit)
  } : {}]
}))

const parseReasoning = ({ reasoning, idMap }) =>
  Object.fromEntries([...idMap].map(([sourceId, id]) => {
    const entry = isObject(reasoning) ? reasoning[sourceId] ?? reasoning[id] : null
    if (!isObject(entry)) return [id, null]
    return [id, {
      rrp: positive(entry.rrp),
      rrpUrl: publicUrl(entry.rrpUrl),
      lowestNow: positive(entry.lowestNow),
      lowest12Months: positive(entry.lowest12Months),
      why: cleanText(entry.why, LIMITS.why),
      evidence: (Array.isArray(entry.evidence) ? entry.evidence : [])
        .map(publicUrl).filter(Boolean).slice(0, LIMITS.evidence)
    }]
  }))

const parseSites = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.flatMap((site) => {
    const name = cleanLine(isObject(site) ? site.name : site, LIMITS.siteName)
    if (!name || seen.has(name.toLowerCase())) return []
    const url = isObject(site) ? publicUrl(site.url) : null
    if (isExcludedMarketplace(`${name} ${url ?? ''}`)) return []
    seen.add(name.toLowerCase())
    const note = isObject(site) ? cleanLine(site.note, LIMITS.note) : null
    return [{ name, ...(url ? { url } : {}), ...(note ? { note } : {}) }]
  }).slice(0, LIMITS.sites)
}

const parseSeasonal = (value) => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!isObject(entry)) return []
    const phrase = cleanLine(entry.phrase, LIMITS.searchText)
    const from = isDay(entry.from) ? entry.from : null
    const until = isDay(entry.until) ? entry.until : null
    if (!phrase || !from || !until || from >= until) return []
    const note = cleanLine(entry.note, LIMITS.note)
    return [{ phrase, from, until, ...(note ? { note } : {}) }]
  }).slice(0, LIMITS.seasonal)
}

const parseCandidates = ({ value, idMap }) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.flatMap((candidate) => {
    if (!isObject(candidate)) return []
    const url = publicUrl(candidate.url)
    const retailer = cleanLine(candidate.retailer, LIMITS.siteName)
    const category = idMap.get(String(candidate.category)) ?? null
    if (!url || !retailer || !category || seen.has(url)) return []
    seen.add(url)
    const variantFilter = safeFilter(candidate.variantFilter)
    return [{ retailer, url, category, ...(variantFilter ? { variantFilter } : {}) }]
  }).slice(0, LIMITS.candidates)
}

const parseSnapshot = ({ snapshot, idMap }) => {
  if (!isObject(snapshot) || !Array.isArray(snapshot.listings)) return null
  const categoryIds = [...idMap.values()]
  const data = {
    checkedAt: isIsoDate(snapshot.checkedAt) ? snapshot.checkedAt : new Date().toISOString(),
    sources: (Array.isArray(snapshot.sources) ? snapshot.sources : [])
      .slice(0, LIMITS.snapshotSources)
      .filter(isObject)
      .map((source) => ({
        name: cleanLine(source.name, LIMITS.siteName) ?? 'Unknown',
        status: ['ok', 'blocked', 'error', 'not_found'].includes(source.status)
          ? source.status
          : 'error',
        note: cleanLine(source.note, LIMITS.note) ?? ''
      })),
    listings: snapshot.listings.slice(0, LIMITS.snapshotListings)
      .filter(isObject)
      .map((listing) => snapshotListing({ listing, idMap }))
      .filter((listing) => listing.retailer && listing.title)
  }
  const { ok, value } = validateResearch({ data, categoryIds })
  return ok ? value : null
}

const snapshotListing = ({ listing, idMap }) => {
  const category = listing.category === 'reject'
    ? 'reject'
    : idMap.get(String(listing.category)) ?? 'reject'
  const price = positive(listing.price)
  return {
    retailer: cleanLine(listing.retailer, LIMITS.siteName),
    title: cleanLine(listing.title, LIMITS.listingText),
    category,
    rejectReason: cleanLine(listing.rejectReason, LIMITS.listingText)
      ?? (category === 'reject' && listing.category !== 'reject' ? 'unknown category' : null),
    price,
    wasPrice: positive(listing.wasPrice),
    effectivePrice: positive(listing.effectivePrice) ?? price,
    deliveryCost: nonNegative(listing.deliveryCost),
    isClearance: listing.isClearance === true,
    inStock: listing.inStock === true,
    verified: listing.verified === true,
    url: publicUrl(listing.url),
    evidence: cleanLine(listing.evidence, LIMITS.listingText),
    notes: cleanLine(listing.notes, LIMITS.listingText) ?? ''
  }
}

const hardenRule = ({ rule = {}, reasoning, input }) => {
  const rrp = rule.rrp ?? reasoning?.rrp ?? null
  const ceiling = Math.min(rrp ? rrp * 3 : LIMITS.maxPrice, LIMITS.maxPrice)
  const hardLimit = input?.budgetMode === 'limit' ? positive(input.budget) : null
  const fallback = fallbackCap({ rrp, reasoning, input })
  const suggested = rule.maxPrice && rule.maxPrice <= ceiling ? rule.maxPrice : fallback
  const maxPrice = hardLimit && suggested && suggested > hardLimit ? hardLimit : suggested
  const clearance = rule.maxPriceIfClearance && maxPrice && rule.maxPriceIfClearance < maxPrice
    ? rule.maxPriceIfClearance
    : null
  return compact({
    maxPrice,
    maxPriceIfClearance: clearance,
    rrp,
    minPctBelowRrp: rrp ? rule.minPctBelowRrp ?? null : null,
    maxPricePerUnit: input?.unit ? rule.maxPricePerUnit ?? null : null
  })
}

const fallbackCap = ({ rrp, reasoning, input }) => {
  if (reasoning?.lowest12Months) return roundTen(reasoning.lowest12Months * 1.04)
  if (rrp) return roundTen(rrp * 0.88)
  return positive(input?.budget)
}

const suggestedDrop = (rules) => {
  const caps = Object.values(rules).map((rule) => rule.maxPrice).filter(Boolean)
  if (caps.length === 0) return 25
  return Math.max(10, Math.round((Math.min(...caps) * 0.03) / 5) * 5)
}

const productText = (draft) => {
  const rejects = draft.rejects.length > 0 ? `\nReject: ${draft.rejects.join('; ')}.` : ''
  return clip(`${draft.product}${rejects}`, LIMITS.productWithRejects)
}

const stripUnknown = (config) => Object.fromEntries(Object.entries(isObject(config) ? config : {})
  .filter(([key]) => KNOWN_KEYS.includes(key)))

const safeFilter = (value) => {
  const text = cleanLine(value, LIMITS.variantFilter)
  return text && !variantFilterProblem(text) ? text : null
}

const cleanList = ({ value, max, length }) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  return value.map((item) => cleanLine(item, length)).filter((item) => {
    if (!item || seen.has(item.toLowerCase())) return false
    seen.add(item.toLowerCase())
    return true
  }).slice(0, max)
}

const compact = (object) => Object.fromEntries(Object.entries(object)
  .filter(([, value]) => value !== null && value !== undefined))

const positive = (value) => {
  const number = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : value
  return Number.isFinite(number) && number > 0 && number <= LIMITS.maxPrice
    ? Math.round(number * 100) / 100
    : null
}

const nonNegative = (value) => (value === 0 ? 0 : positive(value))

const percent = (value) => (Number.isFinite(value) && value >= 1 && value <= 90
  ? Math.round(value)
  : null)

const roundTen = (value) => Math.max(10, Math.round(value / 10) * 10)

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text)

const DAY = /^\d{4}-\d{2}-\d{2}$/

const isDay = (value) => typeof value === 'string' && DAY.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const isIsoDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const isExcludedMarketplace = (text) =>
  /\b(gumtree|facebook|marketplace\.facebook)\b/i.test(text)
