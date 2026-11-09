<script setup>
import { computed } from 'vue'
import { formatDayMonthTime } from '../../format.js'
import { draftName } from '../../wizard.js'

const props = defineProps({
  draft: { type: Object, required: true },
  busy: { type: Boolean, default: false }
})

const emit = defineEmits(['retry', 'separate', 'dismiss'])

const kind = computed(() => props.draft.errorKind)

const pill = computed(() => ({
  out_of_scope: { tone: 'failed', text: 'Out of scope' },
  duplicate: { tone: 'neutral', text: 'Already tracking' },
  limited: { tone: 'warn', text: 'Waiting' }
}[kind.value] ?? { tone: 'warn', text: 'Stopped' }))

const retryLabel = computed(() => (props.draft.failedStep === 'research'
  ? 'Retry research'
  : 'Try again'))

const resetText = computed(() => (props.draft.resetsAt
  ? formatDayMonthTime(props.draft.resetsAt)
  : null))

const duplicateHref = computed(() => `#/item/${encodeURIComponent(props.draft.duplicateOf)}`)
</script>

<template>
  <section class="wizard-screen">
    <article class="card padded stack">
      <div class="row-between">
        <h1 class="wizard-title small-title">{{ draftName(draft) }}</h1>
        <span class="pill" :class="pill.tone">{{ pill.text }}</span>
      </div>
      <template v-if="kind === 'out_of_scope'">
        <p class="body-text">{{ draft.error }}</p>
        <button
          class="btn secondary start"
          type="button"
          :disabled="busy"
          @click="emit('dismiss')"
        >
          Dismiss
        </button>
      </template>
      <template v-else-if="kind === 'duplicate'">
        <p class="body-text">{{ draft.error }}</p>
        <div class="button-row">
          <a class="btn" :href="duplicateHref">Open {{ draft.duplicateName ?? 'that' }} item</a>
          <button class="btn secondary" type="button" :disabled="busy" @click="emit('separate')">
            New item anyway
          </button>
        </div>
        <button class="btn link start" type="button" :disabled="busy" @click="emit('dismiss')">
          Discard this draft
        </button>
      </template>
      <template v-else-if="kind === 'limited'">
        <p class="body-text">
          Your Claude plan reached its usage limit<template v-if="resetText">. It resets at
            {{ resetText }}</template>. Nothing retries on its own.
        </p>
        <p class="small muted">{{ draft.error }}</p>
        <div class="button-row">
          <button class="btn secondary" type="button" :disabled="busy" @click="emit('retry')">
            {{ resetText ? `Retry after ${resetText}` : 'Retry' }}
          </button>
          <button class="btn link" type="button" :disabled="busy" @click="emit('dismiss')">
            Discard
          </button>
        </div>
      </template>
      <template v-else>
        <p class="body-text">{{ draft.error }}</p>
        <p v-if="draft.answers.length" class="small muted">The answers you gave are kept.</p>
        <div class="button-row">
          <button class="btn" type="button" :disabled="busy" @click="emit('retry')">
            {{ retryLabel }}
          </button>
          <button class="btn secondary" type="button" :disabled="busy" @click="emit('dismiss')">
            Discard
          </button>
        </div>
      </template>
    </article>
  </section>
</template>
