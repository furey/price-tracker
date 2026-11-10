import { ACCESSORY_CATEGORY } from './kits.js'
import { withCurrentKeys } from './legacy-keys.js'
import { linkUrl, publicUrlProblem } from './url-rules.js'

const SOURCE_STATUSES = ['ok', 'blocked', 'error', 'not_found']
export const MAX_LISTINGS = 200
export const MAX_SOURCES = 60
export const MAX_PRICE = 200000
export const RESEARCH_CONTRACT = 2
export const TEXT_LIMITS = {
  retailer: 80, title: 300, evidence: 500, notes: 500, rejectReason: 300,
  sourceName: 120, sourceNote: 200
}
const CLIP_MARK = '...'

export const validateResearch = ({
  data: raw, categoryIds, partIds = null, maxPrice = MAX_PRICE
}) => {
  const data = withCurrentKeys(raw)
  const errors = []
  const warnings = []
  if (!isObject(data)) {
    return { ok: false, errors: ['root: expected object'], warnings, value: null }
  }
  const checkedAt = readIsoString({ value: data.checkedAt, path: 'checkedAt', errors })
  const sources = capArray({
    items: readArray({ value: data.sources, path: 'sources', errors }),
    max: MAX_SOURCES, path: 'sources', warnings
  }).map((source, index) => readSource({ source, path: `sources[${index}]`, errors }))
  const listings = capArray({
    items: readArray({ value: data.listings, path: 'listings', errors }),
    max: MAX_LISTINGS, path: 'listings', warnings
  }).map((listing, index) =>
    readListing({ listing, path: `listings[${index}]`, categoryIds, partIds, errors, maxPrice }))
  const ok = errors.length === 0
  const value = ok ? { contract: RESEARCH_CONTRACT, checkedAt, sources, listings } : null
  return { ok, errors, warnings, value }
}

const readSource = ({ source, path, errors }) => {
  if (!isObject(source)) return fail({ path, expected: 'object', errors })
  const url = linkUrl(source.url)
  return {
    name: clip(readString({ value: source.name, path: `${path}.name`, errors }),
      TEXT_LIMITS.sourceName),
    status: readEnum({
      value: source.status, path: `${path}.status`, options: SOURCE_STATUSES, errors
    }),
    note: clip(readNullableString({ value: source.note, path: `${path}.note`, errors }),
      TEXT_LIMITS.sourceNote) ?? '',
    ...(url ? { url } : {})
  }
}

const readListing = ({ listing, path, categoryIds, partIds, errors, maxPrice }) => {
  if (!isObject(listing)) return fail({ path, expected: 'object', errors })
  const part = readPart({ value: listing.part, path: `${path}.part`, partIds, errors })
  const field = (name) => `${path}.${name}`
  const text = (name) => clip(
    readNullableString({ value: listing[name], path: field(name), errors }),
    TEXT_LIMITS[name]
  )
  const required = (name) => clip(
    readString({ value: listing[name], path: field(name), errors }),
    TEXT_LIMITS[name]
  )
  const price = (name) => readPrice({ value: listing[name], path: field(name), errors, maxPrice })
  const flag = (name) => readBoolean({ value: listing[name], path: field(name), errors })
  const unitCount = readUnitCount({ value: listing.unitCount, path: field('unitCount'), errors })
  return {
    retailer: required('retailer'),
    title: required('title'),
    category: readEnum({
      value: listing.category,
      path: field('category'),
      options: part ? [...categoryIds, 'reject', ACCESSORY_CATEGORY] : [...categoryIds, 'reject'],
      errors
    }),
    part,
    rejectReason: text('rejectReason'),
    price: price('price'),
    wasPrice: price('wasPrice'),
    effectivePrice: price('effectivePrice'),
    deliveryCost: readDelivery({
      value: listing.deliveryCost, path: field('deliveryCost'), errors, maxPrice
    }),
    isClearance: flag('isClearance'),
    inStock: flag('inStock'),
    verified: flag('verified'),
    url: readUrl({ value: listing.url, path: field('url'), errors }),
    evidence: text('evidence'),
    notes: text('notes'),
    ...(unitCount === null ? {} : { unitCount })
  }
}

const readUnitCount = ({ value, path, errors }) => {
  if (value === null || value === undefined) return null
  const isCount = typeof value === 'number' && Number.isFinite(value)
    && value > 0 && value <= MAX_UNIT_COUNT
  return isCount ? value : fail({ path, expected: `number from 0 to ${MAX_UNIT_COUNT}`, errors })
}

const MAX_UNIT_COUNT = 100_000

const readPart = ({ value, path, partIds, errors }) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return fail({ path, expected: 'string or null', errors })
  if (partIds && !partIds.includes(value)) {
    return fail({ path, expected: `one of ${partIds.join(', ') || 'no parts'}`, errors })
  }
  return value
}

const readIsoString = ({ value, path, errors }) => {
  const isValid = typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value))
  return isValid ? value : fail({ path, expected: 'ISO date string', errors })
}

const readString = ({ value, path, errors }) =>
  typeof value === 'string' && value.trim() !== ''
    ? value
    : fail({ path, expected: 'non-empty string', errors })

const readNullableString = ({ value, path, errors }) => {
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : fail({ path, expected: 'string or null', errors })
}

const readNullableNumber = ({ value, path, errors }) => {
  if (value === null || value === undefined) return null
  return Number.isFinite(value) ? value : fail({ path, expected: 'number or null', errors })
}

const readPrice = ({ value, path, errors, maxPrice }) => {
  const amount = readNullableNumber({ value, path, errors })
  if (amount === null) return null
  return amount > 0 && amount <= maxPrice
    ? amount
    : fail({ path, expected: `price above 0 and at most ${maxPrice}, or null`, errors })
}

const readDelivery = ({ value, path, errors, maxPrice }) => {
  const amount = readNullableNumber({ value, path, errors })
  if (amount === null) return null
  return amount >= 0 && amount <= maxPrice
    ? amount
    : fail({ path, expected: `amount from 0 to ${maxPrice}, or null`, errors })
}

const readBoolean = ({ value, path, errors }) =>
  typeof value === 'boolean' ? value : fail({ path, expected: 'boolean', errors })

const readEnum = ({ value, path, options, errors }) =>
  options.includes(value)
    ? value
    : fail({ path, expected: `one of ${options.join(', ')}`, errors })

const readUrl = ({ value, path, errors }) => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || publicUrlProblem(value)) {
    return fail({ path, expected: 'public http(s) URL or null', errors })
  }
  return new URL(value.trim()).href
}

const readArray = ({ value, path, errors }) => {
  if (Array.isArray(value)) return value
  fail({ path, expected: 'array', errors })
  return []
}

const capArray = ({ items, max, path, warnings }) => {
  if (items.length <= max) return items
  warnings.push(`${path}: kept the first ${max} of ${items.length}`)
  return items.slice(0, max)
}

const clip = (text, max) => {
  if (typeof text !== 'string' || !max || text.length <= max) return text
  return `${text.slice(0, max - CLIP_MARK.length).trimEnd()}${CLIP_MARK}`
}

const fail = ({ path, expected, errors }) => {
  errors.push(`${path}: expected ${expected}`)
  return null
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
