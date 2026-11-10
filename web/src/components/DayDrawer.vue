<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { getObservations } from '../api.js'
import {
  formatFullDay, formatMoney, formatTime, sourceLabel, timeZoneLabel
} from '../format.js'

const props = defineProps({
  itemId: { type: String, required: true },
  itemName: { type: String, default: '' },
  day: { type: String, required: true }
})

const emit = defineEmits(['close'])

const observations = ref([])
const loading = ref(true)
const errorMessage = ref(null)
const closeButton = ref(null)

const sorted = computed(() =>
  [...observations.value].sort((a, b) => rank(a) - rank(b) || price(a) - price(b)
    || a.checkedAt.localeCompare(b.checkedAt))
)

const rank = (row) => (row.category === 'reject' || row.inStock === false ? 1 : 0)

const price = (row) => row.effectivePrice ?? row.price ?? Infinity

const productKind = (row) => {
  if (row.part) return `Accessory (${row.part})`
  if (row.category === 'reject') return 'Rejected'
  return row.category
}

const load = async () => {
  loading.value = true
  errorMessage.value = null
  try {
    const result = await getObservations({ id: props.itemId, day: props.day })
    observations.value = result.observations
  } catch (error) {
    errorMessage.value = error.message
  } finally {
    loading.value = false
  }
}

const onKey = (event) => {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
  closeButton.value?.focus()
})

onUnmounted(() => window.removeEventListener('keydown', onKey))

watch(() => props.day, load)
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <aside class="drawer" role="dialog" aria-modal="true" :aria-label="`Observations for ${day}`">
      <header>
        <div>
          <p class="eyebrow">{{ itemName }}</p>
          <h2>{{ formatFullDay(day) }}</h2>
          <p class="muted count">
            {{ observations.length }}
            {{ observations.length === 1 ? 'observation' : 'observations' }}
            ({{ timeZoneLabel() }})
          </p>
        </div>
        <button ref="closeButton" class="btn secondary small" type="button" aria-label="Close"
          @click="emit('close')">
          Close
        </button>
      </header>

      <p v-if="loading" class="muted">Loading...</p>
      <p v-else-if="errorMessage" class="banner bad" role="alert">{{ errorMessage }}</p>
      <p v-else-if="!observations.length" class="muted">No observations on this day.</p>

      <ul v-else class="list">
        <li v-for="row in sorted" :key="row.id" class="obs" :class="{ dim: rank(row) === 1 }">
          <div class="top">
            <div>
              <p class="retailer">{{ row.retailer }}</p>
              <p v-if="row.title" class="product">{{ row.title }}</p>
              <p class="muted meta">
                {{ productKind(row) }} at {{ formatTime(row.checkedAt) }}
                via {{ sourceLabel(row.source) }}
              </p>
            </div>
            <div class="prices">
              <p class="num effective">{{ formatMoney(row.effectivePrice ?? row.price) }}</p>
              <p class="muted small">after promos</p>
            </div>
          </div>
          <dl class="facts">
            <div v-if="row.price !== null && row.price !== row.effectivePrice">
              <dt>Listed</dt>
              <dd class="num">{{ formatMoney(row.price) }}</dd>
            </div>
            <div v-if="row.deliveryCost !== null">
              <dt>Delivery</dt>
              <dd class="num">{{ row.deliveryCost ? formatMoney(row.deliveryCost) : 'Free' }}</dd>
            </div>
            <div v-if="row.deliveryCost !== null">
              <dt>Delivered total</dt>
              <dd class="num">
                {{ formatMoney((row.effectivePrice ?? row.price) + row.deliveryCost) }}
              </dd>
            </div>
            <div v-if="row.wasPrice">
              <dt>Was</dt>
              <dd class="num">{{ formatMoney(row.wasPrice) }}</dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{{ row.verified ? 'Yes' : 'No' }}</dd>
            </div>
            <div>
              <dt>Qualifies</dt>
              <dd>{{ row.qualifies ? 'Yes' : 'No' }}</dd>
            </div>
          </dl>
          <p v-if="row.notes" class="notes">
            <span class="label">Promo notes</span> {{ row.notes }}
          </p>
          <blockquote v-if="row.evidence" class="evidence">
            <span class="label">Evidence</span>
            {{ row.evidence }}
          </blockquote>
          <p v-if="row.rejectReason" class="notes reject">Rejected: {{ row.rejectReason }}</p>
          <a v-if="row.url" class="open" :href="row.url" target="_blank" rel="noreferrer">
            Open listing
          </a>
        </li>
      </ul>
    </aside>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  justify-content: flex-end;
  background: var(--scrim);
}

.drawer {
  width: min(560px, 100%);
  height: 100%;
  overflow-y: auto;
  padding: var(--space-6) var(--space-5) var(--space-7);
  background: var(--paper);
  border-left: 1px solid var(--rule);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.eyebrow {
  margin: 0;
  font-size: var(--text-caption);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
  text-wrap: balance;
}

h2 {
  margin: 2px 0 2px;
  font-size: var(--text-figure);
  line-height: 1.2;
  text-wrap: balance;
}

.count {
  margin: 0;
  font-size: var(--text-small);
}

.list {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.obs {
  padding: var(--space-4) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

.obs.dim {
  opacity: 0.7;
}

.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

p {
  margin: 0;
}

.retailer {
  font-size: var(--text-title);
  font-weight: 700;
}

.product {
  margin-top: var(--space-1);
  color: var(--ink-2);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.meta,
.small {
  font-size: var(--text-caption);
}

.prices {
  text-align: right;
}

.effective {
  font-size: var(--text-figure);
  font-weight: 600;
  line-height: 1.1;
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-6);
  margin: var(--space-3) 0 0;
}

.facts dt {
  font-size: var(--text-label);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.facts dd {
  margin: 0;
  font-weight: 600;
}

.notes {
  margin-top: var(--space-3);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.reject {
  color: var(--ink-2);
}

.label {
  display: block;
  margin-bottom: 2px;
  font-size: var(--text-label);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.evidence {
  margin: var(--space-3) 0 0;
  padding: var(--space-3) var(--space-3);
  background: var(--surface-sunk);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  font-size: var(--text-small);
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

.open {
  display: inline-block;
  margin-top: var(--space-3);
  font-size: var(--text-small);
  font-weight: 600;
  color: var(--accent-text);
}
</style>
