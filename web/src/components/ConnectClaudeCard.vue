<script setup>
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps({
  source: { type: String, default: null }
})

const tokenRejected = computed(() => props.source === 'token')
</script>

<template>
  <section class="connect card padded" aria-labelledby="connect-claude-title">
    <header class="connect-head">
      <AppIcon name="spark" />
      <h2 id="connect-claude-title" class="connect-title">
        {{ tokenRejected ? 'Reconnect Claude' : 'Connect Claude' }}
      </h2>
    </header>
    <p class="connect-text">
      <template v-if="tokenRejected">Claude did not accept the login token. </template>
      Claude runs the AI research that finds prices across retailers, and drafts new items for
      you. Free checks of product pages, Chrome checks, price history, and alerts work without it.
    </p>
    <div class="connect-actions">
      <a class="btn small" href="#/settings/claudeOauthToken">
        {{ tokenRejected ? 'Replace the login token' : 'Add a Claude login token' }}
      </a>
      <p class="connect-hint">
        To make a token, run <code>claude setup-token</code> on a computer with Claude Code,
        then paste the token it prints.
      </p>
    </div>
  </section>
</template>

<style scoped>
.connect {
  display: grid;
  gap: var(--space-3);
}

.connect-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--accent-text);
}

.connect-title {
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink);
  text-wrap: balance;
}

.connect-text {
  color: var(--ink-2);
  text-wrap: pretty;
}

.connect-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
}

.connect-hint {
  flex: 1 1 18rem;
  font-size: var(--text-small);
  color: var(--ink-3);
  text-wrap: pretty;
}
</style>
