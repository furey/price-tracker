import { formatDateTime, formatRelative } from './format.js'

export const nextChecks = ({ item, hold }) => [
  { label: 'Next AI check', short: 'AI', ...aiCheck({ item, hold }) },
  { label: 'Next free check', short: 'Free', ...freeCheck(item) }
]

export const aiHoldNote = ({ item, hold }) => {
  if (!hold || item.status !== 'active' || !(item.schedules ?? []).length) return null
  return item.nextDirectSlot
    ? 'AI checks paused · free checks running'
    : 'AI checks paused'
}

const aiCheck = ({ item, hold }) => {
  if (!(item.schedules ?? []).length) return { text: 'Off', muted: true }
  if (hold && item.status === 'active') return { text: 'Paused', detail: hold.label, muted: true }
  return slotText({ slot: item.nextSlot, item })
}

const freeCheck = (item) => {
  if (!item.nextDirectSlot && item.status === 'active') {
    return { text: 'None set up', muted: true }
  }
  return slotText({ slot: item.nextDirectSlot, item })
}

const slotText = ({ slot, item }) => {
  if (!slot) return { text: item.status === 'active' ? '-' : 'Not scheduled', muted: true }
  return { text: formatDateTime(slot), detail: formatRelative(slot), muted: false, time: true }
}
