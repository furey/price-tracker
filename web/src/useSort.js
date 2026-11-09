import { computed, ref, toValue } from 'vue'

export const useSort = ({ rows, columns }) => {
  const column = ref(null)
  const direction = ref(null)
  const sorted = computed(() => {
    const list = [...toValue(rows)]
    const valueOf = toValue(columns)[column.value]
    if (!valueOf) return list
    const sign = direction.value === 'ascending' ? 1 : -1
    return list.sort((a, b) => compareValues({ a: valueOf(a), b: valueOf(b), sign }))
  })
  const ariaSort = (name) => (column.value === name ? direction.value : 'none')
  const toggle = (name) => {
    if (column.value !== name) {
      column.value = name
      direction.value = 'ascending'
      return
    }
    if (direction.value === 'ascending') {
      direction.value = 'descending'
      return
    }
    column.value = null
    direction.value = null
  }
  return { sorted, ariaSort, toggle }
}

export const timeOf = (value) => (value ? Date.parse(value) : null)

const isMissing = (value) =>
  value === null || value === undefined || value === '' || Number.isNaN(value)

const compareValues = ({ a, b, sign }) => {
  const aMissing = isMissing(a)
  const bMissing = isMissing(b)
  if (aMissing || bMissing) return aMissing - bMissing
  if (typeof a === 'string' && typeof b === 'string') {
    return sign * a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  }
  return sign * (Number(a) - Number(b))
}
