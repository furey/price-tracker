<script setup>
import { useFieldErrors } from '../../formContext.js'

const props = defineProps({ path: { type: String, required: true } })

const messages = useFieldErrors(() => props.path)
</script>

<template>
  <p v-for="message in messages" :key="message" class="field-error" role="alert">
    {{ message }}
  </p>
</template>
