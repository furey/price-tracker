<script setup>
import { computed, onMounted, onUnmounted, ref, watchEffect } from 'vue'
import { AUTH_REQUIRED_EVENT, getSession, logout } from './api.js'
import AppFooter from './components/AppFooter.vue'
import AppHeader from './components/AppHeader.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import LoginView from './components/LoginView.vue'
import ItemList from './components/ItemList.vue'
import ItemDetail from './components/ItemDetail.vue'
import ItemEdit from './components/ItemEdit.vue'
import NewItem from './components/NewItem.vue'
import SettingsView from './components/SettingsView.vue'
import { alertRoute, hashAfterLogin, legacyHashTarget } from './loginReturn.js'
import { configureRegion } from './format.js'

const redirectLegacyHash = () => {
  const target = legacyHashTarget(window.location.hash)
  if (target) window.history.replaceState(window.history.state, '', target)
}

redirectLegacyHash()

const hash = ref(window.location.hash)
const syncHash = () => {
  redirectLegacyHash()
  hash.value = window.location.hash
}

const itemId = computed(() => {
  const match = hash.value.match(/^#\/item\/([^/?]+)/)
  return match ? decodeURIComponent(match[1]) : null
})

const alertId = computed(() => alertRoute(hash.value)?.alertId ?? null)

const focus = computed(() => hash.value.match(/^#\/item\/[^/?]+\/(sources|tuning|runs)\b/)?.[1]
  ?? null)

const isEdit = computed(() => /^#\/item\/[^/?]+\/edit/.test(hash.value))

const isSettings = computed(() => hash.value.startsWith('#/settings'))

const newItem = computed(() => {
  const match = hash.value.match(/^#\/new(?:\/([0-9a-f]+))?(?:\/([a-z]+))?/)
  return match ? { draftId: match[1] ?? null, step: match[2] ?? null } : null
})

const section = computed(() => (isSettings.value ? 'settings' : 'items'))

const pageKey = computed(() => {
  if (isSettings.value) return 'settings'
  if (newItem.value) return `new-${newItem.value.draftId ?? 'new'}-${newItem.value.step ?? ''}`
  if (itemId.value && isEdit.value) return `edit-${itemId.value}`
  if (itemId.value) return `item-${itemId.value}-${alertId.value ?? ''}-${focus.value ?? ''}`
  return 'items'
})

const PAGE_TITLES = { items: 'Items', settings: 'Settings' }

watchEffect(() => {
  document.title = `${PAGE_TITLES[section.value]} · Price Tracker`
})

const authRequired = ref(false)
const authenticated = ref(true)
const sessionChecked = ref(false)

const arrivedWith = ref(window.location.hash)

const requireLogin = () => {
  if (authenticated.value) arrivedWith.value = window.location.hash
  authenticated.value = false
}

const signedIn = () => {
  authenticated.value = true
  const target = hashAfterLogin({ arrivedWith: arrivedWith.value, current: window.location.hash })
  if (target) window.location.hash = target
}

const signOut = async () => {
  await logout().catch(() => {})
  arrivedWith.value = window.location.hash
  authenticated.value = false
}

onMounted(async () => {
  window.addEventListener('hashchange', syncHash)
  window.addEventListener(AUTH_REQUIRED_EVENT, requireLogin)
  const session = await getSession().catch(() => ({ authRequired: false, authenticated: true }))
  configureRegion(session.region)
  authRequired.value = session.authRequired
  arrivedWith.value = window.location.hash
  authenticated.value = session.authenticated
  sessionChecked.value = true
})
onUnmounted(() => {
  window.removeEventListener('hashchange', syncHash)
  window.removeEventListener(AUTH_REQUIRED_EVENT, requireLogin)
})
</script>

<template>
  <LoginView v-if="sessionChecked && !authenticated" @signed-in="signedIn" />
  <template v-else-if="sessionChecked">
    <AppHeader :section="section" :auth-required="authRequired" @sign-out="signOut" />
    <div :key="pageKey" class="page page-enter">
      <SettingsView v-if="isSettings" />
      <NewItem
        v-else-if="newItem"
        :key="newItem.draftId ?? 'new'"
        :draft-id="newItem.draftId"
        :step="newItem.step"
      />
      <ItemEdit v-else-if="itemId && isEdit" :key="`edit-${itemId}`" :item-id="itemId" />
      <ItemDetail
        v-else-if="itemId"
        :key="itemId"
        :item-id="itemId"
        :alert-id="alertId"
        :focus="focus"
      />
      <ItemList v-else />
    </div>
    <AppFooter />
    <ConfirmHost />
  </template>
</template>
