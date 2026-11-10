<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  getAlerts,
  getInsights,
  getRun,
  getRuns,
  getItems,
  getSiteStats,
  restoreItem,
  resumeItem,
  sendFeedback,
  startRun,
  tuneItem
} from '../api.js'
import { applyTuningChanges } from '../../../src/tuning.js'
import { itemVerdict } from '../../../src/verdict.js'
import { tuningChanges, tuningSummary } from '../tuningView.js'
import { whoLabel } from '../who.js'
import {
  formatMoney, formatDateTime, formatDayMonth, formatPausedUntil, timeZoneLabel
} from '../format.js'
import { describeSchedule } from '../schedulePresets.js'
import { aiHold, aiUsage, loadAiUsage } from '../aiState.js'
import {
  confirmRestore, confirmResumeItem, confirmRun
} from '../confirmCopy.js'
import { aiHoldNote, nextChecks } from '../nextChecks.js'
import { busiestCategory } from '../insightsView.js'
import { priceTableRows, recentDealWindows } from '../priceTable.js'
import { sectionElementId } from '../itemSections.js'
import FoldSection from './FoldSection.vue'
import ItemMoreMenu from './ItemMoreMenu.vue'
import ItemSummary from './ItemSummary.vue'
import PriceChart from './PriceChart.vue'
import PriceTable from './PriceTable.vue'
import DealWindows from './DealWindows.vue'
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
const HEALTH_STATS_DAYS = 30
const BLOCKED_STATUSES = ['blocked']
const NOTHING_LOADED = {
  insights: false, runs: false, latestRun: false, alerts: false, stats: false, suggestions: false
}
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
const loaded = ref(NOTHING_LOADED)
const otherLinks = ref({})
let pollTimer = null

const isRunning = computed(() => runs.value.some((run) => run.status === 'running'))

const lastRunRow = computed(() => runs.value[0] ?? null)

const verdict = computed(() => {
  if (!loaded.value.insights || !meta.value) return null
  return itemVerdict({
    item: meta.value,
    dealWindows: insights.value.dealWindows,
    retailers: insights.value.retailers
  })
})

const itemHref = (focusName) => `#/item/${encodeURIComponent(props.itemId)}/${focusName}`

const blockedSources = computed(() => new Set([
  ...botCheckSites.value,
  ...sources.value.filter(({ status }) => BLOCKED_STATUSES.includes(status)).map(({ name }) => name)
]))

const attention = computed(() => {
  const { runs: runsDone, stats, suggestions } = loaded.value
  if (!runsDone || !stats || !suggestions) return null
  const blocked = blockedSources.value.size
  const suggestionCount = suggestionState.report.value?.suggestions?.length ?? 0
  return [
    blocked && { key: 'sources', text: `${plural(blocked, 'source')} blocked` },
    suggestionCount && { key: 'tuning', text: plural(suggestionCount, 'tuning suggestion') },
    lastRunRow.value?.status === 'failed' && { key: 'runs', text: 'Last run failed' }
  ].filter(Boolean).map((entry) => ({ ...entry, href: itemHref(entry.key) }))
})

const research = computed(() => latestRun.value?.research ?? null)

const listings = computed(() => research.value?.listings ?? [])

const sources = computed(() => research.value?.sources ?? [])

const visibleWindows = computed(() => recentDealWindows({
  windows: insights.value.dealWindows
}))

const priceRows = computed(() => (meta.value && loaded.value.insights
  ? priceTableRows({
    item: meta.value,
    bestDays: insights.value.bestDays,
    retailers: insights.value.retailers,
    verdict: verdict.value
  })
  : []))

const showDay = (day) => {
  openDay.value = day
}

const hasRuns = computed(() => runs.value.length > 0)

const RUN_LABELS = { ok: 'OK', running: 'running', failed: 'failed', skipped: 'skipped' }

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const scheduleText = computed(() => {
  const texts = (meta.value?.schedules ?? []).map(describeSchedule)
  return texts.length ? `AI schedule (${timeZoneLabel()}): ${texts.join('; ')}` : ''
})

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
  if (!loaded.value.insights) return 'Loading'
  const [latest] = insights.value.priceChanges
  if (!latest) return 'None in this range'
  const move = latest.direction === 'drop' ? 'down' : 'up'
  return `${plural(insights.value.priceChanges.length, 'change')}, latest ${latest.retailer} `
    + `${move} ${formatMoney(Math.abs(latest.delta))} on ${formatDayMonth(latest.day)}`
})

const listingSummary = computed(() => {
  if (!loaded.value.latestRun) return 'Loading'
  if (!listings.value.length) return 'None from the latest run'
  const qualified = latestRun.value?.decision?.qualified?.length ?? 0
  return `${plural(listings.value.length, 'listing')}, ${qualified} qualify`
})

const sourceSummary = computed(() => {
  if (!loaded.value.latestRun) return 'Loading'
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
  if (!loaded.value.suggestions) return 'Loading'
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
  if (!loaded.value.alerts) return 'Loading'
  if (!alerts.value.length) return 'None sent yet'
  const last = alerts.value.find(({ kind }) => kind !== 'test')
  if (!last) return plural(alerts.value.length, 'test alert')
  return `${plural(alerts.value.length, 'alert')}, last ${formatDateTime(last.sentAt)}`
})

const load = async () => {
  loading.value = true
  loaded.value = NOTHING_LOADED
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
  statsKey.value += 1
  await Promise.all([
    loadInsights(), loadRuns(), loadAlerts(), loadSiteStats(), loadSuggestions()
  ])
}

const markLoaded = (part) => {
  loaded.value = { ...loaded.value, [part]: true }
}

const loadInsights = async () => {
  insights.value = await getInsights({ id: props.itemId, days: days.value })
  markLoaded('insights')
}

const loadRuns = async () => {
  runs.value = await getRuns({ id: props.itemId })
  markLoaded('runs')
  await loadLatestRun()
  markLoaded('latestRun')
}

const loadAlerts = async () => {
  alerts.value = await getAlerts({ itemId: props.itemId })
  markLoaded('alerts')
}

const loadSiteStats = async () => {
  const stats = await getSiteStats({ id: props.itemId, days: HEALTH_STATS_DAYS })
    .catch(() => null)
  keepBotChecks(stats)
  markLoaded('stats')
}

const loadSuggestions = async () => {
  await suggestionState.load()
  markLoaded('suggestions')
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
      text: `${dryRun ? 'Test run' : 'Run'} started. Research takes several minutes.`
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

const linksByName = (rows) => Object.fromEntries(rows
  .filter(({ url }) => url)
  .map(({ name, url, urlKind }) => [name, { url, urlKind }]))

const keepBotChecks = (stats) => {
  const siteRows = (stats?.sites ?? []).filter(({ kind }) => kind === 'site')
  botCheckSites.value = siteRows.filter(({ botCheck }) => botCheck).map(({ name }) => name)
  otherLinks.value = linksByName((stats?.sites ?? []).filter(({ kind }) => kind === 'other'))
}

const sectionId = sectionElementId

const scrollToFocus = async () => {
  if (!props.focus) return
  await nextTick()
  document.getElementById(sectionElementId(props.focus))?.scrollIntoView({ block: 'start' })
}

onMounted(() => {
  load()
  loadAiUsage().catch(() => null)
  pollTimer = setInterval(poll, POLL_MS)
})

onUnmounted(() => clearInterval(pollTimer))

watch(() => props.itemId, load)

watch(() => props.focus, scrollToFocus)
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
          <p v-if="holdNote" class="muted ids">
            <span class="pill neutral">{{ holdNote }}</span>
          </p>
        </div>
        <div class="actions">
          <a class="btn secondary" :href="editHref">Edit</a>
          <button
            class="btn"
            type="button"
            :disabled="launching !== null || isRunning"
            @click="launch(false)"
          >
            {{ launching === 'run' ? 'Starting...' : 'Run now' }}
          </button>
          <ItemMoreMenu
            :item="meta"
            :run-disabled="launching !== null || isRunning"
            :test-starting="launching === 'dry'"
            @test-run="launch(true)"
            @changed="applyStatus"
            @failed="showFailure"
          />
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

      <ItemSummary
        :verdict="verdict"
        :last-run="lastRunRow"
        :runs-loaded="loaded.runs"
        :checks="checks"
        :schedule="scheduleText"
        :last-alert="meta.lastAlert"
        :attention="attention"
      />

      <section class="group" aria-labelledby="group-prices">
        <h2 id="group-prices" class="group-title">Prices</h2>

        <section class="part">
          <header class="part-head">
            <h3>Price history</h3>
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
          <p v-if="!loaded.insights" class="muted loading-note">Loading</p>
          <PriceChart
            v-else
            v-model:show-muted="showMuted"
            :daily="insights.series"
            :rules="meta.rules"
            :categories="meta.categories"
            @select-day="showDay"
          />
        </section>

        <section v-if="priceRows.length" class="part">
          <header class="part-head">
            <h3>By category</h3>
            <span class="muted small">Prices after promos</span>
          </header>
          <PriceTable :rows="priceRows" @open-day="showDay" />
        </section>

        <section v-if="visibleWindows.length" class="part">
          <header class="part-head">
            <h3>Deal windows</h3>
            <span class="muted small">Days when a listing met your rules</span>
          </header>
          <DealWindows :windows="visibleWindows" @open-day="showDay" />
        </section>
      </section>

      <section class="group" aria-labelledby="group-details">
        <h2 id="group-details" class="group-title">Details</h2>
        <div class="folds">
          <FoldSection
            v-if="insights.retailers.length"
            :id="sectionId('retailers')"
            name="item-retailers"
            title="Retailers"
            :level="3"
            :summary="retailerSummary"
            :force-open="focus === 'retailers'"
          >
            <p class="fold-note muted">Prices after promos; delivery shown where known.</p>
            <RetailersTable v-model:show-muted="showMuted" :retailers="insights.retailers" />
          </FoldSection>

          <FoldSection
            v-if="insights.kits?.length"
            :id="sectionId('kit')"
            name="item-kits"
            title="Kit prices"
            :level="3"
            :summary="kitSummary"
            :force-open="focus === 'kit'"
          >
            <p class="fold-note muted">Cheapest in-stock part from each retailer, summed.</p>
            <KitPanel :kits="insights.kits" />
          </FoldSection>

          <FoldSection
            :id="sectionId('changes')"
            name="item-changes"
            title="Price changes"
            :level="3"
            :summary="changeSummary"
            :force-open="focus === 'changes'"
          >
            <PriceChanges :changes="insights.priceChanges" @open-day="showDay" />
          </FoldSection>

          <FoldSection
            v-if="hasRuns"
            :id="sectionId('listings')"
            name="item-listings"
            title="Latest listings"
            :level="3"
            :summary="listingSummary"
            :force-open="focus === 'listings'"
          >
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
        </div>
      </section>

      <section class="group" aria-labelledby="group-activity">
        <h2 id="group-activity" class="group-title">Activity</h2>
        <div class="folds">
          <FoldSection
            :id="sectionId('alerts')"
            name="item-alerts"
            title="Recent alerts"
            :level="3"
            :summary="alertSummary"
            :force-open="Boolean(alertId) || focus === 'alerts'"
          >
            <AlertsList v-if="alerts.length" :alerts="alerts" />
            <p v-else-if="!loaded.alerts" class="muted loading-note">Loading</p>
            <div v-else class="empty">
              <p>No alerts sent for this item yet.</p>
            </div>
          </FoldSection>

          <FoldSection
            v-if="hasRuns"
            :id="sectionId('runs')"
            name="item-runs"
            title="Recent runs"
            :level="3"
            :summary="runSummary"
            :force-open="focus === 'runs'"
          >
            <RunsTable :runs="runs" :item-name="meta.name" />
          </FoldSection>
        </div>
        <div v-if="loaded.runs && !hasRuns" class="empty no-runs">
          <h3>No runs yet</h3>
          <p>Start a test run to check prices without saving history or sending alerts.</p>
          <button class="btn" type="button" :disabled="launching !== null" @click="launch(true)">
            Test run
          </button>
        </div>
      </section>

      <section class="group" aria-labelledby="group-settings">
        <h2 id="group-settings" class="group-title">Settings and tuning</h2>
        <div class="folds">
          <FoldSection
            :id="sectionId('tuning')"
            name="item-tuning"
            title="Suggestions and muted"
            :level="3"
            :summary="tuningText"
            :force-open="focus === 'tuning'"
          >
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
            v-if="meta.sources?.sites?.length || meta.direct?.length || sources.length"
            :id="sectionId('sources')"
            name="item-sources"
            title="Sources"
            :level="3"
            :summary="sourceSummary"
            :force-open="focus === 'sources'"
          >
            <p class="fold-note muted">
              Muting a site stops the AI visiting it; a listing from it found another way can
              still alert.
            </p>
            <SiteStatsTable :item-id="itemId" :refresh-key="statsKey" @tune="requestTune" />
            <SourcesPanel
              :item="meta"
              :sources="sources"
              :other-links="otherLinks"
              @tune="requestTune"
            />
          </FoldSection>

          <FoldSection
            v-if="meta.ntfy"
            :id="sectionId('phone')"
            name="item-phone"
            title="Phone alerts"
            :level="3"
            summary="The ntfy topic for this item"
            :force-open="focus === 'phone'"
          >
            <NtfyTopic :server="meta.ntfy.server" :topic="meta.ntfy.topic" />
          </FoldSection>
        </div>
      </section>

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
  position: relative;
  z-index: 5;
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

.crumb {
  display: inline-block;
  margin-bottom: var(--space-1);
}

.small {
  font-size: var(--text-caption);
}

.fold-note {
  margin-bottom: var(--space-3);
  font-size: var(--text-caption);
}

.group {
  margin-top: var(--space-7);
}

.group-title {
  padding-bottom: var(--space-2);
  border-bottom: 2px solid var(--ink);
  font-size: var(--text-heading);
  text-wrap: balance;
}

.group .folds {
  margin-top: 0;
}

.group .folds > .fold:first-child {
  border-top: 0;
}

.part {
  margin-top: var(--space-5);
}

.part-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  margin-bottom: var(--space-3);
}

.part-head h3 {
  font-size: var(--text-title);
  text-wrap: balance;
}

.no-runs {
  margin-top: var(--space-4);
}

.loading-note {
  margin: 0;
  font-size: var(--text-small);
}

@media (max-width: 560px) {
  .actions {
    width: 100%;
    flex-wrap: nowrap;
  }
  .actions > * {
    flex: 1 1 0;
    justify-content: center;
  }
  .actions :deep(.more-toggle) {
    width: 100%;
    justify-content: center;
  }
}
</style>
