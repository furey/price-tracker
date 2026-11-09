<script setup>
import { computed } from 'vue'
import { formatTime } from '../../format.js'
import { draftName, elapsedMinutes, progressFor } from '../../wizard.js'
import StepBar from './StepBar.vue'
import WizardActions from './WizardActions.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  now: { type: Number, required: true },
  busy: { type: Boolean, default: false }
})

const emit = defineEmits(['cancel'])

const progress = computed(() => progressFor({ status: props.draft.status }))

const researching = computed(() => props.draft.status === 'researching')

const heading = computed(() => (researching.value
  ? `Researching ${draftName(props.draft)}`
  : 'Reading your request'))

const running = computed(() => props.draft.jobState === 'running')

const minutes = computed(() => elapsedMinutes({
  from: props.draft.jobStartedAt, now: props.now
}))

const answeredAt = computed(() => {
  const event = [...props.draft.events].reverse()
    .find(({ message }) => message.startsWith('Researching'))
  return event ? formatTime(event.at) : null
})

const linksTested = computed(() => props.draft.events.at(-1)?.message === 'Testing product links')

const steps = computed(() => {
  const hasAnswers = props.draft.questions.length > 0
  if (!researching.value) {
    return [
      { label: 'Read your request and search the web', state: running.value ? 'run' : 'wait',
        detail: running.value ? `${minutes.value ?? 0} min` : 'next' },
      { label: 'Questions for you', state: 'wait', detail: 'next' }
    ]
  }
  return [
    { label: 'Understood the request', state: 'done', detail: '' },
    ...(hasAnswers
      ? [{ label: 'Your answers', state: 'done', detail: answeredAt.value ?? '' }]
      : []),
    {
      label: 'Prices, retailers, and sale dates',
      state: linksTested.value ? 'done' : running.value ? 'run' : 'wait',
      detail: running.value && !linksTested.value ? `${minutes.value ?? 0} min` : ''
    },
    {
      label: 'Testing product links',
      state: linksTested.value ? 'run' : 'wait',
      detail: linksTested.value ? 'now' : 'next'
    }
  ]
})

const log = computed(() => [...props.draft.events].reverse().slice(0, 8))
</script>

<template>
  <section class="wizard-screen">
    <StepBar :filled="progress.filled" :label="progress.label" />
    <h1 class="wizard-title">{{ heading }}</h1>
    <p class="lead">
      You can close this page. Your phone gets an alert on the app topic when the draft
      {{ researching ? 'is ready to review' : 'needs your answers' }}.
    </p>
    <ul class="work-steps card">
      <li v-for="step in steps" :key="step.label">
        <span class="dot" :class="step.state" aria-hidden="true" />
        <span>{{ step.label }}</span>
        <span class="muted small num">{{ step.detail }}</span>
      </li>
    </ul>
    <ul v-if="log.length" class="work-log" aria-label="What Claude is doing">
      <li v-for="(event, index) in log" :key="`${event.at}-${index}`">
        <time class="num" :datetime="event.at">{{ formatTime(event.at) }}</time>
        <span>{{ event.message }}</span>
      </li>
    </ul>
    <p v-if="draft.claudeGuard" class="banner info">
      This step starts on its own once your Claude usage is back under your reserve.
    </p>
    <p v-else-if="draft.waitingFor" class="banner info">
      Waiting for {{ draft.waitingFor }} to finish. Only one AI job runs at a time.
    </p>
    <p v-else class="banner info">
      Only one AI job runs at a time. A scheduled AI check that falls due now waits for the next
      15-minute tick.
    </p>
    <WizardActions>
      <button class="btn secondary" type="button" :disabled="busy" @click="emit('cancel')">
        Cancel draft
      </button>
    </WizardActions>
  </section>
</template>
