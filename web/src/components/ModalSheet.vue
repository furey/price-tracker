<script setup>
import { nextTick, onMounted, onUnmounted, ref, useId } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  wide: { type: Boolean, default: false },
  locked: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',')

const titleId = useId()
const dialog = ref(null)
const heading = ref(null)
let returnTo = null

const requestClose = () => {
  if (!props.locked) emit('close')
}

const focusables = () => [...dialog.value.querySelectorAll(FOCUSABLE)]
  .filter((element) => element.offsetParent !== null)

const trapTab = (event) => {
  const items = focusables()
  if (!items.length) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const outside = !dialog.value.contains(active) || active === heading.value
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault()
    last.focus()
    return
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

const onKeydown = (event) => {
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key === 'Tab') trapTab(event)
}

const lockScroll = () => {
  const root = document.documentElement
  const count = Number(root.dataset.modalCount ?? 0) + 1
  root.dataset.modalCount = String(count)
  root.classList.add('modal-open')
}

const unlockScroll = () => {
  const root = document.documentElement
  const count = Math.max(0, Number(root.dataset.modalCount ?? 1) - 1)
  root.dataset.modalCount = String(count)
  if (count === 0) root.classList.remove('modal-open')
}

const focusStart = async () => {
  await nextTick()
  const target = dialog.value?.querySelector('[data-autofocus]') ?? heading.value
  target?.focus()
}

onMounted(() => {
  returnTo = document.activeElement
  lockScroll()
  focusStart()
})

onUnmounted(() => {
  unlockScroll()
  if (returnTo?.isConnected) returnTo.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="sheet-backdrop" @click.self="requestClose">
      <section
        ref="dialog"
        class="sheet card"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @keydown="onKeydown"
      >
        <h2 :id="titleId" ref="heading" class="sheet-title" tabindex="-1">{{ title }}</h2>
        <slot />
        <div v-if="$slots.actions" class="sheet-actions">
          <slot name="actions" />
        </div>
      </section>
    </div>
  </Teleport>
</template>
