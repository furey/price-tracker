<script setup>
import { screenshotUrl } from '../api.js'

defineProps({
  screenshots: { type: Array, default: () => [] },
  label: { type: String, required: true }
})
</script>

<template>
  <ul v-if="screenshots.length" class="thumbs" :aria-label="`Screenshots of ${label}`">
    <li v-for="(shot, index) in screenshots" :key="shot.id">
      <a
        class="thumb"
        :href="screenshotUrl(shot.id)"
        target="_blank"
        rel="noreferrer"
        :aria-label="`Open screenshot ${index + 1} of ${label} in a new tab`"
      >
        <img
          :src="screenshotUrl(shot.id)"
          :alt="`Screenshot ${index + 1} of ${label}`"
          loading="lazy"
          decoding="async"
        />
      </a>
    </li>
  </ul>
</template>

<style scoped>
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.thumb {
  display: block;
  width: 72px;
  height: 54px;
  overflow: hidden;
  background: var(--surface-sunk);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
}

.thumb:hover {
  border-color: var(--accent);
}

.thumb:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}
</style>
