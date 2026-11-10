import { DIRECT_OFF, MUTED, WEEKLY } from '../../src/tuning.js'

export const sourceActions = ({ kind, key, name, state = null }) => {
  if (kind === 'site') return siteActions({ name, state })
  if (kind !== 'direct') return []
  return [directAction({ url: key, retailer: name, off: state === DIRECT_OFF })]
}

const siteActions = ({ name, state }) => {
  const mute = {
    label: 'Mute site', change: { kind: 'mute-site', name }, reason: 'Not worth the AI time'
  }
  const weekly = {
    label: 'Check weekly', change: { kind: 'weekly-site', name }, reason: 'Check less often'
  }
  const restore = {
    label: state === MUTED ? 'Restore' : 'Every run',
    change: { kind: 'restore-site', name },
    reason: `Check ${name} every run`
  }
  if (state === MUTED) return [restore]
  if (state === WEEKLY) return [restore, mute]
  return [mute, weekly]
}

const directAction = ({ url, retailer, off }) => (off
  ? { label: 'Turn on', change: { kind: 'restore-direct', url }, reason: `Check ${retailer} again` }
  : { label: 'Turn off', change: { kind: 'disable-direct', url }, reason: 'Free check not useful' })
