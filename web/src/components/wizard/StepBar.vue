<script setup>
defineProps({
  filled: { type: Number, required: true },
  label: { type: String, required: true }
})
</script>

<template>
  <div class="step-bar">
    <div class="step-bars" aria-hidden="true">
      <i v-for="index in 5" :key="index" :class="{ on: index <= filled }" />
    </div>
    <p class="step-label">{{ label }}</p>
  </div>
</template>
