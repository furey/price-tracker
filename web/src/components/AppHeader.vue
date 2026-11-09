<script setup>
import AppIcon from './AppIcon.vue'
import BrandMark from './BrandMark.vue'

defineProps({
  section: { type: String, default: 'items' },
  authRequired: { type: Boolean, default: false }
})

const emit = defineEmits(['sign-out'])

const NAV_LINKS = [
  { id: 'items', label: 'Items', href: '#/', icon: 'items' },
  { id: 'settings', label: 'Settings', href: '#/settings', icon: 'settings' }
]
</script>

<template>
  <header class="app-header">
    <div class="header-inner">
      <a class="brand" href="#/">
        <BrandMark />
        <span class="wordmark">Price Tracker</span>
      </a>
      <nav class="primary-nav" aria-label="Main">
        <a
          v-for="link in NAV_LINKS"
          :key="link.id"
          class="nav-item"
          :href="link.href"
          :aria-current="section === link.id ? 'page' : null"
        >
          <span class="nav-content">
            <AppIcon :name="link.icon" />
            <span>{{ link.label }}</span>
          </span>
        </a>
      </nav>
      <div class="header-end">
        <a class="btn new-item" href="#/new">
          <AppIcon name="plus" />
          <span>New item</span>
        </a>
        <button
          v-if="authRequired"
          class="icon-button"
          type="button"
          aria-label="Log out"
          title="Log out"
          @click="emit('sign-out')"
        >
          <AppIcon name="logout" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 30;
  background: var(--paper);
  border-bottom: 1px solid var(--rule);
}

.header-inner {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  max-width: 1040px;
  height: 64px;
  margin: 0 auto;
  padding: 0 var(--gutter);
}

.brand {
  margin-right: var(--space-5);
}

.primary-nav {
  display: flex;
  align-self: stretch;
  gap: var(--space-1);
}

.nav-item {
  display: inline-flex;
  padding: 0 var(--space-2);
  color: var(--ink-3);
  font-size: var(--text-small);
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  text-wrap: balance;
  transition: color 140ms;
}

.nav-item:hover {
  color: var(--ink);
}

.nav-item[aria-current='page'] {
  color: var(--ink);
}

.nav-content {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.nav-item[aria-current='page'] .nav-content::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
}

.nav-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -6px;
  border-radius: var(--radius-control);
}

.nav-item[aria-current='page'] .app-icon {
  color: var(--accent-text);
}

.header-end {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-height);
  height: var(--control-height);
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: none;
  color: var(--ink-3);
  cursor: pointer;
}

.icon-button:hover {
  color: var(--ink);
  background: var(--muted-bg);
}

.icon-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@media (max-width: 639px) {
  .header-inner {
    flex-wrap: wrap;
    height: auto;
    row-gap: 0;
    padding-top: var(--space-3);
  }
  .brand {
    margin-right: 0;
  }
  .primary-nav {
    order: 3;
    flex: 1 0 100%;
    gap: 0;
    height: var(--nav-height);
    margin: var(--space-3) calc(var(--gutter) * -1) 0;
    padding: 0 var(--space-2);
    border-top: 1px solid var(--rule);
  }
  .nav-item {
    flex: 1;
    justify-content: center;
  }
}

@media (max-width: 359px) {
  .wordmark {
    display: none;
  }
}
</style>
