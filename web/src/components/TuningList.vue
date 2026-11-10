<script setup>
import { computed } from 'vue'
import { stampText, tuningEntries } from '../tuningView.js'

const props = defineProps({ item: { type: Object, required: true } })

const emit = defineEmits(['tune'])

const groups = computed(() => {
  const byGroup = new Map()
  tuningEntries(props.item).forEach((entry) => {
    byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry])
  })
  return [...byGroup.entries()]
})

const STATE_TONES = { Weekly: 'info' }

const restore = (entry) => emit('tune', { changes: [entry.restore], reason: entry.restoreLabel })
</script>

<template>
  <div class="tuning-list">
    <p v-if="!groups.length" class="muted small">
      Nothing is muted. Use Not what I want on an alert, the Sources fold, or Mute model on a
      listing to tune this item.
    </p>
    <template v-for="[group, entries] in groups" :key="group">
      <h4 class="group-title">{{ group }}</h4>
      <ul class="rows card">
        <li v-for="entry in entries" :key="entry.key">
          <div class="row-main">
            <span class="name">{{ entry.name }}</span>
            <span class="pill" :class="STATE_TONES[entry.state] ?? 'neutral'">
              {{ entry.state }}
            </span>
          </div>
          <p v-if="entry.detail" class="why muted">{{ entry.detail }}</p>
          <p class="why muted">{{ stampText(entry.entry) }}</p>
          <div class="source-actions">
            <button class="btn secondary small" type="button" @click="restore(entry)">
              {{ entry.state === 'Weekly' ? 'Every run' : 'Restore' }}
            </button>
          </div>
        </li>
      </ul>
    </template>
    <p v-if="groups.length" class="foot muted small">
      Muted prices are still recorded. Turn on Show muted on the chart, retailers, or listings
      to see them greyed.
    </p>
  </div>
</template>

<style scoped>
.group-title {
  margin: var(--space-4) 0 var(--space-2);
  font-size: var(--text-caption);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  text-wrap: balance;
}

.group-title:first-of-type {
  margin-top: 0;
}

.rows {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-4);
}

.rows li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 2px var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-small);
}

.rows li:last-child {
  border-bottom: 0;
}

.row-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
}

.name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.why {
  grid-column: 1;
  margin: 0;
  font-size: var(--text-caption);
  text-wrap: pretty;
  overflow-wrap: anywhere;
}

.source-actions {
  grid-column: 2;
  grid-row: 1 / span 3;
}

.foot {
  margin: var(--space-3) 0 0;
  text-wrap: pretty;
}

.small {
  font-size: var(--text-caption);
}
</style>
