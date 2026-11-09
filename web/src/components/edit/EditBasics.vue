<script setup>
import { computed } from 'vue'
import { useInvalid } from '../../formContext.js'
import { confirmNewTopic } from '../../confirmCopy.js'
import { generateTopic } from '../../itemForm.js'
import FieldError from './FieldError.vue'

const props = defineProps({
  config: { type: Object, required: true },
  original: { type: Object, required: true }
})

const invalid = useInvalid()

const topicChanged = computed(() => props.config.ntfy.topic !== props.original.ntfy?.topic)

const newTopic = async () => {
  if (!(await confirmNewTopic())) return
  props.config.ntfy.topic = generateTopic(props.original.ntfy?.topic)
}
</script>

<template>
  <div class="edit-fields">
    <div class="field">
      <label for="edit-name">Name</label>
      <input id="edit-name" v-model="config.name" type="text" :aria-invalid="invalid('name')" />
      <FieldError path="name" />
    </div>
    <div class="field">
      <label for="edit-topic">ntfy topic</label>
      <div class="input-row">
        <input
          id="edit-topic"
          v-model.trim="config.ntfy.topic"
          class="num"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="invalid('ntfy.topic')"
        />
        <button class="btn secondary" type="button" @click="newTopic">Generate new topic</button>
      </div>
      <p class="hint">
        Anyone who knows the topic can read the alerts, so keep the random part.
      </p>
      <p v-if="topicChanged" class="banner">
        Phones subscribed to the old topic stop getting alerts. After you save, subscribe to the
        new topic in the ntfy app.
      </p>
      <FieldError path="ntfy.topic" />
    </div>
    <div class="field">
      <label for="edit-server">ntfy server</label>
      <input
        id="edit-server"
        v-model.trim="config.ntfy.server"
        type="url"
        :aria-invalid="invalid('ntfy.server')"
      />
      <FieldError path="ntfy.server" />
    </div>
  </div>
</template>
