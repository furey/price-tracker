import { testCandidates, keptEntries } from './draft-direct.js'
import {
  assembleConfig, generateTopic, remapSnapshotCategories, uniqueSlug
} from './draft-harden.js'
import {
  DEFAULT_PRESET, PRESET_IDS, buildDirectSchedules, buildPresetSchedules, endDateFor, minuteFor,
  saleWindowsFrom, localToday, addDays
} from './draft-schedule.js'
import { ntfyBase, sendAppNotice } from './app-notice.js'
import { draftPageLink } from './links.js'
import { dashboardUrlFrom, resolveSettings } from './settings.js'
import { itemRecords } from './item-store.js'
import { validateItem } from './item-validate.js'

export const buildDraftConfig = async ({ context, draft, parsed, keepSnapshot = null }) => {
  const { db, now, region } = context
  const tz = region.timeZone
  const today = localToday(now(), tz)
  const endDate = endDateFor({ needBy: draft.input.needBy, today })
  const id = draft.config?.id ?? uniqueSlug({ text: parsed.name, taken: takenIds(db) })
  const topic = draft.config?.ntfy?.topic ?? generateTopic(parsed.name)
  const preset = pickPreset([parsed.schedulePreset, draft.research?.schedulePreset])
  const seasonalSearches = parsed.seasonalSearches.filter(({ until }) => until > today)
  const saleWindows = saleWindowsFrom({ seasonalSearches, today, endDate })
  const candidates = await testedCandidates({ context, draft, parsed })
  const assembled = assembleConfig({
    draft: { ...parsed, seasonalSearches },
    id,
    topic,
    ntfy: ntfyBase(db),
    schedules: buildPresetSchedules({ preset, minute: minuteFor(id), endDate, saleWindows, tz }),
    directSchedules: buildDirectSchedules({ endDate, tz }),
    direct: keptEntries(candidates),
    input: draft.input
  })
  const config = withoutFreeTextUrls(assembled)
  const errors = validateItem(config)
  if (errors.length > 0) throw new Error(`The drafted item is not valid: ${errors.join('; ')}`)
  const categoryIds = config.categories.map((category) => category.id)
  return {
    config,
    snapshot: remapSnapshotCategories({ snapshot: parsed.snapshot ?? keepSnapshot, categoryIds }),
    research: {
      title: draft.research?.title ?? parsed.name,
      understood: draft.research?.understood ?? null,
      rejects: parsed.rejects,
      categoryLabels: Object.fromEntries(parsed.categories
        .map(({ id: key, label }) => [key, label])),
      reasoning: parsed.reasoning,
      candidates,
      warnings: [...parsed.warnings, ...derivedWarnings({
        config, parsed, draft, endDate, today, currency: region.currency
      })],
      flags: instructionFlags(assembled),
      schedulePreset: preset,
      endDate,
      saleWindows,
      minute: minuteFor(id)
    }
  }
}

export const presetSchedules = ({ draft, preset, now = new Date(), tz }) => {
  const today = localToday(now, tz)
  const endDate = endDateFor({ needBy: draft.input.needBy, today })
  const saleWindows = saleWindowsFrom({
    seasonalSearches: draft.config?.sources?.seasonalSearches ?? [], today, endDate
  })
  return buildPresetSchedules({
    preset: pickPreset([preset]), minute: minuteFor(draft.config.id), endDate, saleWindows, tz
  })
}

export const existingItemSummaries = ({ db, now }) => itemRecords({ db, now })
  .filter((record) => record.status !== 'archived')
  .map((record) => ({ id: record.id, name: record.config.name, product: record.config.product }))

export const notifyDraft = async ({
  db, draft, now = new Date(), send, env = process.env
}) => {
  const notice = draftNotice(draft)
  if (!notice) return { delivered: false, skipped: true }
  return sendAppNotice({
    db, title: notice.title, message: notice.message, now, env,
    click: draftLink({ id: draft.id, db, env }), ...(send ? { send } : {})
  })
}

export const draftNotice = (draft) => {
  const title = draft.research?.title ?? 'New item'
  if (draft.status === 'clarifying') {
    const count = draft.questions.at(-1)?.questions.length ?? 0
    return {
      title: `${title}: needs your answers`,
      message: `${count} quick question${count === 1 ? '' : 's'}, then the research starts.`
    }
  }
  if (draft.status === 'review') {
    return {
      title: `${title}: ready to review`,
      message: 'Check the models, alert prices, and schedule, then save the item.'
    }
  }
  if (draft.status === 'failed') {
    return { title: `${title}: stopped`, message: String(draft.error ?? 'The draft stopped.') }
  }
  return null
}

export const draftLink = ({ id, db, env = process.env }) => draftPageLink({
  dashboardUrl: dashboardUrlFrom(resolveSettings({ db, env })), draftId: id
})

const takenIds = (db) => new Set([
  ...db.prepare('SELECT id FROM items').all().map(({ id }) => id),
  ...db.prepare('SELECT id FROM deleted_items').all().map(({ id }) => id)
])

const pickPreset = (options) => options.find((preset) => PRESET_IDS.includes(preset))
  ?? DEFAULT_PRESET

const testedCandidates = async ({ context, draft, parsed }) => {
  const previous = new Map((draft.research?.candidates ?? [])
    .map((candidate) => [candidateKey(candidate), candidate]))
  const reused = parsed.directCandidates
    .filter((candidate) => previous.has(candidateKey(candidate)))
    .map((candidate) => ({ ...previous.get(candidateKey(candidate)), ...candidate }))
  const fresh = parsed.directCandidates
    .filter((candidate) => !previous.has(candidateKey(candidate)))
  const tested = fresh.length === 0 ? [] : await testCandidates({
    candidates: fresh,
    fetchImpl: context.fetchImpl,
    lookupImpl: context.lookupImpl,
    sleep: context.sleep,
    pauseMs: context.pauseMs,
    log: context.log,
    region: context.region,
    listedUrls: draft.input?.links ?? []
  })
  return [...reused, ...tested]
}

const candidateKey = ({ url, category }) => `${url}|${category}`

const derivedWarnings = ({ config, parsed, draft, endDate, today, currency }) => [
  ...config.categories
    .filter(({ id }) => !config.rules[id]?.maxPrice)
    .map(({ id }) => `No alert price for ${id}. Set one under alert prices.`),
  ...(parsed.directCandidates.length > 0 && !config.direct
    ? [`None of the product links returned a price in ${currency}, so there are no free checks.`]
    : []),
  ...(draft.input.needBy && endDate === addDays(today, 2)
    ? ['Your need-by date is close, so checks stop in 2 days.']
    : []),
  ...(parsed.snapshot ? [] : ['Claude did not return a usable price snapshot.'])
]

const INSTRUCTION_PATTERN = new RegExp([
  'ignore (all|any|the|previous|prior|earlier|above)',
  'system prompt', 'you must', 'you are now', 'disregard', 'developer message',
  'new instructions?', '\\b(assistant|system|user):',
  '\\b(fetch|send|post|report|upload|submit|forward)\\b[^.\\n]{0,40}\\b(to|at)\\b',
  'https?:\\/\\/', '\\bwww\\.', 'webfetch',
  'open\\b[^.\\n]{0,40}\\b(url|link|address)', '[a-z0-9+\\/]{40,}={0,2}'
].join('|'), 'i')

const instructionFlags = (config) => [
  ['What to look for', config.product],
  ...config.categories.map(({ id, description }) => [`Category ${id}`, description]),
  ...config.sources.sites.map(({ name, note }) => [`Site ${name}`, `${name} ${note ?? ''}`]),
  ...(config.sources.searches ?? []).map((phrase) => ['A search phrase', phrase]),
  ...(config.sources.seasonalSearches ?? []).map(({ phrase, note }) =>
    [`Seasonal search ${phrase}`, `${phrase} ${note ?? ''}`])
]
  .filter(([, text]) => INSTRUCTION_PATTERN.test(text ?? ''))
  .map(([where]) => `${where} contains text that reads like an instruction to the AI. Check it.`)

const withoutFreeTextUrls = (config) => ({
  ...config,
  product: stripUrls(config.product),
  categories: config.categories.map((category) =>
    ({ ...category, description: stripUrls(category.description) })),
  sources: {
    ...config.sources,
    sites: config.sources.sites.map(withStrippedNote),
    ...(config.sources.seasonalSearches
      ? { seasonalSearches: config.sources.seasonalSearches.map(withStrippedNote) }
      : {})
  }
})

const withStrippedNote = (item) => (item.note ? { ...item, note: stripUrls(item.note) } : item)

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)\S+/gi

const stripUrls = (text) => typeof text === 'string'
  ? text.replace(URL_IN_TEXT, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1').trim()
  : text
