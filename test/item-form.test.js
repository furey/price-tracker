import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getItem } from '../src/config.js'
import {
  buildCron, describeSchedule, parseSchedule, slotCount, upcomingSlots
} from '../web/src/schedulePresets.js'
import { describeChanges } from '../web/src/itemDiff.js'
import {
  fromDraft, generateTopic, renameCategory, setCategoryMuted, toDraft, validateDraft
} from '../web/src/itemForm.js'
import { tuningChanges } from '../web/src/tuningView.js'

const NOW = new Date('2026-11-07T00:00:00.000Z')

const seeds = () => ['karcher-k7', 'springfree-medium-oval'].map((id) => {
  const { enabled, ...config } = getItem(id)
  return config
})

test('an untouched draft of each seed round-trips to the same config', () => {
  for (const config of seeds()) {
    const draft = toDraft(config)
    assert.deepEqual(fromDraft({ draft, original: config }), config)
    assert.deepEqual(validateDraft({ draft, original: config }), [])
    assert.deepEqual(describeChanges({ before: config, after: config }), [])
  }
})

test('presets parse the seed crons and rebuild them', () => {
  const cases = [
    ['57 7 * * *', 'daily', 'Daily at 7:57 am'],
    ['30 7,19 * * *', 'twice-daily', 'Twice daily at 7:30 am and 7:30 pm'],
    ['45 7 * * 2,5', 'days', 'Tue, Fri at 7:45 am'],
    ['0 9 * * 1-5', 'weekdays', 'Weekdays at 9:00 am'],
    ['*/30 * * * *', 'custom', 'Cron */30 * * * *']
  ]
  for (const [cron, preset, text] of cases) {
    const row = parseSchedule({ cron, tz: 'Australia/Sydney' })
    assert.equal(row.preset, preset, cron)
    assert.equal(buildCron(row), cron)
    assert.equal(describeSchedule({ cron, tz: 'Australia/Sydney' }), text)
  }
  const mixed = { ...parseSchedule({ cron: '30 7 * * *' }), preset: 'twice-daily',
    times: ['07:30', '19:15'] }
  assert.equal(buildCron(mixed), null)
})

test('schedule previews list the next slots and a 30 day count inside the window', () => {
  const schedules = [
    { cron: '45 7 * * *', tz: 'Australia/Sydney', until: '2026-11-10' },
    { cron: '45 7 * * 2,5', tz: 'Australia/Sydney', from: '2026-11-10' }
  ]
  const next = upcomingSlots({ schedules, now: NOW })
  assert.deepEqual(next.map((slot) => slot.toISOString()), [
    '2026-11-07T20:45:00.000Z', '2026-11-08T20:45:00.000Z', '2026-11-09T20:45:00.000Z'
  ])
  assert.equal(slotCount({ schedules, now: NOW }), 10)
})

test('edits produce field-level change lines and invalid rows are reported by path', () => {
  const [config] = seeds()
  const draft = toDraft(config)
  draft.config.rules['premium-power-home'].maxPrice = 900
  draft.scheduleRows[0].preset = 'twice-daily'
  draft.scheduleRows[0].times = ['07:57', '19:57']
  draft.config.sources.sites.push({ name: 'Harvey Norman' })
  const after = fromDraft({ draft, original: config })
  const lines = describeChanges({ before: config, after })
  assert.deepEqual(lines.map(({ label, from, to }) => [label, from, to]), [
    ['AI research schedule', 'Daily at 7:57 am', 'Twice daily at 7:57 am and 7:57 pm'],
    ['premium-power-home: alert at or below', '$950', '$900'],
    ['Added', null, 'Harvey Norman']
  ])
  draft.scheduleRows[0].times = ['07:57', '19:30']
  draft.config.rules['premium-power-home'].maxPrice = -1
  const errors = validateDraft({ draft, original: config })
  assert.ok(errors.some((error) => error.startsWith('schedules[0]: Both times')))
  assert.ok(errors.includes(
    'rules.premium-power-home.maxPrice: expected a positive number or null'
  ))
})

test('renaming a category moves its rule and references', () => {
  const [, config] = seeds()
  const draft = toDraft(config)
  renameCategory({ config: draft.config, from: 'base', to: 'trampoline' })
  assert.ok(draft.config.rules.trampoline)
  assert.equal(draft.config.rules.base, undefined)
  assert.ok(draft.config.direct.some((entry) => entry.category === 'trampoline'))
  assert.equal(draft.config.kits[0].parts[0].match, 'trampoline')
  assert.deepEqual(validateDraft({ draft, original: config }), [])
})

test('a generated topic keeps the prefix and adds 32 hex characters', () => {
  assert.match(generateTopic('karcher-k7'), /^pt-karcher-k7-[0-9a-f]{32}$/)
  assert.match(generateTopic(''), /^pt-item-[0-9a-f]{32}$/)
})

test('the edit form mutes a category, keeps it across a rename, and prunes old sites', () => {
  const [config] = seeds()
  const draft = toDraft(config)
  const at = NOW.toISOString()
  setCategoryMuted({ config: draft.config, id: 'wcm-premium', muted: true, by: 'Alex', at })
  const site = draft.config.sources.sites[0].name
  draft.config.tuning.sites = { [site]: { state: 'muted', at, by: 'Alex' } }
  renameCategory({ config: draft.config, from: 'wcm-premium', to: 'wcm' })
  draft.config.sources.sites.shift()
  const saved = fromDraft({ draft, original: config })
  assert.deepEqual(Object.keys(saved.tuning), ['categories'])
  assert.equal(saved.tuning.categories.wcm.by, 'Alex')
  assert.deepEqual(validateDraft({ draft, original: config }), [])
  const lines = describeChanges({ before: config, after: saved })
    .filter(({ section }) => section === 'Tuning')
  assert.deepEqual(lines, [{ section: 'Tuning', label: 'Mute model', from: null, to: 'wcm' }])
  setCategoryMuted({ config: draft.config, id: 'wcm', muted: false })
  assert.equal('tuning' in fromDraft({ draft, original: config }), false)
})

test('tuningChanges describes mutes, weekly sites, never rules, and restores', () => {
  const at = NOW.toISOString()
  const before = { tuning: { sites: { Repco: { state: 'muted', at, by: 'Alex' } } } }
  const after = {
    tuning: {
      categories: { wcm: { state: 'muted', at, by: 'Alex', notifyBelow: 650 } },
      sites: { 'Total Tools': { state: 'weekly', at, by: 'Alex' } },
      never: [{ id: 'p', label: 'K7 WCM', match: { partNumber: '1.317-401.0' }, at, by: 'J' }]
    }
  }
  const lines = tuningChanges({ before, after }).map(({ label, from, to }) => [label, from, to])
  assert.deepEqual(lines, [
    ['Mute model', null, 'wcm, tell me below $650'],
    ['Check site weekly', null, 'Total Tools'],
    ['Check on every run', 'Repco', null],
    ['Never show product', null, 'K7 WCM (part 1.317-401.0)']
  ])
})
