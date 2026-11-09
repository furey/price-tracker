<script setup>
import { ref } from 'vue'
import { login } from '../api.js'
import BrandMark from './BrandMark.vue'

const emit = defineEmits(['signed-in'])

const password = ref('')
const error = ref('')
const submitting = ref(false)

const submit = async () => {
  if (!password.value) {
    error.value = 'Enter your password.'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    await login(password.value)
    password.value = ''
    emit('signed-in')
  } catch (failure) {
    error.value = failure.message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <form class="card login-card" novalidate @submit.prevent="submit">
      <header class="login-head">
        <BrandMark class="login-mark" />
        <h1>Price Tracker</h1>
        <p class="muted">Deal tracker for your saved products.</p>
      </header>
      <div class="field">
        <label for="login-password">Password</label>
        <input
          id="login-password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :aria-invalid="error ? 'true' : 'false'"
          :aria-describedby="error ? 'login-error' : undefined"
          autofocus
          @input="error = ''"
        />
        <p v-if="error" id="login-error" class="field-error" role="alert">{{ error }}</p>
      </div>
      <button class="btn login-submit" type="submit" :disabled="submitting">
        {{ submitting ? 'Signing in...' : 'Sign in' }}
      </button>
    </form>
  </main>
</template>
