<script setup>
import { computed, nextTick, onUnmounted, ref, useId } from 'vue'
import PauseButton from './PauseButton.vue'

const props = defineProps({
  item: { type: Object, required: true },
  runDisabled: { type: Boolean, default: false },
  testStarting: { type: Boolean, default: false }
})

const emit = defineEmits(['test-run', 'changed', 'failed'])

const open = ref(false)
const root = ref(null)
const toggleButton = ref(null)
const panel = ref(null)
const panelId = useId()

const canPause = computed(() => props.item.status === 'active')

const show = async () => {
  open.value = true
  document.addEventListener('pointerdown', closeOnOutside)
  await nextTick()
  panel.value?.querySelector('button:not(:disabled)')?.focus()
}

const hide = ({ returnFocus = true } = {}) => {
  if (!open.value) return
  open.value = false
  document.removeEventListener('pointerdown', closeOnOutside)
  if (returnFocus) toggleButton.value?.focus()
}

const toggle = () => (open.value ? hide() : show())

const closeOnOutside = (event) => {
  if (!root.value?.contains(event.target)) hide({ returnFocus: false })
}

const closeOnFocusOut = (event) => {
  if (event.relatedTarget && !root.value?.contains(event.relatedTarget)) {
    hide({ returnFocus: false })
  }
}

const startTestRun = () => {
  hide()
  emit('test-run')
}

onUnmounted(() => document.removeEventListener('pointerdown', closeOnOutside))
</script>

<template>
  <div
    ref="root"
    class="more-menu"
    @keydown.esc.stop="hide()"
    @focusout="closeOnFocusOut"
  >
    <button
      ref="toggleButton"
      class="btn secondary more-toggle"
      type="button"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="toggle"
    >
      More
      <svg class="more-chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
    <div v-show="open" :id="panelId" ref="panel" class="more-panel card">
      <button
        class="more-action"
        type="button"
        :disabled="runDisabled"
        @click="startTestRun"
      >
        <span class="action-label">{{ testStarting ? 'Starting...' : 'Test run' }}</span>
        <span class="action-hint">Checks prices now. Saves no prices and sends no alerts.</span>
      </button>
      <div v-if="canPause" class="more-row" @click.capture="hide()">
        <PauseButton
          :item="item"
          small
          @changed="emit('changed', $event)"
          @failed="emit('failed', $event)"
        />
        <span class="action-hint">Stops scheduled checks until you resume.</span>
      </div>
      <p class="more-ids">
        <span class="num">{{ item.id }}</span>
        <span class="num">version {{ item.version }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.more-menu {
  position: relative;
  display: inline-flex;
}

.more-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.more-chevron {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.75;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 160ms;
}

.more-toggle[aria-expanded='true'] .more-chevron {
  transform: rotate(180deg);
}

.more-panel {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 20;
  display: grid;
  gap: var(--space-1);
  width: min(280px, calc(100vw - 32px));
  padding: var(--space-2);
  box-shadow: var(--shadow);
}

.more-action {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.more-action:hover:not(:disabled) {
  background: var(--muted-bg);
}

.more-action:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.more-action:disabled {
  color: var(--ink-3);
  cursor: default;
}

.action-label {
  font-weight: 600;
}

.action-hint {
  font-size: var(--text-caption);
  color: var(--ink-3);
  text-wrap: pretty;
}

.more-row {
  display: grid;
  justify-items: start;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--rule);
}

.more-ids {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-1);
  border-top: 1px solid var(--rule);
  font-size: var(--text-caption);
  color: var(--ink-3);
  overflow-wrap: anywhere;
}
</style>
