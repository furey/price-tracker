<script setup>
import { computed, reactive, ref } from 'vue'
import { acceptsRefurbished, applyRefurbished } from '../../../../src/refurbished.js'
import { isCategoryMuted } from '../../../../src/tuning.js'
import { useInvalid } from '../../formContext.js'
import {
  removeCategory, renameCategory, setCategoryMuted, slugify
} from '../../itemForm.js'
import { whoLabel } from '../../who.js'
import WhoField from '../WhoField.vue'
import FieldError from './FieldError.vue'

const props = defineProps({
  config: { type: Object, required: true },
  original: { type: Object, required: true },
  renames: { type: Object, required: true }
})

const invalid = useInvalid()

const pendingIds = reactive({})
const newCategory = reactive({ id: '', description: '' })
const addError = ref('')

const setRefurbished = (accepted) => applyRefurbished({ config: props.config, accepted })

const originalIds = () => (props.original.categories ?? []).map(({ id }) => id)

const sourceIdOf = (id) =>
  Object.entries(props.renames).find(([, to]) => to === id)?.[0] ?? id

const isRenamed = (id) => sourceIdOf(id) !== id

const hasHistory = (id) => originalIds().includes(sourceIdOf(id))

const applyRename = (category) => {
  const next = slugify(pendingIds[category.id] ?? category.id)
  const current = category.id
  delete pendingIds[current]
  if (!next || next === current) return
  if (props.config.categories.some(({ id }) => id === next)) return
  const source = sourceIdOf(current)
  renameCategory({ config: props.config, from: current, to: next })
  if (originalIds().includes(source)) {
    if (source === next) delete props.renames[source]
    else props.renames[source] = next
  }
}

const isMuted = (id) => isCategoryMuted({ item: props.config, category: id })

const unmutedCount = computed(() =>
  props.config.categories.filter(({ id }) => !isMuted(id)).length)

const canMute = (id) => !isMuted(id) && unmutedCount.value > 1 && Boolean(whoLabel.value)

const toggleMute = (id) => {
  const muted = !isMuted(id)
  if (muted && !canMute(id)) return
  setCategoryMuted({
    config: props.config, id, muted, by: whoLabel.value, at: new Date().toISOString()
  })
}

const remove = (id) => {
  removeCategory({ config: props.config, id })
  delete props.renames[sourceIdOf(id)]
}

const add = () => {
  const id = slugify(newCategory.id || newCategory.description)
  addError.value = ''
  if (!id) {
    addError.value = 'Enter an id or a description.'
    return
  }
  if (props.config.categories.some((category) => category.id === id)) {
    addError.value = `A category with id "${id}" already exists.`
    return
  }
  props.config.categories.push({ id, description: newCategory.description.trim() })
  newCategory.id = ''
  newCategory.description = ''
}
</script>

<template>
  <div class="edit-fields">
    <div class="field">
      <label for="edit-product">What the AI looks for</label>
      <textarea
        id="edit-product"
        v-model="config.product"
        rows="8"
        :aria-invalid="invalid('product')"
      />
      <p class="hint">
        Describe the exact product and what to reject (other sizes, look-alikes, parts sold
        alone). The AI research reads this text as written.
      </p>
      <FieldError path="product" />
    </div>

    <div class="field">
      <label class="check">
        <input
          type="checkbox"
          :checked="acceptsRefurbished(config)"
          @change="setRefurbished($event.target.checked)"
        />
        Refurbished is OK
      </label>
      <p class="hint">Adds a refurbished category with its own alert price, set under Alert
        prices. Only units refurbished by the maker or a retailer, with a warranty. Used and
        open-box stay out. Turning it off removes the category.</p>
      <FieldError path="accept.refurbished" />
    </div>

    <h3 class="sub-head">Categories</h3>
    <p class="muted small">
      Each listing is sorted into one category. Alert prices are set per category. A muted
      category never alerts; its prices are still recorded.
    </p>
    <WhoField v-if="!whoLabel" />
    <ul class="row-list">
      <li
        v-for="(category, index) in config.categories"
        :key="`${index}-${category.id}`"
        class="row-item"
      >
        <div class="category-grid">
          <div class="field">
            <label :for="`category-id-${index}`">Id</label>
            <input
              :id="`category-id-${index}`"
              class="num"
              type="text"
              spellcheck="false"
              :value="pendingIds[category.id] ?? category.id"
              :aria-invalid="invalid(`categories[${index}].id`)"
              @input="pendingIds[category.id] = $event.target.value"
              @change="applyRename(category)"
            />
          </div>
          <div class="field">
            <label :for="`category-description-${index}`">Description</label>
            <textarea
              :id="`category-description-${index}`"
              v-model="category.description"
              class="short"
              rows="2"
              :aria-invalid="invalid(`categories[${index}]`)"
            />
          </div>
        </div>
        <p
          v-if="hasHistory(category.id) && (isRenamed(category.id) || pendingIds[category.id])"
          class="banner"
        >
          Renaming a category breaks its price history: past prices stay under
          "{{ sourceIdOf(category.id) }}" and the new id starts empty.
        </p>
        <FieldError :path="`categories[${index}]`" />
        <FieldError :path="`categories[${index}].id`" />
        <div class="row-foot">
          <span class="muted small foot-state">
            {{ index + 1 }} of {{ config.categories.length }}
            <span v-if="isMuted(category.id)" class="pill neutral">Muted</span>
          </span>
          <span class="foot-actions">
            <button
              class="btn link"
              type="button"
              :disabled="!isMuted(category.id) && !canMute(category.id)"
              :aria-pressed="isMuted(category.id)"
              @click="toggleMute(category.id)"
            >
              {{ isMuted(category.id) ? 'Unmute' : 'Mute' }}
            </button>
            <button
              class="btn link"
              type="button"
              :disabled="config.categories.length === 1"
              @click="remove(category.id)"
            >
              Remove category
            </button>
          </span>
        </div>
      </li>
    </ul>
    <div class="row-item add-row">
      <div class="category-grid">
        <div class="field">
          <label for="new-category-id">New category id</label>
          <input
            id="new-category-id"
            v-model="newCategory.id"
            class="num"
            type="text"
            spellcheck="false"
            placeholder="medium-bundle"
          />
        </div>
        <div class="field">
          <label for="new-category-description">Description</label>
          <input id="new-category-description" v-model="newCategory.description" type="text" />
        </div>
      </div>
      <p v-if="addError" class="field-error" role="alert">{{ addError }}</p>
      <button class="btn secondary small" type="button" @click="add">Add category</button>
    </div>
  </div>
</template>

<style scoped>
.foot-state,
.foot-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}
</style>
