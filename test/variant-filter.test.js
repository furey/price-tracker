import assert from 'node:assert/strict'
import { test } from 'node:test'
import { variantFilterProblem, variantMatcher } from '../src/variant-filter.js'

test('variantMatcher matches plain alternatives case-insensitively', () => {
  const matches = variantMatcher('blue|black')
  assert.equal(matches('K7 Premium - Black'), true)
  assert.equal(matches('K7 Premium - BLUE'), true)
  assert.equal(matches('K7 Premium - Red'), false)
  assert.equal(variantMatcher('medium oval')('Sun Bundle - Medium Oval'), true)
})

test('variantMatcher keeps anchors at the ends of a choice', () => {
  const exact = variantMatcher('^sun shade - medium oval$')
  assert.equal(exact('Sun Shade - Medium Oval'), true)
  assert.equal(exact('Sun Shade - Medium Oval Plus'), false)
  assert.equal(variantMatcher('^k7')('K7 Premium'), true)
  assert.equal(variantMatcher('^k7')('New K7'), false)
  assert.equal(variantMatcher('oval$')('Medium Oval'), true)
})

test('variantMatcher with no filter matches everything', () => {
  assert.equal(variantMatcher(undefined)('anything'), true)
  assert.equal(variantMatcher(null)('anything'), true)
})

test('variantMatcher refuses regex syntax, including backtracking traps', () => {
  for (const filter of ['(a|a?)+$', '(.|.?)+QQQ', '(a+)+$', 'a.*b', '[ab]', 'a{2}', 'a\\d',
    'a||b', 'a|', 'mid^dle', '^$']) {
    assert.equal(variantMatcher(filter), null, filter)
    assert.ok(variantFilterProblem(filter), filter)
  }
})

test('variantMatcher runs in linear time on a long hostile title', () => {
  const matches = variantMatcher('aaaa|bbbb')
  const started = performance.now()
  assert.equal(matches(`${'a'.repeat(100_000)}!`), true)
  assert.ok(performance.now() - started < 50)
})

test('variantFilterProblem accepts real stored filters', () => {
  for (const filter of ['medium oval', '^sun shade - medium oval$', 'blue|black', undefined]) {
    assert.equal(variantFilterProblem(filter), null, String(filter))
  }
  assert.ok(variantFilterProblem(''))
  assert.ok(variantFilterProblem(5))
})
