import { isCategoryMuted } from '../../src/tuning.js'
import { bestRecentByCategory, targetPrice } from '../../src/verdict.js'

export const RECENT_WINDOW_DAYS = 30
export const ENDED_WINDOW_LIMIT = 6

export const recentDealWindows = ({ windows = [], now = new Date() }) => {
  const since = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10)
  const live = windows.filter((window) => window.live)
  const ended = windows.filter((window) => !window.live && window.endDay >= since)
  return [...live, ...ended.slice(0, ENDED_WINDOW_LIMIT)]
}

export const priceTableRows = ({
  item, bestDays = [], retailers = [], verdict = null, now = new Date()
}) => {
  const recent = bestRecentByCategory({ item, retailers, now })
  const lowest = new Map(bestDays.map((best) => [best.category, best]))
  return (item.categories ?? [])
    .map(({ id }) => id)
    .filter((category) => !isCategoryMuted({ item, category }))
    .map((category) => ({
      category,
      bestNow: recent.get(category) ?? null,
      lowest: lowest.get(category) ?? null,
      target: targetPrice({ rule: item.rules?.[category] }),
      highlighted: verdict?.category === category
    }))
}

const DAY_MS = 86_400_000
