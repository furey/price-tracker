<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { validateItem } from '../../../src/item-validate.js'
import {
  cancelDraft, getDraft, retryDraft, runDraftAnyway, saveDraft, saveDraftConfig
} from '../api.js'
import { aiUsage, claudeDisconnected, loadAiUsage } from '../aiState.js'
import { confirmDiscardDraft, confirmDraftAnyway, confirmSaveItem } from '../confirmCopy.js'
import { provideForm } from '../formContext.js'
import { regionTimeZone } from '../schedulePresets.js'
import {
  FLOW_STEPS, POLL_MS, REVIEW_STEPS, cloneJson, draftName, isBusy, progressFor, sameJson
} from '../wizard.js'
import AiChangeSheet from './wizard/AiChangeSheet.vue'
import HandItemForm from './wizard/HandItemForm.vue'
import ReviewModels from './wizard/ReviewModels.vue'
import ReviewPrices from './wizard/ReviewPrices.vue'
import ReviewSchedule from './wizard/ReviewSchedule.vue'
import ReviewSources from './wizard/ReviewSources.vue'
import StepBar from './wizard/StepBar.vue'
import WizardActions from './wizard/WizardActions.vue'
import WizardClarify from './wizard/WizardClarify.vue'
import WizardDescribe from './wizard/WizardDescribe.vue'
import WizardSave from './wizard/WizardSave.vue'
import WizardStopped from './wizard/WizardStopped.vue'
import WizardTest from './wizard/WizardTest.vue'
import WizardWorking from './wizard/WizardWorking.vue'

const props = defineProps({
  draftId: { type: String, default: null },
  step: { type: String, default: null }
})

const SCREEN_TITLES = {
  models: 'Check the models',
  prices: 'When should we alert you?',
  sources: 'Where to look',
  schedule: 'How often to check',
  test: 'Would it alert today?',
  save: 'Save the item'
}

const draft = ref(null)
const config = ref(null)
const serverConfig = ref(null)
const preset = ref('normal')
const loading = ref(Boolean(props.draftId))
const loadError = ref(null)
const busy = ref(false)
const notice = ref(null)
const changeOpen = ref(false)
const saveResult = ref(null)
const now = ref(Date.now())
const usageChecked = ref(aiUsage.value !== null)
let pollTimer = null
let clockTimer = null

const errors = computed(() => (config.value ? validateItem(normalised(config.value)) : []))

provideForm({ errors })

const currentStep = computed(() => (FLOW_STEPS.includes(props.step) ? props.step : 'models'))

const inReview = computed(() => ['review', 'testing'].includes(draft.value?.status))

const progress = computed(() => progressFor({ status: 'review', step: currentStep.value }))

const dirty = computed(() => Boolean(config.value) && !sameJson(config.value, serverConfig.value))

const changeRunning = computed(() =>
  ['queued', 'running'].includes(draft.value?.pendingChange?.state))

const changeReady = computed(() => draft.value?.pendingChange?.state === 'ready')

const stepIndex = computed(() => FLOW_STEPS.indexOf(currentStep.value))

const normalised = (value) => {
  const result = cloneJson(value)
  if ((result.direct ?? []).length > 0 && !(result.directSchedules ?? []).length) {
    const until = draft.value?.research?.endDate
    result.directSchedules = [{ cron: '30 7,19 * * *', tz: regionTimeZone(),
      ...(until ? { until } : {}) }]
  }
  return result
}

const applyDraft = (next, { replace = false } = {}) => {
  draft.value = next
  if (!next.config) return
  const changedOnServer = !sameJson(next.config, serverConfig.value)
  if (!config.value || replace || (changedOnServer && !dirty.value)) {
    config.value = reactive(cloneJson(next.config))
  }
  serverConfig.value = cloneJson(next.config)
  preset.value = next.research?.schedulePreset ?? preset.value
}

const load = async () => {
  if (!props.draftId) return
  try {
    applyDraft(await getDraft(props.draftId))
    loadError.value = null
  } catch (error) {
    loadError.value = error.message
  } finally {
    loading.value = false
  }
}

const persist = async () => {
  if (!dirty.value || !inReview.value) return
  const body = await saveDraftConfig({
    id: draft.value.id, config: normalised(config.value), preset: preset.value
  })
  serverConfig.value = cloneJson(config.value)
  draft.value = body
}

const goTo = async (step) => {
  notice.value = null
  try {
    await persist()
  } catch (error) {
    notice.value = error.message
    return
  }
  window.location.hash = `#/new/${draft.value.id}/${step}`
  window.scrollTo({ top: 0 })
}

const next = () => goTo(FLOW_STEPS[stepIndex.value + 1])

const back = () => goTo(FLOW_STEPS[Math.max(0, stepIndex.value - 1)])

const created = (newDraft) => {
  window.location.hash = `#/new/${newDraft.id}`
}

const act = async (action) => {
  busy.value = true
  notice.value = null
  try {
    applyDraft(await action(), { replace: true })
  } catch (error) {
    notice.value = error.message
  } finally {
    busy.value = false
  }
}

const runAnyway = async () => {
  await loadAiUsage().catch(() => null)
  const confirmed = await confirmDraftAnyway({
    guardMessage: draft.value.claudeGuard?.message, weekly: aiUsage.value?.weekly ?? null
  })
  if (confirmed) await act(() => runDraftAnyway(draft.value.id))
}

const cancel = async () => {
  if (!(await confirmDiscardDraft({ name: draftName(draft.value) }))) return
  await act(() => cancelDraft(draft.value.id))
  window.location.hash = '#/'
}

const dismiss = () => act(() => cancelDraft(draft.value.id)).then(() => {
  window.location.hash = '#/'
})

const retry = (separate = false) => act(() => retryDraft({ id: draft.value.id, separate }))

const save = async () => {
  if (!(await confirmSaveItem({ name: config.value.name }))) return
  busy.value = true
  notice.value = null
  try {
    saveResult.value = await saveDraft({ id: draft.value.id, config: normalised(config.value) })
    applyDraft(await getDraft(draft.value.id), { replace: true })
  } catch (error) {
    notice.value = error.message
  } finally {
    busy.value = false
  }
}

const updated = (body, options) => applyDraft(body, options)

const warnBeforeLeaving = (event) => {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

watch(() => props.draftId, () => {
  draft.value = null
  config.value = null
  serverConfig.value = null
  loading.value = Boolean(props.draftId)
  load()
})

onMounted(() => {
  load()
  loadAiUsage().catch(() => null).finally(() => { usageChecked.value = true })
  pollTimer = setInterval(() => {
    if (isBusy(draft.value) || changeRunning.value) load()
  }, POLL_MS)
  clockTimer = setInterval(() => { now.value = Date.now() }, 15000)
  window.addEventListener('beforeunload', warnBeforeLeaving)
})

onUnmounted(() => {
  clearInterval(pollTimer)
  clearInterval(clockTimer)
  window.removeEventListener('beforeunload', warnBeforeLeaving)
})
</script>

<template>
  <main class="wizard">
    <template v-if="!draftId">
      <p v-if="!usageChecked" class="muted">Loading...</p>
      <HandItemForm
        v-else-if="step === 'hand' || claudeDisconnected"
        :needs-claude="claudeDisconnected"
      />
      <WizardDescribe v-else @created="created" />
    </template>

    <p v-else-if="loading" class="muted">Loading the draft...</p>

    <div v-else-if="loadError && !draft" class="empty">
      <h2>Cannot load this draft</h2>
      <p>{{ loadError }}</p>
      <a class="btn secondary" href="#/">Back to Items</a>
    </div>

    <template v-else-if="draft">
      <p v-if="notice" class="banner bad" role="alert">{{ notice }}</p>
      <div v-if="draft.claudeGuard" class="banner guard-banner" role="status">
        <p>{{ draft.claudeGuard.message }}</p>
        <button class="btn small" type="button" :disabled="busy" @click="runAnyway">
          Run anyway
        </button>
      </div>

      <WizardWorking
        v-if="['scoping', 'researching'].includes(draft.status)"
        :draft="draft"
        :now="now"
        :busy="busy"
        @cancel="cancel"
      />

      <WizardClarify
        v-else-if="draft.status === 'clarifying'"
        :key="draft.questions.length"
        :draft="draft"
        @updated="updated"
        @cancel="cancel"
      />

      <WizardStopped
        v-else-if="draft.status === 'failed'"
        :draft="draft"
        :busy="busy"
        @retry="retry(false)"
        @separate="retry(true)"
        @dismiss="dismiss"
      />

      <section v-else-if="draft.status === 'cancelled'" class="empty">
        <h2>Draft discarded</h2>
        <a class="btn secondary" href="#/">Back to Items</a>
      </section>

      <section v-else-if="draft.status === 'saved' && config" class="wizard-screen">
        <h1 class="wizard-title">{{ config.name }} is saved</h1>
        <WizardSave :draft="draft" :config="config" :result="saveResult" />
      </section>

      <section v-else-if="inReview && config" class="wizard-screen">
        <StepBar :filled="progress.filled" :label="progress.label" />
        <div class="row-between wrap">
          <h1 class="wizard-title">{{ SCREEN_TITLES[currentStep] }}</h1>
          <a class="crumb" href="#/" @click="persist">Save for later</a>
        </div>
        <p v-if="currentStep === 'models'" class="lead">
          {{ draft.research?.understood ?? `Draft for ${draftName(draft)}.` }}
        </p>
        <p v-if="changeRunning" class="banner info">
          Claude is applying your change. It shows here for approval when ready.
        </p>
        <button
          v-if="changeReady && !changeOpen"
          class="banner info banner-button"
          type="button"
          @click="changeOpen = true"
        >
          Your change is ready. Review it.
        </button>

        <ReviewModels
          v-if="currentStep === 'models'"
          :config="config"
          :research="draft.research ?? {}"
        />
        <ReviewPrices
          v-else-if="currentStep === 'prices'"
          :config="config"
          :research="draft.research ?? {}"
          :input="draft.input"
        />
        <ReviewSources
          v-else-if="currentStep === 'sources'"
          :config="config"
          :research="draft.research ?? {}"
          :draft-id="draft.id"
        />
        <ReviewSchedule
          v-else-if="currentStep === 'schedule'"
          v-model:preset="preset"
          :config="config"
          :draft="draft"
        />
        <WizardTest
          v-else-if="currentStep === 'test'"
          :draft="draft"
          :config="normalised(config)"
          :per-run-minutes="draft.usage.perRun.minutes"
          @updated="updated"
        />
        <WizardSave v-else :draft="draft" :config="config" :result="saveResult" />

        <ul
          v-if="errors.length && ['test', 'save'].includes(currentStep)"
          class="banner bad error-list"
          role="alert"
        >
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>

        <WizardActions>
          <button
            v-if="stepIndex > 0"
            class="btn secondary"
            type="button"
            :disabled="busy"
            @click="back"
          >
            Back
          </button>
          <button
            v-if="REVIEW_STEPS.includes(currentStep)"
            class="btn secondary full-row"
            type="button"
            :disabled="busy || draft.status === 'testing'"
            @click="changeOpen = true"
          >
            Ask AI to change
          </button>
          <button
            v-if="currentStep !== 'save'"
            class="btn"
            type="button"
            :disabled="busy"
            @click="next"
          >
            {{ currentStep === 'schedule' ? 'Next: test' : 'Next' }}
          </button>
          <button
            v-else
            class="btn"
            type="button"
            :disabled="busy || errors.length > 0 || draft.status !== 'review'"
            @click="save"
          >
            {{ busy ? 'Saving...' : 'Save item' }}
          </button>
        </WizardActions>

        <AiChangeSheet
          v-if="changeOpen"
          :draft="draft"
          :config="config"
          @updated="updated"
          @close="changeOpen = false"
        />
      </section>
    </template>
  </main>
</template>
