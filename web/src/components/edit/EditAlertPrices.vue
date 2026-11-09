<script setup>
import { currencySymbol, formatDateTime, formatMoney } from '../../format.js'
import { useInvalid } from '../../formContext.js'
import { moveItem, setNumber } from '../../itemForm.js'
import FieldError from './FieldError.vue'

const props = defineProps({
  config: { type: Object, required: true },
  lowest: { type: Object, default: () => ({}) }
})

const invalid = useInvalid()

const RULE_FIELDS = [
  { key: 'maxPrice', label: 'Alert at or below', unit: '$' },
  { key: 'maxPriceIfClearance', label: 'Clearance alert at or below', unit: '$' },
  { key: 'rrp', label: 'RRP', unit: '$' },
  { key: 'minPctBelowRrp', label: 'Or this % below RRP', unit: '%' }
]

const ruleValue = ({ id, key }) => props.config.rules?.[id]?.[key] ?? ''

const setRule = ({ id, key, value }) => {
  props.config.rules ??= {}
  props.config.rules[id] ??= {}
  setNumber({ target: props.config.rules[id], key, value })
}

const move = (index, offset) => moveItem({ list: props.config.categories, index, offset })

const setDrop = (value) => {
  props.config.dedupe ??= {}
  setNumber({ target: props.config.dedupe, key: 'minDrop', value })
}

const setHeartbeat = (value) => {
  props.config.heartbeat = { ...props.config.heartbeat, monthly: value }
}

const fieldId = ({ id, key }) => `rule-${id}-${key}`
</script>

<template>
  <div class="edit-fields">
    <p class="muted small">
      Categories are in preference order. When two deals qualify, the alert names the one higher
      up. An alert fires when a price is at or below the alert price, or far enough below RRP.
    </p>
    <ol class="row-list">
      <li v-for="(category, index) in config.categories" :key="category.id" class="row-item">
        <div class="row-head">
          <div>
            <h3 class="num">{{ index + 1 }}. {{ category.id }}</h3>
            <p class="muted small">{{ category.description }}</p>
          </div>
          <div class="order-buttons">
            <button
              class="btn secondary small"
              type="button"
              :disabled="index === 0"
              :aria-label="`Move ${category.id} up`"
              @click="move(index, -1)"
            >
              Up
            </button>
            <button
              class="btn secondary small"
              type="button"
              :disabled="index === config.categories.length - 1"
              :aria-label="`Move ${category.id} down`"
              @click="move(index, 1)"
            >
              Down
            </button>
          </div>
        </div>
        <p class="lowest small">
          <template v-if="lowest[category.id]">
            Lowest seen in {{ lowest[category.id].days }} days:
            <strong class="num">{{ formatMoney(lowest[category.id].effectivePrice) }}</strong>
            at {{ lowest[category.id].retailer }},
            <span class="num">{{ formatDateTime(lowest[category.id].checkedAt) }}</span>
          </template>
          <span v-else class="muted">No in-stock price seen in the last 90 days.</span>
        </p>
        <div class="rule-grid">
          <div v-for="field in RULE_FIELDS" :key="field.key" class="field">
            <label :for="fieldId({ id: category.id, key: field.key })">{{ field.label }}</label>
            <div class="unit-input" :data-unit="field.unit">
              <input
                :id="fieldId({ id: category.id, key: field.key })"
                class="num"
                type="number"
                inputmode="decimal"
                min="0"
                :step="field.unit === '%' ? 1 : 10"
                :value="ruleValue({ id: category.id, key: field.key })"
                :aria-invalid="invalid(`rules.${category.id}.${field.key}`)"
                @input="setRule({ id: category.id, key: field.key, value: $event.target.value })"
              />
            </div>
            <FieldError :path="`rules.${category.id}.${field.key}`" />
          </div>
        </div>
        <FieldError :path="`rules.${category.id}`" />
      </li>
    </ol>
    <div class="edit-grid">
      <div class="field">
        <label for="edit-min-drop">Repeat alert needs a drop of</label>
        <div class="unit-input" :data-unit="currencySymbol()">
          <input
            id="edit-min-drop"
            class="num"
            type="number"
            inputmode="decimal"
            min="0"
            step="5"
            :value="config.dedupe?.minDrop ?? ''"
            :aria-invalid="invalid('dedupe.minDrop')"
            @input="setDrop($event.target.value)"
          />
        </div>
        <p class="hint">A second alert for the same retailer and category needs at least this
          much off the last alerted price.</p>
        <FieldError path="dedupe.minDrop" />
      </div>
      <div class="field">
        <span class="field-label">Monthly heartbeat</span>
        <label class="check">
          <input
            type="checkbox"
            :checked="config.heartbeat?.monthly === true"
            @change="setHeartbeat($event.target.checked)"
          />
          Send a "still tracking" message once a month with the lowest price
        </label>
        <FieldError path="heartbeat.monthly" />
      </div>
    </div>
  </div>
</template>
