<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { copyText } from '../clipboard.js'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  server: { type: String, required: true },
  topic: { type: String, required: true }
})

const COPIED_MS = 2000

const topicElement = ref(null)
const copied = ref(false)
let resetTimer = null

const openUrl = computed(() => `${props.server.replace(/\/+$/, '')}/${props.topic}`)

const selectTopic = () => {
  const range = document.createRange()
  range.selectNodeContents(topicElement.value)
  const selection = window.getSelection()
  selection.removeAllRanges()
  selection.addRange(range)
}

const showCopied = () => {
  copied.value = true
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = false
  }, COPIED_MS)
}

const copyTopic = async () => {
  if (await copyText(props.topic)) return showCopied()
  selectTopic()
}

onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <div class="ntfy card">
    <dl>
      <div>
        <dt>Server</dt>
        <dd><code class="value">{{ server }}</code></dd>
      </div>
      <div>
        <dt>Topic</dt>
        <dd><code ref="topicElement" class="value topic">{{ topic }}</code></dd>
      </div>
    </dl>
    <div class="buttons">
      <button class="btn secondary" type="button" @click="copyTopic">
        <AppIcon v-if="copied" name="check" />
        <span aria-live="polite">{{ copied ? 'Copied' : 'Copy topic' }}</span>
      </button>
      <a class="btn secondary" :href="openUrl" target="_blank" rel="noreferrer">
        Open in browser
      </a>
      <slot name="actions" />
    </div>
    <slot name="result" />
    <p class="muted help">
      In the ntfy app, tap +, paste the topic, and keep the server as ntfy.sh.
    </p>
  </div>
</template>

<style scoped>
.ntfy {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

dl {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

dt {
  font-size: var(--text-label);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
}

dd {
  margin: 2px 0 0;
}

.value {
  font-family: var(--font-code);
  font-size: var(--text-small);
  overflow-wrap: anywhere;
  user-select: all;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.buttons .btn {
  text-decoration: none;
}

.help {
  margin: 0;
  font-size: var(--text-small);
  text-wrap: pretty;
}
</style>
