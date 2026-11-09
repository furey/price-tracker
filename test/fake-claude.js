import { EventEmitter } from 'node:events'

export const fenced = (value) => `Done.\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

export const streamChild = ({ resultText, sessionId = 'sess-1', isError = false, cost = 0.4,
  toolUses = [], rateLimit = null, code = 0, streaming = true }) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 5151
  const lines = [
    { type: 'system', subtype: 'init', session_id: sessionId },
    ...toolUses.map(([name, input]) => ({
      type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] }
    })),
    ...(rateLimit ? [{ type: 'rate_limit_event', rate_limit_info: rateLimit }] : []),
    {
      type: 'result', subtype: isError ? 'error_during_execution' : 'success', is_error: isError,
      result: resultText, session_id: sessionId, total_cost_usd: cost, num_turns: 3
    }
  ]
  setImmediate(() => {
    const shown = streaming ? lines : lines.slice(-1)
    const text = shown.map((line) => JSON.stringify(line)).join('\n')
    child.stdout.emit('data', Buffer.from(text.slice(0, 40)))
    child.stdout.emit('data', Buffer.from(`${text.slice(40)}\n`))
    child.emit('close', code)
  })
  return child
}

export const scriptedClaude = (replies) => {
  const calls = []
  const spawnImpl = (bin, args, options) => {
    calls.push({ bin, args, options, prompt: args[args.indexOf('-p') + 1] })
    const next = replies[calls.length - 1]
    if (!next) throw new Error(`unexpected claude call ${calls.length}`)
    const reply = typeof next === 'function' ? next(calls.at(-1)) : next
    return streamChild({ ...reply, streaming: args.includes('stream-json') })
  }
  return { spawnImpl, calls }
}

export const scopeQuestions = {
  outcome: 'questions',
  title: 'Dyson V15 Detect',
  understood: 'A Dyson V15 Detect cordless vacuum around $900.',
  reason: null,
  duplicateOf: null,
  questions: [
    {
      text: 'Which V15 kit would you be happy with?',
      multi: true,
      choices: [
        { label: 'V15 Detect Absolute', detail: 'Full tool kit, RRP $1,399', recommended: true },
        { label: 'V15 Detect Total Clean', detail: 'More tools, RRP $1,549' }
      ]
    }
  ]
}

export const researchDraft = (overrides = {}) => ({
  outcome: 'draft',
  name: 'Dyson V15 Detect',
  product: 'A new Dyson V15 Detect cordless stick vacuum sold by an Australian retailer.',
  rejects: ['Dyson V12 Detect Slim', 'Refurbished units'],
  categories: [
    { id: 'v15-absolute', label: 'V15 Detect Absolute', description: 'Dyson V15 Detect Absolute.' }
  ],
  rules: { 'v15-absolute': { maxPrice: 899, rrp: 1399, minPctBelowRrp: 35 } },
  reasoning: {
    'v15-absolute': {
      rrp: 1399, lowestNow: 949, lowest12Months: 849, why: 'Dropped to $849 last Black Friday.',
      evidence: ['https://www.ozbargain.com.au/node/123']
    }
  },
  sites: [{ name: 'Dyson AU', url: 'https://www.dyson.com.au/' }, { name: 'JB Hi-Fi' }],
  searches: ['Dyson V15 Detect Absolute'],
  seasonalSearches: [{ phrase: 'Dyson Black Friday', from: '2026-11-20', until: '2026-12-02' }],
  directCandidates: [
    { retailer: 'Vacuum Shop', url: 'https://vacuumshop.com.au/products/dyson-v15-absolute',
      category: 'v15-absolute' },
    { retailer: 'Private', url: 'https://intranet.corp.example.com.au/products/x',
      category: 'v15-absolute' }
  ],
  snapshot: {
    checkedAt: '2026-11-08T10:00:00+11:00',
    sources: [{ name: 'JB Hi-Fi', status: 'ok', note: '' }],
    listings: [{
      retailer: 'JB Hi-Fi', title: 'Dyson V15 Detect Absolute', category: 'v15-absolute',
      rejectReason: null, price: 949, wasPrice: 1399, effectivePrice: 949,
      deliveryCost: 0, isClearance: false, inStock: true, verified: true,
      url: 'https://www.jbhifi.com.au/products/dyson-v15', evidence: 'On the page', notes: ''
    }]
  },
  schedulePreset: null,
  warnings: [],
  ...overrides
})

export const shopifyFetch = ({ price = '929.00' } = {}) => {
  const requests = []
  const fetchImpl = async (url) => {
    requests.push(url)
    if (url.includes('/products.json')) {
      return response({
        products: [{
          handle: 'dyson-v15-absolute',
          title: 'Dyson V15 Detect Absolute',
          variants: [
            { title: 'Default Title', price, compare_at_price: '1399.00', available: true }
          ]
        }]
      })
    }
    return { ok: false, status: 404, text: async () => '' }
  }
  return { fetchImpl, requests }
}

export const publicLookup = async (hostname) => (hostname.includes('intranet')
  ? [{ address: '10.0.0.5', family: 4 }]
  : [{ address: '104.16.0.1', family: 4 }])

const response = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
