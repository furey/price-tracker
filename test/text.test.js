import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPrice, roundToCurrency, sanitizeOutgoing } from '../src/text.js'

const aud = (amount) => formatPrice({ amount, currency: 'AUD', locale: 'en-AU' })

test('sanitizeOutgoing replaces em and en dashes with hyphens', () => {
  assert.equal(sanitizeOutgoing('a — b – c'), 'a - b - c')
})

test('sanitizeOutgoing strips emoji, variation selectors, and ZWJ', () => {
  assert.equal(sanitizeOutgoing('Deal \u{1F525} found ❤️'), 'Deal found')
  assert.equal(sanitizeOutgoing('a‍b'), 'ab')
})

test('sanitizeOutgoing keeps non-ASCII letters', () => {
  assert.equal(sanitizeOutgoing('Kärcher K7 deal found'), 'Kärcher K7 deal found')
})

test('sanitizeOutgoing collapses doubled spaces and keeps newlines', () => {
  assert.equal(sanitizeOutgoing('a  b\nc   d'), 'a b\nc d')
})

test('formatPrice omits cents when whole', () => {
  assert.equal(aud(1049), '$1,049')
  assert.equal(aud(0), '$0')
})

test('formatPrice uses two decimals when fractional', () => {
  assert.equal(aud(1049.5), '$1,049.50')
  assert.equal(aud(99.99), '$99.99')
})

test('formatPrice follows the currency and locale', () => {
  assert.equal(formatPrice({ amount: 1049, currency: 'USD', locale: 'en-US' }), '$1,049')
  assert.equal(formatPrice({ amount: 1049.5, currency: 'GBP', locale: 'en-GB' }), '£1,049.50')
  assert.equal(formatPrice({ amount: 1049.4, currency: 'JPY', locale: 'en-US' }), '¥1,049')
  assert.equal(formatPrice({ amount: 1049, currency: 'AUD', locale: 'en-US' }), 'A$1,049')
})

test('formatPrice output survives sanitizeOutgoing as plain spaces', () => {
  const euros = formatPrice({ amount: 1049.5, currency: 'EUR', locale: 'fr-FR' })
  assert.equal(sanitizeOutgoing(`Price: ${euros}`), 'Price: 1 049,50 €')
  assert.equal(sanitizeOutgoing(`Price: ${aud(1049)}`), 'Price: $1,049')
})

test('roundToCurrency rounds to the minor unit of the currency', () => {
  assert.equal(roundToCurrency({ amount: 12.345, currency: 'AUD' }), 12.35)
  assert.equal(roundToCurrency({ amount: 1234.5, currency: 'JPY' }), 1235)
})

test('sanitizeOutgoing strips control and bidi characters but keeps newlines', () => {
  assert.equal(sanitizeOutgoing('a\u0000b\u0007c\u001Bd\u0085e'), 'abcde')
  assert.equal(sanitizeOutgoing('line one\r\nline\ttwo'), 'line one\nline two')
  assert.equal(sanitizeOutgoing('ok.com.au/x\u202Egnp.exe'), 'ok.com.au/xgnp.exe')
  assert.equal(sanitizeOutgoing('\u2066Bunnings\u2069 \u200E\u200Fdeal'), 'Bunnings deal')
  assert.equal(sanitizeOutgoing('Kärcher'), 'Kärcher')
})
