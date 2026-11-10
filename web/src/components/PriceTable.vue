<script setup>
import { formatDayMonth, formatMoney, sourceLabel } from '../format.js'

defineProps({
  rows: { type: Array, default: () => [] }
})

const emit = defineEmits(['open-day'])
</script>

<template>
  <div class="price-table card">
    <table>
      <thead>
        <tr>
          <th scope="col">Category</th>
          <th scope="col">Best now <span class="th-note">(last 7 days)</span></th>
          <th scope="col">Lowest ever</th>
          <th scope="col" class="right">Target</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.category" :class="{ highlighted: row.highlighted }">
          <th scope="row" class="category">{{ row.category }}</th>
          <td data-label="Best now">
            <template v-if="row.bestNow">
              <span class="num price">{{ formatMoney(row.bestNow.price) }}</span>
              <span class="who">{{ row.bestNow.retailer }}</span>
            </template>
            <span v-else class="muted">None seen</span>
          </td>
          <td data-label="Lowest ever">
            <template v-if="row.lowest">
              <span class="num price">{{ formatMoney(row.lowest.effectivePrice) }}</span>
              <span class="who">{{ row.lowest.retailer }}</span>
              <span class="muted when">
                {{ formatDayMonth(row.lowest.day) }}, {{ sourceLabel(row.lowest.source) }}
              </span>
              <button class="link" type="button" @click="emit('open-day', row.lowest.day)">
                See evidence
              </button>
            </template>
            <span v-else class="muted">None yet</span>
          </td>
          <td data-label="Target" class="right">
            <span v-if="row.target !== null" class="num price">{{ formatMoney(row.target) }}</span>
            <span v-else class="muted">None set</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.price-table {
  overflow: hidden;
}

table {
  font-size: var(--text-small);
}

th,
td {
  padding: var(--space-3) var(--space-4);
}

tbody tr:last-child > * {
  border-bottom: 0;
}

.th-note {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.category {
  background: none;
  font-size: var(--text-small);
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink);
}

td > span,
td > button {
  display: block;
}

.price {
  font-weight: 600;
}

.who {
  color: var(--ink-2);
}

.when {
  font-size: var(--text-caption);
}

.right {
  text-align: right;
}

.highlighted {
  background: var(--accent-bg);
}

.link {
  margin-top: var(--space-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent-text);
  font: inherit;
  font-size: var(--text-caption);
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 560px) {
  thead {
    display: none;
  }
  table,
  tbody,
  tr,
  th,
  td {
    display: block;
  }
  tr {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-bottom: 1px solid var(--rule);
  }
  tbody tr:last-child {
    border-bottom: 0;
  }
  th,
  td {
    border-bottom: 0;
  }
  .category {
    grid-column: 1 / -1;
    padding-bottom: 0;
  }
  td[data-label='Target'] {
    grid-column: 1 / -1;
    display: flex;
    gap: var(--space-2);
    padding-top: 0;
    text-align: left;
  }
  td::before {
    content: attr(data-label);
    display: block;
    font-size: var(--text-label);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-3);
  }
  td[data-label='Target']::before {
    display: inline;
  }
}
</style>
