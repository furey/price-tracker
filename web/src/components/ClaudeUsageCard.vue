<script setup>
import { computed, onMounted, ref, useId } from 'vue'
import { aiHold, aiUsage as usage, loadAiUsage, setAiUsage } from '../aiState.js'
import { pauseAi, refreshClaudeUsage, resumeAi } from '../api.js'
import { confirmPauseAllAi, confirmResumeAi } from '../confirmCopy.js'
import { formatDateTime, formatShortWhen, formatTime } from '../format.js'
import { useStoredOpen } from '../useStoredOpen.js'
import AppIcon from './AppIcon.vue'
import ConnectClaudeCard from './ConnectClaudeCard.vue'

const loadError = ref(null)
const busy = ref(null)
const notice = ref(null)
const open = useStoredOpen({ key: 'claude-usage', initial: false })
const detailsId = useId()

const NEAR_RESERVE_POINTS = 10

const SOURCE_LABELS = {
  probe: 'a refresh',
  run: 'an AI check',
  draft: 'a new item draft',
  'login-test': 'a login test'
}

const WINDOW_NAMES = { seven_day: 'weekly', five_hour: 'session' }

const guard = computed(() => usage.value?.guard ?? null)

const paused = computed(() => usage.value?.limits.paused === true)

const state = computed(() => {
  if (!guard.value) return null
  if (guard.value.allow) return 'running'
  return guard.value.reason
})

const pill = computed(() => ({
  running: { tone: 'ok', text: 'AI checks running' },
  paused: { tone: 'neutral', text: 'AI checks paused by you' },
  reserve: { tone: 'warn', text: 'AI checks paused: above reserve' },
  limited: { tone: 'bad', text: 'Claude limit reached' }
})[state.value] ?? null)

const statusLine = computed(() => {
  const decision = guard.value
  if (!decision) return ''
  const resumes = decision.resumesAt
    ? ` AI checks resume ${formatShortWhen(decision.resumesAt)}.`
    : ''
  const windowName = WINDOW_NAMES[decision.window] ?? 'usage'
  if (state.value === 'running') return 'AI checks run on schedule.'
  if (state.value === 'paused') return 'You paused all AI checks. Free price checks keep running.'
  if (state.value === 'limited') return `Claude's ${windowName} limit is reached.${resumes}`
  const label = `${windowName.charAt(0).toUpperCase()}${windowName.slice(1)}`
  return `${label} usage is ${decision.percent}%, above your ${decision.reserve}% reserve.`
    + resumes
})

const toneOf = (reading) => {
  if (reading.status && reading.status !== 'allowed') return 'bad'
  if (typeof reading.percent !== 'number') return 'normal'
  if (reading.percent >= 100) return 'bad'
  return reading.percent >= reading.reserve - NEAR_RESERVE_POINTS ? 'warn' : 'normal'
}

const toBar = (reading) => reading && {
  ...reading,
  fill: Math.min(100, reading.percent ?? 0),
  tone: toneOf(reading),
  resets: reading.resetsAt ? formatShortWhen(reading.resetsAt) : null
}

const weekly = computed(() => toBar(usage.value?.weekly))

const session = computed(() => toBar(usage.value?.session))

const latest = computed(() => [...(usage.value?.readings ?? [])]
  .sort((a, b) => Date.parse(b.readAt) - Date.parse(a.readAt))[0] ?? null)

const facts = computed(() => {
  const reading = latest.value
  const month = usage.value?.month
  return [
    reading && `Updated ${formatDateTime(reading.readAt)} from `
      + `${SOURCE_LABELS[reading.source] ?? reading.source}`,
    overageText(usage.value?.weekly ?? reading),
    month && `${month.used} of ${month.cap} AI runs this month`
  ].filter(Boolean)
})

const overageText = (reading) => {
  if (!reading?.overageStatus && !reading?.isUsingOverage) return null
  if (reading.isUsingOverage) return 'Using extra usage, billed on top of your plan'
  return reading.overageStatus === 'allowed' ? 'Extra usage on, not in use' : 'Extra usage off'
}

const load = async () => {
  try {
    await loadAiUsage()
    loadError.value = null
  } catch (error) {
    loadError.value = error.message
  }
}

const act = async ({ key, call, success }) => {
  busy.value = key
  notice.value = null
  try {
    const result = await call()
    setAiUsage(result.usage ?? result)
    notice.value = { tone: 'done', text: success }
  } catch (error) {
    if (error.body?.usage) setAiUsage(error.body.usage)
    notice.value = { tone: 'bad', text: refreshProblem(error) }
  } finally {
    busy.value = null
  }
}

const refreshProblem = (error) => {
  if (error.status === 429 && error.body?.retryAt) {
    return `Refreshed in the last 10 minutes. Try again after ${formatTime(error.body.retryAt)}.`
  }
  return error.message
}

const refresh = () => act({ key: 'refresh', call: refreshClaudeUsage, success: 'Updated just now' })

const togglePause = async () => {
  const resuming = paused.value
  const confirmed = resuming
    ? await confirmResumeAi({ hold: aiHold.value })
    : await confirmPauseAllAi()
  if (!confirmed) return
  await act({
    key: 'pause',
    call: resuming ? resumeAi : pauseAi,
    success: resuming ? 'AI checks resumed' : 'AI checks paused; free checks keep running'
  })
}

onMounted(load)

defineExpose({ load })
</script>

<template>
  <ConnectClaudeCard v-if="state === 'disconnected'" :source="usage.connection?.source ?? null" />
  <section v-else class="usage card" aria-label="Claude usage">
    <button
      class="usage-toggle"
      type="button"
      :aria-expanded="open"
      :aria-controls="detailsId"
      @click="open = !open"
    >
      <span class="usage-head">
        <span class="usage-titles">
          <span class="usage-title">Claude usage</span>
          <span v-if="pill" class="pill" :class="pill.tone">{{ pill.text }}</span>
        </span>
        <svg class="fold-chevron" :class="{ turned: open }" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </span>
      <span v-if="loadError" class="usage-caption">Cannot load Claude usage: {{ loadError }}</span>
      <span v-else-if="!usage" class="usage-caption">Loading...</span>
      <span v-else-if="!weekly" class="usage-caption">No reading yet. Open to refresh.</span>
      <template v-else>
        <span class="meter-bar" :class="weekly.tone" aria-hidden="true">
          <span class="meter-fill" :style="{ width: `${weekly.fill}%` }" />
          <span class="meter-tick" :style="{ left: `${weekly.reserve}%` }" />
        </span>
        <span class="usage-caption num">
          <span><strong>{{ weekly.percent ?? '?' }}%</strong> this week</span><span
            class="sep">reserve {{ weekly.reserve }}%</span><span
            v-if="weekly.resets" class="sep">resets {{ weekly.resets }}</span>
        </span>
      </template>
    </button>

    <div v-show="open" :id="detailsId" class="usage-details">
      <template v-if="usage">
        <p class="status-line">{{ statusLine }}</p>

        <p v-if="usage.formatChanged" class="banner bad small">
          Claude Code sent its usage in a new format this app cannot read. The figures show the
          last good reading.
        </p>

        <div v-if="session" class="session">
          <span class="session-label">Five-hour session</span>
          <span class="meter-bar" :class="session.tone" aria-hidden="true">
            <span class="meter-fill" :style="{ width: `${session.fill}%` }" />
            <span class="meter-tick" :style="{ left: `${session.reserve}%` }" />
          </span>
          <span class="usage-caption num">
            <span><strong>{{ session.percent ?? '?' }}%</strong> used</span><span
              class="sep">reserve {{ session.reserve }}%</span><span
              v-if="session.resets" class="sep">resets {{ session.resets }}</span>
          </span>
        </div>

        <p v-if="facts.length" class="facts num">
          <span v-for="(fact, index) in facts" :key="fact" :class="{ sep: index > 0 }">
            {{ fact }}
          </span>
        </p>

        <div class="usage-actions">
          <button
            class="btn secondary small"
            type="button"
            :disabled="busy !== null"
            @click="refresh"
          >
            {{ busy === 'refresh' ? 'Refreshing...' : 'Refresh' }}
          </button>
          <button
            class="btn small"
            :class="{ secondary: !paused }"
            type="button"
            :disabled="busy !== null"
            @click="togglePause"
          >
            <AppIcon v-if="!paused" name="pause" />
            {{ busy === 'pause' ? 'Saving...' : paused ? 'Resume AI checks' : 'Pause AI checks' }}
          </button>
          <span v-if="!notice" class="notice">
            {{ paused
              ? 'AI research is off for every item. Free checks are running.'
              : 'Stops AI research for every item. Free checks keep running.' }}
          </span>
          <span v-if="notice" class="notice" :class="notice.tone" role="status">
            {{ notice.text }}
          </span>
        </div>

        <details class="how">
          <summary>How this works</summary>
          <p>
            AI checks stop when weekly usage passes your reserve, and start again when the week
            resets. Free price checks keep running. The figures cover your whole Claude account,
            work included.
          </p>
          <p>
            Refresh asks Claude for a one-word reply, which uses a tiny amount of your usage. It
            works once every 10 minutes.
          </p>
        </details>
      </template>
    </div>
  </section>
</template>

<style scoped>
.usage {
  padding: 0;
}

.usage-toggle {
  display: grid;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-4);
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.usage-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.usage-toggle:hover .fold-chevron {
  stroke: var(--ink);
}

.usage-titles {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.usage-head {
  display: flex;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.usage-title {
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.usage-head .fold-chevron {
  margin-left: auto;
}

.fold-chevron.turned {
  transform: rotate(180deg);
}

.meter-bar {
  position: relative;
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--track);
}

.meter-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: var(--meter-fill);
}

.meter-bar.warn .meter-fill {
  background: var(--warn-fill);
}

.meter-bar.bad .meter-fill {
  background: var(--bad-fill);
}

.meter-tick {
  position: absolute;
  top: -4px;
  bottom: -4px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--meter-tick);
}

.usage-caption {
  font-size: var(--text-small);
  color: var(--ink-2);
  text-wrap: pretty;
}

.usage-caption > span {
  display: inline-block;
  white-space: nowrap;
}

.usage-caption strong {
  color: var(--ink);
}

.usage-details {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
  border-top: 1px solid var(--rule);
}

.status-line {
  font-weight: 600;
  text-wrap: pretty;
}

.session {
  display: grid;
  gap: var(--space-2);
}

.session-label {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

.facts {
  font-size: var(--text-caption);
  color: var(--ink-3);
  text-wrap: pretty;
}

.usage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.notice {
  font-size: var(--text-caption);
  color: var(--ink-3);
}

.notice.bad {
  color: var(--bad);
}

.how {
  font-size: var(--text-small);
  color: var(--ink-2);
}

.how summary {
  width: fit-content;
  color: var(--accent-text);
  font-weight: 600;
  cursor: pointer;
}

.how p {
  margin-top: var(--space-2);
  text-wrap: pretty;
}

.banner {
  margin-top: 0;
}
</style>
