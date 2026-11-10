import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceActions } from '../web/src/sourceActions.js'

const labels = (row) => sourceActions(row).map(({ label }) => label)

test('a site row offers mute and weekly, or a way back', () => {
  assert.deepEqual(labels({ kind: 'site', key: 'Myer', name: 'Myer' }),
    ['Mute site', 'Check weekly'])
  assert.deepEqual(labels({ kind: 'site', key: 'Myer', name: 'Myer', state: 'weekly' }),
    ['Every run', 'Mute site'])
  assert.deepEqual(labels({ kind: 'site', key: 'Myer', name: 'Myer', state: 'muted' }),
    ['Restore'])
  const [mute] = sourceActions({ kind: 'site', key: 'Myer', name: 'Myer' })
  assert.deepEqual(mute.change, { kind: 'mute-site', name: 'Myer' })
})

test('a free check row turns off or back on by its URL', () => {
  const url = 'https://shop.example.au/p/1'
  const [off] = sourceActions({ kind: 'direct', key: url, name: 'Shop' })
  assert.deepEqual([off.label, off.change], ['Turn off', { kind: 'disable-direct', url }])
  const [on] = sourceActions({ kind: 'direct', key: url, name: 'Shop', state: 'off' })
  assert.deepEqual([on.label, on.change], ['Turn on', { kind: 'restore-direct', url }])
})

test('a source outside the item has no actions', () => {
  assert.deepEqual(sourceActions({ kind: 'other', key: 'eBay', name: 'eBay' }), [])
})
