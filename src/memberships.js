import { DEFAULT_REGION } from './regions/index.js'

export const NO_MEMBERSHIPS = 'none'
export const MAX_MEMBERSHIPS = 20
export const MAX_MEMBERSHIP_LENGTH = 40

export const defaultMemberships = (region = DEFAULT_REGION) => region.memberships.defaults

export const membershipSuggestions = (region = DEFAULT_REGION) =>
  region.memberships.suggestions

export const parseMemberships = (text) => {
  const trimmed = String(text ?? '').trim()
  if (trimmed.toLowerCase() === NO_MEMBERSHIPS) return []
  return uniqueNames(trimmed.split(','))
}

export const formatMemberships = (names) => {
  const unique = uniqueNames(names)
  return unique.length > 0 ? unique.join(', ') : NO_MEMBERSHIPS
}

export const validateMemberships = (text) => {
  const names = parseMemberships(text)
  if (names.length > MAX_MEMBERSHIPS) return `use at most ${MAX_MEMBERSHIPS} memberships`
  if (names.some((name) => name.length > MAX_MEMBERSHIP_LENGTH)) {
    return `each name must be at most ${MAX_MEMBERSHIP_LENGTH} characters`
  }
  if (/[\u0000-\u001f]/.test(text)) return 'must not contain control characters'
  return null
}

export const requiredMembership = ({ url, region = DEFAULT_REGION }) => {
  const host = hostOf(url)
  if (!host) return null
  return region.memberships.requirements
    .find((entry) => entry.host.test(host))?.membership ?? null
}

export const hasMembership = ({ memberships, membership }) =>
  memberships.some((name) => name.toLowerCase() === membership.toLowerCase())

export const gateByMemberships = ({ listings, memberships, region = DEFAULT_REGION }) =>
  listings.map((listing) => gateListing({ listing, memberships, region }))

const gateListing = ({ listing, memberships, region }) => {
  if (listing.category === 'reject') return listing
  const membership = requiredMembership({ url: listing.url, region })
  if (!membership || hasMembership({ memberships, membership })) return listing
  return {
    ...listing,
    category: 'reject',
    rejectReason: `Needs ${membership} (not in your memberships)`
  }
}

const uniqueNames = (names) => {
  const seen = new Set()
  return names
    .map((name) => String(name).trim())
    .filter((name) => {
      const key = name.toLowerCase()
      if (!name || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

const hostOf = (url) => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
