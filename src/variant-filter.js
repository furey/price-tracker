export const variantMatcher = (filter) => {
  if (filter === undefined || filter === null || filter === '') return () => true
  const alternatives = parseAlternatives(filter)
  if (!alternatives) return null
  return (title) => {
    const text = String(title ?? '').toLowerCase()
    return alternatives.some((alternative) => matchesAlternative({ text, alternative }))
  }
}

export const variantFilterProblem = (filter) => {
  if (filter === undefined || filter === null) return null
  if (typeof filter !== 'string' || filter.trim() === '') return 'expected a non-empty string'
  return parseAlternatives(filter) ? null : FILTER_RULE
}

const FILTER_RULE = 'use plain words separated by |; ^ and $ only at the start or end '
  + 'of a choice; no other symbols such as . * + ? ( ) [ ] { } \\'

const REGEX_SYMBOLS = /[\\.*+?()[\]{}^$]/

const parseAlternatives = (filter) => {
  if (typeof filter !== 'string') return null
  const alternatives = filter.split('|').map(parseAlternative)
  return alternatives.every(Boolean) ? alternatives : null
}

const parseAlternative = (raw) => {
  const trimmed = raw.trim()
  const atStart = trimmed.startsWith('^')
  const atEnd = trimmed.endsWith('$') && trimmed.length > (atStart ? 1 : 0)
  const text = trimmed.slice(atStart ? 1 : 0, atEnd ? -1 : undefined)
  if (text.trim() === '' || REGEX_SYMBOLS.test(text)) return null
  return { text: text.toLowerCase(), atStart, atEnd }
}

const matchesAlternative = ({ text, alternative }) => {
  if (alternative.atStart && alternative.atEnd) return text === alternative.text
  if (alternative.atStart) return text.startsWith(alternative.text)
  if (alternative.atEnd) return text.endsWith(alternative.text)
  return text.includes(alternative.text)
}
