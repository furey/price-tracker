<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { aiHold } from '../aiState.js'
import { cancelDraft, getAiUsage, getDrafts, getItems } from '../api.js'
import { confirmDiscardDraft } from '../confirmCopy.js'
import { formatMoney, formatDateTime, pauseLabel } from '../format.js'
import { aiHoldNote, nextChecks } from '../nextChecks.js'
import { POLL_MS, draftName } from '../wizard.js'
import BotCheckNotice from './BotCheckNotice.vue'
import ClaudeUsageCard from './ClaudeUsageCard.vue'
import DraftCard from './DraftCard.vue'
import PauseButton from './PauseButton.vue'
import StatusPill from './StatusPill.vue'
import TrendChart from './TrendChart.vue'

const items = ref([])
const loading = ref(true)
const errorMessage = ref(null)
const showArchived = ref(false)
const notice = ref(null)
const drafts = ref([])
const month = ref(null)
const discarding = ref(null)
let draftTimer = null

const current = computed(() => items.value.filter((item) => item.status !== 'archived'))

const archived = computed(() => items.value.filter((item) => item.status === 'archived'))

const replaceItem = (updated) => {
  items.value = items.value.map((item) => (item.id === updated.id ? updated : item))
  notice.value = null
}

const showFailure = (error) => {
  notice.value = error.message
}

const loadDrafts = async () => {
  try {
    drafts.value = await getDrafts()
  } catch {
    drafts.value = []
  }
}

const discardDraft = async (draft) => {
  if (!(await confirmDiscardDraft({ name: draftName(draft) }))) return
  discarding.value = draft.id
  try {
    await cancelDraft(draft.id)
    drafts.value = drafts.value.filter(({ id }) => id !== draft.id)
  } catch (error) {
    notice.value = error.message
  } finally {
    discarding.value = null
  }
}

const loadUsage = async () => {
  try {
    month.value = (await getAiUsage()).month
  } catch {
    month.value = null
  }
}

const load = async () => {
  loading.value = true
  errorMessage.value = null
  loadDrafts()
  loadUsage()
  try {
    items.value = await getItems()
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const itemHref = (item) => `#/item/${encodeURIComponent(item.id)}`

const hasTrend = (item) => (item.trend?.days?.length ?? 0) >= 2

const lowestPrice = (item) => {
  const lowest = item.lowestRecent
  if (typeof lowest === 'number') return { price: lowest, retailer: null }
  if (!lowest) return null
  return {
    price: lowest.effectivePrice ?? lowest.lowest,
    retailer: lowest.retailer,
    category: lowest.category ?? null
  }
}

const lowestText = ({ category, retailer }) => [
  'lowest in 30 days',
  category && `(${category})`,
  retailer && `at ${retailer}`
].filter(Boolean).join(' ')

const alertSummary = (alert) => {
  if (!alert) return null
  const price = alert.effectivePrice ? ` ${formatMoney(alert.effectivePrice)}` : ''
  return `${alert.kind ?? 'alert'}${price}`
}

onMounted(() => {
  load()
  draftTimer = setInterval(() => {
    if (drafts.value.some(({ jobState }) => jobState)) loadDrafts()
  }, POLL_MS)
})

onUnmounted(() => clearInterval(draftTimer))
</script>

<template>
  <main>
    <h1>Items</h1>
    <p class="muted intro">Prices checked on schedule, lowest effective price per retailer.</p>

    <ClaudeUsageCard class="usage-top" />

    <p v-if="month?.reached" class="banner bad cap-banner" role="alert">
      This month's AI research cap is used up ({{ month.used }} of {{ month.cap }} runs).
      Scheduled AI checks pause until the 1st; free checks continue.
      <a href="#/settings/aiMonthlyCap">Raise the cap in Settings</a> to resume now.
    </p>
    <p v-else-if="month && month.projected > month.cap" class="banner cap-banner" role="status">
      The current schedules reach about {{ month.projected }} AI runs this month, over the cap of
      {{ month.cap }}. Scheduled AI checks stop once the cap is used.
      <a href="#/settings/aiMonthlyCap">Change the cap</a>
    </p>

    <ul v-if="drafts.length" class="grid drafts-grid" aria-label="Drafts">
      <li v-for="draft in drafts" :key="draft.id">
        <DraftCard :draft="draft" :busy="discarding === draft.id" @discard="discardDraft" />
      </li>
    </ul>

    <p v-if="loading && !items.length" class="muted state">Loading items...</p>

    <div v-else-if="errorMessage" class="empty">
      <h2>Cannot load items</h2>
      <p>{{ errorMessage }}</p>
      <button class="btn secondary" type="button" @click="load">Try again</button>
    </div>

    <div v-else-if="!items.length" class="empty">
      <h2>No items yet</h2>
      <p>Tap New item to describe what you want, and Claude drafts the item for you.</p>
      <a class="btn" href="#/new">New item</a>
    </div>

    <template v-else>
      <p v-if="notice" class="banner bad" role="alert">{{ notice }}</p>
      <p v-if="!current.length && !showArchived" class="empty all-archived">
        Every item is archived.
      </p>
      <BotCheckNotice />
      <ul class="grid">
        <li
          v-for="(item, index) in (showArchived ? items : current)"
          :key="item.id"
          class="rise"
          :style="{ '--i': index }"
        >
          <article class="item-card card" :class="{ dimmed: item.status !== 'active' }">
            <div class="head">
              <h2>
                <a class="card-link" :href="itemHref(item)">
                  {{ item.name }}
                </a>
              </h2>
              <div class="head-actions">
                <span v-if="pauseLabel(item)" class="pill" :class="item.status">
                  {{ pauseLabel(item) }}
                </span>
                <PauseButton
                  v-if="item.status !== 'archived'"
                  :item="item"
                  small
                  @changed="replaceItem"
                  @failed="showFailure"
                />
              </div>
            </div>

            <div class="price">
              <template v-if="lowestPrice(item)">
                <span class="num amount">{{ formatMoney(lowestPrice(item).price) }}</span>
                <span class="muted">
                  {{ lowestText(lowestPrice(item)) }}
                </span>
              </template>
              <span v-else class="muted">No prices recorded yet</span>
            </div>

            <p v-if="aiHoldNote({ item, hold: aiHold })" class="hold-note">
              <span class="pill neutral">{{ aiHoldNote({ item, hold: aiHold }) }}</span>
            </p>

            <TrendChart v-if="hasTrend(item)" :trend="item.trend" :href="itemHref(item)" />
            <p v-else-if="item.trend" class="trend-wait muted">
              Trend appears after a second day of prices
            </p>

            <dl>
              <div>
                <dt>Last run</dt>
                <dd>
                  <template v-if="item.lastRun">
                    <StatusPill :status="item.lastRun.status" />
                    <span class="num">{{ formatDateTime(item.lastRun.startedAt) }}</span>
                  </template>
                  <span v-else class="muted">Never</span>
                </dd>
              </div>
              <div v-for="check in nextChecks({ item, hold: aiHold })" :key="check.label">
                <dt>{{ check.label }}</dt>
                <dd>
                  <span :class="{ num: check.time, muted: check.muted }">{{ check.text }}</span>
                  <span v-if="check.detail" class="muted">{{ check.detail }}</span>
                </dd>
              </div>
              <div>
                <dt>Last alert</dt>
                <dd>
                  <template v-if="item.lastAlert">
                    <span class="num">{{ formatDateTime(item.lastAlert.sentAt) }}</span>
                    <span class="muted">{{ alertSummary(item.lastAlert) }}</span>
                  </template>
                  <span v-else class="muted">None</span>
                </dd>
              </div>
            </dl>
          </article>
        </li>
      </ul>
      <button
        v-if="archived.length"
        class="btn secondary small archived-toggle"
        type="button"
        :aria-pressed="showArchived"
        @click="showArchived = !showArchived"
      >
        {{ showArchived ? 'Hide archived' : `Archived (${archived.length})` }}
      </button>
    </template>
  </main>
</template>

<style scoped>
.usage-top {
  margin-top: var(--space-4);
}

.drafts-grid {
  margin-top: var(--space-4);
}

.intro {
  margin-top: var(--space-1);
}

.state {
  margin-top: var(--space-6);
}

.grid {
  list-style: none;
  margin: var(--space-5) 0 0;
  padding: 0;
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
}

.item-card {
  position: relative;
  display: block;
  height: 100%;
  padding: var(--space-4);
  transition: background-color 140ms;
}

.item-card:hover {
  background: var(--muted-bg);
}

.card-link:focus-visible {
  outline: none;
}

.card-link:focus-visible .item-card {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.card-link {
  text-decoration: none;
}

.card-link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--radius);
}

.card-link:focus-visible {
  outline: none;
}

.card-link:focus-visible::after {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  justify-content: space-between;
}

.head-actions {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dimmed .price .amount {
  color: var(--ink-3);
}

.archived-toggle {
  margin-top: var(--space-4);
}

.all-archived {
  margin-top: var(--space-5);
}

.price {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: var(--space-3) 0 var(--space-4);
}

.amount {
  font-size: var(--text-figure);
  font-weight: 600;
}

.hold-note {
  margin: calc(var(--space-1) * -1) 0 var(--space-3);
}

.trend-wait {
  margin: 0 0 var(--space-3);
  font-size: var(--text-caption);
  text-wrap: pretty;
}

dl {
  margin: 0;
  border-top: 1px solid var(--rule);
}

dl div {
  display: grid;
  grid-template-columns: 112px 1fr;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
}

dl div:last-child {
  border-bottom: 0;
  padding-bottom: 0;
}

dt {
  color: var(--ink-3);
  font-size: var(--text-caption);
  padding-top: 2px;
}

dd {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px var(--space-3);
  font-size: var(--text-small);
}
</style>
