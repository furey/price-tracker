<script setup>
import { useInvalid } from '../../formContext.js'
import FieldError from './FieldError.vue'

defineProps({ config: { type: Object, required: true } })

const invalid = useInvalid()

const setMatch = ({ part, value }) => {
  if (value) {
    part.match = value
    return
  }
  delete part.match
  part.description ??= part.name ?? part.id
}
</script>

<template>
  <div class="edit-fields">
    <p class="muted small">
      A kit adds up the cheapest in-stock price of each part. A part either matches a category
      (for example the trampoline on its own) or is an accessory found by free checks.
    </p>
    <div v-for="(kit, kitIndex) in config.kits" :key="kit.id" class="row-item">
      <div class="field">
        <label :for="`kit-name-${kitIndex}`">Kit name</label>
        <input
          :id="`kit-name-${kitIndex}`"
          v-model="kit.name"
          type="text"
          :aria-invalid="invalid(`kits[${kitIndex}].name`)"
        />
        <FieldError :path="`kits[${kitIndex}].name`" />
      </div>
      <ul class="row-list">
        <li v-for="(part, partIndex) in kit.parts" :key="part.id" class="part-row">
          <h4 class="num">{{ part.id }}</h4>
          <div class="site-grid">
            <div class="field">
              <label :for="`part-name-${kitIndex}-${partIndex}`">Name</label>
              <input :id="`part-name-${kitIndex}-${partIndex}`" v-model="part.name" type="text" />
            </div>
            <div class="field">
              <label :for="`part-match-${kitIndex}-${partIndex}`">Matches</label>
              <select
                :id="`part-match-${kitIndex}-${partIndex}`"
                :value="part.match ?? ''"
                :aria-invalid="invalid(`kits[${kitIndex}].parts[${partIndex}].match`)"
                @change="setMatch({ part, value: $event.target.value })"
              >
                <option value="">Accessory (found by free checks)</option>
                <option
                  v-for="category in config.categories"
                  :key="category.id"
                  :value="category.id"
                >
                  Category {{ category.id }}
                </option>
              </select>
              <FieldError :path="`kits[${kitIndex}].parts[${partIndex}].match`" />
            </div>
            <div v-if="!part.match" class="field wide">
              <label :for="`part-description-${kitIndex}-${partIndex}`">Description</label>
              <input
                :id="`part-description-${kitIndex}-${partIndex}`"
                v-model="part.description"
                type="text"
                :aria-invalid="invalid(`kits[${kitIndex}].parts[${partIndex}].description`)"
              />
              <FieldError :path="`kits[${kitIndex}].parts[${partIndex}].description`" />
            </div>
          </div>
          <FieldError :path="`kits[${kitIndex}].parts[${partIndex}]`" />
        </li>
      </ul>
    </div>
  </div>
</template>
