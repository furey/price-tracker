<script setup>
import { computed } from 'vue'
import ModalSheet from '../ModalSheet.vue'

const props = defineProps({
  changes: { type: Array, required: true },
  nextVersion: { type: Number, required: true },
  saving: { type: Boolean, default: false }
})

const note = defineModel('note', { type: String, default: '' })

const emit = defineEmits(['confirm', 'cancel'])

const groups = computed(() => {
  const bySection = new Map()
  props.changes.forEach((change) => {
    bySection.set(change.section, [...(bySection.get(change.section) ?? []), change])
  })
  return [...bySection.entries()]
})
</script>

<template>
  <ModalSheet
    :title="`Save version ${nextVersion}?`"
    wide
    :locked="saving"
    @close="emit('cancel')"
  >
    <p class="body-text">
      These changes apply from the next check. Prices already recorded keep the rules they were
      judged by.
    </p>
    <div class="change-groups">
      <p v-if="!changes.length" class="small">
        Only formatting changed. Saving still makes a new version.
      </p>
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
    <div class="field">
      <label for="change-note">Note (optional)</label>
      <input
        id="change-note"
        v-model="note"
        type="text"
        maxlength="500"
        placeholder="Lower the bundle alert price for Black Friday"
      />
    </div>
    <p class="confirm-note">
      Earlier versions stay listed under Versions, and you can restore any of them.
    </p>
    <template #actions>
      <button class="btn secondary" type="button" :disabled="saving" @click="emit('cancel')">
        Cancel
      </button>
      <button class="btn" type="button" :disabled="saving" @click="emit('confirm')">
        {{ saving ? 'Saving...' : `Save version ${nextVersion}` }}
      </button>
    </template>
  </ModalSheet>
</template>
