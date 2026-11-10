<script setup>
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import { parseSweepReply, sweepPrompt } from '../../../src/sweep.js'
import { getSweep, recordObservations } from '../api.js'
import { copyText } from '../clipboard.js'
import AppIcon from './AppIcon.vue'
import ModalSheet from './ModalSheet.vue'

const COPIED_MS = 2000

const sweep = ref({ items: [], labels: undefined })
const copied = ref(false)
const problem = ref(null)
const recording = ref(false)
const reply = ref('')
const busy = ref(false)
const outcomes = ref([])
const headingId = useId()
const replyId = useId()
let resetTimer = null

const pageCount = computed(() => sweep.value.items
  .reduce((total, { sources }) => total + sources.length, 0))

const itemNames = computed(() => new Map(sweep.value.items
  .map(({ itemId, itemName }) => [itemId, itemName])))

const load = async () => {
  try {
    sweep.value = await getSweep()
  } catch {
    sweep.value = { items: [], labels: undefined }
  }
}

const copyPrompt = async () => {
  problem.value = null
  const prompt = sweepPrompt({ items: sweep.value.items, labels: sweep.value.labels })
  if (!await copyText(prompt)) {
    problem.value = 'Copy failed. Run the sweep command instead.'
    return
  }
  copied.value = true
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => { copied.value = false }, COPIED_MS)
}

const openRecording = () => {
  reply.value = ''
  outcomes.value = []
  recording.value = true
}

const closeRecording = async () => {
  recording.value = false
  if (outcomes.value.some(({ ok }) => ok)) await load()
}

const record = async () => {
  busy.value = true
  const { results, problems } = parseSweepReply(reply.value)
  const recorded = []
  for (const { itemId, data } of results) recorded.push(await recordOne({ itemId, data }))
  outcomes.value = [...problems.map((text) => ({ ok: false, text })), ...recorded]
  busy.value = false
}

const recordOne = async ({ itemId, data }) => {
  const name = itemNames.value.get(itemId) ?? itemId
  try {
    const { listingCount, qualifiedCount } = await recordObservations({ id: itemId, data })
    const text = `${name}: recorded ${listingCount} listings, ${qualifiedCount} qualify.`
    return { ok: true, text }
  } catch (error) {
    const detail = error.errors?.length ? ` ${error.errors.join('; ')}` : ''
    return { ok: false, text: `${name}: ${error.message}${detail}` }
  }
}

onMounted(load)
onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <section v-if="sweep.items.length" class="sweep card" :aria-labelledby="headingId">
    <div class="sweep-head">
      <AppIcon name="globe" class="sweep-icon" />
      <h2 :id="headingId" class="sweep-title">Chrome sweep</h2>
    </div>
    <p class="sweep-lead muted">
      {{ pageCount }} blocked {{ pageCount === 1 ? 'page' : 'pages' }} can be checked in your own
      browser. Paste the prompt into Claude in Chrome, then paste its reply back here.
    </p>
    <div class="sweep-actions">
      <button class="btn secondary small" type="button" @click="copyPrompt">
        {{ copied ? 'Copied' : 'Copy prompt' }}
      </button>
      <button class="btn secondary small" type="button" @click="openRecording">
        Record results
      </button>
      <span v-if="problem" class="problem" role="alert">{{ problem }}</span>
    </div>
  </section>
  <ModalSheet v-if="recording" title="Record Chrome sweep results" @close="closeRecording">
    <div class="field">
      <label :for="replyId">Claude in Chrome reply</label>
      <textarea
        :id="replyId"
        v-model="reply"
        class="reply"
        rows="10"
        spellcheck="false"
        placeholder="Paste the whole reply, with its JSON blocks"
      />
    </div>
    <ul v-if="outcomes.length" class="outcomes" role="status">
      <li v-for="outcome in outcomes" :key="outcome.text" :class="outcome.ok ? 'good' : 'bad'">
        {{ outcome.text }}
      </li>
    </ul>
    <template #actions>
      <button class="btn secondary" type="button" @click="closeRecording">Close</button>
      <button class="btn" type="button" :disabled="busy || !reply.trim()" @click="record">
        Record
      </button>
    </template>
  </ModalSheet>
</template>

<style scoped>
.sweep {
  margin-top: var(--space-4);
  padding: var(--space-4);
}

.sweep-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.sweep-icon {
  flex: none;
  color: var(--accent);
}

.sweep-title {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.sweep-lead {
  margin: var(--space-2) 0 var(--space-3);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.sweep-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.field .reply {
  height: auto;
  min-height: 12rem;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  resize: vertical;
}

.outcomes {
  margin: var(--space-3) 0 0;
  padding-left: var(--space-4);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.outcomes .good {
  color: var(--ok);
}

.outcomes .bad {
  color: var(--bad);
}

.problem {
  color: var(--bad);
  font-size: var(--text-caption);
}
</style>
