<script setup>
import { onMounted, onUnmounted, ref, useId } from 'vue'
import { BOT_CHECK_HINT } from '../../../src/bot-checks.js'
import { sweepPrompt } from '../../../src/sweep.js'
import { getBotChecks, getSweep, markBotChecksSeen } from '../api.js'
import { copyText } from '../clipboard.js'
import { formatDateTime } from '../format.js'
import { whoLabel } from '../who.js'
import AppIcon from './AppIcon.vue'
import SourceLink from './SourceLink.vue'

const checks = ref([])
const busy = ref(false)
const problem = ref(null)
const copied = ref(false)
const headingId = useId()
const COPIED_MS = 2000
let resetTimer = null

const load = async () => {
  try {
    checks.value = (await getBotChecks()).checks
  } catch {
    checks.value = []
  }
}

const markSeen = async () => {
  busy.value = true
  problem.value = null
  try {
    await markBotChecksSeen({ checks: checks.value, by: whoLabel.value || undefined })
    checks.value = []
  } catch (error) {
    problem.value = error.message
  } finally {
    busy.value = false
  }
}

const copySweep = async () => {
  problem.value = null
  try {
    const { items } = await getSweep()
    const prompt = sweepPrompt({ items, dashboardUrl: window.location.origin })
    if (!await copyText(prompt)) throw new Error('Copy failed. Run the sweep command instead.')
    copied.value = true
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => { copied.value = false }, COPIED_MS)
  } catch (error) {
    problem.value = error.message
  }
}

const sourcesHref = ({ itemId }) => `#/item/${encodeURIComponent(itemId)}/sources`

const siteLabel = ({ kind, name }) => (kind === 'direct' ? `${name} free check` : name)

const rowKey = ({ itemId, kind, key }) => `${itemId}:${kind}:${key}`

onMounted(load)
onUnmounted(() => clearTimeout(resetTimer))
</script>

<template>
  <section v-if="checks.length" class="bot-notice card" :aria-labelledby="headingId">
    <div class="notice-head">
      <AppIcon name="info" class="notice-icon" />
      <h2 :id="headingId" class="notice-title">Sites asking for a human check</h2>
    </div>
    <p class="notice-lead muted">
      Scheduled checks never solve a CAPTCHA or bot check. {{ BOT_CHECK_HINT }}
    </p>
    <ul class="notice-list">
      <li v-for="check in checks" :key="rowKey(check)">
        <span class="pill warn compact">Bot check</span>
        <SourceLink
          class="site"
          :name="siteLabel(check)"
          :url="check.url"
          :url-kind="check.urlKind"
        />
        <a class="item-link" :href="sourcesHref(check)">{{ check.itemName }}</a>
        <span class="when muted num">{{ formatDateTime(check.at) }}</span>
      </li>
    </ul>
    <div class="notice-actions">
      <button class="btn secondary small" type="button" :disabled="busy" @click="markSeen">
        Got it
      </button>
      <button class="btn secondary small" type="button" @click="copySweep">
        {{ copied ? 'Copied' : 'Copy Chrome sweep prompt' }}
      </button>
      <span v-if="problem" class="problem" role="alert">{{ problem }}</span>
    </div>
  </section>
</template>

<style scoped>
.bot-notice {
  margin-top: var(--space-4);
  padding: var(--space-4);
}

.notice-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.notice-icon {
  flex: none;
  color: var(--warn);
}

.notice-title {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 700;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.notice-lead {
  margin: var(--space-2) 0 var(--space-3);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.notice-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--rule);
}

.notice-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--rule);
  font-size: var(--text-small);
}

.site {
  font-weight: 600;
}

.when {
  margin-left: auto;
  font-size: var(--text-caption);
}

.notice-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-3);
}

.problem {
  color: var(--bad);
  font-size: var(--text-caption);
}
</style>
