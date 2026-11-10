import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { STATE_DIR } from './config.js'
import { ACCESSORY_CATEGORY, kitPartIds } from './kits.js'
import { DEFAULT_REGION } from './regions/index.js'
import { formatPrice } from './text.js'
import {
  promptCategories, promptNeverRules, promptSearches, promptSeasonalSearches, promptSites
} from './tuning.js'
import { acceptsRefurbished } from './refurbished.js'
import { validateResearch } from './validate.js'
import { isLoginError } from './claude-connection.js'

const DEFAULT_MAX_TURNS = 80
const DEFAULT_TOOLS = 'WebSearch,WebFetch'
const CLAUDE_CONFIG_DIR = path.join(STATE_DIR, 'claude-config')
const CHILD_SETTINGS = JSON.stringify({ cleanupPeriodDays: 14 })
const CHILD_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TZ', 'LANG', 'TMPDIR',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'
]
const CHILD_ENV_SWITCHES = {
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1'
}
const DEFAULT_TIMEOUT_MINUTES = 15
const KILL_GRACE_MS = 10000
const BOT_CHECK_SENTENCE = 'If a site shows a CAPTCHA or a bot check, never try to solve it, ' +
  'and write "CAPTCHA" or "bot check" in that source note.'

export const buildPrompt = ({
  item, now = new Date(), delivery = null, memberships = [], recentSites = [],
  region = DEFAULT_REGION
}) => {
  const today = localToday({ now, timeZone: region.timeZone })
  const maxTurns = item.research?.maxTurns ?? DEFAULT_MAX_TURNS
  const rules = researchRules({ today, maxTurns, region, item })
  const ref = ruleNumbers(rules)
  return [
    introSection({ today, region }),
    productSection(item),
    categoriesSection(item),
    unitSection(item),
    notWantedSection(item),
    kitsSection({ item, region }),
    rulesSection({ rules, ref, today, region }),
    schemaSection({ ref, region }),
    deliverySection({ delivery, region }),
    membershipsSection({ memberships, region }),
    sourcesSection({ item, today, recentSites }),
    closingSection()
  ].filter(Boolean).join('\n\n')
}

export const extractJson = (text) => {
  const candidates = [
    lastFencedBlock({ text, pattern: /```json[^\S\n]*\n([\s\S]*?)```/g }),
    lastFencedBlock({ text, pattern: /```[^\n]*\n([\s\S]*?)```/g }),
    text
  ].filter((candidate) => candidate != null)
  let lastError = null
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.trim())
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`No valid JSON found in the reply: ${lastError?.message ?? 'empty reply'}`)
}

export const runClaude = ({
  prompt,
  maxTurns = DEFAULT_MAX_TURNS,
  timeoutMs = DEFAULT_TIMEOUT_MINUTES * 60000,
  model,
  resumeSessionId,
  cwd,
  onEvent,
  onRateLimit,
  signal,
  claudeToken = null,
  tools = DEFAULT_TOOLS,
  allowedTools = null,
  configDir = CLAUDE_CONFIG_DIR,
  spawnImpl = spawn,
  killImpl = process.kill.bind(process),
  killGraceMs = KILL_GRACE_MS
}) =>
  new Promise((resolve, reject) => {
    const args = buildArgs({ prompt, maxTurns, model, resumeSessionId, tools, allowedTools })
    const env = childEnv({ claudeToken, configDir })
    if (env.CLAUDE_CONFIG_DIR === configDir) mkdirSync(configDir, { recursive: true })
    const child = spawnImpl(process.env.CLAUDE_BIN ?? 'claude', args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    })
    const output = {
      stdout: '', stderr: '', pending: '', envelope: null, rateLimit: null, rateLimitSeen: false
    }
    let settled = false
    let killTimer = null
    const settle = (action, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      signal?.removeEventListener('abort', abort)
      action(value)
    }
    const abort = () => {
      killProcessGroup({ child, signal: 'SIGTERM', killImpl })
      const error = new Error('cancelled')
      error.kind = 'cancelled'
      settle(reject, error)
    }
    const timeoutTimer = setTimeout(() => {
      killProcessGroup({ child, signal: 'SIGTERM', killImpl })
      killTimer = setTimeout(
        () => killProcessGroup({ child, signal: 'SIGKILL', killImpl }),
        killGraceMs
      )
      killTimer.unref?.()
      const error = new Error(`claude timed out after ${Math.round(timeoutMs / 1000)} s`)
      error.kind = 'timeout'
      settle(reject, error)
    }, timeoutMs)
    const stopEarly = (reason) => {
      killProcessGroup({ child, signal: 'SIGTERM', killImpl })
      const error = new Error(reason)
      error.kind = 'skipped'
      settle(reject, error)
    }
    const handleRateLimit = (event) => {
      const first = !output.rateLimitSeen
      output.rateLimitSeen = true
      const stop = safelyCall(() => onRateLimit?.(event, { first }))
      if (typeof stop === 'string' && stop) stopEarly(stop)
    }
    child.stdout?.on('data', (chunk) => {
      readStreamChunk({ chunk, output, onEvent, onRateLimit: handleRateLimit })
    })
    child.stderr?.on('data', (chunk) => { output.stderr += chunk })
    child.on('error', (error) => settle(reject, error))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    child.on('close', (code) => {
      clearTimeout(killTimer)
      readStreamChunk({ chunk: '\n', output, onEvent, onRateLimit: handleRateLimit })
      settleFromExit({ code, envelope: output.envelope, output, settle, resolve, reject })
    })
  })

export const describeClaudeEvent = (event) => {
  if (event?.type !== 'assistant') return []
  const content = Array.isArray(event.message?.content) ? event.message.content : []
  return content
    .filter((item) => item?.type === 'tool_use')
    .map(describeToolUse)
    .filter(Boolean)
}

export const webFetchRules = ({ urls = [], region = DEFAULT_REGION } = {}) => {
  const hosts = urls.map(hostOf).filter((host) => host && !isHomeSuffix({ host, region }))
  const domains = [...new Set([...region.fetchDomains, ...hosts])]
  return ['WebSearch', ...domains.map((domain) => `WebFetch(domain:${domain})`)]
}

export const itemUrls = (item) => [
  ...(item?.sources?.sites ?? []).map((site) => site?.url),
  ...(item?.direct ?? []).map((entry) => entry?.url)
]

export const research = async ({
  item,
  now = new Date(),
  delivery = null,
  memberships = [],
  recentSites = [],
  region = DEFAULT_REGION,
  claudeToken = null,
  onRateLimit,
  spawnImpl,
  killImpl,
  log = () => {}
}) => {
  const cwd = path.join(STATE_DIR, 'claude-work')
  mkdirSync(cwd, { recursive: true })
  const settings = {
    maxTurns: item.research?.maxTurns ?? DEFAULT_MAX_TURNS,
    timeoutMs: (item.research?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60000,
    model: item.research?.model,
    cwd,
    claudeToken,
    allowedTools: webFetchRules({ urls: itemUrls(item), region }),
    onRateLimit,
    spawnImpl,
    killImpl
  }
  const categoryIds = item.categories.map((category) => category.id)
  const partIds = kitPartIds(item)
  const prompt = buildPrompt({ item, now, delivery, memberships, recentSites, region })
  const maxPrice = region.maxPrice
  const first = await attempt({
    prompt, settings, categoryIds, partIds, maxPrice, log, label: 'attempt 1'
  })
  if (first.ok) return finalResult({ outcome: first, attempts: 1, costUsd: first.costUsd })
  if (!first.ran) return finalResult({ outcome: first, attempts: 1, costUsd: 0 })
  log(`attempt 1 invalid: ${first.errors.join('; ')}`)
  const nudge = buildNudge(first.errors)
  const second = await retryWithNudge({
    first, prompt, nudge, settings, categoryIds, partIds, maxPrice, log
  })
  return finalResult({
    outcome: second,
    attempts: 2,
    costUsd: first.costUsd + second.costUsd
  })
}

const localToday = ({ now, timeZone }) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)

const isHomeSuffix = ({ host, region }) =>
  region.homeHostSuffixes.some((suffix) => host.endsWith(suffix))

const introSection = ({ today, region }) =>
  [
    `You are a price researcher. Today is ${today} (${region.timeZone} time).`,
    region.research.job,
    'You only collect facts. You do NOT decide whether a listing is a good deal. ' +
      'You do NOT decide whether to send an alert. A separate program makes those decisions.'
  ].join('\n')

const productSection = (item) => `PRODUCT\n${item.product}`

const categoriesSection = (item) => {
  const { active, muted } = promptCategories(item)
  return [
    'CATEGORIES',
    'Give every listing exactly one category id from this list, in preference order, or "reject".',
    ...active.map(categoryLine),
    ...(hasKits(item) ? [accessoryCategoryLine()] : []),
    '- reject: the listing is not the product, or breaks a rule below. ' +
      'Put the reason in rejectReason.',
    ...mutedCategoryLines(muted)
  ].join('\n')
}

const categoryLine = (category) => `- ${category.id}: ${category.description}`

const mutedCategoryLines = (muted) => muted.length === 0 ? [] : [
  'Muted by the buyer (do not target these: do not search for them or spend turns on them). ' +
    'When you see one anyway, still classify it correctly under its own id below, never under ' +
    'another category:',
  ...muted.map((category) => `${categoryLine(category)} (muted: do not target)`)
]

const notWantedSection = (item) => {
  const lines = promptNeverRules(item)
  if (lines.length === 0) return null
  return [
    'NOT WANTED',
    'The buyer rejected these exact products. Do not search for them. When you see one, ' +
      'report it with category "reject", rejectReason "Buyer rejected this product", ' +
      'and its price.',
    ...lines
  ].join('\n')
}

const hasKits = (item) => (item.kits ?? []).length > 0

const accessoryCategoryLine = () =>
  `- ${ACCESSORY_CATEGORY}: a single kit part (see KITS) sold on its own, not the trampoline. ` +
  'Always set part on these listings.'

const kitsSection = ({ item, region }) => {
  if (!hasKits(item)) return null
  return [
    'KITS',
    'The buyer may assemble a bundle from separate parts. For each kit below, ' +
      'also find every part at every source in SOURCES.',
    ...item.kits.flatMap(kitLines),
    'Rules for kit parts:',
    `- Tag each single accessory listing with category "${ACCESSORY_CATEGORY}" and set part to ` +
      'the part id.',
    `- Apply the same ${region.research.kitRules} as every other listing.`,
    '- Report the trampoline itself under its normal category, with part null.',
    `- Also look for any ready-made bundle, from ${region.research.bundleRetailers}, that ` +
      'includes the trampoline plus every kit part. List it under the kit category.',
    '- Check for sales on that ready-made bundle at the brand site and at retailers ' +
      '(for example Black Friday). Record the sale price, with wasPrice when shown.'
  ].join('\n')
}

const kitLines = (kit) => [
  `Kit "${kit.name}" (id ${kit.id}, bundle category ${kit.category}). Parts:`,
  ...kit.parts.map((part) => part.match
    ? `- ${part.id}: the trampoline itself, category ${part.match}`
    : `- ${part.id}: ${part.description}`)
]

const researchRules = ({ today, maxTurns, region, item }) => [
  {
    key: 'search',
    text: () => 'Search every source and every search phrase listed under SOURCES.'
  },
  {
    key: 'listAll',
    text: () => 'List every candidate you find, including candidates you reject. ' +
      'For a reject, set category to "reject" and explain it in rejectReason. ' +
      'Never leave a candidate out.'
  },
  {
    key: 'verify',
    text: () => 'Open the product page of each candidate with WebFetch. ' +
      'Set verified to true only if you saw the price on that product page during this run. ' +
      'Set verified to false if you did not.'
  },
  ...region.research.marketRules,
  ...(acceptsRefurbished(item) ? [REFURBISHED_RULE] : []),
  {
    key: 'blocked',
    text: () => 'If a site blocks you or refuses to load, set that source status to "blocked" ' +
      'and move on. Never try to get around a block. ' +
      `${BOT_CHECK_SENTENCE} ${region.research.fetchScope}`
  },
  {
    key: 'neverInvent',
    text: () => 'Never invent a price, a URL, or a stock state. ' +
      'If you cannot see a value on a page, use null (or false for inStock) and say so in notes.'
  },
  {
    key: 'effective',
    text: () => 'effectivePrice is the price a buyer pays after any gift card, cashback, ' +
      'or promo code you can verify. Without such a promo, it equals price. ' +
      'Describe the promo in notes. Member prices and coupons follow the MEMBERSHIPS section.'
  },
  {
    key: 'retailer',
    text: () => 'Set retailer to the exact source name from SOURCES when the listing is on ' +
      'that site. If a marketplace seller or another party sells the item, put that seller in ' +
      `notes (for example "Sold by X"), not in retailer.${region.research.retailerNote}`
  },
  {
    key: 'turns',
    text: () => `You have at most ${maxTurns} turns. Do not spend them all on one site.`
  }
].map((rule) => ({
  ...rule,
  context: { today, currency: region.currency, refurbished: acceptsRefurbished(item) }
}))

const REFURBISHED_RULE = {
  key: 'refurbished',
  text: () => 'This item accepts refurbished stock: a unit refurbished by the manufacturer, ' +
    'or sold as certified refurbished by a retailer under SOURCES, with a stated warranty. ' +
    'Put every such unit in category "refurbished", never in another category, and give the ' +
    'refurbisher and the warranty in notes. Reject used, open-box, and refurbished units from ' +
    'marketplace third-party sellers.'
}

const unitSection = (item) => {
  const name = item.unit?.name
  if (!name) return null
  return [
    'UNITS',
    `Compare listings by price per ${name}. Add "unitCount" to every listing: the number of ` +
      `${name} units the listing sells (a pack of 54 gives 54, two packs of 54 give 108). ` +
      'Use null when the page does not say. Never guess a count.'
  ].join('\n')
}

const ruleNumbers = (rules) => {
  const numbers = new Map(rules.map(({ key }, index) => [key, index + 1]))
  return (key) => numbers.get(key)
}

const rulesSection = ({ rules, ref }) =>
  [
    'RULES',
    ...rules.map(({ text, context }, index) => `${index + 1}. ${text({ ...context, ref })}`)
  ].join('\n')

const schemaSection = ({ ref, region }) =>
  [
    'OUTPUT',
    'Return one JSON object with exactly this shape:',
    '```json',
    JSON.stringify(schemaExample(region), null, 2),
    '```',
    'Field meanings:',
    '- checkedAt: the time you finished, as an ISO 8601 string.',
    '- sources[].name: the source name as listed under SOURCES. Report every source.',
    '- sources[].status: "ok" (searched and read), "blocked" (the site blocked you), ' +
      '"error" (the site failed to load), or "not_found" (the site has no matching product).',
    '- sources[].note: one short sentence, or an empty string.',
    '- sources[].url: the exact page URL you opened or tried for this source, or null.',
    '- listings[].retailer: the exact source name from SOURCES when the listing is on that ' +
      'site, with no extra words, seller names, or URLs. Otherwise the shop name.',
    '- listings[].title: the product title as shown on the page.',
    '- listings[].category: a category id from CATEGORIES, or "reject".',
    '- listings[].part: a kit part id from KITS for an accessory listing, otherwise null.',
    '- listings[].rejectReason: why you rejected it, or null when category is not "reject".',
    `- listings[].price: the current price in ${region.currency} as a number, ` +
      'or null if unknown.',
    '- listings[].wasPrice: the crossed-out "was" price as a number, or null.',
    `- listings[].effectivePrice: see rule ${ref('effective')}. ` +
      'Use null only if price is null.',
    '- listings[].deliveryCost: the delivery cost as a number (0 for free), or null if unknown.',
    '- listings[].isClearance: true if the page marks the item as clearance, else false.',
    '- listings[].inStock: true only if the page shows the item as available to buy.',
    `- listings[].verified: see rule ${ref('verify')}.`,
    `- listings[].url: ${region.research.urlField}`,
    '- listings[].evidence: the exact text on the page that shows the price and the model.',
    '- listings[].notes: colour, bundle contents, promos, and anything else the product ' +
      'description asks you to note, or an empty string.',
    `Numbers are plain JSON numbers (1049, not "${examplePrice(region)}").`
  ].join('\n')

const examplePrice = (region) =>
  formatPrice({ amount: 1049, currency: region.currency, locale: region.locale })

const schemaExample = (region) => ({
  checkedAt: '2026-01-01T00:00:00+11:00',
  sources: [{
    name: 'Example Retailer', status: 'ok', note: '', url: `https://${region.exampleDomain}/search`
  }],
  listings: [
    {
      retailer: 'Example Retailer',
      title: 'Product title',
      category: 'category-id',
      part: null,
      rejectReason: null,
      price: 0,
      wasPrice: null,
      effectivePrice: 0,
      deliveryCost: null,
      isClearance: false,
      inStock: true,
      verified: true,
      url: `https://${region.exampleDomain}/product`,
      evidence: 'Text seen on the page',
      notes: ''
    }
  ]
})

const sourcesSection = ({ item, today, recentSites }) => {
  const sites = promptSites({ item, recentSites, today })
  const lines = ['SOURCES', 'Sites to check:', ...sites.map(siteLine)]
  lines.push('Search phrases to run:', ...promptSearches(item).map((phrase) => `- ${phrase}`))
  const seasonal = promptSeasonalSearches(item).filter((search) =>
    isActiveOn({ search, today })
  )
  if (seasonal.length > 0) {
    lines.push('Seasonal search phrases (active today):', ...seasonal.map(seasonalLine))
  }
  return lines.join('\n')
}

const siteLine = (site) => {
  const location = site.url ? ` (${site.url})` : ''
  const note = site.note ? `: ${site.note}` : ''
  return `- ${site.name}${location}${note}`
}

const seasonalLine = (search) => `- ${search.phrase}${search.note ? `: ${search.note}` : ''}`

const isActiveOn = ({ search, today }) =>
  String(search.from).slice(0, 10) <= today && today < String(search.until).slice(0, 10)

const deliverySection = ({ delivery, region }) => {
  if (!delivery) return null
  const place = [delivery.suburb, delivery.postcode, region.country].filter(Boolean).join(' ')
  return [
    'DELIVERY',
    `The buyer lives at ${place}.`,
    `Where a page states the delivery cost to this ${region.deliveryLabels.postcode}, or a flat ` +
      'delivery fee that applies',
    'to it, record it in deliveryCost. Never enter it into a checkout, cart, or account form.',
    'If the cost depends on a form you cannot use, leave deliveryCost null.'
  ].join('\n')
}

const membershipsSection = ({ memberships, region }) => {
  const names = memberships ?? []
  return [
    'MEMBERSHIPS',
    names.length > 0
      ? `The buyer holds these memberships: ${names.join(', ')}.`
      : 'The buyer holds no memberships.',
    'Apply a member price or member coupon to effectivePrice only for a membership in that ' +
      `list (${region.research.membershipExample}). Name the promo in notes.`,
    'For a membership not in the list, never apply its trade or member price. Report the normal ' +
      'price instead, or reject the listing with a rejectReason that names the membership.'
  ].join('\n')
}

const closingSection = () =>
  'Return the JSON in one final ```json fenced block and write nothing after it.'

const lastFencedBlock = ({ text, pattern }) => {
  const matches = [...text.matchAll(pattern)]
  return matches.length > 0 ? matches.at(-1)[1] : null
}

const describeToolUse = ({ name, input }) => {
  if (name === 'WebSearch' && input?.query) return `Searched "${clip(input.query, 120)}"`
  if (name === 'WebFetch' && input?.url) return `Opened ${shortPage(input.url)}`
  return null
}

const shortPage = (url) => {
  try {
    const parsed = new URL(url)
    return clip(`${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`, 120)
  } catch {
    return clip(String(url), 120)
  }
}

const clip = (text, max) => {
  const value = String(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

const readStreamChunk = ({ chunk, output, onEvent, onRateLimit }) => {
  output.pending += chunk
  const lines = output.pending.split('\n')
  output.pending = lines.pop()
  for (const line of lines.filter((entry) => entry.trim())) {
    const event = parseEnvelope(line)
    if (!event) continue
    if (event.type === 'result') output.envelope = event
    else if (event.type === 'rate_limit_event') {
      output.rateLimit = event.rate_limit_info ?? null
      onRateLimit(event)
    } else if (typeof onEvent === 'function') safelyCall(() => onEvent(event))
  }
  if (!output.envelope) output.stdout = `${output.stdout}${chunk}`.slice(-2000)
}

const safelyCall = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}

export const childEnv = ({
  claudeToken = null, configDir = CLAUDE_CONFIG_DIR, env = process.env
} = {}) => {
  const token = claudeToken || env.CLAUDE_CODE_OAUTH_TOKEN || null
  const kept = CHILD_ENV_KEYS.filter((key) => env[key]).map((key) => [key, env[key]])
  const localeKeys = Object.keys(env).filter((key) => key.startsWith('LC_'))
  return {
    ...Object.fromEntries(kept),
    ...Object.fromEntries(localeKeys.map((key) => [key, env[key]])),
    ...CHILD_ENV_SWITCHES,
    ...(token
      ? { CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CONFIG_DIR: configDir }
      : configDirFromEnv(env))
  }
}

const configDirFromEnv = (env) =>
  env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR } : {}

const hostOf = (url) => {
  try {
    const parsed = new URL(String(url))
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    const host = parsed.hostname.toLowerCase()
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null
  } catch {
    return null
  }
}

const buildArgs = ({
  prompt, maxTurns, model, resumeSessionId, tools = DEFAULT_TOOLS, allowedTools = null
}) => {
  const args = [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    '--tools', tools,
    ...(tools ? ['--allowedTools', (allowedTools ?? webFetchRules()).join(',')] : []),
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--restricted',
    '--disable-slash-commands',
    '--settings', CHILD_SETTINGS,
    '--max-turns', String(maxTurns)
  ]
  if (model) args.push('--model', model)
  if (resumeSessionId) args.push('--resume', resumeSessionId)
  return args
}

const killProcessGroup = ({ child, signal, killImpl }) => {
  try {
    killImpl(-child.pid, signal)
  } catch {
    try {
      child.kill?.(signal)
    } catch {
      return
    }
  }
}

const settleFromExit = ({ code, envelope, output, settle, resolve, reject }) => {
  if (!envelope) {
    const detail = output.stderr.trim() || output.stdout.trim().slice(0, 300) || 'no output'
    const error = new Error(`claude exited with code ${code}: ${detail}`)
    error.kind = errorKind({ text: detail, rateLimit: output.rateLimit })
    error.resetsAt = resetTime(output.rateLimit)
    return settle(reject, error)
  }
  if (envelope.is_error) {
    const detail = envelope.result || envelope.subtype || 'unknown error'
    const error = new Error(`claude reported an error (${envelope.subtype}): ${detail}`)
    error.sessionId = envelope.session_id
    error.costUsd = envelope.total_cost_usd ?? 0
    error.kind = errorKind({ text: detail, rateLimit: output.rateLimit })
    error.resetsAt = resetTime(output.rateLimit)
    return settle(reject, error)
  }
  if (code !== 0) return settle(reject, new Error(`claude exited with code ${code}`))
  return settle(resolve, {
    envelope,
    resultText: envelope.result ?? '',
    sessionId: envelope.session_id ?? null,
    costUsd: envelope.total_cost_usd ?? 0
  })
}

const USAGE_LIMIT_PATTERN =
  /usage limit|limit reached|rate.?limit|resets? at|out of (?:extra )?usage/i

const errorKind = ({ text, rateLimit }) => {
  if (isLoginError(text)) return 'login'
  if (rateLimit && rateLimit.status && rateLimit.status !== 'allowed') return 'limited'
  return USAGE_LIMIT_PATTERN.test(text) ? 'limited' : 'error'
}

const resetTime = (rateLimit) => {
  const seconds = Number(rateLimit?.resetsAt)
  if (!rateLimit || rateLimit.status === 'allowed' || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

const parseEnvelope = (stdout) => {
  try {
    const parsed = JSON.parse(stdout)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

const attempt = async ({
  prompt, settings, categoryIds, partIds, maxPrice, log, label, resumeSessionId
}) => {
  let run
  try {
    run = await runClaude({ ...settings, prompt, resumeSessionId })
  } catch (error) {
    log(`${label} failed to run: ${error.message}`)
    return {
      ok: false,
      ran: false,
      skipped: error.kind === 'skipped' ? error.message : null,
      loginError: error.kind === 'login',
      errors: [error.message],
      costUsd: error.costUsd ?? 0,
      sessionId: error.sessionId ?? null,
      rawText: ''
    }
  }
  return { ...checkReply({ run, categoryIds, partIds, maxPrice }), ran: true }
}

const checkReply = ({ run, categoryIds, partIds, maxPrice }) => {
  const base = { costUsd: run.costUsd, sessionId: run.sessionId, rawText: run.resultText }
  let parsed
  try {
    parsed = extractJson(run.resultText)
  } catch (error) {
    return { ...base, ok: false, errors: [error.message], data: null }
  }
  const validation = validateResearch({ data: parsed, categoryIds, partIds, maxPrice })
  if (!validation.ok) return { ...base, ok: false, errors: validation.errors, data: null }
  return { ...base, ok: true, errors: [], data: validation.value }
}

const buildNudge = (errors) =>
  'Your last reply was not valid. Return ONLY the JSON object matching the schema, ' +
  `in one \`\`\`json block. Errors: ${errors.slice(0, 20).join('; ')}`

const retryWithNudge = async ({
  first, prompt, nudge, settings, categoryIds, partIds, maxPrice, log
}) => {
  const resumed = first.sessionId
    ? await attempt({
        prompt: nudge,
        settings,
        categoryIds,
        partIds,
        maxPrice,
        log,
        label: 'attempt 2 (resume)',
        resumeSessionId: first.sessionId
      })
    : null
  if (resumed?.ran) return resumed
  return attempt({
    prompt: `${prompt}\n\n${nudge}`,
    settings,
    categoryIds,
    partIds,
    maxPrice,
    log,
    label: 'attempt 2 (fresh)'
  })
}

const finalResult = ({ outcome, attempts, costUsd }) => ({
  ok: outcome.ok,
  data: outcome.data ?? null,
  errors: outcome.errors,
  attempts,
  costUsd,
  sessionId: outcome.sessionId,
  rawText: outcome.rawText,
  skipped: outcome.skipped ?? null,
  loginError: outcome.loginError === true
})
