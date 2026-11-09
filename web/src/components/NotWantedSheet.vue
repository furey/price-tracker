<script setup>
import { computed, ref, useId } from 'vue'
import {
  isCategoryMuted, partNumberIn, suggestedNotifyBelow
} from '../../../src/tuning.js'
import { currencySymbol, formatMoney } from '../format.js'
import ModalSheet from './ModalSheet.vue'

const props = defineProps({
  listing: { type: Object, required: true },
  item: { type: Object, required: true }
})

const emit = defineEmits(['review', 'cancel'])

const priceId = useId()

const category = computed(() => props.listing.category)
const rule = computed(() => props.item.rules?.[category.value] ?? null)
const alreadyMuted = computed(() => isCategoryMuted({
  item: props.item, category: category.value
}))
const partNumber = computed(() => partNumberIn([
  props.listing.title, props.listing.evidence, props.listing.notes
].join(' ')))

const choice = ref(alreadyMuted.value ? 'not-this-product' : 'not-this-model')
const notify = ref(false)
const notifyBelow = ref(suggestedNotifyBelow(rule.value) ?? '')
const alsoNever = ref(false)

const price = computed(() => props.listing.effectivePrice ?? props.listing.price)

const capText = computed(() => (typeof rule.value?.maxPrice === 'number'
  ? ` (now ${formatMoney(rule.value.maxPrice)})`
  : ''))

const options = computed(() => [
  {
    id: 'not-this-model',
    label: 'Not this model',
    detail: alreadyMuted.value
      ? `${category.value} is already muted.`
      : `Mute ${category.value}. Prices are still recorded; it never alerts.`,
    disabled: alreadyMuted.value
  },
  {
    id: 'not-this-product',
    label: 'Not this exact product',
    detail: `Hide this listing${partNumber.value ? ' and its part number' : ''}. Keep the model.`
  },
  {
    id: 'price-too-high',
    label: 'Price not low enough',
    detail: `Open the alert price for ${category.value}${capText.value}.`
  },
  { id: 'not-now', label: 'Just not now', detail: 'Record the feedback. Change nothing.' }
])

const neverRule = () => ({
  label: clip(props.listing.title || `${props.listing.retailer} listing`, 80),
  match: {
    ...(props.listing.url ? { url: props.listing.url } : {}),
    ...(partNumber.value ? { partNumber: partNumber.value } : {})
  }
})

const notifyValue = () => {
  const value = Number(notifyBelow.value)
  return notify.value && Number.isFinite(value) && value > 0 ? value : null
}

const modelRequest = () => ({
  changes: [
    { kind: 'mute-category', id: category.value, notifyBelow: notifyValue() },
    ...(alsoNever.value && partNumber.value
      ? [{ kind: 'never', rule: { label: `Part ${partNumber.value}`,
        match: { partNumber: partNumber.value } } }]
      : [])
  ],
  reason: 'Not the model I want',
  notes: [`Listings in ${category.value} stay in the price history, greyed when you turn on `
    + 'Show muted.']
})

const REQUESTS = {
  'not-this-model': modelRequest,
  'not-this-product': () => ({
    changes: [{ kind: 'never', rule: neverRule() }],
    reason: 'Not the exact product I want',
    notes: ['The model stays. Only listings that match this URL or part number are hidden.']
  }),
  'price-too-high': () => ({
    changes: [],
    reason: 'Price not low enough',
    after: 'edit-prices'
  }),
  'not-now': () => ({ changes: [], reason: 'Just not now' })
}

const review = () => {
  emit('review', { ...REQUESTS[choice.value](), feedbackReason: choice.value })
}

const select = (option) => {
  if (!option.disabled) choice.value = option.id
}

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)
</script>

<template>
  <ModalSheet title="What is wrong with this alert?" @close="emit('cancel')">
    <p class="lead-line">
      {{ listing.title }}, <span class="num">{{ formatMoney(price) }}</span>
      at {{ listing.retailer }}
    </p>
    <div class="options" role="radiogroup" aria-label="Reason">
      <div v-for="option in options" :key="option.id" class="option">
        <button
          class="choice"
          type="button"
          role="radio"
          :aria-checked="choice === option.id"
          :aria-disabled="option.disabled"
          :disabled="option.disabled"
          @click="select(option)"
        >
          <span class="mark" aria-hidden="true" />
          <span class="choice-label">{{ option.label }}</span>
          <span class="choice-detail">{{ option.detail }}</span>
        </button>
        <div v-if="option.id === 'not-this-model' && choice === option.id" class="extras">
          <label class="check">
            <input v-model="notify" type="checkbox" />
            <span>Tell me if it drops below</span>
          </label>
          <div class="field price-field">
            <label class="visually-hidden" :for="priceId">Price alert in dollars</label>
            <div class="unit-input" :data-unit="currencySymbol()">
              <input
                :id="priceId"
                v-model="notifyBelow"
                class="num"
                type="number"
                min="1"
                step="1"
                inputmode="decimal"
                :disabled="!notify"
              />
            </div>
          </div>
          <label v-if="partNumber" class="check">
            <input v-model="alsoNever" type="checkbox" />
            <span>Also never show part <code>{{ partNumber }}</code>, even if the AI files it
              under another model</span>
          </label>
        </div>
      </div>
    </div>
    <template #actions>
      <button class="btn secondary" type="button" @click="emit('cancel')">Cancel</button>
      <button class="btn" type="button" @click="review">Review change</button>
    </template>
  </ModalSheet>
</template>

<style scoped>
.lead-line {
  margin: 0 0 var(--space-3);
  color: var(--ink-2);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.options {
  display: grid;
  gap: var(--space-2);
}

.choice:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.extras {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-3) var(--space-1) calc(22px + var(--space-6));
}

.price-field {
  max-width: 160px;
  margin-top: calc(var(--space-1) * -1);
}

code {
  font-family: var(--font-code);
  font-size: var(--text-caption);
}
</style>
