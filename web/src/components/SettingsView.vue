<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import NtfyTopic from './NtfyTopic.vue'
import {
  getAbout, getAiUsage, getSettings, getItems, pauseAi, resumeAi, saveSettings,
  sendAppTopicTest, sendTestNotification, testClaudeLogin
} from '../api.js'
import { appTestOutcome } from '../appTopicTest.js'
import { aiHold, aiUsage, loadAiUsage, setAiUsage } from '../aiState.js'
import {
  confirmClearOverride, confirmPauseAllAi, confirmResumeAi, confirmSettingChange
} from '../confirmCopy.js'
import { SETTING_EFFECTS, SETTING_GROUPS, maskedPreview } from '../settingsLayout.js'
import AiRunsExplainer from './AiRunsExplainer.vue'
import AppIcon from './AppIcon.vue'
import ClaudeUsageCard from './ClaudeUsageCard.vue'
import FoldSection from './FoldSection.vue'
import WhoField from './WhoField.vue'
import {
  formatMemberships, membershipSuggestions, parseMemberships
} from '../../../src/memberships.js'
import { regionProfile } from '../../../src/regions/index.js'
import { currentRegion } from '../format.js'

const settings = ref([])
const items = ref([])
const about = ref(null)
const drafts = reactive({})
const saving = ref(null)
const testing = ref(null)
const testingApp = ref(false)
const appTestResult = ref(null)
const loading = ref(true)
const loadError = ref(null)
const notice = ref(null)
const focusKey = ref(null)
const activeGroup = ref(SETTING_GROUPS[0].id)
const usageCard = ref(null)
let groupObserver = null

const keepUsageCard = (element) => {
  usageCard.value = element
}

const RESERVE_KEYS = ['claudeReservePercent', 'claudeSessionReservePercent']

const SOURCE_LABELS = {
  env: 'from .env', settings: 'overridden here', default: 'default', none: 'not set'
}

const usage = ref(null)
const loginTest = ref(null)
const testingLogin = ref(false)

const settingByKey = computed(() =>
  Object.fromEntries(settings.value.map((setting) => [setting.key, setting])))

const groups = computed(() => SETTING_GROUPS.map((group) => ({
  ...group,
  settings: group.keys.map((key) => settingByKey.value[key]).filter(Boolean)
})))

const aiPaused = computed(() => aiUsage.value?.limits?.paused === true)

const aiPauseSummary = computed(() => {
  if (aiPaused.value) return 'On: AI checks paused, free checks running'
  if (aiHold.value) return `Off, but AI checks are held: ${aiHold.value.label}`
  return 'Off: AI checks run on schedule'
})

const readFocusKey = () =>
  /^#\/settings\/([A-Za-z]+)/.exec(window.location.hash)?.[1] ?? null

const scrollToFocus = async () => {
  focusKey.value = readFocusKey()
  if (!focusKey.value) return
  await nextTick()
  const target = document.getElementById(`setting-${focusKey.value}`)
    ?? document.getElementById(`group-${focusKey.value}`)
  target?.scrollIntoView({ block: 'start' })
}

const runLoginTest = async () => {
  testingLogin.value = true
  loginTest.value = null
  try {
    loginTest.value = await testClaudeLogin()
  } catch (error) {
    loginTest.value = { ok: false, error: error.message }
  } finally {
    testingLogin.value = false
    usageCard.value?.load()
  }
}

const appServer = computed(() => items.value.find((item) => item.ntfy)?.ntfy.server
  ?? 'https://ntfy.sh')

const heldMemberships = computed(() => parseMemberships(settingByKey.value.memberships?.value))

const suggestions = membershipSuggestions(regionProfile({ id: currentRegion().id }))

const quickAdd = computed(() => suggestions.filter((name) =>
  !heldMemberships.value.some((held) => held.toLowerCase() === name.toLowerCase())))

const listText = (names) => (names.length ? names.join(', ') : 'None')

const changeMemberships = async ({ names, success }) => {
  const setting = settingByKey.value.memberships
  const confirmed = await confirmSettingChange({
    setting,
    from: listText(heldMemberships.value),
    to: listText(parseMemberships(formatMemberships(names))),
    effect: SETTING_EFFECTS.memberships
  })
  if (!confirmed) return
  await apply({
    key: 'memberships',
    changes: { memberships: formatMemberships(names) },
    success
  })
}

const addMembership = (name) => {
  const cleaned = String(name ?? '').trim()
  if (!cleaned) return
  return changeMemberships({
    names: [...heldMemberships.value, cleaned], success: `Added ${cleaned}.`
  })
}

const removeMembership = (name) => changeMemberships({
  names: heldMemberships.value.filter((held) => held !== name), success: `Removed ${name}.`
})

const canUseEnv = (setting) => setting.source === 'settings' && setting.key !== 'appTopic'

const sourceKey = (setting) => setting.source ?? 'none'

const valueText = (setting) => {
  if (setting.key === 'memberships') return listText(heldMemberships.value)
  if (!setting.isSet) return 'Not set'
  if (setting.secret) return 'Set'
  if (setting.key === 'aiMonthlyCap' && usage.value) {
    return `${setting.value} runs, ${usage.value.month.used} used this month`
  }
  if (RESERVE_KEYS.includes(setting.key)) return `${setting.value}%`
  return setting.value
}

const summaryOf = (setting) => {
  const value = valueText(setting)
  if (!setting.isSet && setting.key !== 'memberships') return value
  return `${value} (${SOURCE_LABELS[sourceKey(setting)]})`
}

const currentText = (setting) => {
  if (!setting.isSet) return 'Not set'
  if (RESERVE_KEYS.includes(setting.key)) return `${setting.value}%`
  return setting.value
}

const newText = ({ setting, value }) => {
  if (setting.secret) return maskedPreview(value)
  if (RESERVE_KEYS.includes(setting.key)) return `${value}%`
  return value
}

const load = async () => {
  loading.value = true
  loadError.value = null
  try {
    const [loadedSettings, loadedItems, loadedUsage, loadedAbout] = await Promise.all([
      getSettings(), getItems(), getAiUsage().catch(() => null), getAbout().catch(() => null),
      loadAiUsage().catch(() => null)
    ])
    settings.value = loadedSettings
    items.value = loadedItems
    usage.value = loadedUsage
    about.value = loadedAbout
  } catch (error) {
    loadError.value = error.message
  } finally {
    loading.value = false
  }
}

const apply = async ({ key, changes, success }) => {
  saving.value = key
  notice.value = null
  try {
    settings.value = await saveSettings(changes)
    drafts[key] = ''
    if (RESERVE_KEYS.includes(key) || key === 'claudeOauthToken') usageCard.value?.load()
    if (key === 'aiMonthlyCap') usage.value = await getAiUsage().catch(() => usage.value)
    notice.value = { tone: 'good', text: success }
  } catch (error) {
    notice.value = { tone: 'bad', text: error.message }
  } finally {
    saving.value = null
  }
}

const save = async (setting) => {
  const value = (drafts[setting.key] ?? '').trim()
  if (!value) return
  const effect = SETTING_EFFECTS[setting.key]
  if (effect) {
    const confirmed = await confirmSettingChange({
      setting, from: currentText(setting), to: newText({ setting, value }), effect
    })
    if (!confirmed) return
  }
  await apply({
    key: setting.key,
    changes: { [setting.key]: value },
    success: `${setting.label} saved.`
  })
}

const useEnv = async (setting) => {
  const confirmed = await confirmClearOverride({
    setting, envText: `the ${setting.envName} value from .env, or the default`
  })
  if (!confirmed) return
  await apply({
    key: setting.key,
    changes: { [setting.key]: null },
    success: `${setting.label} now uses the .env value.`
  })
}

const toggleAiPause = async () => {
  const resuming = aiPaused.value
  const confirmed = resuming
    ? await confirmResumeAi({ hold: aiHold.value })
    : await confirmPauseAllAi()
  if (!confirmed) return
  saving.value = 'aiPaused'
  notice.value = null
  try {
    setAiUsage(await (resuming ? resumeAi() : pauseAi()))
    usageCard.value?.load()
    notice.value = {
      tone: 'good',
      text: resuming ? 'AI checks resumed.' : 'AI checks paused. Free checks keep running.'
    }
  } catch (error) {
    notice.value = { tone: 'bad', text: error.message }
  } finally {
    saving.value = null
  }
}

const testNotify = async (item) => {
  testing.value = item.id
  notice.value = null
  try {
    const { delivered } = await sendTestNotification(item.id)
    notice.value = delivered
      ? { tone: 'good', text: `Test notification sent for ${item.name}.` }
      : { tone: 'bad', text: `Test notification for ${item.name} was not delivered.` }
  } catch (error) {
    notice.value = { tone: 'bad', text: error.message }
  } finally {
    testing.value = null
  }
}

const testAppTopic = async () => {
  testingApp.value = true
  appTestResult.value = null
  try {
    appTestResult.value = appTestOutcome(await sendAppTopicTest())
  } catch (error) {
    appTestResult.value = { tone: 'bad', text: error.message }
  } finally {
    testingApp.value = false
  }
}

const itemGroups = () => {
  groupObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
    if (visible.length) activeGroup.value = visible[0].target.dataset.group
  }, { rootMargin: '-96px 0px -55% 0px' })
  document.querySelectorAll('[data-group]').forEach((element) => groupObserver.observe(element))
}

onMounted(async () => {
  window.addEventListener('hashchange', scrollToFocus)
  await load()
  await nextTick()
  itemGroups()
  scrollToFocus()
})

onUnmounted(() => {
  window.removeEventListener('hashchange', scrollToFocus)
  groupObserver?.disconnect()
})
</script>

<template>
  <main class="settings">
    <h1>Settings</h1>
    <p class="muted intro">
      Values come from <code>.env</code>. An override saved here wins over <code>.env</code> and
      is stored in the local database, not in git.
    </p>

    <p v-if="notice" class="banner" :class="notice.tone" role="status">{{ notice.text }}</p>
    <p v-if="loading" class="muted state">Loading settings...</p>

    <div v-else-if="loadError" class="empty">
      <h2>Cannot load settings</h2>
      <p>{{ loadError }}</p>
      <button class="btn secondary" type="button" @click="load">Try again</button>
    </div>

    <div v-else class="settings-layout">
      <nav class="group-index" aria-label="Setting groups">
        <a
          v-for="group in groups"
          :key="group.id"
          class="group-link"
          :href="`#/settings/${group.id}`"
          :aria-current="activeGroup === group.id ? 'true' : null"
        >
          <AppIcon :name="group.icon" />
          <span>{{ group.title }}</span>
        </a>
      </nav>

      <div class="groups">
        <section
          v-for="group in groups"
          :id="`group-${group.id}`"
          :key="group.id"
          class="group"
          :data-group="group.id"
          :aria-labelledby="`group-title-${group.id}`"
        >
          <header class="group-head">
            <span class="group-icon"><AppIcon :name="group.icon" /></span>
            <div>
              <h2 :id="`group-title-${group.id}`" class="group-title">{{ group.title }}</h2>
              <p class="group-description">{{ group.description }}</p>
            </div>
          </header>

          <ClaudeUsageCard v-if="group.id === 'ai'" :ref="keepUsageCard" class="group-usage" />

          <div v-if="group.id !== 'about'" class="card group-rows">
            <template v-for="setting in group.settings" :key="setting.key">
              <FoldSection
                :id="`setting-${setting.key}`"
                :name="`setting-${setting.key}`"
                :title="setting.label"
                :force-open="focusKey === setting.key"
                :summary="summaryOf(setting)"
              >
                <p class="muted setting-meta">
                  <code>{{ setting.envName }}</code>
                  <template v-if="setting.isSet && setting.key !== 'memberships'">
                    current value <code>{{ setting.value }}</code>
                  </template>
                </p>
                <template v-if="setting.key === 'memberships'">
                  <p class="muted small setting-extra">
                    Member-only prices and coupons count only for memberships listed here.
                  </p>
                  <ul class="chips setting-extra" aria-label="Your memberships">
                    <li v-for="name in heldMemberships" :key="name">
                      <button
                        class="chip held"
                        type="button"
                        :disabled="saving === 'memberships'"
                        :aria-label="`Remove ${name}`"
                        @click="removeMembership(name)"
                      >
                        {{ name }} <span aria-hidden="true">&times;</span>
                      </button>
                    </li>
                    <li v-if="!heldMemberships.length" class="muted small">No memberships.</li>
                  </ul>
                  <form class="setting-form" @submit.prevent="addMembership(drafts.memberships)">
                    <input
                      v-model="drafts.memberships"
                      type="text"
                      aria-label="Add a membership"
                      placeholder="Add a membership"
                      maxlength="40"
                      autocomplete="off"
                    />
                    <button
                      class="btn"
                      type="submit"
                      :disabled="saving === 'memberships' || !(drafts.memberships ?? '').trim()"
                    >
                      Add
                    </button>
                    <button
                      class="btn secondary"
                      type="button"
                      :disabled="saving === 'memberships' || !canUseEnv(setting)"
                      @click="useEnv(setting)"
                    >
                      Use default
                    </button>
                  </form>
                  <div v-if="quickAdd.length" class="setting-extra">
                    <p class="muted small quick-label">Quick add</p>
                    <ul class="chips">
                      <li v-for="name in quickAdd" :key="name">
                        <button
                          class="chip"
                          type="button"
                          :disabled="saving === 'memberships'"
                          @click="addMembership(name)"
                        >
                          + {{ name }}
                        </button>
                      </li>
                    </ul>
                  </div>
                </template>
                <form v-else class="setting-form" @submit.prevent="save(setting)">
                  <input
                    v-model="drafts[setting.key]"
                    :type="setting.secret ? 'password' : 'text'"
                    :aria-label="`New value for ${setting.label}`"
                    :placeholder="setting.secret ? 'Paste a new token' : 'New value'"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button
                    class="btn"
                    type="submit"
                    :disabled="saving === setting.key || !(drafts[setting.key] ?? '').trim()"
                  >
                    Save
                  </button>
                  <button
                    class="btn secondary"
                    type="button"
                    :disabled="saving === setting.key || !canUseEnv(setting)"
                    @click="useEnv(setting)"
                  >
                    Use .env value
                  </button>
                </form>
                <p v-if="setting.key === 'dashboardUrl'" class="muted small setting-extra">
                  Alerts on your phone open this address, so it must be reachable from your
                  phone.
                </p>
                <template v-if="setting.key === 'aiMonthlyCap'">
                  <div v-if="usage" class="month-usage">
                    <p>
                      This month: <strong class="num">{{ usage.month.used }}</strong> of
                      <span class="num">{{ usage.month.cap }}</span> runs used. With the current
                      schedules the month ends at about
                      <strong class="num">{{ usage.month.projected }}</strong>.
                    </p>
                    <p v-if="usage.month.reached" class="banner bad">
                      The cap is used up. Scheduled AI checks pause until the 1st; free checks
                      continue.
                    </p>
                  </div>
                  <AiRunsExplainer class="setting-extra" />
                  <p class="muted small setting-extra">
                    Enter 0 to stop all AI runs. A new item, or an edit that adds runs, is
                    blocked when its next 30 days of runs would pass the cap.
                  </p>
                </template>
                <template v-if="setting.key === 'claudeReservePercent'">
                  <p class="small setting-extra">
                    AI checks use the same Claude subscription as your work. When weekly usage
                    passes this percentage, AI checks stop until the weekly reset. Free price
                    checks keep running.
                  </p>
                  <p class="muted small setting-extra">
                    The monthly AI run cap applies too; whichever is hit first pauses AI checks.
                  </p>
                </template>
                <p
                  v-if="setting.key === 'claudeSessionReservePercent'"
                  class="small setting-extra"
                >
                  The same check for Claude's five-hour session window, when Claude reports one.
                  A higher number lets AI checks run closer to the session limit.
                </p>
                <template v-if="setting.key === 'claudeOauthToken'">
                  <p class="muted small setting-extra">
                    The token lets the app run Claude with your Claude subscription. Make one with
                    <code>claude setup-token</code> on your Mac, then paste it here. It is stored
                    in the local database (<code>state/</code>), not in git, and the page never
                    shows it again.
                  </p>
                  <div class="button-row setting-extra">
                    <button
                      class="btn secondary"
                      type="button"
                      :disabled="testingLogin"
                      @click="runLoginTest"
                    >
                      {{ testingLogin ? 'Testing...' : 'Test Claude login' }}
                    </button>
                  </div>
                  <div
                    v-if="loginTest"
                    class="banner"
                    :class="loginTest.ok ? 'good' : 'bad'"
                    role="status"
                  >
                    <p v-if="loginTest.ok">
                      Claude login works. Claude replied "{{ loginTest.reply }}".
                    </p>
                    <template v-else>
                      <p>{{ loginTest.error }}</p>
                      <p v-if="loginTest.hint">{{ loginTest.hint }}</p>
                    </template>
                  </div>
                </template>
                <template v-if="setting.key === 'appTopic' && setting.value">
                  <p class="muted small setting-extra">
                    New item drafts send their notices here: needs your answers, ready to review,
                    and stopped. Product alerts keep their own topics.
                  </p>
                  <NtfyTopic :server="appServer" :topic="setting.value">
                    <template #actions>
                      <button
                        class="btn secondary"
                        type="button"
                        :disabled="testingApp"
                        @click="testAppTopic"
                      >
                        {{ testingApp ? 'Sending...' : 'Send test' }}
                      </button>
                    </template>
                    <template #result>
                      <p
                        v-if="appTestResult"
                        class="banner"
                        :class="appTestResult.tone"
                        role="status"
                      >
                        {{ appTestResult.text }}
                      </p>
                    </template>
                  </NtfyTopic>
                </template>
              </FoldSection>

              <FoldSection
                v-if="setting.key === 'appTopic'"
                id="setting-testNotifications"
                name="setting-test-notifications"
                title="Test notifications"
                :force-open="focusKey === 'testNotifications'"
                :summary="`${items.length} items`"
              >
                <p class="muted setting-meta">Sends a test message to each item's ntfy topic.</p>
                <ul class="setting-list">
                  <li v-for="item in items" :key="item.id" class="test-row">
                    <div class="test-head">
                      <span>{{ item.name }}</span>
                      <button
                        class="btn secondary"
                        type="button"
                        :disabled="testing === item.id"
                        @click="testNotify(item)"
                      >
                        {{ testing === item.id ? 'Sending...' : 'Send test notification' }}
                      </button>
                    </div>
                    <NtfyTopic
                      v-if="item.ntfy"
                      :server="item.ntfy.server"
                      :topic="item.ntfy.topic"
                    />
                  </li>
                </ul>
              </FoldSection>
            </template>

            <FoldSection
              v-if="group.id === 'ai'"
              id="setting-aiPaused"
              name="setting-aiPaused"
              title="Pause all AI"
              :force-open="focusKey === 'aiPaused'"
              :summary="aiPauseSummary"
            >
              <p class="small setting-extra">
                Pausing stops AI research for every item. Free price checks keep running on
                their own schedules, and their alerts still arrive.
              </p>
              <div class="button-row setting-extra">
                <button
                  class="btn"
                  :class="{ secondary: !aiPaused }"
                  type="button"
                  :disabled="saving === 'aiPaused' || !aiUsage"
                  @click="toggleAiPause"
                >
                  {{ aiPaused ? 'Resume AI checks' : 'Pause AI checks' }}
                </button>
              </div>
            </FoldSection>
          </div>

          <div v-else class="card about">
            <dl>
              <div>
                <dt>Version</dt>
                <dd class="num">{{ about?.version ?? 'Unknown' }}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd><code class="path">{{ about?.database ?? 'Unknown' }}</code></dd>
              </div>
              <div>
                <dt>This browser</dt>
                <dd><WhoField /></dd>
              </div>
              <div>
                <dt>Help</dt>
                <dd>
                  The project <code>README.md</code> explains
                  <span class="readme-refs">
                    <span>Settings</span><span class="sep">Claude usage</span><span
                      class="sep">Memberships</span><span class="sep">Schedules</span>
                  </span>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  </main>
</template>

<style scoped>
.intro {
  margin-top: var(--space-1);
}

.state {
  margin-top: var(--space-6);
}

.settings-layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  align-items: start;
  gap: var(--space-7);
  margin-top: var(--space-6);
}

.group-index {
  position: sticky;
  top: 88px;
  display: grid;
  gap: var(--space-1);
}

.group-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border-radius: var(--radius-control);
  color: var(--ink-2);
  font-size: var(--text-small);
  font-weight: 600;
  line-height: 1;
  text-decoration: none;
  text-wrap: balance;
}

.group-link:hover {
  color: var(--ink);
  background: var(--muted-bg);
}

.group-link[aria-current='true'] {
  color: var(--ink);
  background: var(--muted-bg);
}

.group-link[aria-current='true'] .app-icon {
  color: var(--accent-text);
}

.group-link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.groups {
  display: grid;
  gap: var(--space-7);
  min-width: 0;
}

.group-head {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: start;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}

.group-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--ink-2);
}

.group-title {
  font-size: var(--text-heading);
  line-height: 36px;
}

.group-description {
  margin-top: calc(var(--space-1) * -1);
  color: var(--ink-3);
  font-size: var(--text-small);
  text-wrap: pretty;
}

.group-usage {
  margin-bottom: var(--space-3);
}

.group-rows {
  padding: 0 var(--space-4);
}

.group-rows > :deep(.fold:first-child) {
  border-top: 0;
}

.quick-label {
  margin-bottom: var(--space-2);
}

.about dl {
  margin: 0;
}

.about dl div {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--rule);
  font-size: var(--text-small);
}

.about dl div:first-child {
  border-top: 0;
}

.about dt {
  color: var(--ink-3);
}

.about dd {
  margin: 0;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}

.path {
  font-family: var(--font-code);
  font-size: var(--text-caption);
}

.readme-refs > span {
  white-space: nowrap;
}

@media (max-width: 899px) {
  .settings-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    margin-top: var(--space-4);
  }
  .group-index {
    position: static;
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    margin: 0 calc(var(--gutter) * -1);
    padding: 0 var(--gutter) var(--space-1);
    scrollbar-width: none;
  }
  .group-link {
    flex: none;
    min-height: var(--control-height-small);
    gap: var(--space-2);
    border: 1px solid var(--rule);
    border-radius: 999px;
    background: var(--surface);
  }
  .group-link[aria-current='true'] {
    border-color: var(--rule-strong);
  }
}
</style>
