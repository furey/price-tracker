<script setup>
import { computed, ref } from 'vue'
import { decideDraftChange, requestDraftChange } from '../../api.js'
import { formatMoney } from '../../format.js'
import { describeChanges } from '../../itemDiff.js'
import ModalSheet from '../ModalSheet.vue'

const props = defineProps({
  draft: { type: Object, required: true },
  config: { type: Object, required: true }
})

const emit = defineEmits(['close', 'updated'])

const instruction = ref('')
const busy = ref(false)
const error = ref(null)

const pending = computed(() => props.draft.pendingChange)
const running = computed(() => ['queued', 'running'].includes(pending.value?.state))
const ready = computed(() => pending.value?.state === 'ready')

const groups = computed(() => {
  if (!ready.value) return []
  const bySection = new Map()
  describeChanges({ before: props.config, after: pending.value.config }).forEach((change) => {
    bySection.set(change.section, [...(bySection.get(change.section) ?? []), change])
  })
  return [...bySection.entries()]
})

const productChanged = computed(() => ready.value
  && pending.value.config.product !== props.config.product)

const send = async () => {
  busy.value = true
  error.value = null
  try {
    emit('updated', await requestDraftChange({
      id: props.draft.id, instruction: instruction.value, config: props.config
    }))
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

const decide = async (approve) => {
  busy.value = true
  error.value = null
  try {
    emit('updated', await decideDraftChange({ id: props.draft.id, approve }), { replace: true })
    emit('close')
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

const placeholder = 'Drop the second model, and lower the first alert price to '
  + `${formatMoney(849)}.`
</script>

<template>
  <ModalSheet title="Change this draft" wide :locked="busy" @close="emit('close')">
    <template v-if="ready">
      <p class="small muted">"{{ pending.instruction }}"</p>
      <p class="banner good">Change ready. Review it below; nothing is saved yet.</p>
      <div class="change-groups">
        <p v-if="!groups.length" class="small">The AI made no changes.</p>
        <div v-for="[section, items] in groups" :key="section" class="change-group">
          <h3>{{ section }}</h3>
          <ul class="change-list">
            <li v-for="(item, index) in items" :key="index">
              <span class="change-label">{{ item.label }}</span>
              <span class="change-values">
                <del v-if="item.from !== null" class="num">{{ item.from }}</del>
                <span v-if="item.from !== null && item.to !== null" aria-hidden="true">→</span>
                <ins v-if="item.to !== null" class="num">{{ item.to }}</ins>
              </span>
            </li>
          </ul>
        </div>
      </div>
      <div v-if="productChanged" class="change-group">
        <h3>What Claude looks for, in full</h3>
        <p class="quote"><del>{{ config.product }}</del></p>
        <p class="quote"><ins>{{ pending.config.product }}</ins></p>
      </div>
      <div class="sheet-actions">
        <button class="btn secondary" type="button" :disabled="busy" @click="decide(false)">
          Discard
        </button>
        <button class="btn" type="button" :disabled="busy" @click="decide(true)">
          Use this change
        </button>
      </div>
    </template>
    <template v-else-if="running">
      <p class="small muted">"{{ pending.instruction }}"</p>
      <p class="banner info">
        Claude is working on it. This usually takes a few minutes. You can close this and keep
        reviewing; the change waits for your approval.
      </p>
      <div class="sheet-actions">
        <button class="btn secondary" type="button" @click="emit('close')">Close</button>
      </div>
    </template>
    <template v-else>
      <p v-if="pending?.state === 'failed'" class="banner bad">
        The last change did not work: {{ pending.error }}
      </p>
      <div class="field">
        <label for="ai-change-text">What should change?</label>
        <textarea
          id="ai-change-text"
          v-model="instruction"
          class="short-area"
          rows="4"
          maxlength="1000"
          :placeholder="placeholder"
        />
        <p class="hint">Tap the mic on your keyboard to talk instead of typing.</p>
      </div>
      <p v-if="error" class="banner bad" role="alert">{{ error }}</p>
      <div class="sheet-actions">
        <button class="btn secondary" type="button" @click="emit('close')">Cancel</button>
        <button
          class="btn"
          type="button"
          :disabled="busy || !instruction.trim()"
          @click="send"
        >
          {{ busy ? 'Sending...' : 'Ask AI' }}
        </button>
      </div>
    </template>
  </ModalSheet>
</template>
