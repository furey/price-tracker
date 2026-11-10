<script setup>
import { computed, reactive, ref } from 'vue'
import { createHandItem } from '../../api.js'
import { currencySymbol } from '../../format.js'
import WizardActions from './WizardActions.vue'

defineProps({
  needsClaude: { type: Boolean, default: false }
})

const form = reactive({ name: '', lookFor: '', category: '', alertPrice: '', url: '' })
const busy = ref(false)
const errors = ref([])
const added = ref(null)

const canAdd = computed(() => !busy.value && form.name.trim() && form.lookFor.trim()
  && Number(form.alertPrice) > 0)

const missedText = computed(() => {
  const note = added.value?.freeCheck.note
  return `${form.name} is added. The product page gave no price${note ? ` (${note})` : ''}, `
    + 'so the item has no free check yet. You can add one on the Edit page.'
})

const editHref = (itemId) => `#/item/${encodeURIComponent(itemId)}/edit`

const add = async () => {
  busy.value = true
  errors.value = []
  try {
    const result = await createHandItem({
      name: form.name,
      lookFor: form.lookFor,
      category: form.category.trim() || null,
      alertPrice: Number(form.alertPrice),
      url: form.url.trim() || null
    })
    if (result.freeCheck.requested && !result.freeCheck.added) {
      added.value = result
      return
    }
    window.location.hash = editHref(result.itemId)
  } catch (error) {
    errors.value = error.errors?.length ? error.errors : [error.message]
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="wizard-screen">
    <template v-if="needsClaude">
      <h1 class="wizard-title">New items need Claude</h1>
      <p class="lead">
        Claude reads your request, finds the models and shops, and drafts the item. Claude is not
        connected, so you can add the item by hand instead.
      </p>
      <p class="hint">
        To connect Claude, add a <a href="#/settings/claudeOauthToken">Claude login token</a> in
        Settings.
      </p>
      <h2 class="wizard-title small-title">Add by hand</h2>
    </template>
    <h1 v-else class="wizard-title">Add by hand</h1>

    <template v-if="added">
      <p class="banner info" role="status">{{ missedText }}</p>
      <WizardActions>
        <a class="btn" :href="editHref(added.itemId)">Open the Edit page</a>
      </WizardActions>
    </template>

    <template v-else>
      <div class="field">
        <label for="hand-name">Name</label>
        <input
          id="hand-name"
          v-model="form.name"
          type="text"
          maxlength="60"
          placeholder="Dyson V15 Detect"
        />
      </div>
      <div class="field">
        <label for="hand-look-for">What to look for</label>
        <textarea
          id="hand-look-for"
          v-model="form.lookFor"
          rows="4"
          maxlength="2000"
          placeholder="Dyson V15 Detect cordless vacuum, new, any colour. Not the V12 or V8."
        />
        <p class="hint">The product, the models that count, and what to avoid.</p>
      </div>
      <div class="grid-two">
        <div class="field">
          <label for="hand-category">Category (optional)</label>
          <input
            id="hand-category"
            v-model="form.category"
            type="text"
            maxlength="80"
            placeholder="V15 Detect"
          />
        </div>
        <div class="field">
          <label for="hand-price">Alert price</label>
          <div class="unit-input" :data-unit="currencySymbol()">
            <input
              id="hand-price"
              v-model="form.alertPrice"
              class="num"
              type="number"
              inputmode="decimal"
              min="0"
              step="10"
            />
          </div>
        </div>
      </div>
      <p class="hint">You get an alert when a price in this category is at or below the alert
        price.</p>
      <div class="field">
        <label for="hand-url">Product page (optional)</label>
        <input
          id="hand-url"
          v-model="form.url"
          type="url"
          inputmode="url"
          placeholder="https://"
        />
        <p class="hint">The app reads the price from this page twice a day for free, without
          Claude.</p>
      </div>
      <ul v-if="errors.length" class="banner bad error-list" role="alert">
        <li v-for="error in errors" :key="error">{{ error }}</li>
      </ul>
      <p class="hint">
        Adding the item sends a test alert to its new phone alert topic. The Edit page opens next,
        for schedules, more shops, and alert settings.
      </p>
      <WizardActions>
        <button class="btn" type="button" :disabled="!canAdd" @click="add">
          {{ busy ? 'Adding...' : 'Add item' }}
        </button>
      </WizardActions>
    </template>
  </section>
</template>
