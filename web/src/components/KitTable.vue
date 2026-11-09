<script setup>
import { formatMoney } from '../format.js'
import { useSort } from '../useSort.js'
import SortHeader from './SortHeader.vue'

const props = defineProps({ kit: { type: Object, required: true } })

const sort = useSort({
  rows: () => props.kit.parts,
  columns: {
    part: (part) => part.name,
    retailer: (part) => part.retailer,
    price: (part) => part.price
  }
})
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <SortHeader :sort="sort" column="part">Part</SortHeader>
          <SortHeader :sort="sort" column="retailer">Retailer</SortHeader>
          <SortHeader :sort="sort" column="price" class="right">Price</SortHeader>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="part in sort.sorted.value" :key="part.id">
          <td class="name">
            {{ part.name }}
            <small v-if="!part.verified" class="muted">unverified</small>
          </td>
          <td>{{ part.retailer }}</td>
          <td class="num right">{{ formatMoney(part.price) }}</td>
          <td>
            <a v-if="part.url" class="quiet-link" :href="part.url" target="_blank"
              rel="noreferrer">Open</a>
            <span v-else class="muted">-</span>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <th colspan="2">Total</th>
          <td class="num right">{{ formatMoney(kit.total) }}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
td small {
  display: block;
  font-size: var(--text-caption);
}

tfoot th,
tfoot td {
  border-bottom: 0;
  font-weight: 700;
}
</style>
