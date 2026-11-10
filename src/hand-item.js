import { capCheck } from './ai-usage.js'
import { ntfyBase } from './app-notice.js'
import { keptEntries, testCandidates } from './draft-direct.js'
import {
  LIMITS, cleanLine, cleanText, generateTopic, publicUrl, slugify, suggestedDrop, uniqueSlug
} from './draft-harden.js'
import {
  DEFAULT_PRESET, buildDirectSchedules, buildPresetSchedules, minuteFor
} from './draft-schedule.js'
import { ItemError, createItem } from './item-store.js'
import { validateItem } from './item-validate.js'
import { hostOf } from './retailers.js'
import { sendTestNotification } from './runner.js'

export const HAND_NOTE = 'Added by hand'

export const readHandInput = ({ body, maxPrice }) => {
  const value = isObject(body) ? body : {}
  const name = cleanLine(value.name, LIMITS.title)
  const lookFor = cleanText(value.lookFor, LIMITS.product)
  const category = cleanLine(value.category, LIMITS.categoryLabel)
  const alertPrice = Number(value.alertPrice)
  const rawUrl = cleanLine(value.url, LIMITS.url)
  const url = rawUrl ? publicUrl(rawUrl) : null
  const errors = [
    !name && 'name: give the item a name',
    !lookFor && 'lookFor: describe what to look for',
    !(alertPrice > 0 && alertPrice <= maxPrice) && 'alertPrice: expected a price above 0',
    rawUrl && !url && 'url: expected a public http(s) address'
  ].filter(Boolean)
  if (errors.length > 0) {
    throw new ItemError({ code: 'invalid', message: errors.join('; '), errors })
  }
  return { name, lookFor, category, alertPrice, url }
}

export const createHandItem = async ({
  db, body, region, now = new Date(), env = process.env, fetchImpl, lookupImpl, deliver
}) => {
  const input = readHandInput({ body, maxPrice: region.maxPrice })
  const id = uniqueSlug({ text: input.name, taken: takenIds(db) })
  const categoryId = slugify(input.category ?? input.name, LIMITS.categoryId) || 'main'
  const freeCheck = await freeCheckFor({
    url: input.url, categoryId, region, fetchImpl, lookupImpl
  })
  const config = handConfig({ db, id, categoryId, input, region, direct: freeCheck.entries })
  const errors = validateItem(config)
  if (errors.length > 0) {
    throw new ItemError({ code: 'invalid', message: errors.join('; '), errors })
  }
  const cap = capCheck({ db, config, now, env })
  if (!cap.ok) throw new ItemError({ code: 'state', message: cap.message, errors: [cap.message] })
  const record = createItem({ db, config, origin: 'app', source: 'edit', note: HAND_NOTE, now })
  const test = await safeTestAlert({ db, item: record.config, deliver, now, env })
  return {
    itemId: record.id,
    version: record.version,
    freeCheck: { requested: Boolean(input.url), added: freeCheck.entries.length > 0,
      note: freeCheck.note },
    testDelivered: test.delivered,
    testError: test.error ?? null
  }
}

export const handConfig = ({ db, id, categoryId, input, region, direct = [] }) => {
  const rules = {
    [categoryId]: { maxPrice: input.alertPrice, rrp: null, minPctBelowRrp: null }
  }
  const tz = region.timeZone
  return {
    id,
    name: input.name,
    product: input.lookFor,
    categories: [{
      id: categoryId,
      description: clip(input.category ? `${input.category}: ${input.lookFor}` : input.lookFor)
    }],
    rules,
    sources: {
      sites: input.url ? [{ name: hostOf(input.url), url: input.url }] : [],
      searches: [input.name],
      seasonalSearches: []
    },
    schedules: buildPresetSchedules({ preset: DEFAULT_PRESET, minute: minuteFor(id), tz }),
    ...(direct.length > 0 ? { direct, directSchedules: buildDirectSchedules({ tz }) } : {}),
    ntfy: { ...ntfyBase(db), topic: generateTopic(input.name) },
    research: { maxTurns: 80, timeoutMinutes: 15 },
    dedupe: { minDrop: suggestedDrop(rules) },
    heartbeat: { monthly: true }
  }
}

const freeCheckFor = async ({ url, categoryId, region, fetchImpl, lookupImpl }) => {
  if (!url) return { entries: [], note: null }
  const [result] = await testCandidates({
    candidates: [{ retailer: hostOf(url), url, category: categoryId }],
    region,
    listedUrls: [url],
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(lookupImpl ? { lookupImpl } : {})
  })
  return { entries: keptEntries([result]), note: result.note ?? null }
}

const safeTestAlert = async ({ db, item, deliver, now, env }) => {
  try {
    return await sendTestNotification({
      item, db, now, env, log: () => {}, ...(deliver ? { deliver } : {})
    })
  } catch (error) {
    return { delivered: false, error: error.message }
  }
}

const takenIds = (db) => new Set([
  ...db.prepare('SELECT id FROM items').all().map(({ id }) => id),
  ...db.prepare('SELECT id FROM deleted_items').all().map(({ id }) => id)
])

const clip = (text) => text.slice(0, LIMITS.description)

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
