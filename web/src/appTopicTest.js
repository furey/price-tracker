import { formatTime } from './format.js'

export const appTestOutcome = ({ delivered, sentAt, error }) => delivered
  ? { tone: 'good', text: `Test notice sent to the app topic at ${formatTime(sentAt)}.` }
  : {
    tone: 'bad',
    text: `Test notice to the app topic was not delivered${error ? `: ${error}` : '.'}`
  }
