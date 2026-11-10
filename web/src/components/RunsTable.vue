<script setup>
import { formatCost, formatDateTime } from '../format.js'
import { timeOf, useSort } from '../useSort.js'
import ScreenshotThumbs from './ScreenshotThumbs.vue'
import SortHeader from './SortHeader.vue'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  runs: { type: Array, default: () => [] },
  itemName: { type: String, default: '' }
})

const shotLabel = (run) => [props.itemName, 'Chrome check', formatDateTime(run.startedAt)]
  .filter(Boolean).join(', ')

const triggerLabels = { tick: 'Scheduled', manual: 'Manual', 'dry-run': 'Test run' }

const sort = useSort({
  rows: () => props.runs,
  columns: {
    started: (run) => timeOf(run.startedAt),
    status: (run) => run.status,
    trigger: (run) => triggerLabels[run.trigger] ?? run.trigger,
    listings: (run) => run.listingCount,
    qualified: (run) => run.qualifiedCount,
    cost: (run) => run.costUsd
  }
})
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <SortHeader :sort="sort" column="started">Started</SortHeader>
          <SortHeader :sort="sort" column="status">Status</SortHeader>
          <SortHeader :sort="sort" column="trigger">Trigger</SortHeader>
          <SortHeader :sort="sort" column="listings" class="right">Listings</SortHeader>
          <SortHeader :sort="sort" column="qualified" class="right">Qualified</SortHeader>
          <SortHeader :sort="sort" column="cost" class="right">Cost</SortHeader>
        </tr>
      </thead>
      <tbody>
        <tr v-for="run in sort.sorted.value" :key="run.id">
          <td class="num nowrap">{{ formatDateTime(run.startedAt) }}</td>
          <td>
            <StatusPill :status="run.status" />
            <small
              v-if="run.error"
              class="error-text"
              :class="{ skipped: run.status === 'skipped' }"
            >
              {{ run.error }}
            </small>
          </td>
          <td>
            {{ triggerLabels[run.trigger] ?? run.trigger }}
            <ScreenshotThumbs
              v-if="run.screenshots?.length"
              :screenshots="run.screenshots"
              :label="shotLabel(run)"
            />
          </td>
          <td class="num right">{{ run.listingCount ?? '-' }}</td>
          <td class="num right">{{ run.qualifiedCount ?? '-' }}</td>
          <td class="num right">{{ formatCost(run.costUsd) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.nowrap {
  white-space: nowrap;
}

.error-text {
  display: block;
  max-width: 340px;
  margin-top: var(--space-1);
  color: var(--bad);
  font-size: var(--text-caption);
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.error-text.skipped {
  color: var(--ink-3);
}
</style>
