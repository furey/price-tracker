import { formatMoney } from './format.js'
import { describeSchedule } from './schedulePresets.js'
import { tuningChanges } from './tuningView.js'

export const describeChanges = ({ before, after, renames = {} }) => [
  ...basicChanges({ before, after }),
  ...scheduleChanges({ before, after, key: 'schedules', label: 'AI research schedule' }),
  ...scheduleChanges({ before, after, key: 'directSchedules', label: 'Free check schedule' }),
  ...categoryChanges({ before, after, renames }),
  ...ruleChanges({ before, after, renames }),
  ...alertOptionChanges({ before, after }),
  ...listChanges({
    section: 'Sites',
    before: before.sources?.sites,
    after: after.sources?.sites,
    keyOf: (site) => site.name,
    describe: (site) => site.name
  }),
  ...listChanges({
    section: 'Search phrases',
    before: before.sources?.searches,
    after: after.sources?.searches,
    keyOf: (phrase) => phrase,
    describe: (phrase) => `"${phrase}"`
  }),
  ...listChanges({
    section: 'Seasonal searches',
    before: before.sources?.seasonalSearches,
    after: after.sources?.seasonalSearches,
    keyOf: (entry) => entry.phrase,
    describe: (entry) => `"${entry.phrase}" ${entry.from} to ${entry.until}`
  }),
  ...listChanges({
    section: 'Free checks',
    before: before.direct,
    after: after.direct,
    keyOf: (entry) => entry.url,
    describe: (entry) => `${entry.retailer} ${shortUrl(entry.url)}`
  }),
  ...kitChanges({ before, after }),
  ...researchChanges({ before, after }),
  ...tuningChanges({ before, after }),
  ...otherChanges({ before, after })
]

const HANDLED_KEYS = new Set([
  'id', 'name', 'product', 'ntfy', 'schedules', 'directSchedules', 'categories', 'rules',
  'dedupe', 'heartbeat', 'sources', 'direct', 'kits', 'research', 'enabled', 'tuning'
])

const RULE_FIELDS = [
  { key: 'maxPrice', label: 'alert at or below', money: true },
  { key: 'maxPriceIfClearance', label: 'clearance alert at or below', money: true },
  { key: 'rrp', label: 'RRP', money: true },
  { key: 'minPctBelowRrp', label: '% below RRP', money: false }
]

const basicChanges = ({ before, after }) => [
  change({ section: 'Basics', label: 'Name', from: before.name, to: after.name }),
  change({
    section: 'Basics', label: 'ntfy topic', from: before.ntfy?.topic, to: after.ntfy?.topic
  }),
  change({
    section: 'Basics', label: 'ntfy server', from: before.ntfy?.server, to: after.ntfy?.server
  }),
  before.product === after.product ? null : {
    section: 'What to look for',
    label: 'Product description',
    from: `${(before.product ?? '').length} characters`,
    to: `${(after.product ?? '').length} characters`
  }
].filter(Boolean)

const scheduleChanges = ({ before, after, key, label }) => {
  const describeAll = (schedules) => (schedules ?? []).length
    ? schedules.map(describeSchedule).join('; ')
    : 'Off'
  return [change({
    section: 'How often', label, from: describeAll(before[key]), to: describeAll(after[key])
  })].filter(Boolean)
}

const categoryChanges = ({ before, after, renames }) => {
  const renamedFrom = Object.fromEntries(Object.entries(renames).map(([from, to]) => [to, from]))
  const beforeIds = (before.categories ?? []).map(({ id }) => id)
  const afterIds = (after.categories ?? []).map(({ id }) => id)
  const originalId = (id) => renamedFrom[id] ?? id
  const changes = [
    ...Object.entries(renames)
      .filter(([from, to]) => from !== to && afterIds.includes(to))
      .map(([from, to]) => ({
        section: 'What to look for', label: 'Category renamed', from, to
      })),
    ...afterIds.filter((id) => !beforeIds.includes(originalId(id))).map((id) => ({
      section: 'What to look for', label: 'Category added', from: null, to: id
    })),
    ...beforeIds.filter((id) => !afterIds.map(originalId).includes(id)).map((id) => ({
      section: 'What to look for', label: 'Category removed', from: id, to: null
    }))
  ]
  const kept = after.categories.filter(({ id }) => beforeIds.includes(originalId(id)))
  kept.forEach((category) => {
    const old = before.categories.find(({ id }) => id === originalId(category.id))
    const described = change({
      section: 'What to look for',
      label: `Description of ${category.id}`,
      from: old.description,
      to: category.description
    })
    if (described) changes.push(described)
  })
  const order = (ids) => ids.join(', ')
  const keptOrderBefore = beforeIds.filter((id) => afterIds.map(originalId).includes(id))
  const keptOrderAfter = afterIds.map(originalId).filter((id) => beforeIds.includes(id))
  if (order(keptOrderBefore) !== order(keptOrderAfter)) {
    changes.push({
      section: 'Alert prices',
      label: 'Preference order',
      from: order(beforeIds),
      to: order(afterIds)
    })
  }
  return changes
}

const ruleChanges = ({ before, after, renames }) => {
  const renamedFrom = Object.fromEntries(Object.entries(renames).map(([from, to]) => [to, from]))
  return (after.categories ?? []).flatMap(({ id }) => {
    const oldRule = before.rules?.[renamedFrom[id] ?? id] ?? {}
    const newRule = after.rules?.[id] ?? {}
    return RULE_FIELDS.map(({ key, label, money }) => change({
      section: 'Alert prices',
      label: `${id}: ${label}`,
      from: formatValue({ value: oldRule[key], money }),
      to: formatValue({ value: newRule[key], money })
    })).filter(Boolean)
  })
}

const alertOptionChanges = ({ before, after }) => [
  change({
    section: 'Alert prices',
    label: 'Repeat alert needs a drop of',
    from: formatValue({ value: before.dedupe?.minDrop, money: true }),
    to: formatValue({ value: after.dedupe?.minDrop, money: true })
  }),
  change({
    section: 'Alert prices',
    label: 'Monthly heartbeat',
    from: before.heartbeat?.monthly ? 'On' : 'Off',
    to: after.heartbeat?.monthly ? 'On' : 'Off'
  })
].filter(Boolean)

const listChanges = ({ section, before = [], after = [], keyOf, describe }) => {
  const beforeByKey = new Map((before ?? []).map((item) => [keyOf(item), item]))
  const afterByKey = new Map((after ?? []).map((item) => [keyOf(item), item]))
  return [
    ...[...afterByKey].filter(([key]) => !beforeByKey.has(key)).map(([, item]) => ({
      section, label: 'Added', from: null, to: describe(item)
    })),
    ...[...beforeByKey].filter(([key]) => !afterByKey.has(key)).map(([, item]) => ({
      section, label: 'Removed', from: describe(item), to: null
    })),
    ...[...afterByKey]
      .filter(([key, item]) => beforeByKey.has(key) && !sameJson(beforeByKey.get(key), item))
      .map(([key, item]) => ({
        section,
        label: `Changed ${describe(item)}`,
        from: fieldDiff({ from: beforeByKey.get(key), to: item, side: 'from' }),
        to: fieldDiff({ from: beforeByKey.get(key), to: item, side: 'to' })
      }))
  ]
}

const kitChanges = ({ before, after }) => (after.kits ?? []).flatMap((kit) => {
  const old = (before.kits ?? []).find(({ id }) => id === kit.id)
  if (!old) return [{ section: 'Kits', label: 'Kit added', from: null, to: kit.name }]
  return [
    change({ section: 'Kits', label: `${kit.id} name`, from: old.name, to: kit.name }),
    ...kit.parts.map((part) => {
      const oldPart = old.parts.find(({ id }) => id === part.id)
      if (!oldPart) {
        return { section: 'Kits', label: `${kit.id} part added`, from: null, to: part.id }
      }
      if (sameJson(oldPart, part)) return null
      return {
        section: 'Kits',
        label: `${kit.id} part ${part.id}`,
        from: fieldDiff({ from: oldPart, to: part, side: 'from' }),
        to: fieldDiff({ from: oldPart, to: part, side: 'to' })
      }
    })
  ].filter(Boolean)
})

const researchChanges = ({ before, after }) => [
  ['maxTurns', 'Max turns'],
  ['timeoutMinutes', 'Timeout (minutes)'],
  ['model', 'Model']
].map(([key, label]) => change({
  section: 'Advanced',
  label,
  from: before.research?.[key] ?? 'default',
  to: after.research?.[key] ?? 'default'
})).filter(Boolean)

const otherChanges = ({ before, after }) => [...new Set([...Object.keys(before),
  ...Object.keys(after)])]
  .filter((key) => !HANDLED_KEYS.has(key))
  .filter((key) => !sameJson(before[key], after[key]))
  .map((key) => ({ section: 'Other', label: key, from: 'previous value', to: 'changed' }))

const fieldDiff = ({ from = {}, to = {}, side }) => {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter((key) => !sameJson(from[key], to[key]))
  const source = side === 'from' ? from : to
  return keys.map((key) => `${key}: ${source[key] ?? 'none'}`).join(', ')
}

const change = ({ section, label, from, to }) => {
  const normalise = (value) => (value === undefined || value === '' ? null : value)
  if (normalise(from) === normalise(to)) return null
  return { section, label, from: normalise(from), to: normalise(to) }
}

const formatValue = ({ value, money: isMoney }) => {
  if (value === null || value === undefined || value === '') return null
  return isMoney ? formatMoney(value) : `${value}%`
}

const shortUrl = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return url
  }
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
