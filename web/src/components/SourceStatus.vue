<script setup>
import SourceLink from './SourceLink.vue'
import StatusPill from './StatusPill.vue'

defineProps({ sources: { type: Array, default: () => [] } })
</script>

<template>
  <ul class="sources card">
    <li v-for="source in sources" :key="source.name">
      <SourceLink class="name" :name="source.name" :url="source.url" />
      <StatusPill :status="source.status" compact />
      <span v-if="source.note" class="note muted">{{ source.note }}</span>
    </li>
  </ul>
</template>

<style scoped>
.sources {
  list-style: none;
  margin: 0;
  padding: var(--space-1) var(--space-4);
}

li {
  display: grid;
  grid-template-columns: minmax(120px, 190px) auto 1fr;
  align-items: baseline;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-small);
}

li:last-child {
  border-bottom: 0;
}

.name {
  font-weight: 600;
}

.note {
  font-size: var(--text-caption);
}

@media (max-width: 560px) {
  li {
    grid-template-columns: 1fr auto;
  }
  .note {
    grid-column: 1 / -1;
  }
}
</style>
