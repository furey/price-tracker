<script setup>
import { formatMoney, formatDayMonth, formatDayMonthTime, sourceLabel } from '../format.js'

defineProps({
  windows: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] }
})

const emit = defineEmits(['open-day'])

const rangeText = ({ startDay, endDay, live }) => {
  if (live) return `from ${formatDayMonth(startDay)}, still live`
  if (startDay === endDay) return `on ${formatDayMonth(startDay)}`
  return `from ${formatDayMonth(startDay)} to ${formatDayMonth(endDay)}`
}

const alertText = ({ alert }) =>
  alert ? `alert sent ${formatDayMonthTime(alert.sentAt)}` : 'no alert sent'
</script>

<template>
  <ul v-if="windows.length" class="windows">
    <li v-for="window in windows" :key="`${window.retailer}|${window.category}|${window.startDay}`"
      class="card window">
      <div class="head">
        <span class="pill" :class="window.live ? 'ok' : 'neutral'">
          {{ window.live ? 'Live now' : 'Ended' }}
        </span>
        <span class="source muted">{{ sourceLabel(window.best.source) }}</span>
      </div>
      <p class="line">
        <strong>{{ window.retailer }} {{ window.category }}</strong>:
        <span class="num price">{{ formatMoney(window.lowest) }}</span>
        {{ rangeText(window) }}
        <span class="muted">({{ alertText(window) }})</span>
      </p>
      <p class="actions">
        <button class="link" type="button" @click="emit('open-day', window.best.day)">
          See evidence
        </button>
        <a v-if="window.best.url" :href="window.best.url" target="_blank" rel="noreferrer">
          Open listing
        </a>
      </p>
    </li>
  </ul>
  <div v-else class="empty">
    <p>No listing has met the rules yet.</p>
  </div>
</template>

<style scoped>
.windows {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.window {
  padding: var(--space-4) var(--space-4);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.source {
  font-size: var(--text-caption);
}

.line {
  margin: var(--space-2) 0 var(--space-2);
  text-wrap: pretty;
}

.price {
  font-weight: 700;
}

.actions {
  display: flex;
  gap: var(--space-4);
  margin: 0;
  font-size: var(--text-small);
}

.actions a {
  color: var(--accent-text);
  font-weight: 600;
  text-underline-offset: 3px;
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
