<script setup>
import { computed, ref } from 'vue'
import { testDraftEntry } from '../../api.js'
import { currentRegion, formatMoney } from '../../format.js'
import { describeSchedule } from '../../schedulePresets.js'
import { hostOf } from '../../wizard.js'
import EditDirect from '../edit/EditDirect.vue'
import EditSources from '../edit/EditSources.vue'
import SourceLink from '../SourceLink.vue'

const props = defineProps({
  config: { type: Object, required: true },
  research: { type: Object, required: true },
  draftId: { type: String, required: true }
})

const newSite = ref('')
const newSearch = ref('')
const detailed = ref(false)

const candidates = computed(() => props.research.candidates ?? [])

const resultFor = (url) => candidates.value.find((candidate) => candidate.url === url)

const dropped = computed(() => candidates.value.filter((candidate) => !candidate.kept
  && !(props.config.direct ?? []).some(({ url }) => url === candidate.url)))

const pillFor = (result) => {
  if (!result) return { tone: 'neutral', text: 'Not tested' }
  if (result.kept || result.status === 'ok') {
    return { tone: 'ok', text: `Read ${formatMoney(result.price)}` }
  }
  if (result.status === 'skipped') return { tone: 'neutral', text: 'Not checked' }
  if (result.status === 'blocked') return { tone: 'warn', text: 'Blocked' }
  return { tone: 'warn', text: 'No price data' }
}

const removeDirect = (index) => {
  props.config.direct.splice(index, 1)
  if (props.config.direct.length === 0) {
    delete props.config.direct
    delete props.config.directSchedules
  }
}

const addSite = () => {
  const name = newSite.value.trim()
  if (!name || props.config.sources.sites.some((site) => site.name === name)) return
  props.config.sources.sites.push({ name })
  newSite.value = ''
}

const addSearch = () => {
  const phrase = newSearch.value.trim()
  if (!phrase || props.config.sources.searches.includes(phrase)) return
  props.config.sources.searches.push(phrase)
  newSearch.value = ''
}

const removeAt = ({ list, index }) => list.splice(index, 1)

const tester = (entry) => testDraftEntry({ id: props.draftId, entry })

const dayFormat = new Intl.DateTimeFormat(currentRegion().locale, {
  timeZone: 'UTC', day: 'numeric', month: 'short'
})

const formatDay = (day) => dayFormat.format(new Date(`${day}T00:00:00Z`))
</script>

<template>
  <div class="review-body">
    <h2 class="section-label">Free price checks (no AI)</h2>
    <ul v-if="(config.direct ?? []).length || dropped.length" class="plain-rows card">
      <li v-for="(entry, index) in config.direct ?? []" :key="entry.url">
        <div class="row-text">
          <SourceLink :name="entry.retailer" :url="resultFor(entry.url)?.url ?? null" />
          <span class="sub">{{ resultFor(entry.url)?.title ?? hostOf(entry.url) }}</span>
        </div>
        <div class="row-actions">
          <span class="pill" :class="pillFor(resultFor(entry.url)).tone">
            {{ pillFor(resultFor(entry.url)).text }}
          </span>
          <button
            class="btn link"
            type="button"
            :aria-label="`Remove free check at ${entry.retailer}`"
            @click="removeDirect(index)"
          >
            Remove
          </button>
        </div>
      </li>
      <li v-for="candidate in dropped" :key="candidate.url">
        <div class="row-text">
          <SourceLink :name="candidate.retailer" :url="candidate.url" />
          <span class="sub">AI checks only. {{ candidate.note }}.</span>
        </div>
        <span class="pill" :class="pillFor(candidate).tone">{{ pillFor(candidate).text }}</span>
      </li>
    </ul>
    <p v-else class="muted small">
      No product page returned a {{ currentRegion().currency }} price, so every check uses AI.
    </p>
    <p v-if="config.directSchedules?.length" class="muted small">
      {{ config.directSchedules.map(describeSchedule).join('; ') }}
    </p>

    <h2 class="section-label">AI also checks</h2>
    <div class="chips">
      <button
        v-for="(site, index) in config.sources.sites"
        :key="site.name"
        class="chip"
        type="button"
        :aria-label="`Remove ${site.name}`"
        @click="removeAt({ list: config.sources.sites, index })"
      >
        {{ site.name }} <span aria-hidden="true">×</span>
      </button>
    </div>
    <form class="input-row" @submit.prevent="addSite">
      <label class="visually-hidden" for="new-site">Add a retailer</label>
      <input id="new-site" v-model="newSite" type="text" placeholder="Add a retailer" />
      <button class="btn secondary small" type="submit" :disabled="!newSite.trim()">Add</button>
    </form>

    <h2 class="section-label">Search phrases</h2>
    <div class="chips">
      <button
        v-for="(phrase, index) in config.sources.searches"
        :key="phrase"
        class="chip"
        type="button"
        :aria-label="`Remove ${phrase}`"
        @click="removeAt({ list: config.sources.searches, index })"
      >
        {{ phrase }} <span aria-hidden="true">×</span>
      </button>
    </div>
    <form class="input-row" @submit.prevent="addSearch">
      <label class="visually-hidden" for="new-search">Add a search phrase</label>
      <input id="new-search" v-model="newSearch" type="text" placeholder="Add a search phrase" />
      <button class="btn secondary small" type="submit" :disabled="!newSearch.trim()">Add</button>
    </form>

    <template v-if="config.sources.seasonalSearches?.length">
      <h2 class="section-label">Sale searches</h2>
      <ul class="plain-rows card">
        <li v-for="entry in config.sources.seasonalSearches" :key="entry.phrase">
          <div class="row-text">
            <span>{{ entry.phrase }}</span>
            <span class="sub num">
              {{ formatDay(entry.from) }} to {{ formatDay(entry.until) }}<template
                v-if="entry.note">. {{ entry.note }}</template>
            </span>
          </div>
        </li>
      </ul>
    </template>

    <button class="btn link start" type="button" @click="detailed = !detailed">
      {{ detailed ? 'Hide the detailed editor' : 'Edit sites, links, and notes in detail' }}
    </button>
    <template v-if="detailed">
      <div class="card padded"><EditSources :config="config" /></div>
      <div class="card padded"><EditDirect :config="config" :tester="tester" /></div>
    </template>
  </div>
</template>
