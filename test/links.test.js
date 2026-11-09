import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  alertLink, draftPageLink, listingActions, normaliseDashboardUrl, settingsLink,
  validateDashboardUrl, itemLink
} from '../src/links.js'
import { sendNtfy } from '../src/notify.js'
import { openDb } from '../src/db.js'
import { dashboardUrlFrom, resolveSettings, setSetting, SettingsError } from '../src/settings.js'

const DASHBOARD = 'http://nas.local:4280'

test('link builders point at hash routes on the dashboard', () => {
  assert.equal(
    alertLink({ dashboardUrl: DASHBOARD, itemId: 'wcm-premium', alertId: 42 }),
    `${DASHBOARD}/#/item/wcm-premium/alert/42`
  )
  assert.equal(itemLink({ dashboardUrl: DASHBOARD, itemId: 'a b' }), `${DASHBOARD}/#/item/a%20b`)
  assert.equal(settingsLink(DASHBOARD), `${DASHBOARD}/#/settings`)
  assert.equal(
    draftPageLink({ dashboardUrl: DASHBOARD, draftId: 'ab12' }),
    `${DASHBOARD}/#/new/ab12`
  )
})

test('listingActions builds one view action that keeps the notification', () => {
  assert.deepEqual(listingActions('https://shop.example/p'), [
    { action: 'view', label: 'Open listing', url: 'https://shop.example/p', clear: false }
  ])
  assert.deepEqual(listingActions(null), [])
})

test('sendNtfy posts click and actions in the JSON body', async () => {
  const bodies = []
  const fetchImpl = async (url, options) => {
    bodies.push(JSON.parse(options.body))
    return { ok: true, status: 200 }
  }
  await sendNtfy({
    server: 'https://ntfy.sh', topic: 't', title: 'x', message: 'y', priority: 4,
    click: `${DASHBOARD}/#/item/w/alert/1`, actions: listingActions('https://shop.example/p'),
    fetchImpl
  })
  assert.equal(bodies[0].click, `${DASHBOARD}/#/item/w/alert/1`)
  assert.deepEqual(bodies[0].actions, [
    { action: 'view', label: 'Open listing', url: 'https://shop.example/p', clear: false }
  ])
})

test('dashboardUrl validates, strips trailing slashes, and has a default and env fallback', () => {
  assert.equal(normaliseDashboardUrl(' http://nas:4280/// '), 'http://nas:4280')
  assert.equal(validateDashboardUrl('ftp://nas'), 'must start with http:// or https://')
  assert.match(validateDashboardUrl('nas:4280'), /^must/)
  assert.equal(validateDashboardUrl('https://nas.example'), null)
  const db = openDb(':memory:')
  assert.equal(dashboardUrlFrom(resolveSettings({ db, env: {} })), 'http://localhost:4280')
  assert.equal(
    dashboardUrlFrom(resolveSettings({ db, env: { DASHBOARD_URL: 'http://nas:4280/' } })),
    'http://nas:4280'
  )
  setSetting({ db, key: 'dashboardUrl', value: 'https://tracker.example/' })
  assert.equal(dashboardUrlFrom(resolveSettings({ db, env: {} })), 'https://tracker.example')
  assert.throws(() => setSetting({ db, key: 'dashboardUrl', value: 'nope' }), SettingsError)
})
