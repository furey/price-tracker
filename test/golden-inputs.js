import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const GOLDEN_DIR = resolve(ROOT, 'test/fixtures/golden')

export const GOLDEN_NOW = new Date('2026-11-07T00:00:00Z')

export const goldenItem = (id) =>
  JSON.parse(readFileSync(resolve(ROOT, `items/${id}.json`), 'utf8'))

export const GOLDEN_DELIVERY = { suburb: 'Newtown', postcode: '2042' }

export const GOLDEN_MEMBERSHIPS = ['eBay Plus', 'Bunnings PowerPass']

export const GOLDEN_RECENT_SITES = [
  { name: 'Bing Lee', url: 'https://www.binglee.com.au/' },
  { name: 'Costco', url: 'https://www.costco.com.au/' }
]

export const GOLDEN_URL_SETS = {
  none: [],
  mixed: [
    'https://www.myer.com.au/p/item',
    'https://www.example-shop.com/products/item',
    'https://shop.example.co.nz/item',
    'not a url',
    'ftp://files.example.com/x'
  ]
}

export const GOLDEN_INPUT = {
  request: 'A Dyson V15 Detect cordless vacuum',
  budget: 900,
  budgetMode: 'around',
  needBy: '2026-12-20',
  quantity: 2,
  mustHaves: ['laser head', 'HEPA'],
  links: ['https://www.dyson.com.au/v15', 'https://www.example-shop.com/products/v15']
}

export const GOLDEN_EXISTING = [
  { id: 'karcher-k7', name: 'Kärcher K7', product: 'A genuine Kärcher K7 pressure washer.' }
]

export const GOLDEN_ROUNDS = [{
  questions: [{
    id: 'q1',
    text: 'Which V15 kit would you be happy with?',
    multi: true,
    choices: [
      { id: 'c1', label: 'V15 Detect Absolute' },
      { id: 'c2', label: 'V15 Detect Total Clean' }
    ]
  }],
  answers: [{ questionId: 'q1', choiceIds: ['c2', 'c1'], other: 'any colour' }]
}]

export const GOLDEN_CURRENT_DRAFT = {
  name: 'Dyson V15 Detect',
  rules: { 'v15-absolute': { maxPrice: 899, rrp: 1399, minPctBelowRrp: 35 } }
}

export const GOLDEN_FAILING_SITES = ['The Good Guys', 'Officeworks']

export const LEGACY_PROMPT_KEYS = [
  ['effectivePriceAud', 'effectivePrice'],
  ['wasPriceAud', 'wasPrice'],
  ['deliveryAud', 'deliveryCost'],
  ['priceAud', 'price']
]

export const withRenamedKeys = (text) => LEGACY_PROMPT_KEYS.reduce(
  (result, [from, to]) => result.replaceAll(from, to),
  text
)
