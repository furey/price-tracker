<script setup>
import { computed } from 'vue'
import { formatDateTime, formatDayMonth, formatMoney } from '../format.js'
import { RECENT_DAYS } from '../../../src/verdict.js'
import StatusPill from './StatusPill.vue'

const props = defineProps({
  verdict: { type: Object, default: null },
  lastRun: { type: Object, default: null },
  runsLoaded: { type: Boolean, default: false },
  checks: { type: Array, default: () => [] },
  schedule: { type: String, default: '' },
  lastAlert: { type: Object, default: null },
  attention: { type: Array, default: null }
})

const isDeal = computed(() => props.verdict?.kind === 'deal')

const headline = computed(() => {
  const kind = props.verdict?.kind
  if (!kind) return 'Loading'
  if (kind === 'deal') return props.verdict.live ? 'Deal now' : 'Under target'
  if (kind === 'none') return 'No recent prices'
  if (kind === 'no-rule') return 'No alert price'
  return 'No deal'
})

const hasOffer = computed(() => ['deal', 'gap', 'no-rule'].includes(props.verdict?.kind))

const emptyText = computed(() => (props.verdict
  ? `No listing seen in the last ${RECENT_DAYS} days.`
  : 'Checking the latest prices.'))

const lead = computed(() => ({ gap: 'Best', 'no-rule': 'Cheapest' })[props.verdict?.kind] ?? '')

const tail = computed(() => {
  const verdict = props.verdict
  if (verdict?.kind === 'deal' && verdict.live) {
    return `, live since ${formatDayMonth(verdict.since)}.`
  }
  if (verdict?.kind === 'deal') return `, under the ${formatMoney(verdict.target)} target.`
  if (verdict?.kind === 'gap') return `, target ${formatMoney(verdict.target)}.`
  return '.'
})

const gapText = computed(() => (props.verdict?.kind === 'gap'
  ? `${formatMoney(props.verdict.gap)} to go`
  : null))

const alertText = (alert) => {
  const price = alert.effectivePrice ? ` ${formatMoney(alert.effectivePrice)}` : ''
  return `${alert.kind}${price}`
}
</script>

<template>
  <section class="summary card" aria-label="Status summary">
    <div class="verdict" :class="{ deal: isDeal }" role="status">
      <span class="label">Is there a deal now?</span>
      <p class="verdict-line">
        <strong class="verdict-head">{{ headline }}</strong>
        <span v-if="hasOffer" class="verdict-detail">
          {{ lead }} <span class="nowrap">{{ verdict.category }}</span> <span
            class="num nowrap">{{ formatMoney(verdict.price) }}</span> at {{ verdict.retailer
          }}{{ tail }} <strong v-if="gapText" class="num nowrap">{{ gapText }}</strong>
        </span>
        <span v-else class="verdict-detail">{{ emptyText }}</span>
      </p>
      <a
        v-if="isDeal && verdict.url"
        class="listing-link"
        :href="verdict.url"
        target="_blank"
        rel="noreferrer"
      >
        Open listing
      </a>
    </div>
    <dl class="health">
      <div class="stat">
        <dt class="label">Last run</dt>
        <dd>
          <template v-if="lastRun">
            <StatusPill :status="lastRun.status" compact />
            <span class="num small">{{ formatDateTime(lastRun.startedAt) }}</span>
          </template>
          <span v-else-if="runsLoaded" class="muted small">Never</span>
          <span v-else class="muted small">Loading</span>
        </dd>
      </div>
      <div class="stat">
        <dt class="label">Next checks</dt>
        <dd>
          <span v-for="check in checks" :key="check.label" class="check-line small">
            <span class="check-kind">{{ check.short }}</span>
            <span :class="{ num: check.time, muted: check.muted }">{{ check.text }}</span>
            <span v-if="check.detail" class="muted">{{ check.detail }}</span>
          </span>
          <span v-if="schedule" class="schedule muted small">{{ schedule }}</span>
        </dd>
      </div>
      <div class="stat">
        <dt class="label">Last alert</dt>
        <dd>
          <template v-if="lastAlert">
            <span class="num small">{{ formatDateTime(lastAlert.sentAt) }}</span>
            <span class="muted small">{{ alertText(lastAlert) }}</span>
          </template>
          <span v-else class="muted small">None</span>
        </dd>
      </div>
      <div class="stat">
        <dt class="label">Needs attention</dt>
        <dd>
          <span v-if="!attention" class="muted small">Loading</span>
          <span v-else-if="!attention.length" class="muted small">Nothing</span>
          <a
            v-for="entry in attention"
            v-else
            :key="entry.key"
            class="attention-link small"
            :href="entry.href"
          >
            {{ entry.text }}
          </a>
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.summary {
  margin-top: var(--space-5);
  overflow: hidden;
}

.verdict {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  padding: var(--space-4);
  border-bottom: 1px solid var(--rule);
}

.verdict.deal {
  background: var(--ok-bg);
}

.verdict.deal .verdict-head,
.verdict.deal .label {
  color: var(--ok);
}

.verdict-line {
  margin: 0;
  font-size: var(--text-title);
  text-wrap: pretty;
}

.verdict-head {
  margin-right: var(--space-2);
  font-size: var(--text-heading);
}

.nowrap {
  white-space: nowrap;
}

.listing-link {
  color: var(--accent-text);
  font-size: var(--text-small);
  font-weight: 600;
  text-underline-offset: 3px;
}

.verdict.deal .listing-link {
  color: var(--ok);
}

.health {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  border-left: 1px solid var(--rule);
}

.stat:first-child {
  border-left: 0;
}

.stat dd {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
  margin: 0;
}

.label {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

.small {
  font-size: var(--text-caption);
}

.check-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-2);
}

.schedule {
  margin-top: var(--space-1);
  text-wrap: pretty;
}

.check-kind {
  color: var(--ink-2);
  font-weight: 600;
}

.attention-link {
  color: var(--warn);
  font-weight: 600;
  text-underline-offset: 3px;
}

@media (max-width: 720px) {
  .health {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .stat:nth-child(3) {
    border-left: 0;
  }
  .stat:nth-child(n + 3) {
    border-top: 1px solid var(--rule);
  }
}
</style>
