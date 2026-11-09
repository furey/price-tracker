<script setup>
import { computed, ref } from 'vue'
import { moveItem, removeCategory } from '../../itemForm.js'
import EditLookFor from '../edit/EditLookFor.vue'
import FieldError from '../edit/FieldError.vue'

const props = defineProps({
  config: { type: Object, required: true },
  research: { type: Object, required: true }
})

const editing = ref(false)
const renames = {}

const labelOf = (category) => props.research.categoryLabels?.[category.id] ?? category.id

const notices = computed(() => [
  ...(props.research.flags ?? []),
  ...(props.research.warnings ?? [])
])

const move = (index, offset) => moveItem({ list: props.config.categories, index, offset })

const remove = (id) => removeCategory({ config: props.config, id })
</script>

<template>
  <div class="review-body">
    <ul v-if="notices.length" class="banner notice-list" role="status">
      <li v-for="notice in notices" :key="notice">{{ notice }}</li>
    </ul>
    <div class="field">
      <label for="review-name">Item name</label>
      <input id="review-name" v-model="config.name" type="text" maxlength="60" />
      <FieldError path="name" />
    </div>
    <div class="row-between">
      <h2 class="section-title">Acceptable models</h2>
      <span class="muted small">in order of preference</span>
    </div>
    <ol class="rank-list card">
      <li v-for="(category, index) in config.categories" :key="category.id" class="rank">
        <span class="rank-number num" aria-hidden="true">{{ index + 1 }}</span>
        <div class="rank-text">
          <h3>{{ labelOf(category) }}</h3>
          <p class="muted small">{{ category.description }}</p>
        </div>
        <div class="rank-buttons">
          <button
            class="btn secondary small"
            type="button"
            :disabled="index === 0"
            :aria-label="`Move ${labelOf(category)} up`"
            @click="move(index, -1)"
          >
            Up
          </button>
          <button
            class="btn secondary small"
            type="button"
            :disabled="config.categories.length === 1"
            :aria-label="`Remove ${labelOf(category)}`"
            @click="remove(category.id)"
          >
            Remove
          </button>
        </div>
      </li>
    </ol>
    <div v-if="research.rejects?.length" class="card padded">
      <h3>Rejected look-alikes</h3>
      <ul class="rejects">
        <li v-for="reject in research.rejects" :key="reject">{{ reject }}</li>
      </ul>
    </div>
    <div class="field">
      <span class="field-label">What Claude looks for on each check</span>
      <p v-if="!editing" class="quote">{{ config.product }}</p>
      <button class="btn link start" type="button" @click="editing = !editing">
        {{ editing ? 'Done editing' : 'Edit text and categories' }}
      </button>
    </div>
    <div v-if="editing" class="card padded">
      <EditLookFor :config="config" :original="config" :renames="renames" />
    </div>
  </div>
</template>
