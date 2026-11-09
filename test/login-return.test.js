import assert from 'node:assert/strict'
import { test } from 'node:test'
import { alertRoute, hashAfterLogin, legacyHashTarget } from '../web/src/loginReturn.js'

test('hashAfterLogin restores the hash the visitor arrived with', () => {
  assert.equal(
    hashAfterLogin({ arrivedWith: '#/item/wcm/alert/7', current: '' }),
    '#/item/wcm/alert/7'
  )
  assert.equal(
    hashAfterLogin({ arrivedWith: '#/item/wcm/alert/7', current: '#/item/wcm/alert/7' }),
    null
  )
  assert.equal(hashAfterLogin({ arrivedWith: '', current: '#/settings' }), null)
})

test('alertRoute reads the item id and alert id from the hash', () => {
  assert.deepEqual(alertRoute('#/item/wcm-premium/alert/42'), {
    itemId: 'wcm-premium', alertId: 42
  })
  assert.equal(alertRoute('#/item/wcm-premium'), null)
  assert.equal(alertRoute('#/item/wcm-premium/alert/x'), null)
})

test('legacyHashTarget sends old watch links to the item routes', () => {
  assert.equal(legacyHashTarget('#/watch/wcm/alert/7'), '#/item/wcm/alert/7')
  assert.equal(legacyHashTarget('#/watch/wcm'), '#/item/wcm')
  assert.equal(legacyHashTarget('#/watch/wcm/edit'), '#/item/wcm/edit')
  assert.equal(legacyHashTarget('#/watches'), '#/items')
  assert.equal(legacyHashTarget('#/item/wcm'), null)
  assert.equal(legacyHashTarget('#/watchlist'), null)
  assert.equal(legacyHashTarget(''), null)
})
