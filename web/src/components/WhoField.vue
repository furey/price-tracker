<script setup>
import { computed, onMounted, ref, useId } from 'vue'
import { MAX_WHO_LENGTH, WHO_CHOICES, loadWho, setWho, whoLabel } from '../who.js'

defineProps({ hint: { type: Boolean, default: true } })

const labelId = useId()
const inputId = useId()
const typing = ref(false)

const isCustom = computed(() => Boolean(whoLabel.value) && !WHO_CHOICES.includes(whoLabel.value))

const pick = (name) => {
  typing.value = false
  setWho(name)
}

const startTyping = () => {
  typing.value = true
}

onMounted(() => {
  if (!whoLabel.value) loadWho()
})
</script>

<template>
  <div class="who-field">
    <span :id="labelId" class="field-label">Changed by</span>
    <div class="chips" role="group" :aria-labelledby="labelId">
      <button
        v-for="name in WHO_CHOICES"
        :key="name"
        class="chip"
        :class="{ on: whoLabel === name }"
        type="button"
        :aria-pressed="whoLabel === name"
        @click="pick(name)"
      >
        {{ name }}
      </button>
      <button
        class="chip"
        :class="{ on: isCustom || typing }"
        type="button"
        :aria-pressed="isCustom || typing"
        @click="startTyping"
      >
        {{ isCustom ? whoLabel : 'Other' }}
      </button>
    </div>
    <div v-if="typing" class="who-input field">
      <label class="visually-hidden" :for="inputId">Your name</label>
      <input
        :id="inputId"
        type="text"
        :maxlength="MAX_WHO_LENGTH"
        :value="isCustom ? whoLabel : ''"
        placeholder="Your name"
        @change="setWho($event.target.value)"
      />
    </div>
    <p v-if="hint" class="hint">
      Shown beside each mute and feedback. Kept in this browser only.
    </p>
  </div>
</template>

<style scoped>
.who-field {
  display: grid;
  gap: var(--space-2);
}

.who-input input {
  width: 100%;
  max-width: 260px;
}

.hint {
  margin: 0;
}
</style>
