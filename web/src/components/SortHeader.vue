<script setup>
import { computed } from 'vue'

const props = defineProps({
  sort: { type: Object, required: true },
  column: { type: String, required: true }
})

const arrows = { ascending: '↑', descending: '↓', none: '↕' }

const state = computed(() => props.sort.ariaSort(props.column))
</script>

<template>
  <th :aria-sort="state">
    <button class="sort-button" :class="{ active: state !== 'none' }" type="button"
      @click="sort.toggle(column)">
      <slot />
      <span class="sort-arrow" aria-hidden="true">{{ arrows[state] }}</span>
    </button>
  </th>
</template>
