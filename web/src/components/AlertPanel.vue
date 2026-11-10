<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { getAlertDetail } from '../api.js'
import { formatMoney, formatDateTime, sourceLabel } from '../format.js'
import NotWantedSheet from './NotWantedSheet.vue'
import SourceStatus from './SourceStatus.vue'

const props = defineProps({
  alertId: { type: Number, required: true },
  itemId: { type: String, required: true },
  item: { type: Object, default: null }
})

const emit = defineEmits(['open-day', 'tune'])

const asking = ref(false)

const canGiveFeedback = computed(() => alert.value?.kind === 'deal' && Boolean(listing.value)
  && Boolean(props.item))

const reviewFeedback = (request) => {
  asking.value = false
  emit('tune', { ...request, alertId: props.alertId })
}

const detail = ref(null)
const loading = ref(true)
const errorMessage = ref(null)
const showRun = ref(false)
const panel = ref(null)

const listing = computed(() => detail.value?.listing ?? null)
const why = computed(() => detail.value?.why ?? null)
const alert = computed(() => detail.value?.alert ?? null)
const wrongItem = computed(() => alert.value && alert.value.itemId !== props.itemId)

const check = computed(() => detail.value?.check ?? null)

const siteHost = computed(() => {
  try {
    return new URL(listing.value?.url ?? alert.value?.url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
})

const hasWasPrice = computed(() => typeof listing.value?.wasPrice === 'number')

const ruleText = computed(() => {
  if (!why.value) return ''
  const reasons = why.value.reasons.length ? why.value.reasons.join('; ') : 'Rule matched'
  return `${reasons}, version ${why.value.version}`
})

const rankText = computed(() => {
  const rank = why.value?.rank
  return rank ? `Rank ${rank.position} of ${rank.of} qualifying listings in that run` : null
})

const closeHref = computed(() => `#/item/${encodeURIComponent(props.itemId)}`)

const money = (value) => (typeof value === 'number' ? formatMoney(value) : 'Not stated')

const load = async () => {
  loading.value = true
  errorMessage.value = null
  try {
    detail.value = await getAlertDetail(props.alertId)
  } catch (error) {
    errorMessage.value = error.status === 404 ? 'This alert no longer exists.' : error.message
  } finally {
    loading.value = false
    await nextTick()
    panel.value?.scrollIntoView({ block: 'start' })
  }
}

onMounted(load)
</script>

<template>
  <section ref="panel" class="alert-panel card" aria-label="Alert detail">
    <header>
      <h2>Alert</h2>
      <a class="btn secondary small close" :href="closeHref">Close</a>
    </header>
    <p v-if="loading" class="muted">Loading...</p>
    <p v-else-if="errorMessage" class="banner bad" role="alert">{{ errorMessage }}</p>
    <p v-else-if="wrongItem" class="banner bad" role="alert">
      This alert belongs to another item.
    </p>
    <template v-else-if="detail">
      <p class="sent">
        Sent <span class="num">{{ formatDateTime(alert.sentAt) }}</span>
        <span class="pill" :class="alert.delivered ? 'ok' : 'failed'">
          {{ alert.delivered ? 'Delivered' : 'Not delivered' }}
        </span>
        <span v-if="alert.error" class="error-text">{{ alert.error }}</span>
      </p>

      <div v-if="check" class="banner check-banner" role="note">
        <p>
          Sent as a low-priority check, not a deal alert. The listing is on
          <strong>{{ check.host ?? siteHost ?? 'an unknown site' }}</strong>.
          Make sure the shop is genuine before you buy.
        </p>
        <p v-if="check.concerns.length">{{ check.concerns.join('; ') }}</p>
      </div>

      <div v-if="listing" class="columns">
        <div class="block">
          <h3>The listing</h3>
          <p class="headline">
            <span class="num price">
              {{ money(listing.effectivePrice ?? listing.price) }}
            </span>
            <span>at {{ listing.retailer }}</span>
          </p>
          <p class="title">{{ listing.title }}</p>
          <dl>
            <template v-if="siteHost">
              <dt>Site</dt>
              <dd>{{ siteHost }}</dd>
            </template>
            <dt>Price</dt>
            <dd class="num">{{ money(listing.price) }}</dd>
            <template v-if="hasWasPrice">
              <dt>Was</dt>
              <dd class="num">{{ money(listing.wasPrice) }}</dd>
            </template>
            <dt>After promos</dt>
            <dd class="num">{{ money(listing.effectivePrice ?? listing.price) }}</dd>
            <dt>Delivery</dt>
            <dd class="num">
              {{ listing.deliveryCost === 0 ? 'Free' : money(listing.deliveryCost) }}
            </dd>
            <dt>Delivered total</dt>
            <dd class="num">{{ money(listing.deliveredTotal) }}</dd>
            <dt>Verified</dt>
            <dd>{{ listing.verified ? 'Yes, seen on the product page' : 'No' }}</dd>
            <dt>Found by</dt>
            <dd>{{ sourceLabel(listing.source) }}</dd>
            <dt v-if="listing.notes">Notes</dt>
            <dd v-if="listing.notes">{{ listing.notes }}</dd>
          </dl>
          <p v-if="listing.evidence" class="evidence-label">Evidence on the page</p>
          <blockquote v-if="listing.evidence" class="evidence">{{ listing.evidence }}</blockquote>
          <a v-if="listing.url" class="btn secondary link" :href="listing.url" target="_blank"
            rel="noreferrer">{{ check ? `Open ${siteHost ?? 'listing'}` : 'Open listing' }}</a>
        </div>

        <div class="block">
          <h3>Why it alerted</h3>
          <template v-if="why">
            <p class="reason">{{ ruleText }}</p>
            <p v-if="why.categoryDescription" class="muted small">
              Category <code>{{ why.category }}</code>: {{ why.categoryDescription }}
            </p>
            <p v-if="rankText">{{ rankText }}.</p>
            <p v-if="why.dedupe.previous">
              Repeat check passed: the last alert for this retailer and category was
              <span class="num">{{ money(why.dedupe.previous.effectivePrice) }}</span>
              on <span class="num">{{ formatDateTime(why.dedupe.previous.sentAt) }}</span>.
              This price is <span class="num">{{ money(why.dedupe.dropAmount) }}</span> lower
              (minimum drop <span class="num">{{ money(why.dedupe.minDrop) }}</span>).
            </p>
            <p v-else>No earlier alert for this retailer and category, so nothing to compare.</p>
          </template>
          <p v-else class="muted">
            The rules that applied to this alert were not stored for this run.
          </p>
          <div class="button-row">
            <button class="btn secondary" type="button" @click="emit('open-day', detail.day)">
              See every price that day
            </button>
            <button
              v-if="detail.run"
              class="btn secondary"
              type="button"
              :aria-expanded="showRun"
              @click="showRun = !showRun"
            >
              {{ showRun ? 'Hide the run' : 'Open the run' }}
            </button>
            <button
              v-if="canGiveFeedback"
              class="btn secondary"
              type="button"
              @click="asking = true"
            >
              Not what I want
            </button>
          </div>
        </div>
      </div>
      <p v-else class="muted">This alert has no listing attached ({{ alert.kind }}).</p>

      <NotWantedSheet
        v-if="asking"
        :listing="listing"
        :item="item"
        @review="reviewFeedback"
        @cancel="asking = false"
      />

      <div v-if="showRun && detail.run" class="run">
        <h3>
          Run {{ detail.run.id }}, {{ formatDateTime(detail.run.startedAt) }}
          <span class="muted small">
            {{ sourceLabel(detail.run.mode) }}, version {{ detail.run.itemVersion }}
          </span>
        </h3>
        <SourceStatus v-if="detail.run.sources.length" :sources="detail.run.sources" />
        <p v-else class="muted">This run recorded no source statuses.</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.alert-panel {
  margin-top: var(--space-4);
  padding: var(--space-4);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.close {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-caption);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

.small {
  font-size: var(--text-caption);
}

.sent {
  margin-top: var(--space-2);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
}

.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4) var(--space-6);
  margin-top: var(--space-2);
}

.headline {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  margin: 0;
}

.price {
  font-size: var(--text-figure);
  font-weight: 600;
}

.check-banner p {
  margin: 0;
  text-wrap: pretty;
}

.check-banner p + p {
  margin-top: var(--space-1);
}

.title {
  margin: 2px 0 var(--space-2);
  text-wrap: pretty;
}

dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  font-size: var(--text-small);
}

dt {
  color: var(--ink-3);
}

dd {
  margin: 0;
}

.evidence-label {
  margin: var(--space-3) 0 2px;
  color: var(--ink-3);
  font-size: var(--text-caption);
}

.evidence {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--surface-sunk);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
}

.reason {
  margin: 0 0 var(--space-2);
  font-size: var(--text-title);
  font-weight: 600;
  text-wrap: balance;
}

p {
  text-wrap: pretty;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.run {
  margin-top: var(--space-4);
}

.error-text {
  color: var(--bad);
  font-size: var(--text-caption);
}
</style>
