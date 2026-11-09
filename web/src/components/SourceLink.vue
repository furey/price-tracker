<script setup>
import { HOME_LINK_TITLE } from '../link-kinds.js'

defineProps({
  name: { type: String, required: true },
  url: { type: String, default: null },
  urlKind: { type: String, default: null }
})
</script>

<template>
  <a
    v-if="url"
    class="quiet-link"
    :href="url"
    :title="urlKind === 'home' ? HOME_LINK_TITLE : url"
    target="_blank"
    rel="noreferrer"
  >
    {{ name }}
    <span v-if="urlKind === 'home'" class="muted home-note">(home page)</span>
  </a>
  <span v-else>{{ name }}</span>
</template>
