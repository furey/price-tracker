import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  buildChangePrompt, buildResearchPrompt, buildScopePrompt
} from '../src/draft-prompts.js'
import { regionProfile } from '../src/regions/index.js'
import { buildPrompt, research, itemUrls, webFetchRules } from '../src/research.js'
import { scriptedClaude } from './fake-claude.js'
import {
  GOLDEN_CURRENT_DRAFT, GOLDEN_DELIVERY, GOLDEN_DIR, GOLDEN_EXISTING, GOLDEN_FAILING_SITES,
  GOLDEN_INPUT, GOLDEN_MEMBERSHIPS, GOLDEN_NOW, GOLDEN_RECENT_SITES, GOLDEN_ROUNDS,
  GOLDEN_URL_SETS, goldenItem, withRenamedKeys
} from './golden-inputs.js'

const AU = regionProfile({ id: 'au' })
const TODAY = '2026-11-07'
const ITEM_IDS = ['springfree-medium-oval', 'karcher-k7']

test('the AU research prompt matches the captured prompt apart from the renamed keys', () => {
  for (const id of ITEM_IDS) {
    const item = goldenItem(id)
    const full = buildPrompt({
      item, now: GOLDEN_NOW, delivery: GOLDEN_DELIVERY, memberships: GOLDEN_MEMBERSHIPS,
      recentSites: GOLDEN_RECENT_SITES, region: AU
    })
    assert.equal(full, expectedText(`research-prompt-${id}.txt`))
    const bare = buildPrompt({ item, now: GOLDEN_NOW, region: AU })
    assert.equal(bare, expectedText(`research-prompt-${id}-bare.txt`))
  }
})

test('the AU claude args match the captured args apart from the renamed keys', async () => {
  for (const id of ITEM_IDS) {
    const { spawnImpl, calls } = scriptedClaude([{ resultText: 'nope' }, { resultText: 'nope' }])
    await research({ item: goldenItem(id), now: GOLDEN_NOW, spawnImpl, region: AU })
    const expected = JSON.parse(fixture(`research-args-${id}.json`))
    assert.deepEqual(
      calls.map(({ args }) => args),
      expected.map(({ args }) => args.map((arg) => withRenamedKeys(arg)))
    )
  }
})

test('the AU WebFetch allowlist matches the captured allowlist', () => {
  for (const id of ITEM_IDS) {
    const rules = webFetchRules({ urls: itemUrls(goldenItem(id)), region: AU })
    assert.deepEqual(rules, expectedJson(`fetch-rules-${id}.json`))
  }
  for (const [name, urls] of Object.entries(GOLDEN_URL_SETS)) {
    assert.deepEqual(webFetchRules({ urls, region: AU }), expectedJson(`fetch-rules-${name}.json`))
  }
  assert.deepEqual(webFetchRules(), expectedJson('fetch-rules-default.json'))
})

test('the AU wizard prompts match the captured prompts apart from the renamed keys', () => {
  const scope = buildScopePrompt({
    input: GOLDEN_INPUT, existing: GOLDEN_EXISTING, delivery: GOLDEN_DELIVERY,
    memberships: GOLDEN_MEMBERSHIPS, today: TODAY, separateFrom: 'karcher-k7', region: AU
  })
  assert.equal(scope, expectedText('scope-prompt.txt'))
  const bareScope = buildScopePrompt({
    input: { request: 'a bike' }, existing: [], delivery: null, today: TODAY, region: AU
  })
  assert.equal(bareScope, expectedText('scope-prompt-bare.txt'))
  const wizardResearch = buildResearchPrompt({
    input: GOLDEN_INPUT, rounds: GOLDEN_ROUNDS, delivery: GOLDEN_DELIVERY,
    memberships: GOLDEN_MEMBERSHIPS, today: TODAY, endDate: '2026-12-20', questionsAllowed: true,
    failingSites: GOLDEN_FAILING_SITES, region: AU
  })
  assert.equal(wizardResearch, expectedText('wizard-research-prompt.txt'))
  const bareResearch = buildResearchPrompt({
    input: { request: 'a bike', budget: 500, budgetMode: 'limit' }, rounds: [], delivery: null,
    today: TODAY, endDate: null, questionsAllowed: false, region: AU
  })
  assert.equal(bareResearch, expectedText('wizard-research-prompt-bare.txt'))
  const change = buildChangePrompt({
    instruction: 'Add Bing Lee', current: GOLDEN_CURRENT_DRAFT, today: TODAY, region: AU
  })
  assert.equal(change, expectedText('change-prompt.txt'))
})

const fixture = (name) => readFileSync(resolve(GOLDEN_DIR, name), 'utf8')

const expectedText = (name) => withRenamedKeys(fixture(name))

const expectedJson = (name) => JSON.parse(fixture(name))
