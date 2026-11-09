import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openDb } from '../src/db.js'
import {
  SettingsError, deliveryFrom, maskSecret, membershipsFrom, ntfyTokenFor, publicSettings,
  resolveSettings, rotateAppTopic, setSetting, setSettings
} from '../src/settings.js'

const item = { ntfy: { tokenEnv: 'NTFY_PT_TOKEN' } }
const env = { NTFY_PT_TOKEN: 'envtoken1234', DELIVERY_POSTCODE: ' 2000 ' }

test('openDb creates the settings table and reopening is harmless', () => {
  const db = openDb(':memory:')
  const columns = db.prepare('PRAGMA table_info(settings)').all().map(({ name }) => name)
  assert.deepEqual(columns, ['key', 'value', 'updated_at'])
})

test('resolveSettings falls back to env, trimmed, with the item token variable', () => {
  const settings = resolveSettings({ db: openDb(':memory:'), env, item })
  assert.deepEqual(settings.ntfyToken, { value: 'envtoken1234', source: 'env' })
  assert.deepEqual(settings.deliveryPostcode, { value: '2000', source: 'env' })
  assert.deepEqual(settings.deliverySuburb, { value: null, source: null })
})

test('a stored override wins over env and clearing it restores env', () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'deliveryPostcode', value: '3000' })
  assert.deepEqual(
    resolveSettings({ db, env, item }).deliveryPostcode,
    { value: '3000', source: 'settings' }
  )
  setSetting({ db, key: 'deliveryPostcode', value: null })
  assert.equal(resolveSettings({ db, env, item }).deliveryPostcode.source, 'env')
  setSetting({ db, key: 'deliveryPostcode', value: '3000' })
  setSetting({ db, key: 'deliveryPostcode', value: '  ' })
  assert.equal(resolveSettings({ db, env, item }).deliveryPostcode.source, 'env')
})

test('setSetting rejects bad values and unknown keys', () => {
  const db = openDb(':memory:')
  assert.throws(() => setSetting({ db, key: 'deliveryPostcode', value: '22' }), SettingsError)
  assert.throws(() => setSetting({ db, key: 'deliveryPostcode', value: 2000 }), SettingsError)
  assert.throws(() => setSetting({ db, key: 'ntfyToken', value: 'has space' }), SettingsError)
  assert.throws(() => setSetting({ db, key: 'nope', value: 'x' }), SettingsError)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0)
})

test('setSettings applies nothing when one change is invalid', () => {
  const db = openDb(':memory:')
  const changes = { deliverySuburb: 'Sydney', deliveryPostcode: 'abcd' }
  assert.throws(() => setSettings({ db, changes }), SettingsError)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0)
})

test('publicSettings masks secrets and reports the source', () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'ntfyToken', value: 'tk_overridden_ab12' })
  const list = publicSettings({ db, env, item })
  const token = list.find(({ key }) => key === 'ntfyToken')
  assert.equal(token.value, '••••••')
  assert.equal(token.source, 'settings')
  assert.equal(token.envName, 'NTFY_PT_TOKEN')
  assert.equal(JSON.stringify(list).includes('tk_overridden'), false)
  assert.equal(list.find(({ key }) => key === 'deliveryPostcode').value, '2000')
  const unset = publicSettings({ db, env: {}, item })
  assert.equal(unset.find(({ key }) => key === 'deliverySuburb').isSet, false)
})

test('maskSecret shows no characters of the secret', () => {
  assert.equal(maskSecret('short'), '••••••')
  assert.equal(maskSecret('x'.repeat(40)), '••••••')
})

test('tokenEnv outside NTFY_ names is ignored', () => {
  const db = openDb(':memory:')
  const hostile = { ntfy: { tokenEnv: 'SESSION_SECRET' } }
  const settings = resolveSettings({ db, env: { SESSION_SECRET: 'x'.repeat(40) }, item: hostile })
  assert.equal(settings.ntfyToken.value, null)
  assert.equal(publicSettings({ db, env: {}, item: hostile })[0].envName, 'NTFY_ACCESS_TOKEN')
})

test('ntfyTokenFor withholds the token from servers other than the trusted origin', () => {
  const db = openDb(':memory:')
  const settings = resolveSettings({ db, env: { NTFY_ACCESS_TOKEN: 'tk_secret' } })
  const at = (server) => ntfyTokenFor({ settings, item: { ntfy: { server } }, env: {} })
  assert.deepEqual(at('https://ntfy.sh/'), { token: 'tk_secret', withheld: false })
  assert.deepEqual(at('https://attacker.example'), { token: null, withheld: true })
  const custom = { NTFY_TRUSTED_SERVER: 'https://ntfy.home.lan' }
  const home = { ntfy: { server: 'https://ntfy.home.lan' } }
  assert.equal(ntfyTokenFor({ settings, item: home, env: custom }).token, 'tk_secret')
})

test('deliveryFrom builds the location or null', () => {
  const db = openDb(':memory:')
  assert.equal(deliveryFrom(resolveSettings({ db, env: {}, item })), null)
  const settings = resolveSettings({ db, env: { ...env, DELIVERY_SUBURB: 'Sydney' }, item })
  assert.deepEqual(deliveryFrom(settings), { postcode: '2000', suburb: 'Sydney' })
})

test('memberships default to eBay Plus, read MEMBERSHIPS, and accept an override', () => {
  const db = openDb(':memory:')
  assert.deepEqual(membershipsFrom(resolveSettings({ db, env: {} })), ['eBay Plus'])
  assert.deepEqual(
    membershipsFrom(resolveSettings({ db, env: { MEMBERSHIPS: 'Costco, OnePass' } })),
    ['Costco', 'OnePass']
  )
  setSetting({ db, key: 'memberships', value: 'Flybuys' })
  assert.deepEqual(membershipsFrom(resolveSettings({ db, env: {} })), ['Flybuys'])
  setSetting({ db, key: 'memberships', value: 'none' })
  assert.deepEqual(membershipsFrom(resolveSettings({ db, env: {} })), [])
})

test('setSetting rejects an overlong membership name', () => {
  const db = openDb(':memory:')
  assert.throws(
    () => setSetting({ db, key: 'memberships', value: 'x'.repeat(41) }),
    SettingsError
  )
})

test('rotating the app topic replaces it with a new random topic', () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'appTopic', value: 'price-tracker-app-old' })
  const topic = rotateAppTopic({ db })
  assert.match(topic, /^pt-app-[0-9a-f]{32}$/)
  assert.equal(resolveSettings({ db, env: {} }).appTopic.value, topic)
})
