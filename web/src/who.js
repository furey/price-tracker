import { ref } from 'vue'

export const WHO_CHOICES = ['Me']
export const MAX_WHO_LENGTH = 40

export const whoLabel = ref('')

export const loadWho = () => {
  whoLabel.value = readWho()
  return whoLabel.value
}

export const setWho = (name) => {
  const cleaned = String(name ?? '').trim().slice(0, MAX_WHO_LENGTH)
  whoLabel.value = cleaned
  writeWho(cleaned)
  return cleaned
}

export const whoChoices = () => [...new Set([...WHO_CHOICES, whoLabel.value].filter(Boolean))]

const STORAGE_KEY = 'price-tracker:who'

const readWho = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const writeWho = (name) => {
  try {
    if (name) window.localStorage.setItem(STORAGE_KEY, name)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    return null
  }
}
