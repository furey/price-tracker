import { Cron } from 'croner'
import { DIRECT_PARSERS } from './direct-parsers.js'
import { accessoryPartIds } from './kits.js'
import { validateTuning } from './tuning.js'
import { publicUrlProblem } from './url-rules.js'
import { variantFilterProblem } from './variant-filter.js'

export const validateItem = (item, fileName = null) => {
  if (!isObject(item)) return ['item: expected an object']
  return [
    ...validateIdentity({ item, fileName }),
    ...validateCategories(item),
    ...validateRules(item),
    ...validateSchedules(item),
    ...validateKits(item),
    ...validateDirect(item),
    ...validateNtfy(item),
    ...validateSources(item),
    ...validateDedupe(item),
    ...validateHeartbeat(item),
    ...validateDeadline(item),
    ...validateAccept(item),
    ...validateUnit(item),
    ...validateResearchOptions(item),
    ...validateTuning(item)
  ]
}

const validateIdentity = ({ item, fileName }) => {
  const errors = []
  if (!isNonEmptyString(item.id)) errors.push('id: expected a non-empty string')
  if (!isNonEmptyString(item.name)) errors.push('name: expected a non-empty string')
  if (!isNonEmptyString(item.product)) errors.push('product: expected a non-empty string')
  if (fileName && item.id !== fileName) {
    errors.push(`id: "${item.id}" does not match file name "${fileName}"`)
  }
  return errors
}

const validateCategories = (item) => {
  if (!Array.isArray(item.categories) || item.categories.length === 0) {
    return ['categories: expected a non-empty array']
  }
  const ids = item.categories.map((category) => category?.id)
  return item.categories.flatMap((category, index) => {
    if (!isNonEmptyString(category?.id) || !isNonEmptyString(category?.description)) {
      return [`categories[${index}]: expected id and description strings`]
    }
    if (category.id === 'reject') return [`categories[${index}].id: "reject" is reserved`]
    if (!CATEGORY_ID.test(category.id)) {
      return [`categories[${index}].id: use lowercase letters, digits, and hyphens`]
    }
    return ids.indexOf(category.id) === index ? [] : [`categories[${index}].id: duplicate`]
  })
}

const validateRules = (item) => {
  if (!isObject(item.rules)) return ['rules: expected an object']
  const categoryIds = new Set((item.categories ?? []).map((category) => category?.id))
  return Object.entries(item.rules).flatMap(([key, rule]) =>
    categoryIds.has(key)
      ? validateRule({ rule, label: `rules.${key}` })
      : [`rules.${key}: not a category id`]
  )
}

const validateRule = ({ rule, label }) => {
  if (!isObject(rule)) return [`${label}: expected an object`]
  const errors = RULE_PRICE_KEYS.flatMap((key) =>
    isOptionalPositive(rule[key]) ? [] : [`${label}.${key}: expected a positive number or null`])
  const pct = rule.minPctBelowRrp
  if (pct !== undefined && pct !== null && !(isNumber(pct) && pct > 0 && pct < 100)) {
    errors.push(`${label}.minPctBelowRrp: expected a number between 0 and 100, or null`)
  }
  return errors
}

const validateSchedules = (item) => {
  if (!Array.isArray(item.schedules)) return ['schedules: expected an array (empty means off)']
  return item.schedules.flatMap((schedule, index) =>
    validateSchedule({ schedule, label: `schedules[${index}]` })
  )
}

const validateSchedule = ({ schedule, label }) => {
  if (!isNonEmptyString(schedule?.cron) || !isNonEmptyString(schedule?.tz)) {
    return [`${label}: expected cron and tz strings`]
  }
  const errors = []
  const cronError = cronProblem(schedule)
  if (cronError) errors.push(`${label}: ${cronError}`)
  for (const key of ['from', 'until']) {
    if (schedule[key] != null && Number.isNaN(Date.parse(schedule[key]))) {
      errors.push(`${label}.${key}: not a valid date`)
    }
  }
  return errors
}

const validateKits = (item) => {
  const kits = item.kits ?? []
  if (!Array.isArray(kits)) return ['kits: expected an array']
  const categoryIds = new Set((item.categories ?? []).map((category) => category?.id))
  return kits.flatMap((kit, index) =>
    validateKit({ kit, label: `kits[${index}]`, categoryIds }))
}

const validateKit = ({ kit, label, categoryIds }) => {
  if (!isObject(kit)) return [`${label}: expected an object`]
  const errors = []
  if (!isNonEmptyString(kit.id)) errors.push(`${label}.id: expected a non-empty string`)
  if (!isNonEmptyString(kit.name)) errors.push(`${label}.name: expected a non-empty string`)
  if (!categoryIds.has(kit.category)) errors.push(`${label}.category: not a category id`)
  if (!Array.isArray(kit.parts) || kit.parts.length === 0) {
    return [...errors, `${label}.parts: expected a non-empty array`]
  }
  const ids = kit.parts.map((part) => part?.id)
  kit.parts.forEach((part, index) => {
    errors.push(...validateKitPart({
      part, label: `${label}.parts[${index}]`, categoryIds, ids
    }))
  })
  return errors
}

const validateKitPart = ({ part, label, categoryIds, ids }) => {
  if (!isObject(part)) return [`${label}: expected an object`]
  const errors = []
  if (!isNonEmptyString(part.id)) errors.push(`${label}.id: expected a non-empty string`)
  if (ids.filter((id) => id === part.id).length > 1) errors.push(`${label}.id: duplicate`)
  if (part.match !== undefined && !categoryIds.has(part.match)) {
    errors.push(`${label}.match: not a category id`)
  }
  if (part.match === undefined && !isNonEmptyString(part.description)) {
    errors.push(`${label}.description: expected a non-empty string`)
  }
  return errors
}

const validateDirect = (item) => {
  const entries = item.direct ?? []
  if (!Array.isArray(entries)) return ['direct: expected an array']
  const categoryIds = new Set((item.categories ?? []).map((category) => category?.id))
  return [
    ...entries.flatMap((entry, index) =>
      validateDirectEntry({
        entry, label: `direct[${index}]`, categoryIds, partIds: accessoryPartIds(item)
      })),
    ...validateDirectSchedules({ item, entries })
  ]
}

const validateDirectEntry = ({ entry, label, categoryIds, partIds }) => {
  if (!isObject(entry)) return [`${label}: expected an object`]
  const errors = []
  if (!isNonEmptyString(entry.retailer)) errors.push(`${label}.retailer: expected a string`)
  const urlProblem = publicUrlProblem(entry.url)
  if (urlProblem) errors.push(`${label}.url: ${urlProblem}`)
  errors.push(...validateEntryClassification({ entry, label, categoryIds, partIds }))
  if (!DIRECT_PARSERS.includes(entry.parser)) {
    errors.push(`${label}.parser: expected one of ${DIRECT_PARSERS.join(', ')}`)
  }
  const filterError = variantFilterProblem(entry.variantFilter)
  if (filterError) errors.push(`${label}.variantFilter: ${filterError}`)
  return errors
}

const validateEntryClassification = ({ entry, label, categoryIds, partIds }) => {
  if (entry.part === undefined || entry.part === null) {
    return categoryIds.has(entry.category) ? [] : [`${label}.category: not a category id`]
  }
  return partIds.includes(entry.part)
    ? []
    : [`${label}.part: expected one of ${partIds.join(', ') || 'no kit parts'}`]
}

const validateDirectSchedules = ({ item, entries }) => {
  const schedules = item.directSchedules
  if (schedules === undefined) {
    return entries.length > 0 ? ['directSchedules: required when direct is not empty'] : []
  }
  if (!Array.isArray(schedules)) return ['directSchedules: expected an array (empty means off)']
  return schedules.flatMap((schedule, index) =>
    validateSchedule({ schedule, label: `directSchedules[${index}]` }))
}

const cronProblem = ({ cron, tz }) => {
  try {
    new Cron(cron, { timezone: tz })
    return null
  } catch (error) {
    return `cron "${cron}" with tz "${tz}" rejected: ${error.message}`
  }
}

const validateNtfy = (item) => {
  const errors = []
  const topic = item.ntfy?.topic
  if (!isNonEmptyString(topic)) errors.push('ntfy.topic: expected a non-empty string')
  else if (!NTFY_TOPIC.test(topic)) {
    errors.push('ntfy.topic: use letters, digits, hyphens, and underscores (up to 64)')
  }
  if (!isNtfyServer(item.ntfy?.server)) {
    errors.push('ntfy.server: expected an https URL (http only for localhost)')
  }
  const tokenEnv = item.ntfy?.tokenEnv
  if (tokenEnv !== undefined && !(typeof tokenEnv === 'string' && TOKEN_ENV.test(tokenEnv))) {
    errors.push(
      'ntfy.tokenEnv: expected a name like NTFY_TOKEN (NTFY_ then capitals, digits, underscores)'
    )
  }
  return errors
}

const TOKEN_ENV = /^NTFY_[A-Z0-9_]*$/
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const isNtfyServer = (value) => {
  if (!isHttpUrl(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

const validateSources = (item) => {
  const sources = item.sources
  const errors = []
  if (!Array.isArray(sources?.sites)) errors.push('sources.sites: expected an array')
  else errors.push(...sources.sites.flatMap((site, index) => validateSite({ site, index })))
  if (!Array.isArray(sources?.searches)) errors.push('sources.searches: expected an array')
  else {
    errors.push(...sources.searches.flatMap((search, index) =>
      isNonEmptyString(search) ? [] : [`sources.searches[${index}]: expected a non-empty string`]))
  }
  const seasonal = sources?.seasonalSearches ?? []
  if (!Array.isArray(seasonal)) return [...errors, 'sources.seasonalSearches: expected an array']
  return [...errors, ...seasonal.flatMap((entry, index) => validateSeasonal({ entry, index }))]
}

const validateSite = ({ site, index }) => {
  const label = `sources.sites[${index}]`
  if (!isObject(site)) return [`${label}: expected an object`]
  const errors = []
  if (!isNonEmptyString(site.name)) errors.push(`${label}.name: expected a non-empty string`)
  if (site.url !== undefined && site.url !== null && !isHttpUrl(site.url)) {
    errors.push(`${label}.url: expected an http(s) URL`)
  }
  return errors
}

const validateSeasonal = ({ entry, index }) => {
  const label = `sources.seasonalSearches[${index}]`
  if (!isObject(entry)) return [`${label}: expected an object`]
  const errors = []
  if (!isNonEmptyString(entry.phrase)) errors.push(`${label}.phrase: expected a non-empty string`)
  for (const key of ['from', 'until']) {
    if (!isDateString(entry[key])) errors.push(`${label}.${key}: expected a YYYY-MM-DD date`)
  }
  if (isDateString(entry.from) && isDateString(entry.until) && entry.from >= entry.until) {
    errors.push(`${label}.until: must be after from`)
  }
  return errors
}

const validateDedupe = (item) => {
  if (item.dedupe === undefined) return []
  const drop = item.dedupe?.minDrop ?? item.dedupe?.minDropAud
  return isNumber(drop) && drop >= 0 ? [] : ['dedupe.minDrop: expected a number of 0 or more']
}

const validateHeartbeat = (item) => {
  if (item.heartbeat === undefined) return []
  return typeof item.heartbeat?.monthly === 'boolean'
    ? []
    : ['heartbeat.monthly: expected true or false']
}

const validateUnit = (item) => {
  if (item.unit === undefined || item.unit === null) return []
  const name = item.unit?.name
  const valid = isObject(item.unit) && typeof name === 'string'
    && name.trim().length > 0 && name.length <= 30
  return valid ? [] : ['unit.name: expected a short name such as "nappy", up to 30 characters']
}

const validateAccept = (item) => {
  const { accept } = item
  if (accept === undefined) return []
  if (!isObject(accept)) return ['accept: expected an object']
  if (accept.refurbished === undefined) return []
  if (typeof accept.refurbished !== 'boolean') return ['accept.refurbished: expected true or false']
  const hasCategory = (item.categories ?? []).some(({ id } = {}) => id === 'refurbished')
  return accept.refurbished && !hasCategory
    ? ['accept.refurbished: add a "refurbished" category for refurbished stock']
    : []
}

const validateDeadline = (item) => {
  const { deadline } = item
  if (deadline === undefined || deadline === null) return []
  if (!isObject(deadline)) return ['deadline: expected an object']
  const errors = []
  if (!isDayString(deadline.needBy)) errors.push('deadline.needBy: expected a YYYY-MM-DD date')
  if (!isOptionalWhole({ value: deadline.deliveryDays, min: 0, max: 60 })) {
    errors.push('deadline.deliveryDays: expected a whole number from 0 to 60')
  }
  if (!isOptionalWhole({ value: deadline.lastChanceDays, min: 1, max: 30 })) {
    errors.push('deadline.lastChanceDays: expected a whole number from 1 to 30')
  }
  return errors
}

const isDayString = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const isOptionalWhole = ({ value, min, max }) => value === undefined || value === null
  || (Number.isInteger(value) && value >= min && value <= max)

const validateResearchOptions = (item) => {
  const options = item.research
  if (options === undefined) return []
  if (!isObject(options)) return ['research: expected an object']
  const errors = []
  const { maxTurns, timeoutMinutes, model } = options
  if (maxTurns !== undefined && !(Number.isInteger(maxTurns) && maxTurns > 0 && maxTurns <= 500)) {
    errors.push('research.maxTurns: expected a whole number from 1 to 500')
  }
  if (timeoutMinutes !== undefined && !(isNumber(timeoutMinutes) && timeoutMinutes > 0
    && timeoutMinutes <= 120)) {
    errors.push('research.timeoutMinutes: expected a number of minutes from 1 to 120')
  }
  if (model !== undefined && model !== null && !isNonEmptyString(model)) {
    errors.push('research.model: expected a model name or nothing')
  }
  return errors
}

const CATEGORY_ID = /^[a-z0-9][a-z0-9-]*$/
const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/
const RULE_PRICE_KEYS = ['maxPrice', 'maxPriceIfClearance', 'rrp', 'maxPricePerUnit']
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

const isDateString = (value) =>
  typeof value === 'string' && DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value))

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const isOptionalPositive = (value) => value === undefined || value === null
  || (isNumber(value) && value > 0)

const isHttpUrl = (value) => typeof value === 'string' && /^https?:\/\/\S+$/i.test(value)

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== ''
