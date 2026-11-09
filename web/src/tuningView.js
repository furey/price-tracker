import { tuningOf } from '../../src/tuning.js'
import { formatMoney, formatPausedUntil } from './format.js'

export const SITE_STATE_LABELS = { muted: 'Muted', weekly: 'Weekly' }

export const tuningEntries = (item) => {
  const tuning = tuningOf(item)
  return [
    ...Object.entries(tuning.categories).map(([id, entry]) => ({
      group: 'Models', key: `category:${id}`, name: id, state: 'Muted', entry,
      restore: { kind: 'unmute-category', id }, restoreLabel: `Unmute ${id}`
    })),
    ...tuning.never.map((rule) => ({
      group: 'Products', key: `never:${rule.id}`, name: rule.label, state: 'Never show',
      entry: rule, detail: matchText(rule.match),
      restore: { kind: 'restore-never', id: rule.id }, restoreLabel: `Show ${rule.label} again`
    })),
    ...Object.entries(tuning.sites).map(([name, entry]) => ({
      group: 'Sites', key: `site:${name}`, name,
      state: SITE_STATE_LABELS[entry.state] ?? entry.state,
      entry, restore: { kind: 'restore-site', name },
      restoreLabel: `Check ${name} on every run`
    })),
    ...Object.entries(tuning.searches).map(([phrase, entry]) => ({
      group: 'Search phrases', key: `search:${phrase}`, name: `"${phrase}"`, state: 'Muted', entry,
      restore: { kind: 'restore-search', phrase }, restoreLabel: `Restore "${phrase}"`
    })),
    ...Object.entries(tuning.direct).map(([url, entry]) => ({
      group: 'Free checks', key: `direct:${url}`, name: shortUrl(url), state: 'Off', entry,
      restore: { kind: 'restore-direct', url }, restoreLabel: `Turn on ${shortUrl(url)}`
    }))
  ]
}

export const tuningSummary = (item) => {
  const entries = tuningEntries(item)
  if (entries.length === 0) return 'Nothing muted'
  const count = (group, state) => entries
    .filter((entry) => entry.group === group && (!state || entry.state === state)).length
  return [
    plural(count('Models'), 'muted model'),
    count('Products') && plural(count('Products'), 'hidden product'),
    plural(count('Sites', 'Muted'), 'muted site'),
    count('Sites', 'Weekly') && `${count('Sites', 'Weekly')} weekly`,
    count('Search phrases') && plural(count('Search phrases'), 'muted phrase'),
    count('Free checks') && plural(count('Free checks'), 'free check') + ' off'
  ].filter(Boolean).join(', ')
}

export const stampText = (entry) => {
  const when = entry?.at ? formatPausedUntil(entry.at) : null
  const parts = [[entry?.by, when].filter(Boolean).join(', ')]
  if (entry?.reason) parts.push(`"${entry.reason}"`)
  if (typeof entry?.notifyBelow === 'number') {
    parts.push(`Tell me below ${formatMoney(entry.notifyBelow)}.`)
  }
  return parts.filter(Boolean).join(': ')
}

export const matchText = (match = {}) => [
  match.partNumber && `part ${match.partNumber}`,
  match.titleWords?.length && `title has "${match.titleWords.join(' ')}"`,
  match.retailer && `at ${match.retailer}`,
  match.url && shortUrl(match.url)
].filter(Boolean).join(', ')

export const tuningChanges = ({ before, after }) => {
  const was = tuningOf(before)
  const now = tuningOf(after)
  return [
    ...keyedChanges({
      before: was.categories,
      after: now.categories,
      added: (id, entry) => ({ label: 'Mute model', to: withNotify(id, entry) }),
      removed: (id) => ({ label: 'Unmute model', from: id }),
      changed: (id, old, entry) => ({
        label: `Muted model ${id}`, from: withNotify(id, old), to: withNotify(id, entry)
      })
    }),
    ...keyedChanges({
      before: was.sites,
      after: now.sites,
      added: (name, entry) => ({ label: siteLabel(entry.state), to: name }),
      removed: (name) => ({ label: 'Check on every run', from: name }),
      changed: (name, old, entry) => ({
        label: `Site ${name}`,
        from: SITE_STATE_LABELS[old.state] ?? old.state,
        to: SITE_STATE_LABELS[entry.state] ?? entry.state
      })
    }),
    ...keyedChanges({
      before: was.searches,
      after: now.searches,
      added: (phrase) => ({ label: 'Mute search phrase', to: `"${phrase}"` }),
      removed: (phrase) => ({ label: 'Restore search phrase', from: `"${phrase}"` })
    }),
    ...keyedChanges({
      before: was.direct,
      after: now.direct,
      added: (url) => ({ label: 'Turn off free check', to: shortUrl(url) }),
      removed: (url) => ({ label: 'Turn on free check', from: shortUrl(url) })
    }),
    ...keyedChanges({
      before: Object.fromEntries(was.never.map((rule) => [rule.id, rule])),
      after: Object.fromEntries(now.never.map((rule) => [rule.id, rule])),
      added: (id, rule) => ({ label: 'Never show product', to: neverText(rule) }),
      removed: (id, rule) => ({ label: 'Show product again', from: rule.label })
    })
  ].map((change) => ({ section: 'Tuning', from: null, to: null, ...change }))
}

const keyedChanges = ({ before, after, added, removed, changed = null }) => [
  ...Object.entries(after).filter(([key]) => !(key in before))
    .map(([key, entry]) => added(key, entry)),
  ...Object.entries(before).filter(([key]) => !(key in after))
    .map(([key, entry]) => removed(key, entry)),
  ...(changed
    ? Object.entries(after)
      .filter(([key, entry]) => key in before && !sameState(before[key], entry))
      .map(([key, entry]) => changed(key, before[key], entry))
    : [])
]

const sameState = (a, b) => a.state === b.state && a.notifyBelow === b.notifyBelow

const siteLabel = (state) => (state === 'weekly' ? 'Check site weekly' : 'Mute site')

const withNotify = (id, entry) => (typeof entry?.notifyBelow === 'number'
  ? `${id}, tell me below ${formatMoney(entry.notifyBelow)}`
  : id)

const neverText = (rule) => {
  const detail = matchText(rule.match)
  const base = detail ? `${rule.label} (${detail})` : rule.label
  return typeof rule.notifyBelow === 'number'
    ? `${base}, tell me below ${formatMoney(rule.notifyBelow)}`
    : base
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const shortUrl = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`
  } catch {
    return url
  }
}
