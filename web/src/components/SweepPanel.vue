<script setup>
import { computed, onMounted, onUnmounted, ref, useId } from 'vue'
import { parseSweepReply, sweepPrompt } from '../../../src/sweep.js'
import { getSweep, recordObservations, uploadScreenshot } from '../api.js'
import { copyText } from '../clipboard.js'
import { shrinkScreenshot } from '../screenshotImage.js'
import AppIcon from './AppIcon.vue'
import ModalSheet from './ModalSheet.vue'
import ScreenshotThumbs from './ScreenshotThumbs.vue'

const COPIED_MS = 2000
const SWEEP_GUIDE = 'https://furey.github.io/price-tracker/guide/chrome-observations#chrome-sweep'

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

const onPick = ({ outcome, event }) => {
  const files = [...event.target.files]
  event.target.value = ''
  addScreenshots({ outcome, files })
}

const addScreenshots = async ({ outcome, files }) => {
  for (const file of files) await uploadOne({ outcome, file })
}

const uploadOne = async ({ outcome, file }) => {
  outcome.uploads.push({ key: `${Date.now()}-${outcome.uploads.length}`, name: file.name,
    state: 'Shrinking' })
  const upload = outcome.uploads.at(-1)
  try {
    const blob = await shrinkScreenshot(file)
    upload.state = 'Uploading'
    const saved = await uploadScreenshot({ runId: outcome.runId, blob })
    upload.state = `Saved (${Math.ceil(saved.bytes / 1024)} KB)`
    outcome.screenshots.push({ id: saved.id })
  } catch (error) {
    upload.state = `Failed: ${error.message}`
    upload.failed = true
  }
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
    const { runId, listingCount, qualifiedCount } = await recordObservations({ id: itemId, data })
    const text = `${name}: recorded ${listingCount} listings, ${qualifiedCount} qualify.`
    return { ok: true, text, runId, name, uploads: [], screenshots: [] }
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
    <p class="sweep-needs muted">
      Needs the Claude in Chrome browser extension.
      <a :href="SWEEP_GUIDE" target="_blank" rel="noreferrer">How the sweep works</a>
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
        <div v-if="outcome.runId" class="shots">
          <div class="shot-actions">
            <label class="btn secondary small file-pick">
              Add screenshots
              <input
                type="file"
                accept="image/*"
                multiple
                class="visually-hidden"
                @change="onPick({ outcome, event: $event })"
              />
            </label>
          </div>
          <ul v-if="outcome.uploads.length" class="uploads">
            <li v-for="upload in outcome.uploads" :key="upload.key" :class="{ bad: upload.failed }">
              {{ upload.name || 'Image' }}: {{ upload.state }}
            </li>
          </ul>
          <ScreenshotThumbs
            :screenshots="outcome.screenshots"
            :label="`${outcome.name}, Chrome check`"
          />
        </div>
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
  margin: var(--space-2) 0 var(--space-1);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.sweep-needs {
  margin: 0 0 var(--space-3);
  font-size: var(--text-caption);
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

.shots {
  margin: var(--space-2) 0 var(--space-3);
  color: var(--ink);
}

.shot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.file-pick {
  cursor: pointer;
}

.file-pick:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.uploads {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-4);
  color: var(--ink-2);
  font-size: var(--text-caption);
}

.uploads .bad {
  color: var(--bad);
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
