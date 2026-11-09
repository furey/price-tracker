<script setup>
import { computed, ref, watch } from 'vue'
import { pendingConfirm, settleConfirm } from '../confirm.js'
import ModalSheet from './ModalSheet.vue'

const typed = ref('')
const toggled = ref(false)

const request = computed(() => pendingConfirm.value)

const paragraphs = computed(() => [request.value?.message ?? []].flat().filter(Boolean))

const canConfirm = computed(() => !request.value?.typeToConfirm
  || typed.value === request.value.typeToConfirm)

const confirm = () => {
  if (!canConfirm.value) return
  settleConfirm(request.value.toggle ? { toggle: toggled.value } : true)
}

watch(request, () => {
  typed.value = ''
  toggled.value = Boolean(request.value?.toggle?.initial)
})
</script>

<template>
  <ModalSheet
    v-if="request"
    :key="request.title"
    :title="request.title"
    @close="settleConfirm(false)"
  >
    <div class="confirm-body">
      <p v-for="text in paragraphs" :key="text" class="body-text">{{ text }}</p>
      <ul v-if="request.changes?.length" class="change-list">
        <li v-for="change in request.changes" :key="change.label">
          <span class="change-label">{{ change.label }}</span>
          <span class="change-values">
            <del class="num">{{ change.from }}</del>
            <span aria-hidden="true">→</span>
            <span class="visually-hidden">changes to</span>
            <ins class="num">{{ change.to }}</ins>
          </span>
        </li>
      </ul>
      <label v-if="request.toggle" class="check confirm-toggle">
        <input v-model="toggled" type="checkbox" />
        <span>{{ request.toggle.label }}</span>
      </label>
      <p v-if="request.note" class="confirm-note">{{ request.note }}</p>
      <div v-if="request.typeToConfirm" class="field">
        <label for="confirm-typed">
          Type <code>{{ request.typeToConfirm }}</code> to confirm
        </label>
        <input
          id="confirm-typed"
          v-model="typed"
          class="num"
          type="text"
          autocomplete="off"
          spellcheck="false"
          data-autofocus
          @keydown.enter.prevent="confirm"
        />
      </div>
    </div>
    <template #actions>
      <button class="btn secondary" type="button" @click="settleConfirm(false)">Cancel</button>
      <button
        class="btn"
        :class="{ danger: request.danger }"
        type="button"
        :disabled="!canConfirm"
        @click="confirm"
      >
        {{ request.confirmLabel }}
      </button>
    </template>
  </ModalSheet>
</template>
