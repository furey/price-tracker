<script setup>
import { computed } from 'vue'
import { BOT_CHECK, BOT_CHECK_HINT, isBotCheck } from '../../../src/bot-checks.js'
import { canonicalRetailer } from '../../../src/retailers.js'
import { MUTED, tuningOf } from '../../../src/tuning.js'
import SourceLink from './SourceLink.vue'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  item: { type: Object, required: true },
  sources: { type: Array, default: () => [] },
  otherLinks: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['tune'])

const tuning = computed(() => tuningOf(props.item))

const siteNames = computed(() => (props.item.sources?.sites ?? []).map(({ name }) => name))

const otherSources = computed(() => props.sources.filter((source) =>
  !siteNames.value.includes(canonicalRetailer({
    name: source.name, knownRetailers: siteNames.value
  }))))

const phrases = computed(() => [
  ...(props.item.sources?.searches ?? []),
  ...(props.item.sources?.seasonalSearches ?? []).map(({ phrase }) => phrase)
].map((phrase) => ({ phrase, muted: tuning.value.searches[phrase]?.state === MUTED })))

const tune = (action) => emit('tune', { changes: [action.change], reason: action.reason })

const togglePhrase = ({ phrase, muted }) => tune(muted
  ? { change: { kind: 'restore-search', phrase }, reason: `Search "${phrase}" again` }
  : { change: { kind: 'mute-search', phrase }, reason: 'Search phrase not useful' })

const otherLink = (source) => {
  if (source.url) return { url: source.url, urlKind: 'page' }
  const name = canonicalRetailer({ name: source.name, knownRetailers: siteNames.value })
  return props.otherLinks[name] ?? { url: null, urlKind: null }
}

const statusOf = (source) => (isBotCheck(source) ? BOT_CHECK : source.status)
</script>

<template>
  <div v-if="otherSources.length || phrases.length" class="sources-panel">
    <template v-if="otherSources.length">
      <h4 class="group-title">Other sources in the last run</h4>
      <ul class="rows card">
        <li v-for="source in otherSources" :key="source.name">
          <div class="row-main">
            <SourceLink
              class="name"
              :name="source.name"
              :url="otherLink(source).url"
              :url-kind="otherLink(source).urlKind"
            />
            <StatusPill :status="statusOf(source)" compact />
          </div>
          <p v-if="source.note" class="note muted">{{ source.note }}</p>
          <p v-if="isBotCheck(source)" class="note hint">{{ BOT_CHECK_HINT }}</p>
        </li>
      </ul>
    </template>

    <template v-if="phrases.length">
      <h4 class="group-title">Search phrases</h4>
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
