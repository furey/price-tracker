<script setup>
import { computed, ref } from 'vue'
import { archiveItem, deleteItem, pauseItem, restoreItem, resumeItem } from '../../api.js'
import {
  confirmArchive, confirmDelete, confirmPauseItem, confirmRestore, confirmResumeItem
} from '../../confirmCopy.js'
import { currentRegion, formatPausedUntil, timeZoneLabel } from '../../format.js'

const props = defineProps({
  itemId: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, required: true },
  pausedUntil: { type: String, default: null }
})

const emit = defineEmits(['changed', 'deleted'])

const resumeOn = ref('')
const busy = ref(false)
const error = ref(null)

const isArchived = computed(() => props.status === 'archived')

const today = computed(() => new Intl.DateTimeFormat('en-CA', {
  timeZone: currentRegion().timeZone
}).format(new Date()))

const item = computed(() => ({ id: props.itemId, name: props.name }))

const run = async ({ ask, action }) => {
  if (!(await ask())) return
  busy.value = true
  error.value = null
  try {
    emit('changed', await action())
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}

const pauseUntil = () => run({
  ask: () => confirmPauseItem({ item: item.value, untilDay: resumeOn.value }),
  action: () => pauseItem({ id: props.itemId, until: resumeOn.value })
})

const pauseNow = () => run({
  ask: () => confirmPauseItem({ item: item.value }),
  action: () => pauseItem({ id: props.itemId })
})

const resume = () => run({
  ask: () => confirmResumeItem({ item: item.value }),
  action: () => resumeItem(props.itemId)
})

const archive = () => run({
  ask: () => confirmArchive(item.value),
  action: () => archiveItem(props.itemId)
})

const restore = () => run({
  ask: () => confirmRestore(item.value),
  action: () => restoreItem(props.itemId)
})

const remove = async () => {
  if (!(await confirmDelete(item.value))) return
  busy.value = true
  error.value = null
  try {
    await deleteItem({ id: props.itemId, confirm: props.itemId })
    emit('deleted')
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="manage">
    <p v-if="error" class="banner bad" role="alert">{{ error }}</p>
    <div v-if="!isArchived" class="manage-block">
      <h3>Pause</h3>
      <p v-if="status === 'paused'" class="small">
        Paused<template v-if="pausedUntil">
          until {{ formatPausedUntil(pausedUntil) }}</template>. No scheduled checks run.
      </p>
      <p v-else class="small muted">Active. Scheduled checks run as set under How often.</p>
      <div class="input-row">
        <button
          v-if="status === 'paused'"
          class="btn"
          type="button"
          :disabled="busy"
          @click="resume"
        >
          Resume now
        </button>
        <button v-else class="btn secondary" type="button" :disabled="busy" @click="pauseNow">
          Pause now
        </button>
      </div>
      <div class="field">
        <label for="pause-until">Pause until a date</label>
        <div class="input-row">
          <input id="pause-until" v-model="resumeOn" type="date" :min="today" />
          <button
            class="btn secondary"
            type="button"
            :disabled="busy || !resumeOn"
            @click="pauseUntil"
          >
            Pause until then
          </button>
        </div>
        <p class="hint">Checks start again at midnight {{ timeZoneLabel() }} on that day.</p>
      </div>
    </div>
    <div class="manage-block">
      <h3>Finish with this item</h3>
      <template v-if="!isArchived">
        <p class="small muted">
          Archive stops all checks and hides the item from the list. Its price history stays, and
          you can restore it.
        </p>
        <button class="btn secondary" type="button" :disabled="busy" @click="archive">
          Archive
        </button>
        <p class="small muted">Delete is only available after you archive.</p>
      </template>
      <template v-else>
        <p class="small">Archived. No checks run. The price history stays.</p>
        <button class="btn" type="button" :disabled="busy" @click="restore">Restore</button>
        <div class="danger-zone">
          <h4>Delete</h4>
          <p class="small">
            Delete removes the item, every version, and all its runs, prices, and alerts. This
            cannot be undone. If the item came from a repo file, that file is not imported again.
          </p>
          <button class="btn danger" type="button" :disabled="busy" @click="remove">
            Delete item and history
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
