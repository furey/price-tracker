<script setup>
import { VPImage } from 'vitepress/theme'

defineProps({
  light: { type: String, default: '/hero/item-list-light.webp' },
  dark: { type: String, default: '/hero/item-list-dark.webp' },
  label: { type: String, default: 'http://nas.local:4280' },
  alt: {
    type: String,
    default: 'The Price Tracker item list: Claude usage against the weekly reserve, and a card per item with the lowest price, a price trend, the last run, and the next checks'
  },
  ratio: { type: String, default: '1280 / 760' }
})
</script>

<template>
  <figure class="browser-frame__figure">
    <div class="browser-frame">
      <div class="browser-frame__bar">
        <span class="browser-frame__dots" aria-hidden="true">
          <span class="browser-frame__dot"></span>
          <span class="browser-frame__dot"></span>
          <span class="browser-frame__dot"></span>
        </span>
        <span class="browser-frame__url" aria-hidden="true">{{ label }}</span>
      </div>
      <div class="browser-frame__shot" :style="{ aspectRatio: ratio }">
        <VPImage :image="{ light, dark, alt }" />
      </div>
    </div>
  </figure>
</template>

<style scoped>
.browser-frame__figure {
  margin: 0;
}

.vp-doc .browser-frame__figure {
  margin: 24px 0;
}

.browser-frame {
  position: relative;
  z-index: 1;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--pt-hairline);
  background: var(--pt-surface-1);
  box-shadow: 0 24px 60px -28px rgba(76, 29, 149, 0.45);
}

.browser-frame__bar {
  position: relative;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--pt-surface-1);
  border-bottom: 1px solid var(--pt-hairline);
}

.browser-frame__dots {
  display: flex;
  gap: 8px;
}

.browser-frame__dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--pt-surface-3);
}

.browser-frame__url {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: 60%;
  padding: 1px 8px;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.browser-frame__shot {
  width: 100%;
}

.browser-frame__shot :deep(img) {
  display: block;
  width: 100%;
  height: auto;
  margin: 0;
}
</style>
