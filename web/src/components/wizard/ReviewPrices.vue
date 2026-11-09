<script setup>
import { currencySymbol, formatMoney } from '../../format.js'
import { setNumber } from '../../itemForm.js'
import { edgeOf, hostOf, scaleMarks } from '../../wizard.js'
import FieldError from '../edit/FieldError.vue'

const props = defineProps({
  config: { type: Object, required: true },
  research: { type: Object, required: true },
  input: { type: Object, required: true }
})

const labelOf = (category) => props.research.categoryLabels?.[category.id] ?? category.id

const reasonOf = (category) => props.research.reasoning?.[category.id] ?? {}

const ruleOf = (category) => props.config.rules?.[category.id] ?? {}

const rrpOf = (category) => ruleOf(category).rrp ?? reasonOf(category).rrp ?? null

const scale = (category) => scaleMarks({
  rrp: rrpOf(category),
  lowestNow: reasonOf(category).lowestNow,
  lowest12Months: reasonOf(category).lowest12Months,
  cap: ruleOf(category).maxPrice
})

const aboveBudget = (category) => Boolean(props.input.budget)
  && (ruleOf(category).maxPrice ?? 0) > props.input.budget

const setRule = ({ category, key, value }) => {
  props.config.rules ??= {}
  props.config.rules[category.id] ??= {}
  setNumber({ target: props.config.rules[category.id], key, value })
}

const setDrop = (value) => {
  props.config.dedupe ??= {}
  setNumber({ target: props.config.dedupe, key: 'minDrop', value })
}

const fieldId = ({ category, key }) => `price-${category.id}-${key}`
</script>

<template>
  <div class="review-body">
    <p class="muted small">
      An alert fires when a price is at or below the alert price, or far enough below RRP.
    </p>
    <article
      v-for="(category, index) in config.categories"
      :key="category.id"
      class="card padded price-card"
    >
      <div class="row-between">
        <h3>{{ index + 1 }}. {{ labelOf(category) }}</h3>
        <span v-if="aboveBudget(category)" class="pill warn">Above budget</span>
      </div>
      <dl class="price-facts">
        <div><dt>RRP</dt><dd class="num">{{ formatMoney(rrpOf(category)) }}</dd></div>
        <div><dt>Now</dt><dd class="num">{{ formatMoney(reasonOf(category).lowestNow) }}</dd></div>
        <div>
          <dt>Year low</dt>
          <dd class="num">{{ formatMoney(reasonOf(category).lowest12Months) }}</dd>
        </div>
        <div>
          <dt>Alert at</dt>
          <dd class="num cap">{{ formatMoney(ruleOf(category).maxPrice) }}</dd>
        </div>
      </dl>
      <div v-if="scale(category)" class="price-scale" aria-hidden="true">
        <div class="track" />
        <div
          v-if="scale(category).cap !== null"
          class="fill"
          :style="{ width: `${scale(category).cap}%` }"
        />
        <template v-for="mark in scale(category).marks" :key="mark.key">
          <span class="tick" :style="{ left: `${mark.at}%` }" />
          <span
            v-if="mark.showLabel"
            class="tick-label down num"
            :class="mark.edge"
            :style="{ left: `${mark.at}%` }"
          >
            {{ formatMoney(mark.value) }}{{ mark.key === 'rrp' ? ' RRP' : '' }}
          </span>
        </template>
        <template v-if="scale(category).cap !== null">
          <span class="tick cap" :style="{ left: `${scale(category).cap}%` }" />
          <span
            class="tick-label up cap num"
            :class="edgeOf(scale(category).cap)"
            :style="{ left: `${scale(category).cap}%` }"
          >
            {{ formatMoney(ruleOf(category).maxPrice) }}
          </span>
        </template>
      </div>
      <p v-if="reasonOf(category).why" class="reason">
        {{ reasonOf(category).why }}
        <template v-for="(url, at) in reasonOf(category).evidence ?? []" :key="url">
          <a :href="url" target="_blank" rel="noreferrer">{{ hostOf(url) }}</a><template
            v-if="at < reasonOf(category).evidence.length - 1">, </template>
        </template>
      </p>
      <p v-else class="reason muted">No price history found. Check the alert price.</p>
      <div class="grid-two">
        <div class="field">
          <label :for="fieldId({ category, key: 'maxPrice' })">Alert at or below</label>
          <div class="unit-input" :data-unit="currencySymbol()">
            <input
              :id="fieldId({ category, key: 'maxPrice' })"
              class="num"
              type="number"
              inputmode="decimal"
              min="0"
              step="10"
              :value="ruleOf(category).maxPrice ?? ''"
              @input="setRule({ category, key: 'maxPrice', value: $event.target.value })"
            />
          </div>
        </div>
        <div class="field">
          <label :for="fieldId({ category, key: 'minPctBelowRrp' })">Or % below RRP</label>
          <div class="unit-input" data-unit="%">
            <input
              :id="fieldId({ category, key: 'minPctBelowRrp' })"
              class="num"
              type="number"
              inputmode="numeric"
              min="1"
              max="90"
              :value="ruleOf(category).minPctBelowRrp ?? ''"
              @input="setRule({ category, key: 'minPctBelowRrp', value: $event.target.value })"
            />
          </div>
        </div>
      </div>
      <FieldError :path="`rules.${category.id}.maxPrice`" />
      <FieldError :path="`rules.${category.id}.minPctBelowRrp`" />
    </article>
    <div class="field">
      <label for="price-drop">Repeat alert only if the price drops a further</label>
      <div class="unit-input" :data-unit="currencySymbol()">
        <input
          id="price-drop"
          class="num"
          type="number"
          inputmode="decimal"
          min="0"
          step="5"
          :value="config.dedupe?.minDrop ?? ''"
          @input="setDrop($event.target.value)"
        />
      </div>
      <FieldError path="dedupe.minDrop" />
    </div>
  </div>
</template>
