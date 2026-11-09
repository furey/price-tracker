<script setup>
import { useInvalid } from '../../formContext.js'
import FieldError from './FieldError.vue'

const props = defineProps({ config: { type: Object, required: true } })

const invalid = useInvalid()

const sources = () => props.config.sources

const addSite = () => sources().sites.push({ name: '' })

const setOptional = ({ target, key, value }) => {
  const trimmed = value.trim()
  if (trimmed) target[key] = trimmed
  else delete target[key]
}

const addSearch = () => sources().searches.push('')

const addSeasonal = () => {
  sources().seasonalSearches ??= []
  sources().seasonalSearches.push({ phrase: '', from: '', until: '' })
}

const removeAt = ({ list, index }) => list.splice(index, 1)
</script>

<template>
  <div class="edit-fields">
    <h3 class="sub-head">Sites</h3>
    <p class="muted small">Retailers the AI checks by name. A URL and a note are optional.</p>
    <ul class="row-list">
      <li v-for="(site, index) in config.sources.sites" :key="index" class="row-item">
        <div class="site-grid">
          <div class="field">
            <label :for="`site-name-${index}`">Name</label>
            <input
              :id="`site-name-${index}`"
              v-model="site.name"
              type="text"
              :aria-invalid="invalid(`sources.sites[${index}].name`)"
            />
            <FieldError :path="`sources.sites[${index}].name`" />
          </div>
          <div class="field">
            <label :for="`site-url-${index}`">URL</label>
            <input
              :id="`site-url-${index}`"
              type="url"
              :value="site.url ?? ''"
              :aria-invalid="invalid(`sources.sites[${index}].url`)"
              @input="setOptional({ target: site, key: 'url', value: $event.target.value })"
            />
            <FieldError :path="`sources.sites[${index}].url`" />
          </div>
          <div class="field wide">
            <label :for="`site-note-${index}`">Note</label>
            <input
              :id="`site-note-${index}`"
              type="text"
              :value="site.note ?? ''"
              @input="setOptional({ target: site, key: 'note', value: $event.target.value })"
            />
          </div>
        </div>
        <FieldError :path="`sources.sites[${index}]`" />
        <div class="row-foot">
          <span />
          <button
            class="btn link"
            type="button"
            @click="removeAt({ list: config.sources.sites, index })"
          >
            Remove site
          </button>
        </div>
      </li>
    </ul>
    <button class="btn secondary small" type="button" @click="addSite">Add site</button>

    <h3 class="sub-head">Search phrases</h3>
    <ul class="row-list compact">
      <li v-for="(search, index) in config.sources.searches" :key="index" class="input-row">
        <label class="visually-hidden" :for="`search-${index}`">
          Search phrase {{ index + 1 }}
        </label>
        <input
          :id="`search-${index}`"
          v-model="config.sources.searches[index]"
          type="text"
          :aria-invalid="invalid(`sources.searches[${index}]`)"
        />
        <button
          class="btn secondary small"
          type="button"
          :aria-label="`Remove search phrase ${index + 1}`"
          @click="removeAt({ list: config.sources.searches, index })"
        >
          Remove
        </button>
        <FieldError :path="`sources.searches[${index}]`" />
      </li>
    </ul>
    <button class="btn secondary small" type="button" @click="addSearch">Add search phrase</button>

    <h3 class="sub-head">Seasonal searches</h3>
    <p class="muted small">
      Extra phrases used only between two dates, for example a Black Friday search.
    </p>
    <ul class="row-list">
      <li
        v-for="(entry, index) in config.sources.seasonalSearches ?? []"
        :key="index"
        class="row-item"
      >
        <div class="site-grid">
          <div class="field wide">
            <label :for="`seasonal-phrase-${index}`">Phrase</label>
            <input
              :id="`seasonal-phrase-${index}`"
              v-model="entry.phrase"
              type="text"
              :aria-invalid="invalid(`sources.seasonalSearches[${index}].phrase`)"
            />
            <FieldError :path="`sources.seasonalSearches[${index}].phrase`" />
          </div>
          <div class="field">
            <label :for="`seasonal-from-${index}`">From</label>
            <input
              :id="`seasonal-from-${index}`"
              v-model="entry.from"
              type="date"
              :aria-invalid="invalid(`sources.seasonalSearches[${index}].from`)"
            />
            <FieldError :path="`sources.seasonalSearches[${index}].from`" />
          </div>
          <div class="field">
            <label :for="`seasonal-until-${index}`">Until</label>
            <input
              :id="`seasonal-until-${index}`"
              v-model="entry.until"
              type="date"
              :aria-invalid="invalid(`sources.seasonalSearches[${index}].until`)"
            />
            <FieldError :path="`sources.seasonalSearches[${index}].until`" />
          </div>
          <div class="field wide">
            <label :for="`seasonal-note-${index}`">Note</label>
            <input
              :id="`seasonal-note-${index}`"
              type="text"
              :value="entry.note ?? ''"
              @input="setOptional({ target: entry, key: 'note', value: $event.target.value })"
            />
          </div>
        </div>
        <FieldError :path="`sources.seasonalSearches[${index}]`" />
        <div class="row-foot">
          <span />
          <button
            class="btn link"
            type="button"
            @click="removeAt({ list: config.sources.seasonalSearches, index })"
          >
            Remove seasonal search
          </button>
        </div>
      </li>
    </ul>
    <button class="btn secondary small" type="button" @click="addSeasonal">
      Add seasonal search
    </button>
  </div>
</template>
