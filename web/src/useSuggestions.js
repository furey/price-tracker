import { ref } from 'vue'
import {
  dismissSuggestion, getSuggestions, getItems, restoreSuggestion, tuneItem
} from './api.js'
import { confirmAcceptEverywhere, confirmDismissSuggestion } from './confirmCopy.js'
import { loadWho, whoLabel } from './who.js'

export const SUGGESTION_REASON_LENGTH = 200

export const useSuggestions = ({ itemId, editHref, requestTune, notify, afterSave }) => {
  const report = ref(null)
  const busy = ref(null)

  const load = async () => {
    try {
      report.value = await getSuggestions(itemId())
    } catch {
      report.value = null
    }
  }

  const accept = (suggestion) => {
    if (suggestion.action) {
      window.location.hash = `${editHref()}/${EDIT_SECTIONS[suggestion.action]}`
      return
    }
    requestTune({ changes: [suggestion.change], reason: clipReason(suggestion) })
  }

  const acceptEverywhere = async (suggestion) => {
    if (!currentWho()) return notify({ tone: 'bad', text: NEEDS_WHO })
    const targets = [
      { itemId: itemId(), itemName: 'This item', name: suggestion.change.name },
      ...suggestion.alsoOn
    ]
    const state = suggestion.change.kind === 'mute-site' ? 'Muted' : 'Weekly'
    const ok = await confirmAcceptEverywhere({ title: suggestion.title, state, items: targets })
    if (!ok) return
    busy.value = suggestion.id
    try {
      const saved = await saveEverywhere({ suggestion, targets })
      notify({ tone: 'good', text: `${suggestion.title}: saved on ${saved} items.` })
      await afterSave()
    } catch (error) {
      notify({ tone: 'bad', text: error.message })
    } finally {
      busy.value = null
    }
  }

  const dismiss = async (suggestion) => {
    if (!currentWho()) return notify({ tone: 'bad', text: NEEDS_WHO })
    const answer = await confirmDismissSuggestion({ title: suggestion.title })
    if (!answer) return
    await act({
      suggestion,
      call: () => dismissSuggestion({
        id: itemId(), suggestionId: suggestion.id, by: whoLabel.value,
        permanent: answer.toggle === true
      }),
      text: `Dismissed: ${suggestion.title}.`
    })
  }

  const restore = async (suggestion) => {
    if (!currentWho()) return notify({ tone: 'bad', text: NEEDS_WHO })
    await act({
      suggestion,
      call: () => restoreSuggestion({
        id: itemId(), suggestionId: suggestion.id, by: whoLabel.value
      }),
      text: `Showing again: ${suggestion.title}.`
    })
  }

  const act = async ({ suggestion, call, text }) => {
    busy.value = suggestion.id
    try {
      await call()
      notify({ tone: 'good', text })
      await load()
    } catch (error) {
      notify({ tone: 'bad', text: error.message })
    } finally {
      busy.value = null
    }
  }

  return { report, busy, load, accept, acceptEverywhere, dismiss, restore }
}

const EDIT_SECTIONS = { 'edit-prices': 'alert-prices', 'edit-categories': 'look-for' }

const NEEDS_WHO = 'Choose who you are under Settings > About before you change suggestions.'

const saveEverywhere = async ({ suggestion, targets }) => {
  const items = await getItems()
  const versionOf = new Map(items.map(({ id, version }) => [id, version]))
  const reason = clipReason(suggestion)
  for (const target of targets) {
    await tuneItem({
      id: target.itemId,
      baseVersion: versionOf.get(target.itemId),
      changes: [{ kind: suggestion.change.kind, name: target.name }],
      by: whoLabel.value,
      reason,
      note: `Suggested on every item: ${suggestion.title}`
    })
  }
  return targets.length
}

const currentWho = () => whoLabel.value || loadWho()

const clipReason = (suggestion) => suggestion.reason.slice(0, SUGGESTION_REASON_LENGTH)
