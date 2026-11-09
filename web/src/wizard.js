import { monthlyRuns } from '../../src/draft-schedule.js'
import { currentRegion } from './format.js'

export const REVIEW_STEPS = ['models', 'prices', 'sources', 'schedule']
export const FLOW_STEPS = [...REVIEW_STEPS, 'test', 'save']
export const RUNNING_STATUSES = ['scoping', 'researching', 'testing']
export const POLL_MS = 5000

export const isBusy = (draft) => Boolean(draft)
  && (RUNNING_STATUSES.includes(draft.status) || Boolean(draft.jobState))

export const progressFor = ({ status, step }) => {
  if (status === 'clarifying') return { filled: 2, label: 'Step 2 of 5 · Clarify' }
  if (['scoping', 'researching'].includes(status)) {
    return status === 'scoping'
      ? { filled: 2, label: 'Step 2 of 5 · Understanding your request' }
      : { filled: 3, label: 'Step 3 of 5 · Research' }
  }
  if (REVIEW_STEPS.includes(step)) {
    const index = REVIEW_STEPS.indexOf(step) + 1
    return { filled: 4, label: `Step 4 of 5 · Review · ${index} of ${REVIEW_STEPS.length}` }
  }
  if (step === 'test') return { filled: 5, label: 'Step 5 of 5 · Test' }
  return { filled: 5, label: 'Step 5 of 5 · Save' }
}

export const cardState = (draft) => {
  const kind = draft.errorKind
  if (draft.status === 'clarifying') {
    return { pill: 'Needs your answers', tone: 'warn', action: 'Answer questions' }
  }
  if (draft.status === 'scoping') {
    return { pill: draft.jobState === 'queued' ? 'Waiting' : 'Understanding', tone: 'running',
      action: 'Open' }
  }
  if (draft.status === 'researching') {
    return { pill: draft.jobState === 'queued' ? 'Waiting' : 'Researching', tone: 'running',
      action: 'Open' }
  }
  if (draft.status === 'testing') return { pill: 'Testing', tone: 'running', action: 'Open' }
  if (draft.status === 'review') return { pill: 'Ready to review', tone: 'ok', action: 'Review' }
  if (kind === 'out_of_scope') return { pill: 'Out of scope', tone: 'failed', action: 'Open' }
  if (kind === 'duplicate') return { pill: 'Already tracking', tone: 'neutral', action: 'Open' }
  if (kind === 'limited') return { pill: 'Usage limit', tone: 'warn', action: 'Open' }
  return { pill: 'Stopped', tone: 'warn', action: 'Open' }
}

export const draftName = (draft) => draft.title ?? draft.research?.title
  ?? shorten(draft.request ?? draft.input?.request ?? 'New item', 48)

export const shorten = (text, max) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value
}

export const elapsedMinutes = ({ from, now = Date.now() }) => {
  if (!from) return null
  return Math.max(0, Math.round((now - Date.parse(from)) / 60000))
}

export const runsFor = (schedules) => monthlyRuns({ schedules: schedules ?? [], now: new Date() })

export const scaleMarks = ({ rrp, lowestNow, lowest12Months, cap }) => {
  const values = [rrp, lowestNow, lowest12Months, cap].filter((value) => typeof value === 'number')
  if (values.length < 2) return null
  const low = Math.min(...values) * 0.97
  const high = Math.max(...values) * 1.01
  const at = (value) => (typeof value === 'number'
    ? Math.round(((value - low) / (high - low)) * 1000) / 10
    : null)
  const marks = [
    { key: 'year', value: lowest12Months, at: at(lowest12Months) },
    { key: 'now', value: lowestNow, at: at(lowestNow) },
    { key: 'rrp', value: rrp, at: at(rrp) }
  ].filter(({ at: position }) => position !== null)
  return { cap: at(cap), marks: withLabels({ marks }) }
}

const LABEL_GAP = 14

const withLabels = ({ marks }) => {
  const labelled = []
  return marks.toReversed().map((mark) => {
    const showLabel = !labelled.some((position) => Math.abs(position - mark.at) < LABEL_GAP)
    if (showLabel) labelled.push(mark.at)
    return { ...mark, showLabel, edge: edgeOf(mark.at) }
  })
}

export const edgeOf = (position) => {
  if (position > 88) return 'end'
  return position < 12 ? 'start' : ''
}

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export const cloneJson = (value) => JSON.parse(JSON.stringify(value))

export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export const todayInRegion = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: currentRegion().timeZone
}).format(new Date())
