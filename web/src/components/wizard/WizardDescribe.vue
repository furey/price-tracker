<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { createDraft, getSettings } from '../../api.js'
import { currencySymbol, formatMoney } from '../../format.js'
import { todayInRegion } from '../../wizard.js'
import StepBar from './StepBar.vue'
import WizardActions from './WizardActions.vue'

const emit = defineEmits(['created'])

const MAX_LINKS = 5
const EXAMPLE = "Bike for Sam for Christmas. They're turning 7 and about 122 cm. "
  + `He wants gears and a kickstand. Around ${formatMoney(500)}.`
const MAX_MUST_HAVES = 8

const form = reactive({
  request: '',
  budget: '',
  budgetMode: 'around',
  needBy: '',
  quantity: 1,
  mustHaves: [],
  refurbished: false,
  unit: '',
  links: ['']
})
const newMustHave = ref('')
const postcode = ref(null)
const postcodeNoun = ref('postcode')
const busy = ref(false)
const errors = ref([])

const minDate = computed(() => {
  const date = new Date(`${todayInRegion()}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
})

const canStart = computed(() => form.request.trim().length >= 3 && !busy.value)

const addMustHave = () => {
  const value = newMustHave.value.trim()
  if (!value || form.mustHaves.includes(value) || form.mustHaves.length >= MAX_MUST_HAVES) return
  form.mustHaves.push(value)
  newMustHave.value = ''
}

const removeMustHave = (index) => form.mustHaves.splice(index, 1)

const addLink = () => {
  if (form.links.length < MAX_LINKS) form.links.push('')
}

const removeLink = (index) => {
  form.links.splice(index, 1)
  if (form.links.length === 0) form.links.push('')
}

const start = async () => {
  busy.value = true
  errors.value = []
  try {
    const draft = await createDraft({
      request: form.request,
      budget: form.budget === '' ? null : Number(form.budget),
      budgetMode: form.budgetMode,
      needBy: form.needBy || null,
      quantity: Number(form.quantity) || 1,
      mustHaves: form.mustHaves,
      links: form.links.map((link) => link.trim()).filter(Boolean),
      refurbished: form.refurbished,
      unit: form.unit.trim() || null
    })
    emit('created', draft)
  } catch (error) {
    errors.value = error.errors?.length ? error.errors : [error.message]
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try {
    const settings = await getSettings()
    const setting = settings.find(({ key }) => key === 'deliveryPostcode')
    postcode.value = setting?.value ?? null
    postcodeNoun.value = setting?.label?.replace(/^Delivery /, '') ?? 'postcode'
  } catch {
    postcode.value = null
  }
})
</script>

<template>
  <section class="wizard-screen">
    <StepBar :filled="1" label="Step 1 of 5 · Describe" />
    <h1 class="wizard-title">What do you want to track?</h1>
    <div class="field">
      <label class="visually-hidden" for="draft-request">What do you want to track?</label>
      <textarea
        id="draft-request"
        v-model="form.request"
        rows="6"
        maxlength="4000"
        :placeholder="EXAMPLE"
      />
      <p class="hint">Tap the mic on your keyboard to talk instead of typing.</p>
    </div>
    <div class="grid-two">
      <div class="field">
        <label for="draft-budget">Budget</label>
        <div class="unit-input" :data-unit="currencySymbol()">
          <input
            id="draft-budget"
            v-model="form.budget"
            class="num"
            type="number"
            inputmode="decimal"
            min="0"
            step="10"
          />
        </div>
      </div>
      <div class="field">
        <label for="draft-need-by">Need by</label>
        <input id="draft-need-by" v-model="form.needBy" class="num" type="date" :min="minDate" />
      </div>
    </div>
    <div class="segmented wide" role="group" aria-label="Budget type">
      <button
        type="button"
        :aria-pressed="form.budgetMode === 'around'"
        @click="form.budgetMode = 'around'"
      >
        Around this
      </button>
      <button
        type="button"
        :aria-pressed="form.budgetMode === 'limit'"
        @click="form.budgetMode = 'limit'"
      >
        Hard limit
      </button>
    </div>
    <div class="grid-two">
      <div class="field">
        <label for="draft-quantity">How many</label>
        <input
          id="draft-quantity"
          v-model="form.quantity"
          class="num"
          type="number"
          inputmode="numeric"
          min="1"
          max="99"
        />
      </div>
      <div class="field">
        <span class="field-label">Delivery to</span>
        <p class="static-value num">
          <template v-if="postcode">{{ postcode }}</template>
          <a v-else href="#/settings/deliveryPostcode">Set a {{ postcodeNoun }}</a>
        </p>
      </div>
    </div>
    <div class="field">
      <label for="draft-unit">Compare price per (optional)</label>
      <input
        id="draft-unit"
        v-model="form.unit"
        type="text"
        maxlength="30"
        placeholder="nappy, capsule, tablet"
      />
      <p class="hint">For things sold in packs of different sizes. Alerts can then fire on a
        good price per unit.</p>
    </div>
    <div class="field">
      <label class="check">
        <input v-model="form.refurbished" type="checkbox" />
        Refurbished is OK
      </label>
      <p class="hint">Adds a refurbished category with its own alert price. Only units
        refurbished by the maker or a retailer, with a warranty. Used and open-box stay out.</p>
    </div>
    <div class="field">
      <label for="draft-must-have">Must-haves</label>
      <div v-if="form.mustHaves.length" class="chips">
        <button
          v-for="(item, index) in form.mustHaves"
          :key="item"
          class="chip on"
          type="button"
          :aria-label="`Remove ${item}`"
          @click="removeMustHave(index)"
        >
          {{ item }} <span aria-hidden="true">×</span>
        </button>
      </div>
      <form class="input-row" @submit.prevent="addMustHave">
        <input
          id="draft-must-have"
          v-model="newMustHave"
          type="text"
          maxlength="60"
          placeholder="Add a must-have, like gears"
          enterkeyhint="done"
        />
        <button class="btn secondary small" type="submit" :disabled="!newMustHave.trim()">
          Add
        </button>
      </form>
    </div>
    <div class="field">
      <span class="field-label">Links you already found (optional)</span>
      <div v-for="(link, index) in form.links" :key="index" class="input-row">
        <label class="visually-hidden" :for="`draft-link-${index}`">Link {{ index + 1 }}</label>
        <input
          :id="`draft-link-${index}`"
          v-model="form.links[index]"
          type="url"
          inputmode="url"
          placeholder="https://"
        />
        <button
          class="btn secondary small"
          type="button"
          :aria-label="`Remove link ${index + 1}`"
          @click="removeLink(index)"
        >
          ×
        </button>
      </div>
      <button
        v-if="form.links.length < MAX_LINKS"
        class="btn link start"
        type="button"
        @click="addLink"
      >
        + Paste another link
      </button>
    </div>
    <ul v-if="errors.length" class="banner bad error-list" role="alert">
      <li v-for="error in errors" :key="error">{{ error }}</li>
    </ul>
    <p class="hint">
      Drafting uses about 10 to 20 minutes of Claude time, once. Your phone gets an alert when it
      needs you.
    </p>
    <WizardActions>
      <button class="btn" type="button" :disabled="!canStart" @click="start">
        {{ busy ? 'Starting...' : 'Start draft' }}
      </button>
    </WizardActions>
  </section>
</template>
