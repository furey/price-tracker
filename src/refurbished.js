export const REFURBISHED_CATEGORY = 'refurbished'
export const REFURBISHED_DESCRIPTION = 'Refurbished by the manufacturer, or certified ' +
  'refurbished by a retailer, with a stated warranty'

export const acceptsRefurbished = (config) => config?.accept?.refurbished === true

export const applyRefurbished = ({ config, accepted }) => {
  if (accepted) return addRefurbished(config)
  removeRefurbished(config)
}

const addRefurbished = (config) => {
  config.accept = { ...config.accept, refurbished: true }
  config.categories ??= []
  if (!config.categories.some(({ id }) => id === REFURBISHED_CATEGORY)) {
    config.categories.push({ id: REFURBISHED_CATEGORY, description: REFURBISHED_DESCRIPTION })
  }
  config.rules ??= {}
  config.rules[REFURBISHED_CATEGORY] ??= { maxPrice: suggestedCap(config) }
}

const removeRefurbished = (config) => {
  if (config.accept) delete config.accept.refurbished
  if (config.accept && Object.keys(config.accept).length === 0) delete config.accept
  config.categories = (config.categories ?? []).filter(({ id }) => id !== REFURBISHED_CATEGORY)
  if (config.rules) delete config.rules[REFURBISHED_CATEGORY]
}

const suggestedCap = (config) => {
  const firstId = config.categories?.find(({ id }) => id !== REFURBISHED_CATEGORY)?.id
  const cap = config.rules?.[firstId]?.maxPrice
  return typeof cap === 'number' ? Math.round((cap * REFURBISHED_SHARE) / 10) * 10 : null
}

const REFURBISHED_SHARE = 0.85
