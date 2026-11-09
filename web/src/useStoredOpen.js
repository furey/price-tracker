import { ref, watch } from 'vue'

const PREFIX = 'price-tracker:open:'

export const useStoredOpen = ({ key, initial = false }) => {
  const open = ref(readStored({ key, initial }))
  watch(open, (value) => writeStored({ key, value }))
  return open
}

const readStored = ({ key, initial }) => {
  try {
    const stored = window.localStorage.getItem(`${PREFIX}${key}`)
    return stored === null ? initial : stored === '1'
  } catch {
    return initial
  }
}

const writeStored = ({ key, value }) => {
  try {
    window.localStorage.setItem(`${PREFIX}${key}`, value ? '1' : '0')
  } catch {
    return null
  }
}
