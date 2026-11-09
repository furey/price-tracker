<script setup>
import { useId, watch } from 'vue'
import { useStoredOpen } from '../useStoredOpen.js'

const props = defineProps({
  name: { type: String, required: true },
  title: { type: String, required: true },
  summary: { type: String, default: '' },
  initial: { type: Boolean, default: false },
  forceOpen: { type: Boolean, default: false }
})

const open = useStoredOpen({ key: props.name, initial: props.initial })
const bodyId = useId()

const show = () => {
  open.value = true
}

watch(() => props.forceOpen, (force) => force && show(), { immediate: true })

defineExpose({ show })
</script>

<template>
  <section class="fold" :class="{ open }">
    <h2 class="fold-heading">
      <button
        class="fold-toggle"
        type="button"
        :aria-expanded="open"
        :aria-controls="bodyId"
        @click="open = !open"
      >
        <span class="fold-title">{{ title }}</span>
        <span class="fold-summary"><slot name="summary">{{ summary }}</slot></span>
        <svg class="fold-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
    </h2>
    <div v-show="open" :id="bodyId" class="fold-body">
      <slot />
    </div>
  </section>
</template>
