<script setup>
import { computed } from 'vue'
import { formatDayMonth, formatPausedUntil } from '../format.js'

const props = defineProps({
  report: { type: Object, default: null },
  busy: { type: String, default: null }
})

const emit = defineEmits(['accept', 'accept-everywhere', 'dismiss', 'restore'])

const suggestions = computed(() => props.report?.suggestions ?? [])
const waiting = computed(() => props.report?.waiting ?? [])
const held = computed(() => props.report?.held ?? [])
const dismissed = computed(() => props.report?.dismissed ?? [])

const ACTION_LABELS = { 'edit-prices': 'Edit alert prices', 'edit-categories': 'Edit models' }

const acceptLabel = (suggestion) => ACTION_LABELS[suggestion.action] ?? 'Accept'

const everywhereLabel = (suggestion) => (suggestion.change?.kind === 'mute-site'
  ? 'Mute on all items'
  : 'Weekly on all items')

const waitingText = computed(() => waiting.value
  .map(({ subject, needs }) => `${subject.key} (${needs} more)`)
  .join(', '))

const heldSummary = computed(() => {
  const window = props.report?.saleWindow
  if (!window) return ''
  const count = held.value.length
  return `${count} ${count === 1 ? 'suggestion' : 'suggestions'} held until `
    + `${formatDayMonth(window.until)} for ${window.names.join(', ')}`
})

const dismissedText = (dismissal) => [
  `Dismissed by ${dismissal.by}, ${formatPausedUntil(dismissal.at)}`,
  dismissal.permanent ? 'not suggested again' : null
].filter(Boolean).join(', ')
</script>

<template>
  <div class="tuning-suggestions">
    <h4 class="group-title">Suggestions</h4>
    <p v-if="!suggestions.length" class="muted small quiet">
      Nothing to tune right now. Suggestions come from at least 3 checks of a site.
    </p>
    <ul v-else class="cards">
      <li v-for="suggestion in suggestions" :key="suggestion.id" class="card suggestion">
        <p class="title">{{ suggestion.title }}</p>
        <p class="reason">{{ suggestion.reason }}</p>
        <p v-if="suggestion.alsoOn?.length" class="also muted">
          Also suggested on {{ suggestion.alsoOn.map(({ itemName }) => itemName).join(', ') }}.
        </p>
        <div class="actions">
          <button
            class="btn small"
            type="button"
            :disabled="busy !== null"
            @click="emit('accept', suggestion)"
          >
            {{ acceptLabel(suggestion) }}
          </button>
          <button
            v-if="suggestion.alsoOn?.length"
            class="btn secondary small"
            type="button"
            :disabled="busy !== null"
            @click="emit('accept-everywhere', suggestion)"
          >
            {{ everywhereLabel(suggestion) }}
          </button>
          <button
            class="btn secondary small"
            type="button"
            :disabled="busy !== null"
            @click="emit('dismiss', suggestion)"
          >
            {{ busy === suggestion.id ? 'Dismissing...' : 'Dismiss' }}
          </button>
        </div>
      </li>
    </ul>

    <p v-if="waiting.length" class="muted small quiet">
      Waiting for more checks: {{ waitingText }}.
    </p>

    <details v-if="held.length" class="more">
      <summary class="small">{{ heldSummary }}</summary>
      <p class="muted small quiet">
        Sites are not muted or moved to weekly from 14 days before a sale event to 7 days after.
      </p>
      <ul class="rows card">
        <li v-for="suggestion in held" :key="suggestion.id">
          <span class="name">{{ suggestion.title }}</span>
          <span class="why muted">{{ suggestion.reason }}</span>
        </li>
      </ul>
    </details>

    <details v-if="dismissed.length" class="more">
      <summary class="small">
        {{ dismissed.length }} dismissed {{ dismissed.length === 1 ? 'suggestion' : 'suggestions' }}
      </summary>
      <ul class="rows card">
        <li v-for="suggestion in dismissed" :key="suggestion.id" class="with-action">
          <span class="name">{{ suggestion.title }}</span>
          <span class="why muted">{{ dismissedText(suggestion.dismissal) }}</span>
          <button
            class="btn secondary small restore"
            type="button"
            :disabled="busy !== null"
            @click="emit('restore', suggestion)"
          >
            Show again
          </button>
        </li>
      </ul>
    </details>
  </div>
</template>

<style scoped>
.tuning-suggestions {
  margin-bottom: var(--space-4);
}

.group-title {
  margin: 0 0 var(--space-2);
  font-size: var(--text-caption);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  text-wrap: balance;
}

.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.suggestion {
  padding: var(--space-3) var(--space-4);
}

.title {
  margin: 0;
  font-weight: 600;
  font-size: var(--text-small);
  text-wrap: balance;
  overflow-wrap: anywhere;
}

.reason,
.also {
  margin: var(--space-1) 0 0;
  font-size: var(--text-caption);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.quiet {
  margin: var(--space-2) 0 0;
  text-wrap: pretty;
}

.more {
  margin-top: var(--space-3);
}

.more summary {
  cursor: pointer;
  color: var(--ink-2);
  text-wrap: pretty;
}

.more .rows {
  margin-top: var(--space-2);
}

.rows {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-4);
}

.rows li {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-small);
}

.rows li.with-action {
  grid-template-columns: minmax(0, 1fr) auto;
}

.rows li:last-child {
  border-bottom: 0;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.why {
  grid-column: 1;
  font-size: var(--text-caption);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.restore {
  grid-column: 2;
  grid-row: 1 / span 2;
  align-self: center;
}

.small {
  font-size: var(--text-caption);
}
</style>
