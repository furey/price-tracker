import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ITEM_SECTIONS, sectionElementId, sectionFromHash } from '../web/src/itemSections.js'

test('sectionFromHash reads a known section after the item id', () => {
  ITEM_SECTIONS.forEach((section) => {
    assert.equal(sectionFromHash(`#/item/karcher-k7/${section}`), section)
  })
  assert.equal(sectionFromHash('#/item/karcher-k7/runs?x=1'), 'runs')
  assert.equal(sectionFromHash('#/item/karcher-k7/sources/extra'), 'sources')
})

test('sectionFromHash ignores other routes and unknown sections', () => {
  assert.equal(sectionFromHash('#/item/karcher-k7'), null)
  assert.equal(sectionFromHash('#/item/karcher-k7/edit'), null)
  assert.equal(sectionFromHash('#/item/karcher-k7/kits'), null)
  assert.equal(sectionFromHash('#/item/karcher-k7/alert/12'), null)
  assert.equal(sectionFromHash('#/settings'), null)
  assert.equal(sectionFromHash(undefined), null)
})

test('sectionElementId prefixes the section name', () => {
  assert.equal(sectionElementId('phone'), 'item-phone')
})
