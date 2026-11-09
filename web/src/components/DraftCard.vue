<script setup>
import { computed } from 'vue'
import { formatDateTime } from '../format.js'
import { cardState, draftName, shorten } from '../wizard.js'

const props = defineProps({
  draft: { type: Object, required: true },
  busy: { type: Boolean, default: false }
})

const emit = defineEmits(['discard'])

const state = computed(() => cardState(props.draft))

const href = computed(() => {
  const step = props.draft.status === 'review' ? '/models' : ''
  return `#/new/${props.draft.id}${step}`
})

const detail = computed(() => {
  const draft = props.draft
  if (draft.status === 'clarifying') {
    const count = draft.questionCount
    return `${count} quick question${count === 1 ? '' : 's'}, then the research runs on its own.`
  }
  if (draft.claudeGuard && draft.status === 'review') return draft.claudeGuard.message
  if (draft.errorKind === 'limited') {
    return 'Your Claude plan reached its usage limit. Nothing retries on its own.'
  }
  if (draft.status === 'failed') return shorten(draft.error ?? 'The draft stopped.', 160)
  if (draft.status === 'review') return 'Check the models, alert prices, and schedule, then save.'
  if (draft.claudeGuard) return draft.claudeGuard.message
  if (draft.jobState === 'queued') return 'Waiting for another AI job to finish.'
  return draft.lastEvent ? shorten(draft.lastEvent.message, 120) : 'Working on it.'
})
</script>

<template>
  <article class="item-card card draft-card">
    <div class="head">
      <h2>{{ draftName(draft) }}</h2>
      <span class="pill" :class="state.tone">{{ state.pill }}</span>
    </div>
    <p class="small muted draft-detail">{{ detail }}</p>
    <p class="small muted num">Draft started {{ formatDateTime(draft.createdAt) }}</p>
    <div class="button-row">
      <a class="btn small" :href="href">{{ state.action }}</a>
      <button class="btn link" type="button" :disabled="busy" @click="emit('discard', draft)">
        Discard
      </button>
    </div>
  </article>
</template>
