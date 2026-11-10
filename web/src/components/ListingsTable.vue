<script setup>
import { computed } from 'vue'
import { isCategoryMuted, mutedReason, neverRuleFor } from '../../../src/tuning.js'
import { pricePerUnit } from '../../../src/unit-price.js'
import { formatMoney } from '../format.js'
import { useSort } from '../useSort.js'
import SortHeader from './SortHeader.vue'

const props = defineProps({
  listings: { type: Array, default: () => [] },
  decision: { type: Object, default: null },
  item: { type: Object, default: null }
})

const emit = defineEmits(['tune'])

const showMuted = defineModel('showMuted', { type: Boolean, default: false })

const unitName = computed(() => props.item?.unit?.name ?? null)

const MUTED_LABELS = { category: 'Muted model', never: 'Hidden product' }

const reasonOf = (listing) => (props.item ? mutedReason({ item: props.item, listing }) : null)

const mutedCount = computed(() => props.listings.filter(reasonOf).length)

const itemCategory = (listing) => (props.item?.categories ?? [])
  .some(({ id }) => id === listing.category)

const modelAction = (listing) => {
  if (!props.item || !itemCategory(listing)) return null
  const rule = neverRuleFor({ item: props.item, listing })
  if (rule) {
    return { label: 'Show again', change: { kind: 'restore-never', id: rule.id },
      reason: `Show ${rule.label} again` }
  }
  return isCategoryMuted({ item: props.item, category: listing.category })
    ? { label: 'Unmute model', change: { kind: 'unmute-category', id: listing.category },
      reason: `Unmute ${listing.category}` }
    : { label: 'Mute model', change: { kind: 'mute-category', id: listing.category },
      reason: 'Not the model I want' }
}

const act = (listing) => {
  const action = modelAction(listing)
  if (action) emit('tune', { changes: [action.change], reason: action.reason })
}

const keyOf = (listing) => [
  listing.retailer, listing.url, listing.title, listing.category,
  listing.effectivePrice ?? listing.price
].join('|')

const verdicts = computed(() => {
  const map = new Map()
  const { suppressed = [], qualified = [], best = null } = props.decision ?? {}
  suppressed.forEach(({ listing, reason }) =>
    map.set(keyOf(listing), { qualifies: true, note: `suppressed: ${reason}` })
  )
  qualified.forEach(({ listing, reasons }) => {
    if (map.has(keyOf(listing))) return
    map.set(keyOf(listing), { qualifies: true, note: reasons.join('; ') })
  })
  if (best?.listing) {
    const key = keyOf(best.listing)
    map.set(key, { ...map.get(key), best: true, qualifies: true })
  }
  return map
})

const rows = computed(() =>
  [...props.listings]
    .map(rowOf)
    .filter(({ muted }) => showMuted.value || !muted)
    .sort((a, b) => rank(a) - rank(b) || price(a) - price(b))
)

const rowOf = (listing) => {
  const muted = reasonOf(listing)
  const verdict = muted ? null : verdicts.value.get(keyOf(listing)) ?? null
  return { listing, verdict, muted }
}

const rank = ({ listing, verdict }) => {
  if (verdict?.best) return 0
  if (verdict?.qualifies) return 1
  return listing.category === 'reject' ? 3 : 2
}

const price = ({ listing }) => listing.effectivePrice ?? listing.price ?? Infinity

const qualifyRank = ({ verdict }) => {
  if (verdict?.best) return 2
  return verdict?.qualifies ? 1 : 0
}

const sort = useSort({
  rows,
  columns: {
    retailer: ({ listing }) => listing.retailer,
    category: ({ listing }) => listing.category,
    price: ({ listing }) => listing.price,
    effective: ({ listing }) => listing.effectivePrice ?? listing.price,
    verified: ({ listing }) => Boolean(listing.verified),
    qualifies: qualifyRank
  }
})

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
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
          <SortHeader :sort="sort" column="category">Category</SortHeader>
          <SortHeader :sort="sort" column="price" class="right">Price</SortHeader>
          <SortHeader :sort="sort" column="effective" class="right">After promos</SortHeader>
          <SortHeader :sort="sort" column="verified">Verified</SortHeader>
          <SortHeader :sort="sort" column="qualifies">Qualifies</SortHeader>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="({ listing, verdict, muted }, index) in sort.sorted.value"
          :key="`${index}|${keyOf(listing)}`"
          :class="{ 'is-muted': muted }"
        >
          <td class="retailer">
            <a v-if="listing.url" class="quiet-link" :href="listing.url" target="_blank"
              rel="noreferrer">
              {{ listing.retailer }}
            </a>
            <span v-else>{{ listing.retailer }}</span>
            <small class="muted title">{{ listing.title }}</small>
            <small v-if="listing.notes" class="muted">{{ listing.notes }}</small>
            <small v-if="listing.rejectReason" class="reject">
              Rejected: {{ listing.rejectReason }}
            </small>
          </td>
          <td>
            <span class="cat" :class="{ rejected: listing.category === 'reject' }">
              {{ listing.category }}
            </span>
            <small v-if="listing.isClearance" class="muted">clearance</small>
            <small v-if="listing.inStock === false" class="muted">out of stock</small>
            <small v-if="muted" class="muted-label">{{ MUTED_LABELS[muted] }}</small>
            <button
              v-if="modelAction(listing)"
              class="btn link row-action"
              type="button"
              @click="act(listing)"
            >
              {{ modelAction(listing).label }}
            </button>
          </td>
          <td class="num right">
            {{ formatMoney(listing.price) }}
            <small v-if="listing.wasPrice" class="muted was">
              was {{ formatMoney(listing.wasPrice) }}
            </small>
          </td>
          <td class="num right">
            {{ formatMoney(listing.effectivePrice ?? listing.price) }}
            <small v-if="listing.deliveryCost" class="muted was">
              +{{ formatMoney(listing.deliveryCost) }} delivery
            </small>
            <small v-if="unitName && pricePerUnit(listing) !== null" class="muted was">
              {{ formatMoney(pricePerUnit(listing)) }} per {{ unitName }}
            </small>
          </td>
          <td>
            <span class="pill" :class="listing.verified ? 'ok' : 'neutral'">
              {{ listing.verified ? 'Verified' : 'Unverified' }}
            </span>
          </td>
          <td>
            <span v-if="verdict?.best" class="pill ok">Best deal</span>
            <span v-else-if="verdict?.qualifies" class="pill ok">Qualifies</span>
            <span v-else class="pill neutral">No</span>
            <small v-if="verdict?.note" class="muted">{{ verdict.note }}</small>
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

tr.is-muted td :deep(.pill),
tr.is-muted .quiet-link {
  opacity: 0.7;
}

.muted-label {
  font-weight: 600;
}

.row-action {
  display: block;
  margin-top: 2px;
  font-size: var(--text-caption);
  white-space: nowrap;
}

td small {
  display: block;
  font-size: var(--text-caption);
  line-height: 1.35;
}

.retailer {
  min-width: 180px;
}

.retailer .quiet-link {
  white-space: nowrap;
}

.title {
  margin-top: 1px;
}

.reject {
  color: var(--ink-2);
}

.cat {
  font-family: var(--font-mono);
  font-feature-settings: 'cv01' 1, 'tnum' 1;
  font-size: var(--text-caption);
}

.cat.rejected {
  color: var(--ink-3);
}

.was {
  white-space: nowrap;
}
</style>
