export const ITEM_SECTIONS = [
  'listings', 'alerts', 'runs', 'tuning', 'sources', 'retailers', 'kit', 'changes', 'phone'
]

export const sectionFromHash = (hash) => {
  const name = String(hash ?? '').match(/^#\/item\/[^/?]+\/([a-z]+)(?:[/?]|$)/)?.[1]
  return ITEM_SECTIONS.includes(name) ? name : null
}

export const sectionElementId = (section) => `item-${section}`
