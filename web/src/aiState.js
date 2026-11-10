import { computed, ref } from 'vue'
import { getClaudeUsage } from './api.js'

export const aiUsage = ref(null)

export const setAiUsage = (usage) => {
  aiUsage.value = usage
}

export const loadAiUsage = async () => {
  aiUsage.value = await getClaudeUsage()
  return aiUsage.value
}

export const aiHold = computed(() => holdFor(aiUsage.value))

export const holdFor = (usage) => {
  if (!usage) return null
  if (usage.month?.reached) return { reason: 'cap', label: 'monthly cap reached' }
  const guard = usage.guard
  if (!guard || guard.allow) return null
  return { reason: guard.reason, label: REASON_LABELS[guard.reason] ?? 'paused' }
}

export const claudeDisconnected = computed(() => aiUsage.value?.guard?.reason === 'disconnected')

const REASON_LABELS = {
  disconnected: 'waiting for Claude',
  paused: 'paused by you',
  reserve: 'above your Claude reserve',
  limited: 'Claude limit reached'
}
