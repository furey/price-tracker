import { askConfirm, changeLine } from './confirm.js'
import { formatDayMonth, timeZoneLabel } from './format.js'

export const confirmPauseAllAi = () => askConfirm({
  title: 'Pause all AI checks?',
  message: [
    'Scheduled AI research stops for every item. Run now and new item drafts ask you to '
      + 'choose Run anyway before they use Claude.',
    'Free price checks keep running on their own schedules, and alerts from them still arrive.'
  ],
  note: 'You can resume AI checks at any time from the Claude usage card.',
  confirmLabel: 'Pause all AI checks'
})

export const confirmResumeAi = ({ hold }) => askConfirm({
  title: 'Resume AI checks?',
  message: [
    'Scheduled AI research starts again for every active item, using your Claude usage.',
    hold && hold.reason !== 'paused'
      && `AI checks stay blocked while they are ${hold.label}, even after you resume.`
  ],
  note: 'You can pause all AI checks again at any time.',
  confirmLabel: 'Resume AI checks'
})

export const confirmPauseItem = ({ item, untilDay = null }) => askConfirm({
  title: `Pause ${item.name}?`,
  message: [
    untilDay
      ? `No checks run for this item until ${formatDayMonth(untilDay)}. It resumes on its own `
        + `at midnight ${timeZoneLabel()}.`
      : 'No AI or free checks run for this item until you resume it.',
    'Its price history and settings stay, and pausing does not make a new version.'
  ],
  note: 'You can resume it at any time.',
  confirmLabel: untilDay ? 'Pause until then' : 'Pause item'
})

export const confirmResumeItem = ({ item }) => askConfirm({
  title: `Resume ${item.name}?`,
  message: [
    'Scheduled checks start again from the next slot. AI checks use your Claude usage.'
  ],
  note: 'You can pause it again at any time.',
  confirmLabel: 'Resume item'
})

export const confirmArchive = ({ name }) => askConfirm({
  title: `Archive ${name}?`,
  message: [
    'All checks stop and the item moves out of the main list.',
    'Its price history, versions, and alerts stay.'
  ],
  note: 'You can restore it later. Delete is only available once it is archived.',
  confirmLabel: 'Archive item'
})

export const confirmRestore = ({ name }) => askConfirm({
  title: `Restore ${name}?`,
  message: ['The item returns to the list as active, and its scheduled checks start again.'],
  note: 'You can archive it again at any time.',
  confirmLabel: 'Restore item'
})

export const confirmDelete = ({ id, name }) => askConfirm({
  title: `Delete ${name}?`,
  message: [
    'This removes the item, every version, and all its runs, prices, and alerts.',
    'If the item came from a repo file, that file is not imported again.'
  ],
  note: 'This cannot be undone.',
  confirmLabel: 'Delete item and history',
  danger: true,
  typeToConfirm: id
})

export const confirmRestoreVersion = ({ version, nextVersion, tuningDiffers = false }) =>
  askConfirm({
    title: `Restore version ${version}?`,
    message: [
      `The settings from version ${version} are saved as a new version ${nextVersion}.`,
      'Prices already recorded keep the rules they were judged by.',
      tuningDiffers && 'Your current tuning (muted models, sites, and hidden products) is kept, '
        + `so nothing you muted since version ${version} comes back.`
    ],
    toggle: tuningDiffers
      ? { label: `Also restore the tuning from version ${version}`, initial: false }
      : null,
    note: 'Nothing is lost: the current version stays in the list and can be restored too.',
    confirmLabel: `Save as version ${nextVersion}`
  })

export const confirmNewTopic = () => askConfirm({
  title: 'Generate a new ntfy topic?',
  message: [
    'After you save, alerts go to the new topic. Phones subscribed to the old topic stop '
      + 'getting alerts until you subscribe to the new topic in the ntfy app.'
  ],
  note: 'Nothing changes until you save the item. Discard puts the old topic back.',
  confirmLabel: 'Generate new topic'
})

export const confirmRun = ({
  name, dryRun, anyway = false, guardMessage = null, weekly, hold = null
}) =>
  askConfirm({
    title: dryRun ? `Start a dry run of ${name}?` : `Run ${name} now?`,
    message: [
      dryRun
        ? 'Claude researches prices now. Nothing is saved to history and no alerts are sent.'
        : 'Claude researches prices now, saves them to history, and sends alerts that qualify.',
      `A run takes about 7 to 10 minutes of Claude time and uses your Claude usage. ${
        weeklyText(weekly)}`,
      hold && !anyway && `AI checks are ${hold.label}, so you are asked once more before `
        + 'this run goes ahead.',
      anyway && guardMessage,
      anyway && 'Run anyway ignores the AI pause and your reserve for this one run.'
    ],
    note: 'A started run cannot be stopped from the dashboard.',
    confirmLabel: runLabel({ dryRun, anyway })
  })

export const confirmClearOverride = ({ setting, envText }) => askConfirm({
  title: `Clear the ${setting.label} override?`,
  message: [
    `The override saved here is deleted, and ${setting.label} goes back to ${envText}.`
  ],
  note: 'You can save a new override at any time.',
  confirmLabel: 'Clear override'
})

export const confirmSettingChange = ({ setting, from, to, effect }) => askConfirm({
  title: `Change ${setting.label}?`,
  message: [effect],
  changes: [changeLine({ label: setting.label, from, to })],
  note: 'The new value applies at once. You can change it back at any time.',
  confirmLabel: `Save ${setting.label}`
})

export const confirmDiscardDraft = ({ name }) => askConfirm({
  title: `Discard the ${name} draft?`,
  message: ['The answers, research, and suggested settings for this draft are deleted.'],
  note: 'This cannot be undone. No item is created.',
  confirmLabel: 'Discard draft',
  danger: true
})

export const confirmSaveItem = ({ name, testAlert = true }) => askConfirm({
  title: `Save ${name}?`,
  message: [
    'The item becomes active and its scheduled AI and free checks start.',
    testAlert && 'A test alert goes to its ntfy topic now.'
  ],
  note: 'You can pause, edit, or archive the item later.',
  confirmLabel: 'Save item'
})

const weeklyText = (weekly) => {
  if (typeof weekly?.percent !== 'number') return 'No current weekly reading.'
  return `Weekly usage is ${weekly.percent}% now (reserve ${weekly.reserve}%).`
}

const runLabel = ({ dryRun, anyway }) => {
  if (anyway) return dryRun ? 'Start dry run anyway' : 'Run anyway'
  return dryRun ? 'Start dry run' : 'Run now'
}

export const confirmDraftAnyway = ({ guardMessage, weekly }) => askConfirm({
  title: 'Run the draft research anyway?',
  message: [
    guardMessage,
    `Drafting uses about 10 to 20 minutes of Claude time and your Claude usage. ${
      weeklyText(weekly)}`,
    'Run anyway ignores the AI pause and your reserve for this draft only.'
  ],
  note: 'Other AI checks stay paused.',
  confirmLabel: 'Run anyway'
})

export const confirmDismissSuggestion = ({ title }) => askConfirm({
  title: `Dismiss "${title}"?`,
  message: [
    'The suggestion comes back only when its evidence doubles, a new kind of evidence appears, '
      + 'or 90 days pass.'
  ],
  toggle: { label: 'Do not suggest this again', initial: false },
  note: 'Nothing about the item changes. Dismissed suggestions stay listed under Tuning.',
  confirmLabel: 'Dismiss'
})

export const confirmAcceptEverywhere = ({ title, state, items }) => askConfirm({
  title: `${title} on every item?`,
  message: [
    'The same change is suggested on each item that lists this site. Each item saves a new '
      + 'version with the same note.'
  ],
  changes: items.map(({ itemName, name }) => changeLine({
    label: `${itemName}: ${name}`, from: 'Every run', to: state
  })),
  confirmLabel: `Save ${items.length} versions`
})
