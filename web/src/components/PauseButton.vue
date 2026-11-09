<script setup>
import { computed, ref } from 'vue'
import { pauseItem, resumeItem } from '../api.js'
import { confirmPauseItem, confirmResumeItem } from '../confirmCopy.js'

const props = defineProps({
  item: { type: Object, required: true },
  small: { type: Boolean, default: false }
})

const emit = defineEmits(['changed', 'failed'])

const busy = ref(false)

const paused = computed(() => props.item.status === 'paused')

const toggle = async () => {
  const ask = paused.value ? confirmResumeItem : confirmPauseItem
  if (!(await ask({ item: props.item }))) return
  busy.value = true
  try {
    const updated = paused.value
      ? await resumeItem(props.item.id)
      : await pauseItem({ id: props.item.id })
    emit('changed', updated)
  } catch (error) {
    emit('failed', error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <button
    class="btn pause-button"
    :class="{ secondary: !paused, small }"
    type="button"
    :disabled="busy"
    :aria-label="`${paused ? 'Resume' : 'Pause'} ${item.name}`"
    @click.stop.prevent="toggle"
  >
    {{ busy ? 'Saving...' : paused ? 'Resume' : 'Pause' }}
  </button>
</template>
