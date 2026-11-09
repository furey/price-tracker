<script setup>
import { computed } from 'vue'

const props = defineProps({
  status: { type: String, default: null },
  compact: { type: Boolean, default: false }
})

const labels = {
  ok: 'OK',
  running: 'Running',
  failed: 'Failed',
  skipped: 'Skipped',
  blocked: 'Blocked',
  error: 'Error',
  not_found: 'Not found',
  bot_check: 'Bot check'
}

const label = computed(() => labels[props.status] ?? 'No runs')
</script>

<template>
  <span class="pill" :class="[status, { compact }]">{{ label }}</span>
</template>
