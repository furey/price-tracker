export const sanitizeOutgoing = (text) => String(text ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/\t/g, ' ')
  .replace(/[   ]/g, ' ')
  .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
  .replace(/[‎‏‪-‮⁦-⁩]/g, '')
  .replace(/[–—]/g, '-')
  .replace(/\p{Extended_Pictographic}|[︎️‍⃣]/gu, '')
  .replace(/[ \t]{2,}/g, ' ')
  .replace(/[ \t]+$/gm, '')
  .trim()

export const formatPrice = ({ amount, currency, locale }) => {
  const digits = Number.isInteger(amount) ? 0 : currencyDigits(currency)
  return priceFormat({ currency, locale, digits }).format(amount)
}

export const currencyDigits = (currency) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits

export const roundToCurrency = ({ amount, currency }) => {
  const scale = 10 ** currencyDigits(currency)
  return Math.round(amount * scale) / scale
}

const formats = new Map()

const priceFormat = ({ currency, locale, digits }) => {
  const key = `${locale}|${currency}|${digits}`
  if (!formats.has(key)) {
    formats.set(key, new Intl.NumberFormat(locale, {
      style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits
    }))
  }
  return formats.get(key)
}
