import { TOPIC_PREFIX, withTopicPrefix } from '../../src/topics.js'
import { pruneTuning, renameTuningCategory } from '../../src/tuning.js'
import { validateItem } from '../../src/item-validate.js'
import { buildSchedule, parseSchedule, presetProblem } from './schedulePresets.js'

export const SECTIONS = [
  { id: 'basics', label: 'Basics', prefixes: ['name', 'ntfy'] },
  { id: 'how-often', label: 'How often', prefixes: ['schedules', 'directSchedules'] },
  {
    id: 'alert-prices',
    label: 'Alert prices',
    prefixes: ['rules', 'dedupe', 'heartbeat', 'deadline']
  },
  { id: 'look-for', label: 'What to look for', prefixes: ['product', 'categories'] },
  { id: 'look-where', label: 'Where to look', prefixes: ['sources'] },
  { id: 'free-checks', label: 'Free checks', prefixes: ['direct'] },
  { id: 'kits', label: 'Kits', prefixes: ['kits'] },
  { id: 'advanced', label: 'Advanced', prefixes: ['research'] }
]

export const toDraft = (config) => {
  const draft = cloneJson(config)
  return {
    config: draft,
    scheduleRows: (draft.schedules ?? []).map(parseSchedule),
    directScheduleRows: (draft.directSchedules ?? []).map(parseSchedule),
    researchOff: (draft.schedules ?? []).length === 0,
    directOff: (draft.directSchedules ?? []).length === 0
  }
}

export const fromDraft = ({ draft, original }) => {
  const config = cloneJson(draft.config)
  config.schedules = draft.researchOff ? [] : draft.scheduleRows.map(buildSchedule)
  const directSchedules = draft.directOff ? [] : draft.directScheduleRows.map(buildSchedule)
  if (directSchedules.length > 0 || original.directSchedules !== undefined
    || (config.direct ?? []).length > 0) {
    config.directSchedules = directSchedules
  }
  config.rules = pruneRules({ rules: config.rules, original: original.rules ?? {} })
  config.direct = (config.direct ?? []).map(pruneDirectEntry)
  if (config.direct.length === 0 && original.direct === undefined) delete config.direct
  if (config.research) config.research = pruneResearch(config.research)
  return pruneTuning(config)
}

export const validateDraft = ({ draft, original }) => {
  const config = fromDraft({ draft, original })
  const presetErrors = [
    ...rowErrors({ rows: draft.scheduleRows, off: draft.researchOff, key: 'schedules' }),
    ...rowErrors({ rows: draft.directScheduleRows, off: draft.directOff, key: 'directSchedules' })
  ]
  const idError = config.id === original.id ? [] : ['id: cannot change']
  return [...idError, ...presetErrors, ...validateItem(config)]
}

export const errorsFor = ({ errors, path }) => errors
  .filter((error) => pathOf(error) === path)
  .map(messageOf)

export const sectionOf = (error) => {
  const path = pathOf(error)
  const section = SECTIONS.find(({ prefixes }) =>
    prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)
      || path.startsWith(`${prefix}[`)))
  return section?.label ?? 'Item'
}

export const pathOf = (error) => error.split(': ')[0]

export const messageOf = (error) => error.split(': ').slice(1).join(': ') || error

export const generateTopic = (currentTopic) => {
  const prefix = topicPrefix(currentTopic)
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${prefix}-${hex}`
}

export const renameCategory = ({ config, from, to }) => {
  const category = config.categories.find(({ id }) => id === from)
  if (!category || !to || from === to) return
  category.id = to
  renameTuningCategory({ config, from, to })
  if (config.rules?.[from]) {
    config.rules = Object.fromEntries(Object.entries(config.rules)
      .map(([key, rule]) => [key === from ? to : key, rule]))
  }
  for (const entry of config.direct ?? []) {
    if (entry.category === from) entry.category = to
  }
  for (const kit of config.kits ?? []) {
    if (kit.category === from) kit.category = to
    for (const part of kit.parts) {
      if (part.match === from) part.match = to
    }
  }
}

export const removeCategory = ({ config, id }) => {
  config.categories = config.categories.filter((category) => category.id !== id)
  if (config.rules) delete config.rules[id]
}

export const setCategoryMuted = ({ config, id, muted, by, at }) => {
  if (!muted) {
    if (config.tuning?.categories) delete config.tuning.categories[id]
    return
  }
  config.tuning ??= {}
  config.tuning.categories ??= {}
  config.tuning.categories[id] = { state: 'muted', at, by, reason: 'Muted on the edit page' }
}

export const moveItem = ({ list, index, offset }) => {
  const target = index + offset
  if (target < 0 || target >= list.length) return
  const [moved] = list.splice(index, 1)
  list.splice(target, 0, moved)
}

export const setNumber = ({ target, key, value }) => {
  const trimmed = String(value ?? '').trim()
  target[key] = trimmed === '' ? null : Number(trimmed)
}

export const slugify = (text) => String(text ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const rowErrors = ({ rows, off, key }) => off
  ? []
  : rows.map((row, index) => {
    const problem = presetProblem(row)
    return problem ? `${key}[${index}]: ${problem}` : null
  }).filter(Boolean)

const pruneRules = ({ rules = {}, original }) => Object.fromEntries(
  Object.entries(rules).map(([category, rule]) => [
    category,
    Object.fromEntries(Object.entries(rule).filter(([key, value]) =>
      value !== null || Object.hasOwn(original[category] ?? {}, key)))
  ])
)

const OPTIONAL_DIRECT_KEYS = ['variantFilter', 'category', 'part']

const pruneDirectEntry = (entry) => Object.fromEntries(Object.entries(entry)
  .filter(([key, value]) => !(OPTIONAL_DIRECT_KEYS.includes(key) && isBlank(value))))

const isBlank = (value) => value === '' || value === null || value === undefined

const pruneResearch = (research) => Object.fromEntries(Object.entries(research)
  .filter(([, value]) => value !== null && value !== ''))

const topicPrefix = (topic) => {
  const trimmed = String(topic ?? '').replace(/-[0-9a-f]{16,}$/i, '')
  return trimmed ? withTopicPrefix(trimmed) : `${TOPIC_PREFIX}-item`
}

const cloneJson = (value) => JSON.parse(JSON.stringify(value))
