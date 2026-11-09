<script setup>
import { computed } from 'vue'
import { currentRegion } from '../../format.js'
import { runsFor } from '../../wizard.js'
import NtfyTopic from '../NtfyTopic.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  config: { type: Object, required: true },
  result: { type: Object, default: null }
})

const saved = computed(() => props.draft.status === 'saved')

const dayFormat = new Intl.DateTimeFormat(currentRegion().locale, {
  timeZone: 'UTC', day: 'numeric', month: 'short'
})

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

const checks = computed(() => {
  const config = props.config
  const rejects = props.draft.research?.rejects?.length ?? 0
  const endDate = props.draft.research?.endDate
  const snapshot = props.draft.snapshot?.listings?.length ?? 0
  return [
    `${plural(config.categories.length, 'model')}, ranked`
      + (rejects ? `, with ${plural(rejects, 'rejected look-alike')}` : ''),
    `${plural((config.direct ?? []).length, 'free check')}, `
      + `${plural(config.sources.sites.length, 'site')} for AI checks`,
    `${plural(runsFor(config.schedules), 'AI check')} in the next 30 days`
      + (endDate ? `, stops ${dayFormat.format(new Date(`${endDate}T00:00:00Z`))}` : ''),
    snapshot
      ? `Today's ${plural(snapshot, 'price')} become the first history point`
      : 'No price snapshot to import; history starts with the first check'
  ]
})

const itemHref = computed(() => `#/item/${encodeURIComponent(props.draft.itemId ?? '')}`)
</script>

<template>
  <div class="review-body">
    <template v-if="saved">
      <p class="banner good" role="status">
        Saved. The item is active and its first check runs on schedule.
      </p>
      <p v-if="result" class="pill" :class="result.testDelivered ? 'ok' : 'failed'">
        {{ result.testDelivered ? 'Test alert delivered' : 'Test alert not delivered' }}
      </p>
      <p v-if="result?.snapshot?.error" class="banner">
        The price snapshot was not imported: {{ result.snapshot.error }}
      </p>
    </template>
    <div v-else class="card padded stack">
      <h2 class="section-title">Ready to save</h2>
      <ul class="checks">
        <li v-for="line in checks" :key="line">{{ line }}</li>
      </ul>
    </div>
    <h2 class="section-title">Get the alerts on your phone</h2>
    <p class="small muted">
      {{ saved
        ? 'Subscribe to this topic, then check the test alert arrived.'
        : 'Subscribe to this topic now. Saving the item sends a test alert to it.' }}
    </p>
    <NtfyTopic :server="config.ntfy.server" :topic="config.ntfy.topic" />
    <a v-if="saved" class="btn" :href="itemHref">Open the item</a>
  </div>
</template>
