import { isBotCheck } from './bot-checks.js'

export const SWEEP_DAYS = 30

export const sweepItem = ({ item, rows, delivery = null }) => {
  const sources = rows
    .filter(({ kind, state }) => SWEEP_KINDS.includes(kind) && !OFF_STATES.includes(state))
    .map((row) => ({ row, latest: row.recent?.[0] }))
    .filter(({ latest }) => latest && latest.mode !== MANUAL_MODE && latest.status === 'blocked')
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

export const sweepPrompt = ({ items, dashboardUrl, labels = AU_LABELS }) => [
  'Check these prices in this Chrome browser for my Price Tracker app.',
  '',
  'Rules:',
  ...RULES.map((rule) => `- ${rule}`),
  ...locationRules(labels),
  '',
  ...items.flatMap((item) => itemSection({ ...item, labels })),
  'When you finish the pages, open the dashboard at',
  `${dashboardUrl ?? DASHBOARD_PLACEHOLDER} in this browser.`,
  'For each item, run this in that dashboard tab, with the item id and the JSON:',
  '',
  'await fetch(\'/api/items/<item id>/observations\', { method: \'POST\',',
  '  headers: { \'content-type\': \'application/json\' }, body: JSON.stringify(<JSON>) })',
  '',
  'The JSON has this shape:',
  '',
  JSON.stringify(EXAMPLE, null, 2),
  '',
  'Use one entry in "sources" per page, with status ok, blocked, error, or not_found.',
  'Use one entry in "listings" per product you can see, with a category id from that item,',
  'or "reject" with a rejectReason. Use null for a number you cannot see.',
  'A 201 reply means the app recorded the prices. Tell me what you recorded and what failed.'
].join('\n')

const SWEEP_KINDS = ['site', 'direct']
const OFF_STATES = ['muted', 'off']
const MANUAL_MODE = 'manual'
const DASHBOARD_PLACEHOLDER = '<your dashboard address>'
const AU_LABELS = { postcode: 'postcode', locality: 'suburb' }

const RULES = [
  'Open each page one at a time, at a normal reading pace.',
  'Read the price that a shopper sees on the page. Do not use hidden page data.',
  'If a CAPTCHA, bot check, or sign-in page shows, stop and ask me to solve it.',
  'Never try to get past a block. If I do not solve it, mark the source blocked.',
  'Record only what the page shows. Never guess a price or a stock level.'
]

const locationRules = ({ postcode, locality }) => [
  `- A store or ${postcode} prompt is not a block. When a site asks where you are, to show`,
  `  stock or a price, enter the ${locality} and ${postcode} listed for that item.`,
  `  If the item lists none, close the prompt and carry on.`,
  '- If the browser asks to share my location, block it and enter the ' +
    `${locality} and ${postcode} instead.`
]

const EXAMPLE = {
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
