import { lookup as dnsLookup } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { addAbortSignal, pipeline } from 'node:stream'
import zlib from 'node:zlib'
import { isBlockedAddress, publicUrlProblem } from './url-rules.js'

export const MAX_BODY_BYTES = 5 * 1024 * 1024
export const MAX_REDIRECTS = 5
export const BLOCKED_FETCH_NOTE = 'Could not fetch that page'

export {
  MAX_URL_LENGTH, isBlockedAddress, isPublicHostname, linkUrl, publicUrl, publicUrlProblem
} from './url-rules.js'

export const isUnsafeUrlError = (error) => error?.name === UNSAFE_URL_ERROR

export const unsafeUrlError = (message) =>
  Object.assign(new Error(message), { name: UNSAFE_URL_ERROR })

export const safeFetch = async (url, {
  timeoutMs,
  signal,
  maxBytes = MAX_BODY_BYTES,
  maxRedirects = MAX_REDIRECTS,
  headers = {},
  lookupImpl = dnsLookup,
  requestImpl,
  isBlocked = isBlockedAddress
} = {}) => {
  const deadline = combineSignals({ signal, timeoutMs })
  const lookup = guardedLookup({ lookupImpl, isBlocked })
  let current = checkedUrl(String(url))
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await requestOnce({
      url: current, headers, lookup, requestImpl, signal: deadline, maxBytes
    })
    if (!response.redirectTo) return response
    current = checkedUrl(new URL(response.redirectTo, current).toString())
  }
  throw unsafeUrlError('too many redirects')
}

const UNSAFE_URL_ERROR = 'UnsafeUrlError'
const REDIRECT_STATUSES = [301, 302, 303, 307, 308]

const checkedUrl = (url) => {
  const problem = publicUrlProblem(url)
  if (problem) throw unsafeUrlError(problem)
  return new URL(url.trim()).toString()
}

const requestOnce = ({ url, headers, lookup, requestImpl, signal, maxBytes }) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const target = new URL(url)
    const request = (requestImpl ?? transportFor(target).request)(target, {
      method: 'GET',
      headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers },
      agent: false,
      lookup,
      signal
    }, (response) => {
      const location = response.headers.location
      if (REDIRECT_STATUSES.includes(response.statusCode) && location) {
        response.resume()
        return resolve({ redirectTo: location })
      }
      readBody({ response, maxBytes, signal })
        .then((body) => resolve(responseView({ response, body, url })))
        .catch((error) => reject(signal.aborted ? signal.reason : error))
    })
    request.on('error', (error) => reject(signal.aborted ? signal.reason : error))
    request.end()
  })

const readBody = async ({ response, maxBytes, signal }) => {
  const decoder = decoderFor(response.headers['content-encoding'])
  const source = decoder ? pipeline(response, decoder, () => {}) : response
  addAbortSignal(signal, source)
  const chunks = []
  let size = 0
  for await (const chunk of source) {
    size += chunk.length
    if (size > maxBytes) {
      response.destroy()
      throw new Error('response too large')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const responseView = ({ response, body, url }) => ({
  status: response.statusCode,
  ok: response.statusCode >= 200 && response.statusCode < 300,
  url,
  headers: { get: (name) => headerValue(response.headers[String(name).toLowerCase()]) },
  text: async () => body.toString('utf8'),
  json: async () => JSON.parse(body.toString('utf8'))
})

const guardedLookup = ({ lookupImpl, isBlocked }) => (hostname, options, callback) => {
  lookupImpl(hostname, { ...options, all: true }, (error, addresses, family) => {
    if (error) return callback(error)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family }]
    if (list.length === 0 || !list[0]?.address) {
      return callback(Object.assign(new Error(`no address for ${hostname}`), { code: 'ENOTFOUND' }))
    }
    if (list.some(({ address }) => isBlocked(address))) {
      return callback(unsafeUrlError('The site resolves to a private network address'))
    }
    if (options?.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

const decoderFor = (encoding) => {
  const value = String(encoding ?? '').trim().toLowerCase()
  if (value === 'gzip' || value === 'x-gzip') return zlib.createGunzip()
  if (value === 'deflate') return zlib.createInflate()
  if (value === 'br') return zlib.createBrotliDecompress()
  return null
}

const combineSignals = ({ signal, timeoutMs }) => {
  const signals = [signal, timeoutMs ? AbortSignal.timeout(timeoutMs) : null].filter(Boolean)
  return signals.length > 0 ? AbortSignal.any(signals) : new AbortController().signal
}

const transportFor = (url) => (url.protocol === 'https:' ? https : http)

const headerValue = (value) => (Array.isArray(value) ? value.join(', ') : value ?? null)
