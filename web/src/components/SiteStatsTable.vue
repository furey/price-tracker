<script setup>
import { computed, ref, watch } from 'vue'
import { BOT_CHECK, BOT_CHECK_HINT, isBotCheck } from '../../../src/bot-checks.js'
import { getSiteStats } from '../api.js'
import { formatDateTime, formatPausedUntil } from '../format.js'
import { timeOf, useSort } from '../useSort.js'
import AppIcon from './AppIcon.vue'
import SortHeader from './SortHeader.vue'
import SourceLink from './SourceLink.vue'
import { HOME_LINK_TITLE } from '../link-kinds.js'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  itemId: { type: String, required: true },
  refreshKey: { type: Number, default: 0 }
})

const WINDOWS = [30, 90]
const STATUS_PARTS = [
  { status: 'ok', label: 'OK' },
  { status: 'blocked', label: 'blocked' },
  { status: 'error', label: 'error' },
  { status: 'not_found', label: 'not found' }
]
const KIND_LABELS = { direct: 'Free check', other: 'Not in your sites' }
const STATE_LABELS = { muted: 'Muted', weekly: 'Weekly', off: 'Off' }
const STATE_ORDER = { weekly: 1, muted: 2, off: 2 }

const emit = defineEmits(['loaded'])

const days = ref(30)
const stats = ref(null)
const errorMessage = ref(null)
const expanded = ref(new Set())

const load = async () => {
  errorMessage.value = null
  try {
    stats.value = await getSiteStats({ id: props.itemId, days: days.value })
    emit('loaded', stats.value)
  } catch (error) {
    errorMessage.value = error.message
  }
}

watch(() => [props.itemId, props.refreshKey, days.value], load, { immediate: true })

const rows = computed(() => (stats.value?.sites ?? [])
  .filter((row) => row.kind !== 'other' || row.found > 0 || row.manual.checks > 0)
  .map((row) => ({ ...row, rowKey: `${row.kind}:${row.key}` }))
  .sort((a, b) => (STATE_ORDER[a.state] ?? 0) - (STATE_ORDER[b.state] ?? 0)))

const sort = useSort({
  rows: () => rows.value,
  columns: {
    name: (row) => row.name,
    checks: (row) => row.checks,
    ok: (row) => okShare(row),
    found: (row) => row.found,
    eligible: (row) => row.eligible,
    qualifying: (row) => row.qualifying,
    alerts: (row) => row.alerts,
    lastUseful: (row) => timeOf(row.lastUseful)
  }
})

const okShare = (row) => (row.checks ? row.statuses.ok / row.checks : null)

const segments = (row) => STATUS_PARTS
  .filter(({ status }) => row.statuses[status] > 0)
  .map(({ status, label }) => ({
    status, label, count: row.statuses[status], share: row.statuses[status] / row.checks
  }))

const statusText = (row) => segments(row).map(({ label, count }) => `${label} ${count}`)
  .join(', ')

const manualText = (row) => {
  if (!row.manual.checks) return ''
  const found = row.manual.ok ? `${row.manual.ok} OK` : 'not found'
  return `Chrome: ${found}`
}

const pathOf = (url) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`
  } catch {
    return ''
  }
}

const labelText = (row) => {
  const state = STATE_LABELS[row.state]
  const since = state && row.stateSince ? ` since ${formatPausedUntil(row.stateSince)}` : ''
  return [KIND_LABELS[row.kind], state && `${state}${since}`].filter(Boolean).join(', ')
}

const entryStatus = (entry) => (isBotCheck(entry) ? BOT_CHECK : entry.status)

const toggle = (key) => {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
</script>

<template>
  <div class="site-stats">
    <header class="stats-head">
      <h3 class="group-title">Results by source</h3>
      <div class="segmented" role="group" aria-label="Window">
        <button
          v-for="option in WINDOWS"
          :key="option"
          type="button"
          :aria-pressed="days === option"
          @click="days = option"
        >
          {{ option }} days
        </button>
      </div>
    </header>
    <p v-if="errorMessage" class="banner bad" role="alert">{{ errorMessage }}</p>
    <p class="muted small lead">
      Checks are AI research visits. Eligible means in stock, priced, and on the retailer's own
      site. AI cost per site is not measured yet.
    </p>
    <div v-if="rows.length" class="table-wrap">
      <table>
        <thead>
          <tr>
            <SortHeader :sort="sort" column="name">Source</SortHeader>
            <SortHeader :sort="sort" column="checks" class="right">Checks</SortHeader>
            <SortHeader :sort="sort" column="ok">Results</SortHeader>
            <SortHeader :sort="sort" column="found" class="right">Found</SortHeader>
            <SortHeader :sort="sort" column="eligible" class="right">Eligible</SortHeader>
            <SortHeader :sort="sort" column="qualifying" class="right">Qualify</SortHeader>
            <SortHeader :sort="sort" column="alerts" class="right">Alerts</SortHeader>
            <SortHeader :sort="sort" column="lastUseful">Last useful</SortHeader>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in sort.sorted.value" :key="row.rowKey">
            <tr :class="{ 'is-muted': row.state === 'muted' || row.state === 'off' }">
              <td class="name">
                <div class="name-line">
                  <button
                    class="recent-toggle"
                    type="button"
                    :aria-expanded="expanded.has(row.rowKey)"
                    :aria-label="`Recent checks at ${row.name}`"
                    :title="`Recent checks at ${row.name}`"
                    :disabled="!row.recent.length"
                    @click="toggle(row.rowKey)"
                  >
                    <AppIcon name="chevron" />
                  </button>
                  <SourceLink
                    class="site-name"
                    :name="row.name"
                    :url="row.url"
                    :url-kind="row.urlKind"
                  />
                  <StatusPill v-if="row.botCheck" :status="BOT_CHECK" compact />
                </div>
                <small v-if="row.kind === 'direct'" class="muted">{{ pathOf(row.url) }}</small>
                <small v-if="labelText(row)" class="muted">{{ labelText(row) }}</small>
                <small v-if="row.botCheck" class="hint">{{ BOT_CHECK_HINT }}</small>
              </td>
              <td class="num right">{{ row.checks }}</td>
              <td class="results">
                <div
                  v-if="row.checks"
                  class="bar"
                  role="img"
                  :aria-label="statusText(row)"
                  :title="statusText(row)"
                >
                  <span
                    v-for="part in segments(row)"
                    :key="part.status"
                    class="segment"
                    :class="part.status"
                    :style="{ width: `${part.share * 100}%` }"
                  />
                </div>
                <small class="muted">{{ statusText(row) || 'No AI checks' }}</small>
                <small v-if="manualText(row)" class="muted">{{ manualText(row) }}</small>
              </td>
              <td class="num right">{{ row.found }}</td>
              <td class="num right">{{ row.eligible }}</td>
              <td class="num right">{{ row.qualifying }}</td>
              <td class="num right">{{ row.alerts }}</td>
              <td class="num">
                <template v-if="row.lastUseful">{{ formatDateTime(row.lastUseful) }}</template>
                <span v-else class="muted">Never</span>
              </td>
            </tr>
            <tr v-if="expanded.has(row.rowKey)" class="detail">
              <td colspan="8">
                <ul class="recent">
                  <li v-for="entry in row.recent" :key="`${entry.runId}`">
                    <span class="num">{{ formatDateTime(entry.at) }}</span>
                    <StatusPill :status="entryStatus(entry)" compact />
                    <span v-if="entry.mode === 'manual'" class="muted">Chrome</span>
                    <a
                      v-if="entry.url"
                      class="quiet-link page-link"
                      :href="entry.url"
                      :title="entry.urlKind === 'home' ? HOME_LINK_TITLE : entry.url"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {{ pathOf(entry.url) }}
                      <span v-if="entry.urlKind === 'home'" class="muted">(home page)</span>
                    </a>
                    <span v-if="entry.note" class="note muted">{{ entry.note }}</span>
                  </li>
                </ul>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else-if="stats" class="muted small">No checks in the last {{ days }} days.</p>
  </div>
</template>

<style scoped>
.site-stats {
  margin-bottom: var(--space-5);
}

.stats-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  margin-bottom: var(--space-2);
}

.group-title {
  margin: 0;
  font-size: var(--text-caption);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  text-wrap: balance;
}

.lead {
  margin: 0 0 var(--space-2);
  text-wrap: pretty;
}

th,
th :deep(.sort-button) {
  white-space: nowrap;
}

td small {
  display: block;
  font-size: var(--text-caption);
  text-wrap: pretty;
}

.name {
  min-width: 200px;
}

.name-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
}

.site-name {
  font-weight: 600;
  text-wrap: balance;
}

.name > small {
  padding-left: 28px;
}

.hint {
  color: var(--ink-2);
  max-width: 28ch;
}

.recent-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}

.recent-toggle .app-icon {
  width: 16px;
  height: 16px;
  transition: transform 140ms;
}

.recent-toggle[aria-expanded='true'] .app-icon {
  transform: rotate(90deg);
}

.recent-toggle:not(:disabled):hover {
  color: var(--ink);
  background: var(--muted-bg);
}

.recent-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.recent-toggle:disabled {
  visibility: hidden;
}

.page-link {
  font-weight: 500;
  overflow-wrap: anywhere;
}

.results {
  min-width: 180px;
}

.bar {
  display: flex;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--track);
  margin-bottom: 3px;
}

.segment.ok {
  background: var(--ok-fill);
}

.segment.blocked {
  background: var(--warn-fill);
}

.segment.error {
  background: var(--bad-fill);
}

.segment.not_found {
  background: var(--meter-fill);
}

tr.is-muted td {
  color: var(--ink-3);
}

.detail td {
  background: var(--surface-sunk);
}

.recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-1);
}

.recent li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  font-size: var(--text-caption);
}

.note {
  flex-basis: 100%;
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.small {
  font-size: var(--text-caption);
}
</style>
