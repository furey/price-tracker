<script setup>
import { formatMoney, formatDateTime } from '../format.js'

defineProps({ alerts: { type: Array, default: () => [] } })

const kindLabels = {
  deal: 'Deal', heartbeat: 'Heartbeat', test: 'Test', muted: 'Muted price', check: 'Check this'
}

const hasDetail = (alert) => ['deal', 'muted', 'check'].includes(alert.kind) && alert.itemId

const siteHost = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

const detailLabel = (alert) => (alert.kind === 'check'
  ? 'Why it was held back'
  : 'Why it alerted, and Not what I want')

const detailHref = (alert) => `#/item/${alert.itemId}/alert/${alert.id}`
</script>

<template>
  <ul class="alerts card">
    <li v-for="alert in alerts" :key="alert.id">
      <div class="top">
        <span class="kind">{{ kindLabels[alert.kind] ?? alert.kind }}</span>
        <span class="num when">{{ formatDateTime(alert.sentAt) }}</span>
        <span class="pill" :class="alert.delivered ? 'ok' : 'failed'">
          {{ alert.delivered ? 'Delivered' : 'Not delivered' }}
        </span>
      </div>
      <p class="title">
        <a v-if="hasDetail(alert)" class="quiet-link" :href="detailHref(alert)">
          {{ alert.title }}
        </a>
        <a
          v-else-if="alert.url"
          class="quiet-link"
          :href="alert.url"
          target="_blank"
          rel="noreferrer"
        >
          {{ alert.title }}
        </a>
        <template v-else>{{ alert.title }}</template>
        <span v-if="alert.effectivePrice" class="num">
          {{ formatMoney(alert.effectivePrice) }}
        </span>
        <span v-if="alert.retailer" class="muted">at {{ alert.retailer }}</span>
      </p>
      <p v-if="alert.kind === 'check'" class="check-hint">
        Check this site before you buy: {{ siteHost(alert.url) ?? 'unknown site' }}
      </p>
      <p v-if="hasDetail(alert)" class="actions">
        <a class="quiet-link" :href="detailHref(alert)">
          {{ detailLabel(alert) }}
        </a>
        <a
          v-if="alert.url && alert.kind !== 'check'"
          class="quiet-link"
          :href="alert.url"
          target="_blank"
          rel="noreferrer"
        >
          Open listing
        </a>
      </p>
      <p v-if="alert.error" class="error-text">{{ alert.error }}</p>
    </li>
  </ul>
</template>

<style scoped>
.alerts {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-4);
}

li {
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-small);
}

li:last-child {
  border-bottom: 0;
}

.top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
}

.kind {
  font-weight: 600;
}

.when {
  color: var(--ink-3);
  font-size: var(--text-caption);
}

.title {
  margin-top: var(--space-1);
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-3);
}

.actions {
  margin-top: var(--space-1);
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-4);
  font-size: var(--text-caption);
}

.check-hint {
  margin-top: var(--space-1);
  color: var(--warn);
  font-size: var(--text-caption);
  text-wrap: pretty;
}

.error-text {
  margin-top: var(--space-1);
  color: var(--bad);
  font-size: var(--text-caption);
}
</style>
