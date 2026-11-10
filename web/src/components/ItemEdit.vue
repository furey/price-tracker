<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { getItemConfig, saveItemConfig } from '../api.js'
import { pauseLabel } from '../format.js'
import { provideForm } from '../formContext.js'
import { confirmRestoreVersion } from '../confirmCopy.js'
import { restoreVersionConfig } from '../../../src/tuning.js'
import { describeChanges } from '../itemDiff.js'
import { SECTIONS, fromDraft, sectionOf, toDraft, validateDraft } from '../itemForm.js'
import ChangeSummary from './edit/ChangeSummary.vue'
import EditAdvanced from './edit/EditAdvanced.vue'
import EditAlertPrices from './edit/EditAlertPrices.vue'
import EditBasics from './edit/EditBasics.vue'
import EditDirect from './edit/EditDirect.vue'
import EditKits from './edit/EditKits.vue'
import EditLookFor from './edit/EditLookFor.vue'
import EditSchedules from './edit/EditSchedules.vue'
import EditSources from './edit/EditSources.vue'
import ManageCard from './edit/ManageCard.vue'
import SectionErrors from './edit/SectionErrors.vue'
import VersionsCard from './edit/VersionsCard.vue'

const props = defineProps({ itemId: { type: String, required: true } })

const loading = ref(true)
const loadError = ref(null)
const notFound = ref(false)
const original = ref(null)
const baseVersion = ref(0)
const versions = ref([])
const lowest = ref({})
const status = reactive({ status: 'active', pausedUntil: null })
const draft = ref(null)
const renames = reactive({})
const attempted = ref(false)
const serverErrors = ref([])
const reviewing = ref(false)
const saving = ref(false)
const note = ref('')
const notice = ref(null)
const conflict = ref(null)

const detailHref = computed(() => `#/item/${encodeURIComponent(props.itemId)}`)

const edited = computed(() => (draft.value
  ? fromDraft({ draft: draft.value, original: original.value })
  : null))

const clientErrors = computed(() => (draft.value
  ? validateDraft({ draft: draft.value, original: original.value })
  : []))

const errors = computed(() => [
  ...(attempted.value ? clientErrors.value : []),
  ...serverErrors.value.filter((error) => !clientErrors.value.includes(error))
])

const changes = computed(() => (edited.value
  ? describeChanges({ before: original.value, after: edited.value, renames })
  : []))

const dirty = computed(() => Boolean(edited.value)
  && canonical(edited.value) !== canonical(original.value))

const visibleSections = computed(() => SECTIONS.filter((section) =>
  section.id !== 'kits' || (edited.value?.kits ?? []).length > 0))

const navSections = computed(() => [
  ...visibleSections.value,
  { id: 'versions', label: 'Versions' },
  { id: 'manage', label: 'Manage' }
])

const changeCountText = computed(() => {
  if (changes.value.length === 0) return 'Unsaved changes'
  return changes.value.length === 1
    ? 'One change not saved'
    : `${changes.value.length} changes not saved`
})

const errorSections = computed(() => [...new Set(errors.value.map(sectionOf))])

provideForm({ errors })

const load = async () => {
  loading.value = true
  loadError.value = null
  try {
    applyLoaded(await getItemConfig(props.itemId))
  } catch (error) {
    notFound.value = error.status === 404
    loadError.value = error.message
  } finally {
    loading.value = false
  }
}

const scrollToHashSection = async () => {
  const section = /\/edit\/([a-z-]+)/.exec(window.location.hash)?.[1]
  if (!section) return
  await nextTick()
  scrollToSection(section)
}

const applyLoaded = (body) => {
  original.value = body.config
  baseVersion.value = body.version
  versions.value = body.versions
  lowest.value = body.lowestByCategory ?? {}
  status.status = body.status
  status.pausedUntil = body.pausedUntil
  resetDraft()
}

const resetDraft = () => {
  draft.value = reactive(toDraft(original.value))
  Object.keys(renames).forEach((key) => delete renames[key])
  attempted.value = false
  serverErrors.value = []
  note.value = ''
}

const review = async () => {
  attempted.value = true
  notice.value = null
  if (clientErrors.value.length > 0) {
    await nextTick()
    document.querySelector('.field-error, .section-errors')?.scrollIntoView({ block: 'center' })
    return
  }
  reviewing.value = true
}

const save = async () => submit({ config: edited.value, noteText: note.value })

const restoreVersion = async ({ version, config }) => {
  if (dirty.value) {
    notice.value = {
      tone: 'warn',
      text: 'Save or discard your unsaved changes before restoring a version.'
    }
    return
  }
  const tuningDiffers = canonical(config.tuning ?? null)
    !== canonical(original.value.tuning ?? null)
  const answer = await confirmRestoreVersion({
    version, nextVersion: baseVersion.value + 1, tuningDiffers
  })
  if (!answer) return
  const restoreTuning = answer.toggle === true
  await submit({
    config: restoreVersionConfig({
      oldConfig: config, currentConfig: original.value, restoreTuning
    }),
    noteText: restoreTuning
      ? `Restored version ${version} with its tuning`
      : `Restored version ${version}, kept current tuning`
  })
}

const submit = async ({ config, noteText }) => {
  saving.value = true
  serverErrors.value = []
  try {
    const body = await saveItemConfig({
      id: props.itemId, baseVersion: baseVersion.value, config, note: noteText
    })
    original.value = body.config
    baseVersion.value = body.version
    versions.value = body.versions
    resetDraft()
    reviewing.value = false
    notice.value = { tone: 'good', text: `Saved as version ${body.version}.` }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (error) {
    reviewing.value = false
    handleSaveError(error)
  } finally {
    saving.value = false
  }
}

const handleSaveError = (error) => {
  if (error.status === 409) {
    conflict.value = error.message
    return
  }
  serverErrors.value = error.errors ?? []
  notice.value = { tone: 'bad', text: error.message }
}

const reloadLatest = async () => {
  conflict.value = null
  notice.value = null
  await load()
}

const discard = () => {
  resetDraft()
  notice.value = null
}

const applyStatus = (record) => {
  status.status = record.status
  status.pausedUntil = record.pausedUntil
}

const afterDelete = () => {
  window.location.hash = '#/'
}

const scrollToSection = (id) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const warnBeforeLeaving = (event) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

const canonical = (value) => JSON.stringify(sortKeys(value))

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]))
}

onMounted(() => {
  load().then(scrollToHashSection)
  window.addEventListener('beforeunload', warnBeforeLeaving)
})

onUnmounted(() => window.removeEventListener('beforeunload', warnBeforeLeaving))
</script>

<template>
  <main class="edit-page">
    <p v-if="loading && !draft" class="muted">Loading...</p>

    <div v-else-if="loadError && !draft" class="empty">
      <h2>{{ notFound ? 'Item not found' : 'Cannot load this item' }}</h2>
      <p>{{ loadError }}</p>
      <a class="btn secondary back" href="#/">Back to Items</a>
    </div>

    <template v-else-if="draft">
      <header class="edit-head">
        <div>
          <p class="crumbs">
            <a class="crumb" href="#/">Items</a>
            <span class="muted" aria-hidden="true">/</span>
            <a class="crumb" :href="detailHref">{{ original.name }}</a>
          </p>
          <h1>Edit item</h1>
          <p class="muted ids">
            <span class="num">{{ itemId }}</span>
            <span class="num">version {{ baseVersion }}</span>
            <span v-if="pauseLabel(status)" class="pill" :class="status.status">
              {{ pauseLabel(status) }}
            </span>
          </p>
        </div>
      </header>

      <div v-if="conflict" class="banner bad conflict" role="alert">
        <p>{{ conflict }} Your unsaved changes are still on this page.</p>
        <button class="btn small" type="button" @click="reloadLatest">
          Reload latest (discards my changes)
        </button>
      </div>
      <p v-if="notice" class="banner" :class="notice.tone" role="status">{{ notice.text }}</p>
      <div v-if="errors.length" class="banner bad" role="alert">
        Fix {{ errors.length === 1 ? 'one problem' : `${errors.length} problems` }} before
        saving, in {{ errorSections.join(', ') }}.
      </div>

      <nav class="section-nav chips" aria-label="Edit sections">
        <button
          v-for="section in navSections"
          :key="section.id"
          class="chip"
          type="button"
          @click="scrollToSection(section.id)"
        >
          {{ section.label }}
        </button>
      </nav>

      <section id="basics" class="card edit-card">
        <h2>Basics</h2>
        <SectionErrors :prefixes="['id', 'name', 'ntfy']" />
        <EditBasics :config="draft.config" :original="original" />
      </section>

      <section id="how-often" class="card edit-card">
        <h2>How often</h2>
        <SectionErrors :prefixes="['schedules', 'directSchedules']" />
        <EditSchedules
          v-model:off="draft.researchOff"
          :rows="draft.scheduleRows"
          title="AI research"
          path="schedules"
          count-label="AI runs"
          off-text="Off: no AI research runs on a schedule. Run now still works."
        />
        <EditSchedules
          v-model:off="draft.directOff"
          :rows="draft.directScheduleRows"
          title="Free checks"
          path="directSchedules"
          count-label="free checks"
          off-text="Off: the free checks under Free checks do not run on a schedule."
        />
      </section>

      <section id="alert-prices" class="card edit-card">
        <h2>Alert prices</h2>
        <SectionErrors :prefixes="['rules', 'dedupe', 'heartbeat', 'deadline', 'unit']" />
        <EditAlertPrices :config="draft.config" :lowest="lowest" />
      </section>

      <section id="look-for" class="card edit-card">
        <h2>What to look for</h2>
        <SectionErrors :prefixes="['product', 'categories', 'accept']" />
        <EditLookFor :config="draft.config" :original="original" :renames="renames" />
      </section>

      <section id="look-where" class="card edit-card">
        <h2>Where to look</h2>
        <SectionErrors :prefixes="['sources']" />
        <EditSources :config="draft.config" />
      </section>

      <section id="free-checks" class="card edit-card">
        <h2>Free checks</h2>
        <SectionErrors :prefixes="['direct']" />
        <EditDirect :config="draft.config" :item-id="itemId" />
      </section>

      <section v-if="(draft.config.kits ?? []).length" id="kits" class="card edit-card">
        <h2>Kits</h2>
        <SectionErrors :prefixes="['kits']" />
        <EditKits :config="draft.config" />
      </section>

      <section id="advanced" class="card edit-card">
        <h2>Advanced</h2>
        <SectionErrors :prefixes="['research']" />
        <EditAdvanced :config="draft.config" />
      </section>

      <section id="versions" class="card edit-card">
        <h2>Versions</h2>
        <VersionsCard
          :item-id="itemId"
          :versions="versions"
          :current-version="baseVersion"
          :busy="saving"
          @restore="restoreVersion"
        />
      </section>

      <section id="manage" class="card edit-card">
        <h2>Manage</h2>
        <ManageCard
          :item-id="itemId"
          :name="original.name"
          :status="status.status"
          :paused-until="status.pausedUntil"
          @changed="applyStatus"
          @deleted="afterDelete"
        />
      </section>

      <div class="save-bar" :class="{ active: dirty }">
        <p class="small">
          {{ dirty ? changeCountText : 'No unsaved changes' }}
        </p>
        <div class="save-actions">
          <button class="btn secondary" type="button" :disabled="!dirty" @click="discard">
            Discard
          </button>
          <button class="btn" type="button" :disabled="!dirty || saving" @click="review">
            Save changes
          </button>
        </div>
      </div>

      <ChangeSummary
        v-if="reviewing"
        v-model:note="note"
        :changes="changes"
        :next-version="baseVersion + 1"
        :saving="saving"
        @confirm="save"
        @cancel="reviewing = false"
      />
    </template>
  </main>
</template>
