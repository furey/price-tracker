<script setup>
import { useInvalid } from '../../formContext.js'
import { setNumber } from '../../itemForm.js'
import FieldError from './FieldError.vue'

const props = defineProps({ config: { type: Object, required: true } })

const invalid = useInvalid()

const research = () => {
  props.config.research ??= {}
  return props.config.research
}

const setResearchNumber = ({ key, value }) => setNumber({ target: research(), key, value })

const setModel = (value) => {
  research().model = value.trim() || null
}
</script>

<template>
  <div class="edit-grid">
    <div class="field">
      <label for="edit-max-turns">Max turns</label>
      <input
        id="edit-max-turns"
        class="num"
        type="number"
        min="1"
        max="500"
        step="5"
        placeholder="80"
        :value="config.research?.maxTurns ?? ''"
        :aria-invalid="invalid('research.maxTurns')"
        @input="setResearchNumber({ key: 'maxTurns', value: $event.target.value })"
      />
      <p class="hint">How many search and page steps one AI run may take. Blank uses 80.</p>
      <FieldError path="research.maxTurns" />
    </div>
    <div class="field">
      <label for="edit-timeout">Timeout in minutes</label>
      <input
        id="edit-timeout"
        class="num"
        type="number"
        min="1"
        max="120"
        placeholder="15"
        :value="config.research?.timeoutMinutes ?? ''"
        :aria-invalid="invalid('research.timeoutMinutes')"
        @input="setResearchNumber({ key: 'timeoutMinutes', value: $event.target.value })"
      />
      <p class="hint">The run stops after this long. Blank uses 15.</p>
      <FieldError path="research.timeoutMinutes" />
    </div>
    <div class="field">
      <label for="edit-model">Model</label>
      <input
        id="edit-model"
        class="num"
        type="text"
        spellcheck="false"
        placeholder="Default"
        :value="config.research?.model ?? ''"
        :aria-invalid="invalid('research.model')"
        @input="setModel($event.target.value)"
      />
      <p class="hint">Blank uses the Claude Code default model.</p>
      <FieldError path="research.model" />
    </div>
  </div>
</template>
