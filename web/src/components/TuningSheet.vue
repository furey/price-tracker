<script setup>
import { computed, ref, useId } from 'vue'
import { MAX_REASON_LENGTH } from '../../../src/tuning.js'
import { whoLabel } from '../who.js'
import ModalSheet from './ModalSheet.vue'
import WhoField from './WhoField.vue'

const props = defineProps({
  request: { type: Object, required: true },
  nextVersion: { type: Number, required: true },
  saving: { type: Boolean, default: false },
  error: { type: String, default: null }
})

const emit = defineEmits(['confirm', 'cancel'])

const noteId = useId()
const note = ref(props.request.reason ?? '')

const savesVersion = computed(() => props.request.changes.length > 0)

const title = computed(() => (savesVersion.value ? 'Review changes' : 'Send feedback'))

const lead = computed(() => (savesVersion.value
  ? `Saves as version ${props.nextVersion}. Prices already recorded keep the rules they were `
    + 'judged by. Muted prices are still recorded.'
  : 'Records your feedback on this alert. Nothing about the item changes.'))

const confirmLabel = computed(() => {
  if (props.saving) return 'Saving...'
  return savesVersion.value ? `Save version ${props.nextVersion}` : 'Send feedback'
})

const canConfirm = computed(() => Boolean(whoLabel.value) && !props.saving)

const confirm = () => {
  if (canConfirm.value) emit('confirm', { note: note.value.trim() })
}
</script>

<template>
  <ModalSheet :title="title" :locked="saving" @close="emit('cancel')">
    <p class="body-text">{{ lead }}</p>
    <div v-if="savesVersion" class="change-group">
      <h3>Tuning</h3>
      <ul class="change-list">
        <li v-for="(item, index) in request.changes" :key="index">
          <span class="change-label">{{ item.label }}</span>
          <span class="change-values">
            <template v-if="item.from !== null">
              <del class="num">{{ item.from }}</del>
              <span v-if="item.to !== null" aria-hidden="true">→</span>
              <ins v-if="item.to !== null" class="num">{{ item.to }}</ins>
            </template>
            <span v-else-if="item.to !== null" class="change-subject">{{ item.to }}</span>
          </span>
        </li>
      </ul>
    </div>
    <p v-for="text in request.notes ?? []" :key="text" class="banner info">{{ text }}</p>
    <div class="field">
      <label :for="noteId">Note</label>
      <input
        :id="noteId"
        v-model="note"
        type="text"
        :maxlength="MAX_REASON_LENGTH"
        placeholder="Why you made this change"
      />
    </div>
    <WhoField :hint="false" />
    <p v-if="!whoLabel" class="confirm-note">Pick who is making this change.</p>
    <p v-if="error" class="banner bad" role="alert">{{ error }}</p>
    <template #actions>
      <button class="btn secondary" type="button" :disabled="saving" @click="emit('cancel')">
        Back
      </button>
      <button class="btn" type="button" :disabled="!canConfirm" @click="confirm">
        {{ confirmLabel }}
      </button>
    </template>
  </ModalSheet>
</template>

<style scoped>
.change-group h3 {
  margin: var(--space-3) 0 var(--space-2);
}

.field {
  margin-top: var(--space-3);
}

.who-field {
  margin-top: var(--space-3);
}
</style>
