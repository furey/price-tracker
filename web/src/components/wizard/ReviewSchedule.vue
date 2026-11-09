<script setup>
import { computed, ref } from 'vue'
import { draftSchedules } from '../../api.js'
import { SCHEDULE_PRESETS } from '../../../../src/draft-schedule.js'
import { currentRegion } from '../../format.js'
import { describeSchedule } from '../../schedulePresets.js'
import { runsFor } from '../../wizard.js'
import AiRunsExplainer from '../AiRunsExplainer.vue'

const props = defineProps({
  config: { type: Object, required: true },
  draft: { type: Object, required: true },
  preset: { type: String, required: true }
})

const emit = defineEmits(['update:preset'])

const busy = ref(false)
const error = ref(null)

const runs = computed(() => runsFor(props.config.schedules))
const usage = computed(() => props.draft.usage)
const perRun = computed(() => usage.value.perRun)
const others = computed(() => usage.value.items)
const total = computed(() => usage.value.total + runs.value)
const overCap = computed(() => total.value > usage.value.cap)
const hours = computed(() => Math.round((runs.value * perRun.value.minutes) / 6) / 10)
const notional = computed(() => Math.round(runs.value * perRun.value.costUsd))

const basis = computed(() => (perRun.value.sampleSize
  ? `the last ${perRun.value.sampleSize} research runs`
  : 'a typical run'))

const share = (value) => `${Math.min(100, (value / Math.max(usage.value.cap, total.value)) * 100)}%`

const endDate = computed(() => props.draft.research?.endDate ?? null)

const dayFormat = new Intl.DateTimeFormat(currentRegion().locale, {
  timeZone: 'UTC', day: 'numeric', month: 'short'
})

const formatDay = (day) => dayFormat.format(new Date(`${day}T00:00:00Z`))

const pick = async (preset) => {
  if (preset === props.preset || busy.value) return
  busy.value = true
  error.value = null
  try {
    const { schedules } = await draftSchedules({ id: props.draft.id, preset })
    props.config.schedules = schedules
    emit('update:preset', preset)
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="review-body">
    <div class="segmented wide" role="group" aria-label="How often to check">
      <button
        v-for="option in SCHEDULE_PRESETS"
        :key="option.id"
        type="button"
        :aria-pressed="preset === option.id"
        :disabled="busy"
        @click="pick(option.id)"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="muted small">{{ SCHEDULE_PRESETS.find(({ id }) => id === preset)?.detail }}</p>
    <p v-if="error" class="banner bad" role="alert">{{ error }}</p>
    <ul class="plain-rows card">
      <li v-for="(schedule, index) in config.schedules" :key="`ai-${index}`">
        <div class="row-text">
          <span>AI check: {{ describeSchedule(schedule) }}</span>
        </div>
      </li>
      <li v-for="(schedule, index) in config.directSchedules ?? []" :key="`free-${index}`">
        <div class="row-text">
          <span>Free checks: {{ describeSchedule(schedule) }}</span>
        </div>
      </li>
    </ul>
    <p v-if="endDate && draft.input.needBy" class="banner info">
      Stops on {{ formatDay(endDate) }}: you need it by {{ formatDay(draft.input.needBy) }}, less
      time for delivery.
    </p>
    <div class="card padded stack">
      <h2 class="section-label">This item, next 30 days</h2>
      <div class="row-between">
        <span class="big-number num">{{ runs }}</span>
        <span class="muted small right-text">
          AI checks<br />about {{ hours }} h of Claude time
        </span>
      </div>
      <p class="small muted">
        Notional ${{ notional }} at API list prices, for comparison only: your Claude
        subscription pays, and the runs count toward its usage limits. Based on {{ basis }}
        (${{ perRun.costUsd.toFixed(2) }} and {{ perRun.minutes }} min each).
      </p>
    </div>
    <AiRunsExplainer />
    <div class="card padded stack">
      <div class="row-between">
        <h2 class="section-label">All items, next 30 days</h2>
        <span class="num small"><b>{{ total }}</b> of {{ usage.cap }}</span>
      </div>
      <div class="meter" aria-hidden="true">
        <i class="other" :style="{ width: share(usage.total) }" />
        <i class="mine" :class="{ over: overCap }" :style="{ width: share(runs) }" />
      </div>
      <p class="small muted">
        <template v-for="item in others" :key="item.id">
          {{ item.name }} {{ item.runs }} ·
        </template>
        {{ config.name }} {{ runs }}. The cap is set in Settings.
      </p>
      <p v-if="usage.month" class="small muted">
        This month so far: {{ usage.month.used }} of {{ usage.cap }} runs used, about
        {{ usage.month.projected }} by the end of the month with the current schedules.
      </p>
      <p v-if="overCap" class="banner bad" role="alert">
        Over the monthly cap of {{ usage.cap }}. Pick a lighter schedule, pause another item, or
        raise the cap in Settings. Save is blocked until then.
      </p>
    </div>
  </div>
</template>
