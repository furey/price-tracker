export const hashAfterLogin = ({ arrivedWith, current }) =>
  arrivedWith && arrivedWith !== current ? arrivedWith : null

export const alertRoute = (hash) => {
  const match = /^#\/item\/([^/?]+)\/alert\/(\d+)/.exec(hash)
  return match ? { itemId: decodeURIComponent(match[1]), alertId: Number(match[2]) } : null
}

export const legacyHashTarget = (hash) => {
  const match = LEGACY_HASH.exec(hash ?? '')
  return match ? `#/${LEGACY_SECTIONS[match[1]]}${match[2]}` : null
}

const LEGACY_HASH = /^#\/(watches|watch)((?:[/?].*)?)$/

const LEGACY_SECTIONS = { watch: 'item', watches: 'items' }
