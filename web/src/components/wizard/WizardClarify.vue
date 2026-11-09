<script setup>
import { computed, reactive, ref } from 'vue'
import { answerDraft } from '../../api.js'
import StepBar from './StepBar.vue'
import WizardActions from './WizardActions.vue'

const props = defineProps({ draft: { type: Object, required: true } })

const emit = defineEmits(['updated', 'cancel'])

const round = computed(() => props.draft.questions.at(-1))
const isSecondRound = computed(() => props.draft.questions.length > 1)

const recommendedOf = (question) => {
  const recommended = question.choices.find((choice) => choice.recommended)
  return recommended ? [recommended.id] : []
}

const picks = reactive(Object.fromEntries(round.value.questions.map((question) => [
  question.id,
  question.multi ? [] : recommendedOf(question)
])))
const others = reactive({})
const otherOpen = reactive({})
const busy = ref(false)
const error = ref(null)

const rankOf = ({ question, choice }) => {
  const index = picks[question.id].indexOf(choice.id)
  return index === -1 ? null : index + 1
}

const toggle = ({ question, choice }) => {
  const current = picks[question.id]
  if (!question.multi) {
    picks[question.id] = current[0] === choice.id ? [] : [choice.id]
    return
  }
  picks[question.id] = current.includes(choice.id)
    ? current.filter((id) => id !== choice.id)
    : [...current, choice.id]
}

const submit = async () => {
  busy.value = true
  error.value = null
  try {
    const answers = round.value.questions.map((question) => ({
      questionId: question.id,
      choiceIds: picks[question.id],
      other: otherOpen[question.id] ? (others[question.id] ?? '').trim() : ''
    }))
    emit('updated', await answerDraft({ id: props.draft.id, answers }))
  } catch (failure) {
    error.value = failure.message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="wizard-screen">
    <StepBar :filled="2" label="Step 2 of 5 · Clarify" />
    <h1 class="wizard-title">
      {{ isSecondRound ? 'A couple more questions' : 'A few quick questions' }}
    </h1>
    <p v-if="draft.research?.understood" class="lead">{{ draft.research.understood }}</p>
    <fieldset
      v-for="(question, number) in round.questions"
      :key="question.id"
      class="question"
    >
      <legend class="question-text">{{ number + 1 }}. {{ question.text }}</legend>
      <p v-if="question.multi" class="hint">
        Tap in order of preference. Pick as many as you like.
      </p>
      <button
        v-for="choice in question.choices"
        :key="choice.id"
        class="choice"
        :class="{ square: question.multi }"
        type="button"
        :role="question.multi ? 'checkbox' : 'radio'"
        :aria-checked="picks[question.id].includes(choice.id)"
        @click="toggle({ question, choice })"
      >
        <span class="mark" aria-hidden="true">
          {{ question.multi ? rankOf({ question, choice }) : '' }}
        </span>
        <span class="choice-label">{{ choice.label }}</span>
        <span v-if="choice.detail || choice.recommended" class="choice-detail">
          <template v-if="choice.recommended">Recommended. </template>{{ choice.detail }}
        </span>
      </button>
      <button
        v-if="!otherOpen[question.id]"
        class="btn link start"
        type="button"
        @click="otherOpen[question.id] = true"
      >
        Other answer (type or speak)
      </button>
      <div v-else class="field">
        <label :for="`other-${question.id}`">Your answer</label>
        <input
          :id="`other-${question.id}`"
          v-model="others[question.id]"
          type="text"
          maxlength="300"
        />
      </div>
      <p
        v-if="!picks[question.id].length && !(otherOpen[question.id] && others[question.id])"
        class="hint"
      >
        No choice means not fussed.
      </p>
    </fieldset>
    <p v-if="error" class="banner bad" role="alert">{{ error }}</p>
    <WizardActions>
      <button class="btn secondary" type="button" :disabled="busy" @click="emit('cancel')">
        Discard
      </button>
      <button class="btn" type="button" :disabled="busy" @click="submit">
        {{ busy ? 'Sending...' : 'Research these' }}
      </button>
    </WizardActions>
  </section>
</template>
