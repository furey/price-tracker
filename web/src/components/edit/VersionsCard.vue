<script setup>
import { reactive, ref } from 'vue'
import { getItemVersion } from '../../api.js'
import { formatDateTime } from '../../format.js'
import { timeOf, useSort } from '../../useSort.js'
import SortHeader from '../SortHeader.vue'

const props = defineProps({
  itemId: { type: String, required: true },
  versions: { type: Array, required: true },
  currentVersion: { type: Number, required: true },
  busy: { type: Boolean, default: false }
})

const emit = defineEmits(['restore'])

const SOURCE_LABELS = {
  seed: 'Repo file', edit: 'Dashboard', import: 'Import', wizard: 'New item', tune: 'Tuning'
}

const viewing = ref(null)
const loaded = reactive({})
const loadError = ref(null)

const sort = useSort({
  rows: () => props.versions,
  columns: {
    version: (entry) => entry.version,
    saved: (entry) => timeOf(entry.createdAt),
    source: (entry) => SOURCE_LABELS[entry.source] ?? entry.source,
    note: (entry) => entry.note ?? ''
  }
})

const view = async (version) => {
  loadError.value = null
  if (viewing.value === version) {
    viewing.value = null
    return
  }
  viewing.value = version
  if (loaded[version]) return
  try {
    const body = await getItemVersion({ id: props.itemId, version })
    loaded[version] = JSON.stringify(body.config, null, 2)
  } catch (error) {
    loadError.value = error.message
  }
}

const restore = async (version) => {
  try {
    const body = await getItemVersion({ id: props.itemId, version })
    emit('restore', { version, config: body.config })
  } catch (error) {
    loadError.value = error.message
  }
}
</script>

<template>
  <div>
    <p class="muted small">
      Each save is a version. Prices already recorded stay judged by the rules of the version that
      recorded them. Pausing does not make a version.
    </p>
    <p v-if="loadError" class="banner bad" role="alert">{{ loadError }}</p>
    <div class="table-wrap versions-table">
      <table>
        <thead>
          <tr>
            <SortHeader :sort="sort" column="version" class="right">Version</SortHeader>
            <SortHeader :sort="sort" column="saved">Saved</SortHeader>
            <SortHeader :sort="sort" column="source">From</SortHeader>
            <SortHeader :sort="sort" column="note">Note</SortHeader>
            <th><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="entry in sort.sorted.value" :key="entry.version">
            <tr>
              <td class="num right">
                v{{ entry.version }}
                <span v-if="entry.version === currentVersion" class="pill ok">Current</span>
              </td>
              <td class="num nowrap">{{ formatDateTime(entry.createdAt) }}</td>
              <td>{{ SOURCE_LABELS[entry.source] ?? entry.source }}</td>
              <td>{{ entry.note || '-' }}</td>
              <td class="version-actions">
                <button class="btn link" type="button" @click="view(entry.version)">
                  {{ viewing === entry.version ? 'Hide' : 'View' }}
                </button>
                <button
                  v-if="entry.version !== currentVersion"
                  class="btn link"
                  type="button"
                  :disabled="busy"
                  @click="restore(entry.version)"
                >
                  Restore this version
                </button>
              </td>
            </tr>
            <tr v-if="viewing === entry.version" class="json-row">
              <td colspan="5">
                <pre class="json">{{ loaded[entry.version] ?? 'Loading...' }}</pre>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
