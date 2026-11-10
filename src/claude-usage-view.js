import { capStatus } from './ai-usage.js'
import { nextProbeAt } from './claude-check.js'
import { currentGuard, describeGuard } from './claude-guard.js'
import {
  WEEKLY_WINDOW, formatChanged, latestReadings, usageHistory, windowLabel
} from './claude-usage.js'
import { claudeLimits } from './settings.js'
import { claudeConnection } from './claude-connection.js'

export const claudeUsageView = ({ db, now = new Date(), env = process.env }) => {
  const limits = claudeLimits({ db, env })
  const readings = latestReadings({ db }).map((reading) => ({
    ...reading,
    label: windowLabel(reading.window),
    reserve: reading.window === 'five_hour' ? limits.sessionReserve : limits.weeklyReserve,
    expired: Boolean(reading.resetsAt) && Date.parse(reading.resetsAt) <= now.getTime()
  }))
  return {
    readings,
    weekly: readings.find(({ window }) => window === WEEKLY_WINDOW) ?? null,
    session: readings.find(({ window, expired }) => window === 'five_hour' && !expired) ?? null,
    guard: describeGuard(currentGuard({ db, now, env })),
    connection: publicConnection(claudeConnection({ db, env })),
    limits,
    history: usageHistory({ db, now }),
    formatChanged: formatChanged({ db }),
    nextProbeAt: nextProbeAt({ db }),
    month: capStatus({ db, now, env })
  }
}

const publicConnection = ({ connected, source, checkedAt }) => ({ connected, source, checkedAt })
