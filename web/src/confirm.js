import { shallowRef } from 'vue'

export const pendingConfirm = shallowRef(null)

export const askConfirm = (options) => new Promise((resolve) => {
  pendingConfirm.value?.resolve(false)
  pendingConfirm.value = { ...options, resolve }
})

export const settleConfirm = (answer) => {
  const pending = pendingConfirm.value
  pendingConfirm.value = null
  pending?.resolve(answer)
}

export const changeLine = ({ label, from, to }) => ({
  label,
  from: blankAsNone(from),
  to: blankAsNone(to)
})

const blankAsNone = (value) => {
  const text = String(value ?? '').trim()
  return text === '' ? 'None' : text
}
