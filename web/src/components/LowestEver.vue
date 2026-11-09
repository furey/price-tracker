<script setup>
import { computed } from 'vue'
import { formatMoney, formatDayMonth, sourceLabel } from '../format.js'

const props = defineProps({
  bestDays: { type: Array, default: () => [] },
  categories: { type: Array, default: () => [] }
})

const emit = defineEmits(['open-day'])

const cards = computed(() => {
  const order = props.categories.map(({ id }) => id)
  const rank = (category) => (order.includes(category) ? order.indexOf(category) : order.length)
  return [...props.bestDays].sort((a, b) => rank(a.category) - rank(b.category))
})
</script>

<template>
  <div class="cards">
    <article v-for="best in cards" :key="best.category" class="card best">
      <span class="label">{{ best.category }}</span>
      <span class="num big">{{ formatMoney(best.effectivePrice) }}</span>
      <span class="who">{{ best.retailer }}</span>
      <span class="muted small">
        {{ formatDayMonth(best.day) }}, {{ sourceLabel(best.source) }}
      </span>
      <button class="link" type="button" @click="emit('open-day', best.day)">See evidence</button>
    </article>
  </div>
</template>

<style scoped>
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: var(--space-3);
}

.best {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
}

.label {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  text-wrap: balance;
}

.big {
  font-size: var(--text-figure);
  line-height: 1.1;
  font-weight: 600;
}

.who {
  font-size: var(--text-small);
  color: var(--ink-2);
}

.small {
  font-size: var(--text-caption);
  text-wrap: pretty;
}

.link {
  margin-top: var(--space-1);
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
</style>
