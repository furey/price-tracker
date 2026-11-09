<script setup>
import { computed, onMounted, ref } from 'vue'
import { formatDealMessage } from '../../../../src/decide.js'
import { testDraft } from '../../api.js'
import { formatMoney, formatDateTime } from '../../format.js'

const props = defineProps({
  draft: { type: Object, required: true },
  config: { type: Object, required: true },
  perRunMinutes: { type: Number, required: true }
})

const emit = defineEmits(['updated'])

const directBusy = ref(false)
const directError = ref(null)
const fullError = ref(null)

const direct = computed(() => props.draft.test?.direct ?? null)
const full = computed(() => props.draft.test?.full ?? null)
const hasDirect = computed(() => (props.config.direct ?? []).length > 0)
const fullRunning = computed(() => props.draft.status === 'testing'
  || ['queued', 'running'].includes(full.value?.state))

const directListings = computed(() => (direct.value?.listings ?? [])
  .filter((listing) => typeof listing.price === 'number'))

const qualifyingCount = computed(() => directListings.value
  .filter((listing) => listing.qualifies && listing.inStock).length)

const labelOf = (id) => props.draft.research?.categoryLabels?.[id] ?? id

const example = computed(() => {
  if (full.value?.message) return { message: full.value.message, real: true }
  if (direct.value?.message) return { message: direct.value.message, real: true }
  const category = props.config.categories[0]
  const rule = props.config.rules?.[category.id] ?? {}
  const price = rule.maxPrice ?? 100
  return {
    real: false,
    message: formatDealMessage({
      item: props.config,
      listing: {
        title: labelOf(category.id),
        price: price,
        effectivePrice: price,
        wasPrice: rule.rrp ?? null,
        retailer: props.config.sources.sites[0]?.name ?? 'A retailer',
        verified: true,
        isClearance: false,
        notes: ''
      }
    })
  }
})

const runDirect = async () => {
  if (!hasDirect.value) return
  directBusy.value = true
  directError.value = null
  try {
    const body = await testDraft({ id: props.draft.id, kind: 'direct', config: props.config })
    emit('updated', body.draft)
  } catch (error) {
    directError.value = error.message
  } finally {
    directBusy.value = false
  }
}

const runFull = async () => {
  fullError.value = null
  try {
    emit('updated', await testDraft({ id: props.draft.id, kind: 'full', config: props.config }))
  } catch (error) {
    fullError.value = error.message
  }
}

onMounted(() => {
  if (!direct.value) runDirect()
})
</script>

<template>
  <div class="review-body">
    <div class="row-between">
      <h2 class="section-label">Free check{{ direct ? `, ${formatDateTime(direct.at)}` : '' }}</h2>
      <span v-if="direct" class="pill ok">{{ directListings.length }} listings</span>
    </div>
    <p v-if="!hasDirect" class="muted small">
      This item has no free checks. The full AI test below shows what a check finds.
    </p>
    <p v-else-if="directBusy" class="muted small">Reading the product pages...</p>
    <p v-if="directError" class="banner bad" role="alert">{{ directError }}</p>
    <ul v-if="directListings.length" class="plain-rows card">
      <li v-for="(listing, index) in directListings" :key="`${listing.url}-${index}`">
        <div class="row-text">
          <span>{{ listing.title }} · {{ listing.retailer }}</span>
          <span class="sub">
            {{ listing.inStock ? '' : 'Out of stock. ' }}{{ listing.reasons.join(', ') }}
          </span>
        </div>
        <span class="num" :class="{ good: listing.qualifies && listing.inStock }">
          {{ formatMoney(listing.price) }}
        </span>
      </li>
    </ul>
    <p v-if="direct && hasDirect" class="banner" :class="{ good: qualifyingCount > 0 }">
      {{ qualifyingCount > 0
        ? `${qualifyingCount} listing${qualifyingCount === 1 ? '' : 's'} would alert today.`
        : 'Nothing qualifies today. Prices often sit near RRP before a sale, so this is normal.' }}
    </p>
    <button
      v-if="hasDirect && direct"
      class="btn link start"
      type="button"
      :disabled="directBusy"
      @click="runDirect"
    >
      Check again
    </button>

    <div class="card padded stack">
      <h3>Full AI test</h3>
      <p class="small muted">
        Runs one research check against this draft, about {{ Math.round(perRunMinutes) }} minutes.
        Nothing is saved to history and no alert is sent.
      </p>
      <p v-if="fullRunning" class="banner info">
        Running the full test. You can leave this page; the result stays on the draft.
      </p>
      <template v-else-if="full?.state === 'done'">
        <p class="small">
          Found {{ full.listings.length }} listings, {{ full.eligible }} in stock with a price.
          {{ full.qualified.length
            ? `${full.qualified.length} would alert.`
            : 'None would alert today.' }}
        </p>
        <ul v-if="full.qualified.length" class="plain-rows">
          <li v-for="(entry, index) in full.qualified" :key="index">
            <div class="row-text">
              <span>{{ entry.listing.title }} · {{ entry.listing.retailer }}</span>
              <span class="sub">{{ entry.reasons.join(', ') }}</span>
            </div>
            <span class="num good">{{ formatMoney(entry.listing.effectivePrice) }}</span>
          </li>
        </ul>
      </template>
      <p v-else-if="full?.state === 'failed'" class="banner bad">{{ full.error }}</p>
      <p v-if="fullError" class="banner bad" role="alert">{{ fullError }}</p>
      <button
        class="btn secondary"
        type="button"
        :disabled="fullRunning"
        @click="runFull"
      >
        {{ full?.state === 'done' ? 'Run the full test again' : 'Run full test (1 AI check)' }}
      </button>
    </div>

    <h2 class="section-label">What an alert looks like</h2>
    <div class="notification">
      <p class="notification-app">ntfy · {{ example.real ? 'from the test' : 'example' }}</p>
      <p class="notification-title">{{ example.message.title }}</p>
      <pre>{{ example.message.message }}</pre>
    </div>
  </div>
</template>
