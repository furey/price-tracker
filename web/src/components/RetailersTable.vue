<script setup>
import { computed } from 'vue'
import { formatMoney, formatDateTime, sourceLabel } from '../format.js'
import { timeOf, useSort } from '../useSort.js'
import SortHeader from './SortHeader.vue'

const props = defineProps({ retailers: { type: Array, default: () => [] } })

const showMuted = defineModel('showMuted', { type: Boolean, default: false })

const mutedCount = computed(() => props.retailers.filter(({ muted }) => muted).length)

const visible = computed(() => props.retailers.filter(({ muted }) => showMuted.value || !muted))

const sort = useSort({
  rows: () => visible.value,
  columns: {
    retailer: (entry) => entry.retailer,
    latest: (entry) => entry.latest,
    delivered: (entry) => entry.latestDelivered,
    lowest: (entry) => entry.lowest,
    highest: (entry) => entry.highest,
    lastSeen: (entry) => timeOf(entry.lastSeen)
  }
})

const SPARK_WIDTH = 90
const SPARK_HEIGHT = 24

const sparkPath = (points) => {
  if (points.length < 2) return null
  const values = points.map(({ value }) => value)
  const low = Math.min(...values)
  const span = Math.max(...values) - low || 1
  return points
    .map(({ value }, index) => {
      const x = (index / (points.length - 1)) * (SPARK_WIDTH - 4) + 2
      const y = SPARK_HEIGHT - 3 - ((value - low) / span) * (SPARK_HEIGHT - 6)
      return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const lastDot = (points) => {
  const values = points.map(({ value }) => value)
  const low = Math.min(...values)
  const span = Math.max(...values) - low || 1
  const y = SPARK_HEIGHT - 3 - ((values.at(-1) - low) / span) * (SPARK_HEIGHT - 6)
  return { x: SPARK_WIDTH - 2, y }
}
</script>

<template>
  <div v-if="mutedCount" class="muted-toggle">
    <label class="check">
      <input v-model="showMuted" type="checkbox" />
      <span>Show muted ({{ mutedCount }})</span>
    </label>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <SortHeader :sort="sort" column="retailer">Retailer</SortHeader>
          <SortHeader :sort="sort" column="latest" class="right">Latest</SortHeader>
          <SortHeader :sort="sort" column="delivered" class="right">Delivered</SortHeader>
          <SortHeader :sort="sort" column="lowest" class="right">Lowest</SortHeader>
          <SortHeader :sort="sort" column="highest" class="right">Highest</SortHeader>
          <SortHeader :sort="sort" column="lastSeen">Last seen</SortHeader>
          <th>Trend</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in sort.sorted.value"
          :key="`${entry.retailer}|${entry.category}|${entry.muted ? 'muted' : ''}`"
          :class="{ 'is-muted': entry.muted }"
        >
          <td class="name">
            <a v-if="entry.url" class="quiet-link" :href="entry.url" target="_blank"
              rel="noreferrer">
              {{ entry.retailer }}
            </a>
            <span v-else class="strong">{{ entry.retailer }}</span>
            <small class="muted">
              {{ entry.category }}, {{ entry.sources.map(sourceLabel).join(', ') }}
            </small>
            <small v-if="entry.muted" class="muted-label">Muted</small>
          </td>
          <td class="num right">{{ formatMoney(entry.latest) }}</td>
          <td class="num right">
            <template v-if="entry.latestDelivered !== null">
              {{ formatMoney(entry.latestDelivered) }}
              <small class="muted">
                {{
                  entry.latestDeliveryCost ? `+${formatMoney(entry.latestDeliveryCost)}` : 'free'
                }}
              </small>
            </template>
            <span v-else class="muted">-</span>
          </td>
          <td class="num right">{{ formatMoney(entry.lowest) }}</td>
          <td class="num right">{{ formatMoney(entry.highest) }}</td>
          <td class="num">{{ formatDateTime(entry.lastSeen) }}</td>
          <td>
            <svg
              v-if="sparkPath(entry.sparkline)"
              :width="SPARK_WIDTH"
              :height="SPARK_HEIGHT"
              role="img"
              :aria-label="`${entry.retailer} daily lowest price trend`"
            >
              <path :d="sparkPath(entry.sparkline)" fill="none" stroke="var(--ink-3)"
                stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
              <circle :cx="lastDot(entry.sparkline).x" :cy="lastDot(entry.sparkline).y" r="2.5"
                fill="var(--ink)" />
            </svg>
            <span v-else class="muted small">one day</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.muted-toggle {
  margin-bottom: var(--space-2);
}

tr.is-muted td {
  color: var(--ink-3);
}

.muted-label {
  font-weight: 600;
}

td small {
  display: block;
  font-size: var(--text-caption);
}

.name {
  min-width: 170px;
}

svg {
  display: block;
}

.name .quiet-link,
.strong {
  white-space: nowrap;
}

.strong {
  font-weight: 600;
}

.small {
  font-size: var(--text-caption);
}
</style>
