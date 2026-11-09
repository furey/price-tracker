<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getAlerts,
  getInsights,
  getRun,
  getRuns,
  getItems,
  restoreItem,
  resumeItem,
  sendFeedback,
  startRun,
  tuneItem
} from '../api.js'
import { applyTuningChanges } from '../../../src/tuning.js'
import { tuningChanges, tuningSummary } from '../tuningView.js'
import { whoLabel } from '../who.js'
import {
  formatMoney, formatDateTime, formatDayMonth, formatPausedUntil, pauseLabel, timeZoneLabel
} from '../format.js'
import { describeSchedule } from '../schedulePresets.js'
import { aiHold, aiUsage, loadAiUsage } from '../aiState.js'
import {
  confirmRestore, confirmResumeItem, confirmRun
} from '../confirmCopy.js'
import { aiHoldNote, nextChecks } from '../nextChecks.js'
import { busiestCategory } from '../insightsView.js'
import FoldSection from './FoldSection.vue'
import PauseButton from './PauseButton.vue'
import StatusPill from './StatusPill.vue'
import PriceChart from './PriceChart.vue'
import DealWindows from './DealWindows.vue'
import LowestEver from './LowestEver.vue'
import KitPanel from './KitPanel.vue'
import NtfyTopic from './NtfyTopic.vue'
import RetailersTable from './RetailersTable.vue'
import PriceChanges from './PriceChanges.vue'
import DayDrawer from './DayDrawer.vue'
import ListingsTable from './ListingsTable.vue'
import RunsTable from './RunsTable.vue'
import AlertsList from './AlertsList.vue'
import AlertPanel from './AlertPanel.vue'
import SourcesPanel from './SourcesPanel.vue'
import TuningList from './TuningList.vue'
import TuningSheet from './TuningSheet.vue'
import TuningSuggestions from './TuningSuggestions.vue'
import SiteStatsTable from './SiteStatsTable.vue'
import { useSuggestions } from '../useSuggestions.js'

const props = defineProps({
  itemId: { type: String, required: true },
  alertId: { type: Number, default: null },
  focus: { type: String, default: null }
})

const DAY_OPTIONS = [30, 90, 365]
const ENDED_WINDOW_LIMIT = 6
const POLL_MS = 5000
const POLL_AFTER_START_MS = 45000

const meta = ref(null)
const insights = ref({
  series: [], bestDays: [], dealWindows: [], priceChanges: [], retailers: [], kits: []
})
const openDay = ref(null)
const runs = ref([])
const alerts = ref([])
const latestRun = ref(null)
const days = ref(90)
const loading = ref(true)
const errorMessage = ref(null)
const notFound = ref(false)
const launching = ref(null)
const notice = ref(null)
const pollUntil = ref(0)
const showMuted = ref(false)
const tuneRequest = ref(null)
const tuneSaving = ref(false)
const tuneError = ref(null)
const statsKey = ref(0)
const botCheckSites = ref([])
const siteLinks = ref({})
let pollTimer = null

const isRunning = computed(() => runs.value.some((run) => run.status === 'running'))

const lastRunRow = computed(() => runs.value[0] ?? null)

const lowestNow = computed(() => {
  const lowest = meta.value?.lowestRecent
  if (typeof lowest === 'number') return { price: lowest, retailer: null }
  if (!lowest) return null
  return {
    price: lowest.effectivePrice ?? lowest.lowest,
    where: [lowest.category, lowest.retailer].filter(Boolean).join(', ')
  }
})

const research = computed(() => latestRun.value?.research ?? null)

const listings = computed(() => research.value?.listings ?? [])

const sources = computed(() => research.value?.sources ?? [])

const visibleWindows = computed(() => {
  const windows = insights.value.dealWindows
  const live = windows.filter((window) => window.live)
  const ended = windows.filter((window) => !window.live)
  return [...live, ...ended.slice(0, ENDED_WINDOW_LIMIT)]
})

const hiddenWindowCount = computed(
  () => insights.value.dealWindows.length - visibleWindows.value.length
)

const showDay = (day) => {
  openDay.value = day
}

const hasRuns = computed(() => runs.value.length > 0)

const RUN_LABELS = { ok: 'OK', running: 'running', failed: 'failed', skipped: 'skipped' }

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const scheduleText = computed(() => (meta.value?.schedules ?? []).map(describeSchedule))

const liveSeries = computed(() => insights.value.series.filter(({ muted }) => !muted))

const liveRetailers = computed(() => insights.value.retailers.filter(({ muted }) => !muted))

const primaryCategory = computed(() => busiestCategory({
  rows: liveSeries.value,
  order: [...new Set(liveSeries.value.map(({ category }) => category))]
}))

const kitSummary = computed(() => {
  const [kit] = insights.value.kits ?? []
  if (!kit) return ''
  const total = `${kit.name} ${formatMoney(kit.total)}`
  const saving = kit.vsBundle?.saving
  if (!saving) return total
  const word = saving > 0 ? 'cheaper' : 'dearer'
  return `${total}, ${formatMoney(Math.abs(saving))} ${word} than the bundle`
})

const retailerSummary = computed(() => {
  const rows = liveRetailers.value
  const names = new Set(rows.map(({ retailer }) => retailer))
  const inCategory = rows.filter(({ category }) => category === primaryCategory.value)
  const pool = inCategory.length ? inCategory : rows
  const best = pool.reduce((low, row) => (!low || row.latest < low.latest ? row : low), null)
  if (!best) return plural(names.size, 'retailer')
  const label = inCategory.length ? `${primaryCategory.value} from` : 'from'
  const price = formatMoney(best.latest)
  return `${plural(names.size, 'retailer')}, ${label} ${price} at ${best.retailer}`
})

const changeSummary = computed(() => {
  const [latest] = insights.value.priceChanges
  if (!latest) return 'None in this range'
  const move = latest.direction === 'drop' ? 'down' : 'up'
  return `${plural(insights.value.priceChanges.length, 'change')}, latest ${latest.retailer} `
    + `${move} ${formatMoney(Math.abs(latest.delta))} on ${formatDayMonth(latest.day)}`
})

const listingSummary = computed(() => {
  if (!listings.value.length) return 'None from the latest run'
  const qualified = latestRun.value?.decision?.qualified?.length ?? 0
  return `${plural(listings.value.length, 'listing')}, ${qualified} qualify`
})

const sourceSummary = computed(() => {
  const counts = sources.value.reduce((total, { status }) => ({
    ...total, [status]: (total[status] ?? 0) + 1
  }), {})
  const labels = { ok: 'OK', not_found: 'not found', blocked: 'blocked', failed: 'failed' }
  const order = Object.keys(labels)
  const statuses = Object.entries(counts)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([status, count]) => `${count} ${labels[status] ?? status}`)
  const siteStates = Object.values(meta.value?.tuning?.sites ?? {})
  const muted = siteStates.filter(({ state }) => state === 'muted').length
  const weekly = siteStates.filter(({ state }) => state === 'weekly').length
  const sites = plural(meta.value?.sources?.sites?.length ?? 0, 'site')
  return [sites, muted && `${muted} muted`, weekly && `${weekly} weekly`, ...statuses]
    .filter(Boolean).join(', ')
})

const tuningText = computed(() => {
  if (!meta.value) return ''
  const count = suggestionState.report.value?.suggestions?.length ?? 0
  const muted = tuningSummary(meta.value)
  return count ? `${plural(count, 'suggestion')}, ${muted.toLowerCase()}` : muted
})

const previewConfig = () => ({
  categories: meta.value.categories,
  sources: meta.value.sources,
  direct: meta.value.direct,
  ...(meta.value.tuning ? { tuning: meta.value.tuning } : {})
})

const requestTune = (request) => {
  notice.value = null
  tuneError.value = null
  if (!request.changes.length) {
    tuneRequest.value = { ...request, diff: [] }
    return
  }
  try {
    const before = previewConfig()
    const after = applyTuningChanges({
      config: before, changes: request.changes, by: 'preview', at: new Date().toISOString()
    })
    tuneRequest.value = { ...request, diff: tuningChanges({ before, after }) }
  } catch (error) {
    notice.value = { tone: 'bad', text: error.message }
  }
}

const submitTune = async ({ request, note }) => {
  const reason = note || request.reason
  const feedback = request.feedbackReason
    ? { alertId: request.alertId ?? null, reason: request.feedbackReason }
    : null
  if (!request.changes.length) {
    await sendFeedback({
      id: props.itemId, alertId: feedback?.alertId, reason: feedback.reason, note: reason,
      by: whoLabel.value
    })
    return 'Feedback saved.'
  }
  const saved = await tuneItem({
    id: props.itemId, baseVersion: meta.value.version, changes: request.changes,
    by: whoLabel.value, reason, note: reason, feedback
  })
  return `${request.diff.map(({ label, to, from }) => `${label} ${to ?? from}`).join('; ')}. `
    + `Saved as version ${saved.version}.`
}

const confirmTune = async ({ note }) => {
  const request = tuneRequest.value
  tuneSaving.value = true
  tuneError.value = null
  try {
    const text = await submitTune({ request, note })
    tuneRequest.value = null
    notice.value = { tone: 'good', text }
    await refresh()
    if (request.after === 'edit-prices') window.location.hash = `${editHref.value}/alert-prices`
  } catch (error) {
    tuneError.value = error.status === 409
      ? `${error.message} The page now shows the latest version; save again to apply.`
      : error.message
    if (error.status === 409) await refresh().catch(() => null)
  } finally {
    tuneSaving.value = false
  }
}

const runSummary = computed(() => {
  const last = runs.value[0]
  if (!last) return ''
  const problems = runs.value.filter(({ status }) => ['failed', 'error'].includes(status)).length
  const skipped = runs.value.filter(({ status }) => status === 'skipped').length
  const extras = [problems && `${problems} failed`, skipped && `${skipped} skipped`]
  const label = RUN_LABELS[last.status] ?? last.status
  return [`Last run ${label} ${formatDateTime(last.startedAt)}`, ...extras.filter(Boolean)]
    .join(', ')
})

const alertSummary = computed(() => {
  const [last] = alerts.value
  if (!last) return 'None sent yet'
  return `${plural(alerts.value.length, 'alert')}, last ${formatDateTime(last.sentAt)}`
})

const load = async () => {
  loading.value = true
  errorMessage.value = null
  try {
    await refresh()
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
  await scrollToFocus()
}

const refresh = async () => {
  const items = await getItems()
  const found = items.find((entry) => entry.id === props.itemId)
  notFound.value = !found
  if (!found) return
  meta.value = found
  const [insightData, runList, alertList] = await Promise.all([
    getInsights({ id: props.itemId, days: days.value }),
    getRuns({ id: props.itemId }),
    getAlerts({ itemId: props.itemId })
  ])
  insights.value = insightData
  runs.value = runList
  alerts.value = alertList
  statsKey.value += 1
  await Promise.all([loadLatestRun(), suggestionState.load()])
}

const loadLatestRun = async () => {
  const finished = runs.value.find((run) => run.status === 'ok')
  if (!finished) {
    latestRun.value = null
    return
  }
  if (latestRun.value?.id === finished.id) return
  latestRun.value = await getRun(finished.id)
}

const changeDays = async (value) => {
  days.value = value
  try {
    insights.value = await getInsights({ id: props.itemId, days: value })
  } catch (error) {
    errorMessage.value = error.message
  }
}

const checks = computed(() => (meta.value ? nextChecks({ item: meta.value, hold: aiHold.value })
  : []))

const holdNote = computed(() => (meta.value
  ? aiHoldNote({ item: meta.value, hold: aiHold.value })
  : null))

const askRun = async ({ dryRun, anyway }) => {
  await loadAiUsage().catch(() => null)
  return confirmRun({
    name: meta.value.name,
    dryRun,
    anyway,
    guardMessage: notice.value?.text ?? null,
    weekly: aiUsage.value?.weekly ?? null,
    hold: aiHold.value
  })
}

const launch = async (dryRun, runAnyway = false) => {
  if (!(await askRun({ dryRun, anyway: runAnyway }))) return
  launching.value = dryRun ? 'dry' : 'run'
  notice.value = null
  try {
    await startRun({ id: props.itemId, dryRun, runAnyway })
    notice.value = {
      tone: 'info',
      text: `${dryRun ? 'Dry run' : 'Run'} started. Research takes several minutes.`
    }
    pollUntil.value = Date.now() + POLL_AFTER_START_MS
    await refresh()
  } catch (error) {
    if (error.body?.guard) {
      notice.value = { tone: 'warn', text: error.message, overrideDryRun: dryRun }
      return
    }
    const text =
      error.status === 409
        ? 'A run is already in progress. Wait for it to finish, then try again.'
        : error.message
    notice.value = { tone: error.status === 409 ? 'warn' : 'bad', text }
  } finally {
    launching.value = null
  }
}

const applyStatus = (updated) => {
  meta.value = updated
  notice.value = null
}

const showFailure = (error) => {
  notice.value = { tone: 'bad', text: error.message }
}

const STATUS_CONFIRMS = new Map([
  [resumeItem, confirmResumeItem],
  [restoreItem, confirmRestore]
])

const changeStatus = async (action) => {
  const ask = STATUS_CONFIRMS.get(action)
  if (!(await ask({ item: meta.value, name: meta.value.name }))) return
  try {
    applyStatus(await action(props.itemId))
  } catch (error) {
    showFailure(error)
  }
}

const editHref = computed(() => `#/item/${encodeURIComponent(props.itemId)}/edit`)

const suggestionState = useSuggestions({
  itemId: () => props.itemId,
  editHref: () => editHref.value,
  requestTune,
  notify: (message) => {
    notice.value = message
  },
  afterSave: () => refresh()
})

const poll = async () => {
  const active = isRunning.value || Date.now() < pollUntil.value
  if (!active) return
  await refresh().catch(() => null)
}

const keepBotChecks = (stats) => {
  const siteRows = (stats?.sites ?? []).filter(({ kind }) => kind === 'site')
  botCheckSites.value = siteRows.filter(({ botCheck }) => botCheck).map(({ name }) => name)
  siteLinks.value = Object.fromEntries(siteRows
    .filter(({ url }) => url)
    .map(({ name, url, urlKind }) => [name, { url, urlKind }]))
}

const SECTION_IDS = { sources: 'item-sources' }

const scrollToFocus = async () => {
  const id = SECTION_IDS[props.focus]
  if (!id) return
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ block: 'start' })
}

onMounted(() => {
  load()
  loadAiUsage().catch(() => null)
  pollTimer = setInterval(poll, POLL_MS)
})

onUnmounted(() => clearInterval(pollTimer))

watch(() => props.itemId, load)
</script>

<template>
  <main>
    <p v-if="loading && !meta" class="muted">Loading...</p>

    <div v-else-if="errorMessage && !meta" class="empty">
      <h2>Cannot load this item</h2>
      <p>{{ errorMessage }}</p>
      <button class="btn secondary" type="button" @click="load">Try again</button>
    </div>

    <div v-else-if="notFound" class="empty">
      <h2>Item not found</h2>
      <p>No item has the id <code>{{ itemId }}</code>.</p>
      <a class="btn secondary back" href="#/">Back to Items</a>
    </div>

    <template v-else-if="meta">
      <header class="detail-head">
        <div>
          <a class="crumb" href="#/">Items</a>
          <h1>{{ meta.name }}</h1>
          <p class="muted ids">
            <span class="num">{{ meta.id }}</span>
            <span class="num">version {{ meta.version }}</span>
            <span v-if="pauseLabel(meta)" class="pill" :class="meta.status">
              {{ pauseLabel(meta) }}
            </span>
            <span v-if="holdNote" class="pill neutral">{{ holdNote }}</span>
          </p>
        </div>
        <div class="actions">
          <PauseButton
            v-if="meta.status !== 'archived'"
            :item="meta"
            @changed="applyStatus"
            @failed="showFailure"
          />
          <a class="btn secondary" :href="editHref">Edit</a>
          <button
            class="btn"
            type="button"
            :disabled="launching !== null || isRunning"
            @click="launch(false)"
          >
            {{ launching === 'run' ? 'Starting...' : 'Run now' }}
          </button>
          <button
            class="btn secondary"
            type="button"
            :disabled="launching !== null || isRunning"
            @click="launch(true)"
          >
            {{ launching === 'dry' ? 'Starting...' : 'Dry run' }}
          </button>
        </div>
      </header>

      <div v-if="meta.status === 'paused'" class="banner neutral status-banner" role="status">
        <p>
          <strong>Paused.</strong> No checks run until you resume.
          <template v-if="meta.pausedUntil">
            It resumes on its own on {{ formatPausedUntil(meta.pausedUntil) }}.
          </template>
        </p>
        <button class="btn small" type="button" @click="changeStatus(resumeItem)">Resume</button>
      </div>
      <div v-if="meta.status === 'archived'" class="banner neutral status-banner" role="status">
        <p><strong>Archived.</strong> No checks run. The price history stays.</p>
        <button class="btn small" type="button" @click="changeStatus(restoreItem)">
          Restore
        </button>
      </div>
      <div
        v-if="notice?.overrideDryRun !== undefined"
        class="banner guard-banner"
        role="status"
      >
        <p>{{ notice.text }}</p>
        <button
          class="btn small"
          type="button"
          :disabled="launching !== null"
          @click="launch(notice.overrideDryRun, true)"
        >
          Run anyway
        </button>
      </div>
      <p v-else-if="notice" class="banner" :class="notice.tone" role="status">{{ notice.text }}</p>
      <p v-if="isRunning" class="banner info" role="status">
        A run is in progress. This page refreshes.
      </p>
      <p v-if="errorMessage" class="banner bad" role="alert">{{ errorMessage }}</p>

      <AlertPanel
        v-if="alertId"
        :key="alertId"
        :alert-id="alertId"
        :item-id="itemId"
        :item="meta"
        @open-day="showDay"
        @tune="requestTune"
      />

      <section class="summary card" aria-label="Status summary">
        <div class="stat">
          <span class="label">Lowest recent</span>
          <template v-if="lowestNow">
            <span class="num big">{{ formatMoney(lowestNow.price) }}</span>
            <span class="muted small">{{ lowestNow.where || 'last 30 days' }}</span>
          </template>
          <span v-else class="muted">No prices yet</span>
        </div>
        <div class="stat">
          <span class="label">Last run</span>
          <template v-if="lastRunRow">
            <StatusPill :status="lastRunRow.status" />
            <span class="num small">{{ formatDateTime(lastRunRow.startedAt) }}</span>
          </template>
          <span v-else class="muted">Never</span>
        </div>
        <div class="stat">
          <span class="label">Next checks</span>
          <span v-for="check in checks" :key="check.label" class="check-line small">
            <span class="check-kind">{{ check.short }}</span>
            <span :class="{ num: check.time, muted: check.muted }">{{ check.text }}</span>
            <span v-if="check.detail" class="muted">{{ check.detail }}</span>
          </span>
        </div>
        <div class="stat">
          <span class="label">Last alert</span>
          <template v-if="meta.lastAlert">
            <span class="num small">{{ formatDateTime(meta.lastAlert.sentAt) }}</span>
            <span class="muted small">{{ meta.lastAlert.kind }}</span>
          </template>
          <span v-else class="muted">None</span>
        </div>
      </section>

      <p v-if="scheduleText.length" class="schedules muted">
        <span>Checks ({{ timeZoneLabel() }}):</span>
        <span v-for="(text, index) in scheduleText" :key="index">{{ text }}</span>
      </p>

      <section class="section">
        <header>
          <h2>Deal windows</h2>
          <span class="muted small">Days when a listing met your rules</span>
        </header>
        <DealWindows :windows="visibleWindows" @open-day="showDay" />
        <p v-if="hiddenWindowCount" class="muted small more">
          {{ hiddenWindowCount }} older ended windows not shown.
        </p>
      </section>

      <section v-if="insights.bestDays.length" class="section">
        <header>
          <h2>Lowest ever</h2>
          <span class="muted small">Cheapest effective price recorded</span>
        </header>
        <LowestEver
          :best-days="insights.bestDays"
          :categories="meta.categories"
          @open-day="showDay"
        />
      </section>

      <section class="section">
        <header>
          <h2>Price history</h2>
          <div class="segmented" role="group" aria-label="Days">
            <button
              v-for="option in DAY_OPTIONS"
              :key="option"
              type="button"
              :aria-pressed="days === option"
              @click="changeDays(option)"
            >
              {{ option }} days
            </button>
          </div>
        </header>
        <PriceChart
          v-model:show-muted="showMuted"
          :daily="insights.series"
          :rules="meta.rules"
          :categories="meta.categories"
          @select-day="showDay"
        />
      </section>

      <div class="folds">
        <FoldSection name="item-tuning" title="Tuning" :summary="tuningText">
          <TuningSuggestions
            :report="suggestionState.report.value"
            :busy="suggestionState.busy.value"
            @accept="suggestionState.accept"
            @accept-everywhere="suggestionState.acceptEverywhere"
            @dismiss="suggestionState.dismiss"
            @restore="suggestionState.restore"
          />
          <TuningList :item="meta" @tune="requestTune" />
        </FoldSection>

        <FoldSection
          v-if="meta.sources?.sites?.length || sources.length"
          id="item-sources"
          name="item-sources"
          title="Sources"
          :summary="sourceSummary"
          :force-open="focus === 'sources'"
        >
          <SiteStatsTable :item-id="itemId" :refresh-key="statsKey" @loaded="keepBotChecks" />
          <p class="fold-note muted">
            Statuses from the latest successful run. Muting a site stops the AI visiting it;
            a listing from it found another way can still alert.
          </p>
          <SourcesPanel
            :item="meta"
            :sources="sources"
            :bot-check-sites="botCheckSites"
            :site-links="siteLinks"
            @tune="requestTune"
          />
        </FoldSection>

        <FoldSection
          v-if="insights.kits?.length"
          name="item-kits"
          title="Kit prices"
          :summary="kitSummary"
        >
          <p class="fold-note muted">Cheapest in-stock part from each retailer, summed.</p>
          <KitPanel :kits="insights.kits" />
        </FoldSection>

        <FoldSection
          v-if="insights.retailers.length"
          name="item-retailers"
          title="Retailers"
          :summary="retailerSummary"
        >
          <p class="fold-note muted">Effective prices; delivery shown where known.</p>
          <RetailersTable v-model:show-muted="showMuted" :retailers="insights.retailers" />
        </FoldSection>

        <FoldSection name="item-changes" title="Price changes" :summary="changeSummary">
          <PriceChanges :changes="insights.priceChanges" @open-day="showDay" />
        </FoldSection>

        <template v-if="hasRuns">
          <FoldSection name="item-listings" title="Latest listings" :summary="listingSummary">
            <p v-if="latestRun" class="fold-note muted">
              From run {{ latestRun.id }}, {{ formatDateTime(latestRun.startedAt) }}.
            </p>
            <ListingsTable
              v-if="listings.length"
              v-model:show-muted="showMuted"
              :listings="listings"
              :decision="latestRun.decision"
              :item="meta"
              @tune="requestTune"
            />
            <div v-else class="empty">
              <p>The latest successful run found no listings, or no run has finished.</p>
            </div>
          </FoldSection>

          <FoldSection name="item-runs" title="Recent runs" :summary="runSummary">
            <RunsTable :runs="runs" />
          </FoldSection>
        </template>

        <FoldSection
          name="item-alerts"
          title="Recent alerts"
          :summary="alertSummary"
          :force-open="Boolean(alertId)"
        >
          <AlertsList v-if="alerts.length" :alerts="alerts" />
          <div v-else class="empty">
            <p>No alerts sent for this item yet.</p>
          </div>
        </FoldSection>

        <FoldSection
          v-if="meta.ntfy"
          name="item-phone"
          title="Phone alerts"
          :summary="`ntfy topic ${meta.ntfy.topic}`"
        >
          <NtfyTopic :server="meta.ntfy.server" :topic="meta.ntfy.topic" />
        </FoldSection>
      </div>

      <div v-if="!hasRuns" class="empty section">
        <h2>No runs yet</h2>
        <p>Run a dry run to check prices without saving history or sending alerts.</p>
        <button class="btn" type="button" :disabled="launching !== null" @click="launch(true)">
          Dry run
        </button>
      </div>
      <TuningSheet
        v-if="tuneRequest"
        :request="{ ...tuneRequest, changes: tuneRequest.diff }"
        :next-version="meta.version + 1"
        :saving="tuneSaving"
        :error="tuneError"
        @confirm="confirmTune"
        @cancel="tuneRequest = null"
      />
      <DayDrawer
        v-if="openDay"
        :item-id="itemId"
        :item-name="meta.name"
        :day="openDay"
        @close="openDay = null"
      />
    </template>
  </main>
</template>

<style scoped>
.detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3) var(--space-5);
}

.ids {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-top: 2px;
  font-size: var(--text-small);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.actions a.btn {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.status-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
}

.back {
  display: inline-block;
  margin-top: var(--space-4);
  text-decoration: none;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: var(--space-5);
  overflow: hidden;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-left: 1px solid var(--rule);
}

.stat:first-child {
  border-left: 0;
}

.crumb {
  display: inline-block;
  margin-bottom: var(--space-1);
}

.check-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
}

.check-kind {
  color: var(--ink-2);
  font-weight: 600;
}

.label {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

.big {
  font-size: var(--text-figure);
  font-weight: 600;
  line-height: 1.1;
}

.small {
  font-size: var(--text-caption);
}

.schedules {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-3);
  margin-top: var(--space-2);
  font-size: var(--text-caption);
}

.fold-note {
  margin-bottom: var(--space-3);
  font-size: var(--text-caption);
}

.more {
  margin: var(--space-2) 0 0;
}

@media (max-width: 720px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stat:nth-child(3) {
    border-left: 0;
  }
  .stat:nth-child(n + 3) {
    border-top: 1px solid var(--rule);
  }
}

@media (max-width: 560px) {
  .actions {
    width: 100%;
  }
  .actions .btn {
    flex: 1 1 40%;
    justify-content: center;
  }
}
</style>
