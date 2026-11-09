<script setup>
import { formatMoney, formatDayMonth, sourceLabel } from '../format.js'

defineProps({ changes: { type: Array, default: () => [] } })

const emit = defineEmits(['open-day'])
</script>

<template>
  <ol v-if="changes.length" class="timeline">
    <li v-for="change in changes" :key="`${change.retailer}|${change.category}|${change.day}`">
      <span class="when num">{{ formatDayMonth(change.day) }}</span>
      <span class="arrow" :class="change.direction">
        {{ change.direction === 'drop' ? 'Down' : 'Up' }}
        {{ formatMoney(Math.abs(change.delta)) }}
      </span>
      <span class="what">
        <strong>{{ change.retailer }} {{ change.category }}</strong>
        <span class="num">{{ formatMoney(change.from) }} to {{ formatMoney(change.to) }}</span>
        <span class="muted">via {{ sourceLabel(change.source) }}</span>
      </span>
      <button class="link" type="button" @click="emit('open-day', change.day)">Evidence</button>
    </li>
  </ol>
  <div v-else class="empty">
    <p>No price changes recorded in this range.</p>
  </div>
</template>

<style scoped>
.timeline {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--surface);
}

li {
  display: grid;
  grid-template-columns: 56px 100px 1fr auto;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--rule);
}

li:first-child {
  border-top: 0;
}

.when {
  color: var(--ink-3);
}

.arrow {
  font-weight: 700;
}

.arrow.drop {
  color: var(--ok);
}

.arrow.rise {
  color: var(--bad);
}

.what {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-3);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-size: var(--text-small);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 560px) {
  li {
    grid-template-columns: 52px 1fr auto;
  }
  .what {
    grid-column: 1 / -1;
    order: 4;
  }
}
</style>
