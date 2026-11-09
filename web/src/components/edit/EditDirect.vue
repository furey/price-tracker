<script setup>
import { computed, reactive } from 'vue'
import { testDirectEntry } from '../../api.js'
import { formatMoney } from '../../format.js'
import { useInvalid } from '../../formContext.js'
import SourceLink from '../SourceLink.vue'
import FieldError from './FieldError.vue'

const props = defineProps({
  config: { type: Object, required: true },
  itemId: { type: String, default: null },
  tester: { type: Function, default: null }
})

const invalid = useInvalid()

const PARSERS = [
  { id: 'shopify', label: 'Shopify product JSON' },
  { id: 'jsonld', label: 'Page JSON-LD' }
]

const results = reactive({})

const accessoryParts = computed(() => (props.config.kits ?? []).flatMap((kit) =>
  kit.parts.filter((part) => !part.match).map((part) => ({ id: part.id, name: part.name }))))

const classification = (entry) => (entry.part ? `part:${entry.part}` : `category:${entry.category}`)

const setClassification = ({ entry, value }) => {
  const [kind, id] = value.split(/:(.*)/s)
  if (kind === 'part') {
    delete entry.category
    entry.part = id
    return
  }
  delete entry.part
  entry.category = id
}

const setFilter = ({ entry, value }) => {
  if (value.trim()) entry.variantFilter = value
  else delete entry.variantFilter
}

const add = () => {
  props.config.direct ??= []
  props.config.direct.push({
    retailer: '',
    url: '',
    category: props.config.categories[0]?.id ?? '',
    parser: 'jsonld'
  })
}

const remove = (index) => {
  props.config.direct.splice(index, 1)
  delete results[index]
}

const test = async (index) => {
  results[index] = { loading: true }
  try {
    const entry = { ...props.config.direct[index] }
    results[index] = props.tester
      ? await props.tester(entry)
      : await testDirectEntry({ id: props.itemId, entry })
  } catch (error) {
    results[index] = { status: 'error', note: error.message, listings: [] }
  }
}

const testLabel = (index) => (results[index]?.loading ? 'Testing...' : 'Test')
</script>

<template>
  <div class="edit-fields">
    <p class="muted small">
      Free checks read one product page with no AI. Test sends one request to that page.
    </p>
    <ul class="row-list">
      <li v-for="(entry, index) in config.direct ?? []" :key="index" class="row-item">
        <div class="site-grid">
          <div class="field">
            <label :for="`direct-retailer-${index}`">Retailer</label>
            <input
              :id="`direct-retailer-${index}`"
              v-model="entry.retailer"
              type="text"
              :aria-invalid="invalid(`direct[${index}].retailer`)"
            />
            <FieldError :path="`direct[${index}].retailer`" />
          </div>
          <div class="field">
            <label :for="`direct-class-${index}`">Counts as</label>
            <select
              :id="`direct-class-${index}`"
              :value="classification(entry)"
              :aria-invalid="invalid(`direct[${index}].category`)
                ?? invalid(`direct[${index}].part`)"
              @change="setClassification({ entry, value: $event.target.value })"
            >
              <option
                v-for="category in config.categories"
                :key="category.id"
                :value="`category:${category.id}`"
              >
                {{ category.id }}
              </option>
              <option v-for="part in accessoryParts" :key="part.id" :value="`part:${part.id}`">
                Kit part: {{ part.name ?? part.id }}
              </option>
            </select>
            <FieldError :path="`direct[${index}].category`" />
            <FieldError :path="`direct[${index}].part`" />
          </div>
          <div class="field wide">
            <label :for="`direct-url-${index}`">Product URL</label>
            <input
              :id="`direct-url-${index}`"
              v-model.trim="entry.url"
              type="url"
              :aria-invalid="invalid(`direct[${index}].url`)"
            />
            <FieldError :path="`direct[${index}].url`" />
          </div>
          <div class="field">
            <label :for="`direct-parser-${index}`">Read with</label>
            <select
              :id="`direct-parser-${index}`"
              v-model="entry.parser"
              :aria-invalid="invalid(`direct[${index}].parser`)"
            >
              <option v-for="parser in PARSERS" :key="parser.id" :value="parser.id">
                {{ parser.label }}
              </option>
            </select>
            <FieldError :path="`direct[${index}].parser`" />
          </div>
          <div class="field">
            <label :for="`direct-filter-${index}`">Variant filter</label>
            <input
              :id="`direct-filter-${index}`"
              class="num"
              type="text"
              spellcheck="false"
              placeholder="medium oval"
              :value="entry.variantFilter ?? ''"
              :aria-invalid="invalid(`direct[${index}].variantFilter`)"
              @input="setFilter({ entry, value: $event.target.value })"
            />
            <p class="hint">
              Optional. Keeps variants whose title contains one of these words, separated by |
              (for example <code>medium oval|large oval</code>). Start a choice with ^ or end it
              with $ to match the start or end of the title.
            </p>
            <FieldError :path="`direct[${index}].variantFilter`" />
          </div>
        </div>
        <FieldError :path="`direct[${index}]`" />
        <div v-if="results[index] && !results[index].loading" class="test-result" role="status">
          <p>
            <span class="pill" :class="results[index].status">{{ results[index].status }}</span>
            <SourceLink
              v-if="results[index].url"
              class="tested-page"
              :name="entry.retailer || 'Tested page'"
              :url="results[index].url"
            />
            {{ results[index].note }}
          </p>
          <ul v-if="results[index].listings?.length" class="plain-list small">
            <li v-for="(listing, at) in results[index].listings" :key="at">
              {{ listing.title }}:
              <strong class="num">{{ formatMoney(listing.price) }}</strong>
              <span class="muted">{{ listing.inStock ? 'in stock' : 'out of stock' }}</span>
            </li>
          </ul>
        </div>
        <div class="row-foot">
          <button
            class="btn secondary small"
            type="button"
            :disabled="results[index]?.loading || !entry.url"
            @click="test(index)"
          >
            {{ testLabel(index) }}
          </button>
          <button class="btn link" type="button" @click="remove(index)">Remove free check</button>
        </div>
      </li>
    </ul>
    <button class="btn secondary small" type="button" @click="add">Add free check</button>
  </div>
</template>
