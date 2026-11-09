<script setup>
import { useSectionErrors } from '../../formContext.js'

const props = defineProps({ prefixes: { type: Array, required: true } })

const errors = useSectionErrors(props.prefixes)
</script>

<template>
  <ul v-if="errors.length" class="section-errors" role="alert">
    <li v-for="error in errors" :key="error">{{ error }}</li>
  </ul>
</template>
