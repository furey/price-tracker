export const withCurrentKeys = (value) => {
  if (Array.isArray(value)) return value.map(withCurrentKeys)
  if (!isPlainObject(value)) return value
  const entries = Object.entries(value)
  const keys = new Set(entries.map(([key]) => key))
  return Object.fromEntries(entries
    .filter(([key]) => !keys.has(currentKey(key)) || currentKey(key) === key)
    .map(([key, inner]) => [currentKey(key), withCurrentKeys(inner)]))
}

export const parseStoredJson = (text) => (text ? withCurrentKeys(JSON.parse(text)) : null)

const currentKey = (key) => (Object.hasOwn(LEGACY_KEYS, key) ? LEGACY_KEYS[key] : key)

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype

const LEGACY_KEYS = {
  priceAud: 'price',
  wasPriceAud: 'wasPrice',
  effectivePriceAud: 'effectivePrice',
  deliveryAud: 'deliveryCost',
  minDropAud: 'minDrop',
  dropAud: 'dropAmount',
  latestDeliveryAud: 'latestDeliveryCost',
  deliveredTotalAud: 'deliveredTotal',
  watchId: 'itemId',
  watchName: 'itemName',
  watchVersion: 'itemVersion'
}
