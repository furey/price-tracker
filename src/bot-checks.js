export const BOT_CHECK = 'bot_check'
export const BOT_CHECK_SEEN_REASON = 'bot-check-seen'
export const BOT_CHECK_HINT = 'Open the page in your own browser when you have time, then record '
  + 'the price as a Chrome check.'

export const isBotCheck = ({ status, note } = {}) =>
  status === 'blocked' && BOT_CHECK_PATTERN.test(String(note ?? ''))

export const latestDecidingCheck = (recent = []) => recent
  .find(({ mode, status }) => mode !== MANUAL_MODE || CLEARING_STATUSES.includes(status))

export const botCheckOf = (row) => {
  if (OFF_STATES.includes(row?.state)) return null
  const latest = latestDecidingCheck(row?.recent)
  if (!latest || latest.mode === MANUAL_MODE || !isBotCheck(latest)) return null
  return {
    at: latest.at,
    note: latest.note,
    url: latest.url ?? null,
    urlKind: latest.urlKind ?? null
  }
}

export const botCheckFlags = ({ item, rows, feedback = [] }) => {
  const seen = seenKeys(feedback)
  return rows
    .filter(({ kind }) => FLAGGED_KINDS.includes(kind))
    .map((row) => ({ row, check: botCheckOf(row) }))
    .filter(({ check }) => check)
    .map(({ row, check }) => ({
      itemId: item.id,
      itemName: item.name,
      kind: row.kind,
      key: row.key,
      name: row.name,
      at: check.at,
      note: check.note,
      url: check.url,
      urlKind: check.urlKind
    }))
    .filter((flag) => !seen.has(seenKey(flag)))
}

export const seenRecord = ({ kind, key, at }) => ({ kind, key, blockedAt: at })

export const seenKey = ({ itemId, kind, key, at }) => JSON.stringify([itemId, kind, key, at])

const MANUAL_MODE = 'manual'
const CLEARING_STATUSES = ['ok', 'not_found']
const OFF_STATES = ['muted', 'off']
const FLAGGED_KINDS = ['site', 'direct']
const BOT_CHECK_PATTERN = new RegExp([
  'captcha',
  'challenge',
  'verify (?:that )?you(?: are|\'re|r) (?:a )?human',
  'are you a (?:human|robot)',
  '\\bbot\\b',
  'access denied',
  'cloudflare',
  'perimeter ?x',
  'akamai',
  'datadome',
  'incapsula',
  'pardon our interruption',
  'just a moment',
  '\\b403\\b'
].join('|'), 'i')

const seenKeys = (feedback) => new Set(feedback
  .filter(({ reason }) => reason === BOT_CHECK_SEEN_REASON)
  .map(({ itemId, changes }) => seenKey({
    itemId, kind: changes?.kind, key: changes?.key, at: changes?.blockedAt
  })))
