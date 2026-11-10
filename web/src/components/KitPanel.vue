<script setup>
import { formatMoney } from '../format.js'
import KitTable from './KitTable.vue'

defineProps({ kits: { type: Array, default: () => [] } })

const savingText = (vsBundle) => {
  if (!vsBundle) return 'No Sun Bundle price seen in this range'
  const amount = formatMoney(Math.abs(vsBundle.saving))
  const bundle = formatMoney(vsBundle.bundlePrice)
  if (vsBundle.saving > 0) return `${amount} cheaper than the bundle at ${bundle}`
  if (vsBundle.saving < 0) return `${amount} dearer than the bundle at ${bundle}`
  return `Same price as the bundle at ${formatMoney(vsBundle.bundlePrice)}`
}

const savingClass = (vsBundle) => {
  if (!vsBundle || vsBundle.saving === 0) return 'muted'
  return vsBundle.saving > 0 ? 'good' : 'bad'
}
</script>

<template>
  <div class="kits">
    <article v-for="kit in kits" :key="kit.id" class="kit">
      <header>
        <h4>{{ kit.name }}</h4>
        <p class="total num">
          {{ formatMoney(kit.total) }}
          <small v-if="kit.delivered !== null" class="muted">
            {{ formatMoney(kit.delivered) }} delivered
          </small>
        </p>
      </header>
      <KitTable :kit="kit" />
      <p class="versus" :class="savingClass(kit.vsBundle)">
        {{ savingText(kit.vsBundle) }}
        <a v-if="kit.vsBundle?.url" class="quiet-link" :href="kit.vsBundle.url" target="_blank"
          rel="noreferrer">
          {{ kit.vsBundle.retailer }}
        </a>
      </p>
    </article>
  </div>
</template>

<style scoped>
.kits {
  display: grid;
  gap: var(--space-4);
}

.kit {
  display: grid;
  gap: var(--space-3);
}

header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
}

h4,
.total,
.versus {
  margin: 0;
}

h4 {
  font-size: var(--text-title);
  line-height: 1.2;
  text-wrap: balance;
}

.total {
  font-size: var(--text-title);
  font-weight: 700;
}

.total small {
  margin-left: var(--space-2);
  font-size: var(--text-caption);
  font-weight: 400;
}

.versus {
  text-wrap: pretty;
  font-weight: 600;
}

.versus.good {
  color: var(--ok);
}

.versus.bad {
  color: var(--bad);
}

.versus a {
  margin-left: var(--space-2);
  font-weight: 400;
  color: var(--ink-2);
}
</style>
