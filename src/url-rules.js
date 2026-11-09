export const MAX_URL_LENGTH = 2000

export const publicUrlProblem = (url) => {
  if (typeof url !== 'string' || url.trim() === '') return 'Enter a web address'
  if (url.length > MAX_URL_LENGTH) return 'The web address is too long'
  const parsed = parseUrl(url.trim())
  if (!parsed) return 'Not a valid web address'
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'Only http and https addresses work'
  if (parsed.username || parsed.password) return 'Remove the user name or password from the address'
  if (parsed.port) return 'Only the standard web ports work'
  return hostProblem({ hostname: parsed.hostname, rawHost: rawHostOf(url.trim()) })
}

export const linkUrl = (value) => {
  if (typeof value !== 'string' || publicUrlProblem(value)) return null
  return new URL(value.trim()).href
}

export const publicUrl = (value, maxLength = MAX_URL_LENGTH) => {
  if (typeof value !== 'string' || value.length > maxLength) return null
  if (publicUrlProblem(value)) return null
  const parsed = new URL(value.trim())
  return isPublicHostname(parsed.hostname) ? parsed.toString() : null
}

export const isPublicHostname = (hostname) => {
  const host = normaliseHost(hostname)
  if (!host || !host.includes('.')) return false
  if (host.startsWith('[') || host.includes(':') || /^[0-9.]+$/.test(host)) return false
  if (/^0x/i.test(host)) return false
  return !hasSuffix({ host, suffixes: NON_PUBLIC_SUFFIXES })
}

export const isBlockedAddress = (address) => {
  const ip = String(address ?? '').replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase()
  const ipv4 = ipv4Bytes(ip)
  if (ipv4) return inRanges({ bytes: ipv4, ranges: BLOCKED_IPV4 })
  const ipv6 = ipv6Bytes(ip)
  if (!ipv6) return true
  if (inRanges({ bytes: ipv6, ranges: BLOCKED_IPV6 })) return true
  const embedded = embeddedIpv4(ipv6)
  return embedded !== null && inRanges({ bytes: embedded, ranges: BLOCKED_IPV4 })
}

const PRIVATE_SUFFIXES = [
  'localhost', 'local', 'lan', 'home', 'internal', 'intranet', 'corp', 'arpa', 'localdomain'
]

const NON_PUBLIC_SUFFIXES = [...PRIVATE_SUFFIXES, 'test', 'invalid', 'example']

const BLOCKED_IPV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]
].map(([network, prefix]) => ({ network, prefix }))

const BLOCKED_IPV6 = [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10],
  ['fec0::', 10], ['ff00::', 8]
].map(([network, prefix]) => ({ network, prefix }))

const hostProblem = ({ hostname, rawHost }) => {
  const host = normaliseHost(hostname)
  if (host.startsWith('[')) {
    return isBlockedAddress(host) ? 'That address is on a private network' : null
  }
  if (ipv4Bytes(host)) {
    if (rawHost !== host) return 'Write the IP address in the usual dotted form'
    return isBlockedAddress(host) ? 'That address is on a private network' : null
  }
  if (!host.includes('.')) return 'Use a full public web address'
  if (hasSuffix({ host, suffixes: PRIVATE_SUFFIXES })) return 'That address is on a private network'
  return null
}

const inRanges = ({ bytes, ranges }) => ranges.some((range) => inRange({ bytes, range }))

const inRange = ({ bytes, range }) => {
  const network = ipv4Bytes(range.network) ?? ipv6Bytes(range.network)
  const fullBytes = Math.floor(range.prefix / 8)
  for (let index = 0; index < fullBytes; index += 1) {
    if (bytes[index] !== network[index]) return false
  }
  const remainingBits = range.prefix % 8
  if (remainingBits === 0) return true
  const mask = (0xff << (8 - remainingBits)) & 0xff
  return (bytes[fullBytes] & mask) === (network[fullBytes] & mask)
}

const embeddedIpv4 = (bytes) => {
  const zeros = (from, to) => bytes.slice(from, to).every((byte) => byte === 0)
  const mapped = zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff
  const compatible = zeros(0, 12)
  const nat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b
    && zeros(4, 12)
  if (mapped || compatible || nat64) return bytes.slice(12, 16)
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6)
  return null
}

const ipv4Bytes = (text) => {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null
  const bytes = text.split('.').map(Number)
  return bytes.every((byte) => byte <= 255) ? bytes : null
}

const ipv6Bytes = (text) => {
  if (!text.includes(':') || !/^[0-9a-f:.]+$/.test(text)) return null
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1]
  const tailBytes = tail ? ipv4Bytes(tail) : null
  if (tail && !tailBytes) return null
  const hex = tailBytes
    ? `${text.slice(0, -tail.length)}${hexWord(tailBytes[0], tailBytes[1])}:`
      + hexWord(tailBytes[2], tailBytes[3])
    : text
  return hexWordsToBytes(hex)
}

const hexWordsToBytes = (hex) => {
  const parts = hex.split('::')
  if (parts.length > 2) return null
  const words = (part) => (part ? part.split(':') : [])
  const head = words(parts[0])
  const tail = words(parts[1])
  const missing = 8 - head.length - tail.length
  if (parts.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...head, ...Array(Math.max(missing, 0)).fill('0'), ...tail]
  if (!all.every((word) => /^[0-9a-f]{1,4}$/.test(word))) return null
  return all.flatMap((word) => {
    const value = Number.parseInt(word, 16)
    return [value >> 8, value & 0xff]
  })
}

const hexWord = (high, low) => ((high << 8) + low).toString(16)

const rawHostOf = (url) => {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\\]*)/i.exec(url)?.[1] ?? ''
  return normaliseHost(authority.replace(/^.*@/, '').replace(/:\d*$/, ''))
}

const normaliseHost = (hostname) => String(hostname ?? '').toLowerCase().replace(/\.$/, '')

const hasSuffix = ({ host, suffixes }) =>
  suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))

const parseUrl = (value) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}
