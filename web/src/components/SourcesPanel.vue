<script setup>
import { computed } from 'vue'
import { BOT_CHECK, BOT_CHECK_HINT, isBotCheck } from '../../../src/bot-checks.js'
import { canonicalRetailer } from '../../../src/retailers.js'
import { DIRECT_OFF, MUTED, WEEKLY, tuningOf } from '../../../src/tuning.js'
import SourceLink from './SourceLink.vue'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  item: { type: Object, required: true },
  sources: { type: Array, default: () => [] },
  botCheckSites: { type: Array, default: () => [] },
  siteLinks: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['tune'])

const tuning = computed(() => tuningOf(props.item))

const siteNames = computed(() => (props.item.sources?.sites ?? []).map(({ name }) => name))

const statusByName = computed(() => new Map(props.sources.map((source) => [
  canonicalRetailer({ name: source.name, knownRetailers: siteNames.value }), source
])))

const STATE_ORDER = { [WEEKLY]: 1, [MUTED]: 2 }

const sites = computed(() => siteNames.value
  .map((name) => ({
    name,
    state: tuning.value.sites[name]?.state ?? null,
    source: statusByName.value.get(name) ?? null,
    botCheck: props.botCheckSites.includes(name)
      || isBotCheck(statusByName.value.get(name) ?? {})
  }))
  .sort((a, b) => (STATE_ORDER[a.state] ?? 0) - (STATE_ORDER[b.state] ?? 0)))

const otherSources = computed(() => props.sources.filter((source) =>
  !siteNames.value.includes(canonicalRetailer({
    name: source.name, knownRetailers: siteNames.value
  }))))

const phrases = computed(() => [
  ...(props.item.sources?.searches ?? []),
  ...(props.item.sources?.seasonalSearches ?? []).map(({ phrase }) => phrase)
].map((phrase) => ({ phrase, muted: tuning.value.searches[phrase]?.state === MUTED })))

const freeChecks = computed(() => (props.item.direct ?? []).map((entry) => ({
  ...entry, off: tuning.value.direct[entry.url]?.state === DIRECT_OFF
})))

const STATE_PILLS = {
  [WEEKLY]: { label: 'Weekly', tone: 'info' },
  [MUTED]: { label: 'Muted', tone: 'neutral' }
}

const siteActions = (site) => {
  const mute = { label: 'Mute site', change: { kind: 'mute-site', name: site.name },
    reason: 'Not worth the AI time' }
  const weekly = { label: 'Check weekly', change: { kind: 'weekly-site', name: site.name },
    reason: 'Check less often' }
  const restore = { label: site.state === MUTED ? 'Restore' : 'Every run',
    change: { kind: 'restore-site', name: site.name }, reason: `Check ${site.name} every run` }
  if (site.state === MUTED) return [restore]
  if (site.state === WEEKLY) return [restore, mute]
  return [mute, weekly]
}

const tune = (action) => emit('tune', { changes: [action.change], reason: action.reason })

const togglePhrase = ({ phrase, muted }) => tune(muted
  ? { change: { kind: 'restore-search', phrase }, reason: `Search "${phrase}" again` }
  : { change: { kind: 'mute-search', phrase }, reason: 'Search phrase not useful' })

const toggleDirect = ({ url, off, retailer }) => tune(off
  ? { change: { kind: 'restore-direct', url }, reason: `Check ${retailer} again` }
  : { change: { kind: 'disable-direct', url }, reason: 'Free check not useful' })

const siteLink = (site) => site.source?.url
  ? { url: site.source.url, urlKind: 'page' }
  : props.siteLinks[site.name] ?? { url: null, urlKind: null }

const statusOf = (source) => (isBotCheck(source) ? BOT_CHECK : source.status)

const hostPath = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`
  } catch {
    return url
  }
}
</script>

<template>
  <div class="sources-panel">
    <h3 class="group-title">Sites</h3>
    <ul class="rows card">
      <li v-for="site in sites" :key="site.name" :class="{ 'is-muted': site.state === MUTED }">
        <div class="row-main">
          <SourceLink
            class="name"
            :name="site.name"
            :url="siteLink(site).url"
            :url-kind="siteLink(site).urlKind"
          />
          <span v-if="site.state" class="pill compact" :class="STATE_PILLS[site.state].tone">
            {{ STATE_PILLS[site.state].label }}
          </span>
          <StatusPill v-if="site.botCheck" :status="BOT_CHECK" compact />
          <StatusPill v-else-if="site.source" :status="site.source.status" compact />
          <span v-else-if="site.state !== MUTED" class="muted small">Not in the last run</span>
        </div>
        <p v-if="site.source?.note" class="note muted">{{ site.source.note }}</p>
        <p v-if="site.botCheck" class="note hint">{{ BOT_CHECK_HINT }}</p>
        <div class="source-actions">
          <button
            v-for="action in siteActions(site)"
            :key="action.label"
            class="btn secondary small"
            type="button"
            @click="tune(action)"
          >
            {{ action.label }}
          </button>
        </div>
      </li>
    </ul>

    <template v-if="otherSources.length">
      <h3 class="group-title">Other sources in the last run</h3>
      <ul class="rows card">
        <li v-for="source in otherSources" :key="source.name">
          <div class="row-main">
            <SourceLink class="name" :name="source.name" :url="source.url" />
            <StatusPill :status="statusOf(source)" compact />
          </div>
          <p v-if="source.note" class="note muted">{{ source.note }}</p>
          <p v-if="isBotCheck(source)" class="note hint">{{ BOT_CHECK_HINT }}</p>
        </li>
      </ul>
    </template>

    <template v-if="phrases.length">
      <h3 class="group-title">Search phrases</h3>
      <ul class="rows card">
        <li v-for="item in phrases" :key="item.phrase" :class="{ 'is-muted': item.muted }">
          <div class="row-main">
            <span class="name">"{{ item.phrase }}"</span>
            <span v-if="item.muted" class="pill neutral compact">Muted</span>
          </div>
          <div class="source-actions">
            <button class="btn secondary small" type="button" @click="togglePhrase(item)">
              {{ item.muted ? 'Restore' : 'Mute phrase' }}
            </button>
          </div>
        </li>
      </ul>
    </template>

    <template v-if="freeChecks.length">
      <h3 class="group-title">Free checks</h3>
      <ul class="rows card">
        <li v-for="entry in freeChecks" :key="entry.url" :class="{ 'is-muted': entry.off }">
          <div class="row-main">
            <SourceLink class="name" :name="entry.retailer" :url="entry.url" />
            <span v-if="entry.off" class="pill neutral compact">Off</span>
          </div>
          <p class="note muted">{{ hostPath(entry.url) }}</p>
          <div class="source-actions">
            <button class="btn secondary small" type="button" @click="toggleDirect(entry)">
              {{ entry.off ? 'Turn on' : 'Turn off' }}
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.group-title {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-caption);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  text-wrap: balance;
}

.group-title:first-child {
  margin-top: 0;
}

.rows {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-4);
}

.rows li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-small);
}

.rows li:last-child {
  border-bottom: 0;
}

.row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.note {
  grid-column: 1;
  margin: 0;
  font-size: var(--text-caption);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.source-actions {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: var(--space-2);
}

.hint {
  color: var(--ink-2);
}

.is-muted .name,
.is-muted .note {
  color: var(--ink-3);
}

.small {
  font-size: var(--text-caption);
}

@media (max-width: 560px) {
  .rows li {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-actions {
    grid-column: 1;
    grid-row: auto;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}
</style>
