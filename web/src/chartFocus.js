export const toggleFocus = ({ current, name }) => (current === name ? null : name)

export const keepFocus = ({ focused, names }) => (names.includes(focused) ? focused : null)

export const focusedSeries = ({ series, focused }) =>
  focused === null ? series : series.filter((line) => line.name === focused)

export const niceStep = (raw) => {
  const power = 10 ** Math.floor(Math.log10(raw))
  const fraction = raw / power
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * power
}

export const niceDomain = ({ low, high }) => {
  const step = niceStep((high - low) / 4)
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step]
}

export const priceDomain = ({ series, capValues }) => {
  const prices = series.flatMap((line) => line.points.map((point) => point.value))
  const values = [...prices, ...capValues]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const pad = (high - low) * 0.08 || high * 0.05 || 1
  return niceDomain({ low: Math.max(0, low - pad), high: high + pad })
}
