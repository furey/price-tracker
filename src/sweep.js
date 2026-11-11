import { isBotCheck, isRateLimited, latestDecidingCheck } from './bot-checks.js'

export const SWEEP_DAYS = 30

export const sweepItem = ({ item, rows, delivery = null }) => {
  const sources = rows
    .filter(({ kind, state }) => SWEEP_KINDS.includes(kind) && !OFF_STATES.includes(state))
    .map((row) => ({ row, latest: latestDecidingCheck(row.recent) }))
    .filter(({ latest }) => latest && latest.mode !== MANUAL_MODE && latest.status === 'blocked')
    .filter(({ latest }) => !isRateLimited(latest))
    .map(({ row, latest }) => ({
      kind: row.kind,
      name: row.name,
      at: latest.at,
      note: latest.note ?? '',
      url: latest.url ?? null,
      botCheck: isBotCheck(latest)
    }))
  if (sources.length === 0) return null
  return {
    itemId: item.id,
    itemName: item.name,
    product: item.product ?? '',
    categories: (item.categories ?? []).map(({ id, description }) => ({ id, description })),
    delivery,
    sources
  }
}

export const sweepPrompt = ({ items, labels = AU_LABELS }) => [
  'Check these prices in this Chrome browser for my Price Tracker app.',
  '',
  'Rules:',
  ...RULES.map((rule) => `- ${rule}`),
  ...locationRules(labels),
  '',
  ...items.flatMap((item) => itemSection({ ...item, labels })),
  'When you finish the pages, tell me what you checked, what failed, and every sign-up',
  'discount you saw. Then end your reply with one ```json block per item, in this shape:',
  '',
  JSON.stringify(EXAMPLE, null, 2),
  '',
  'Set "itemId" to the item id above.',
  'Use one entry in "sources" per page, with status ok, blocked, error, or not_found.',
  'Use one entry in "listings" per product you can see, with a category id from that item,',
  'or "reject" with a rejectReason. Use null for a number you cannot see.',
  'isClearance, inStock, and verified must be true or false, never null. Use false when the page',
  'does not show it.'
].join('\n')

export const parseSweepReply = (text) => {
  const blocks = [...String(text ?? '').matchAll(CODE_BLOCK)].map(([, body]) => body)
  if (blocks.length === 0) return { results: [], problems: ['No ```json block found.'] }
  const parsed = blocks.map((body, index) => parseBlock({ body, number: index + 1 }))
  return {
    results: parsed.filter(({ result }) => result).map(({ result }) => result),
    problems: parsed.filter(({ problem }) => problem).map(({ problem }) => problem)
  }
}

const SWEEP_KINDS = ['site', 'direct']
const OFF_STATES = ['muted', 'off']
const MANUAL_MODE = 'manual'
const CODE_BLOCK = /```(?:json)?[ \t]*\r?\n([\s\S]*?)```/g
const AU_LABELS = { postcode: 'postcode', locality: 'suburb' }

const RULES = [
  'Open each page one at a time, at a normal reading pace.',
  'Read the price that a shopper sees on the page. Do not use hidden page data.',
  'If a CAPTCHA, bot check, or sign-in page shows, stop and ask me to solve it.',
  'Never try to get past a block. If I do not solve it, mark the source blocked.',
  'Record only what the page shows. Never guess a price or a stock level.',
  'Close newsletter, cookie, and other pop-ups that cover the page, then carry on.',
  'Never sign me up, subscribe, or enter my email. If a pop-up offers a discount for '
    + 'signing up,\n  close it, put the offer and its terms in that source\'s note, '
    + 'and list it in your report.'
]

const locationRules = ({ postcode, locality }) => [
  `- A store or ${postcode} prompt is not a block. When a site asks where you are, to show`,
  `  stock or a price, enter the ${locality} and ${postcode} listed for that item.`,
  `  If the site asks you to pick a store, pick the one nearest that ${postcode}.`,
  `  If the item lists none, close the prompt and carry on.`,
  '- You cannot see or press Chrome\'s own pop-ups, such as "wants to know your location".',
  '  If a page stalls, shows nothing, or waits on a location, stop and ask me to answer any',
  '  browser pop-up. Wait for my reply, then check the page again.',
  '- Before you mark a source blocked or error, tell me why and wait for my reply.'
]

const EXAMPLE = {
  itemId: '<item id>',
  checkedAt: '<ISO date and time of the check>',
  sources: [{ name: '<site name>', status: 'ok', note: 'Checked in Chrome' }],
  listings: [{
    retailer: '<site name>',
    title: '<product title on the page>',
    category: '<category id>',
    rejectReason: null,
    price: 0,
    wasPrice: null,
    effectivePrice: 0,
    deliveryCost: null,
    isClearance: false,
    inStock: true,
    verified: true,
    url: '<product page address>',
    evidence: '<the price text you saw>',
    notes: 'Checked in Chrome'
  }]
}

const itemSection = ({ itemId, itemName, product, categories, delivery, sources, labels }) => [
  `Item: ${itemName} (id ${itemId})`,
  ...(product ? [`What I want: ${product}`] : []),
  ...(delivery ? [deliveryLine({ delivery, labels })] : []),
  'Category ids, best first:',
  ...categories.map(({ id, description }) => `- ${id}: ${description}`),
  'Pages to check:',
  ...sources.map(sourceLine),
  ''
]

const sourceLine = ({ name, url }) => (url
  ? `- ${name}: ${url}`
  : `- ${name}: no page known; search the site for the item`)

const deliveryLine = ({ delivery: { suburb, postcode }, labels }) => (suburb
  ? `My ${labels.locality} and ${labels.postcode}: ${suburb} ${postcode}`
  : `My ${labels.postcode}: ${postcode}`)

const parseBlock = ({ body, number }) => {
  try {
    const { itemId, ...data } = JSON.parse(body)
    if (typeof itemId !== 'string' || !itemId) {
      return { problem: `Block ${number} has no "itemId".` }
    }
    return { result: { itemId, data } }
  } catch {
    return { problem: `Block ${number} is not valid JSON.` }
  }
}
