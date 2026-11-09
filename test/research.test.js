import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { getItem } from '../src/config.js'
import {
  buildPrompt, extractJson, research, runClaude, webFetchRules
} from '../src/research.js'

const NOW = new Date('2026-11-07T00:00:00Z')

const envelope = (overrides = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  session_id: 'sess-1',
  total_cost_usd: 0.25,
  num_turns: 3,
  ...overrides
})

const fakeChild = ({ stdout = '', stderr = '', code = 0, exits = true }) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 4242
  if (exits) {
    setImmediate(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout))
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      child.emit('close', code)
    })
  }
  return child
}

const scriptedSpawn = (children) => {
  const calls = []
  const spawnImpl = (bin, args, options) => {
    calls.push({ bin, args, options })
    return children[calls.length - 1]()
  }
  return { spawnImpl, calls }
}

const replyWith = (value) => () => fakeChild({ stdout: JSON.stringify(envelope(value)) })

const validReply = (item) => {
  const data = {
    checkedAt: '2026-11-07T08:00:00+11:00',
    sources: [{ name: 'Myer', status: 'ok', note: '' }],
    listings: [
      {
        retailer: 'Myer',
        title: 'Springfree O77',
        category: item.categories[0].id,
        rejectReason: null,
        price: 1700,
        wasPrice: null,
        effectivePrice: 1700,
        deliveryCost: null,
        isClearance: false,
        inStock: true,
        verified: true,
        url: 'https://www.myer.com.au/p/springfree',
        evidence: 'Now $1,700',
        notes: ''
      }
    ]
  }
  return `Here you go\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\``
}

test('extractJson uses the last json block', () => {
  const text = 'a\n```json\n{"n":1}\n```\nb\n```json\n{"n":2}\n```\n'
  assert.deepEqual(extractJson(text), { n: 2 })
})

test('extractJson falls back to the last plain block, then the whole text', () => {
  assert.deepEqual(extractJson('x\n```\n{"n":3}\n```'), { n: 3 })
  assert.deepEqual(extractJson('{"n":4}'), { n: 4 })
})

test('extractJson throws when nothing parses', () => {
  assert.throws(() => extractJson('no json here'), /No valid JSON/)
})

test('buildPrompt renders the springfree item with the key rules', () => {
  const prompt = buildPrompt({ item: getItem('springfree-medium-oval'), now: NOW })
  assert.match(prompt, /Today is 2026-11-07 \(Australia\/Sydney/)
  assert.match(prompt, /O77, 8 ft x 11 ft/)
  assert.match(prompt, /- bundle: /)
  assert.match(prompt, /- reject: /)
  assert.match(prompt, /do NOT decide whether to send an alert/i)
  assert.match(prompt, /less than 7 days old/)
  assert.match(prompt, /verified to true only if you saw the price on that product page/)
  assert.match(prompt, /Never invent/)
  assert.match(prompt, /sold by Amazon AU or by the brand/)
  assert.match(prompt, /"blocked"/)
  assert.match(prompt, /Set retailer to the exact source name from SOURCES/)
  assert.match(prompt, /put that seller in notes/)
  assert.match(prompt, /13\. You have at most/)
  assert.match(prompt, /Springfree Black Friday/)
  assert.match(prompt, /- BuyWisely: Good for cross-retailer/)
  assert.match(prompt, /- Springfree Trampoline AU \(https:\/\/www\.springfreetrampoline/)
  assert.ok(prompt.endsWith('write nothing after it.'))
})

test('buildPrompt omits seasonal searches outside their window', () => {
  const item = getItem('springfree-medium-oval')
  const prompt = buildPrompt({ item, now: new Date('2026-12-01T20:00:00Z') })
  assert.doesNotMatch(prompt, /Springfree Black Friday/)
  assert.doesNotMatch(prompt, /Seasonal search phrases/)
})

test('buildPrompt uses the Sydney date near midnight UTC', () => {
  const item = getItem('springfree-medium-oval')
  const prompt = buildPrompt({ item, now: new Date('2026-11-30T14:30:00Z') })
  assert.match(prompt, /Today is 2026-12-01/)
  assert.doesNotMatch(prompt, /Springfree Black Friday/)
})

test('runClaude builds the args and parses the envelope', async () => {
  const { spawnImpl, calls } = scriptedSpawn([replyWith({ result: 'hello' })])
  const result = await runClaude({
    prompt: 'find it',
    maxTurns: 7,
    timeoutMs: 5000,
    model: 'sonnet',
    resumeSessionId: 'abc',
    cwd: '/tmp/work',
    spawnImpl
  })
  assert.equal(result.resultText, 'hello')
  assert.equal(result.sessionId, 'sess-1')
  assert.equal(result.costUsd, 0.25)
  assert.equal(calls[0].bin, process.env.CLAUDE_BIN ?? 'claude')
  assert.deepEqual(calls[0].args, [
    '-p', 'find it',
    '--output-format', 'stream-json', '--verbose',
    '--tools', 'WebSearch,WebFetch',
    '--allowedTools', webFetchRules().join(','),
    '--permission-mode', 'dontAsk',
    '--strict-mcp-config',
    '--restricted',
    '--disable-slash-commands',
    '--settings', '{"cleanupPeriodDays":14}',
    '--max-turns', '7',
    '--model', 'sonnet',
    '--resume', 'abc'
  ])
  assert.equal(calls[0].options.detached, true)
  assert.equal(calls[0].options.cwd, '/tmp/work')
  assert.equal(calls[0].options.stdio[0], 'ignore')
})

test('runClaude rejects when the envelope reports an error', async () => {
  const { spawnImpl } = scriptedSpawn([
    replyWith({ is_error: true, subtype: 'error_max_turns', result: 'ran out' })
  ])
  await assert.rejects(runClaude({ prompt: 'p', timeoutMs: 5000, spawnImpl }), /error_max_turns/)
})

test('runClaude rejects on a non-zero exit without an envelope', async () => {
  const { spawnImpl } = scriptedSpawn([() => fakeChild({ stderr: 'login required', code: 1 })])
  await assert.rejects(
    runClaude({ prompt: 'p', timeoutMs: 5000, spawnImpl }),
    /code 1: login required/
  )
})

test('runClaude kills the process group on timeout', async () => {
  const { spawnImpl } = scriptedSpawn([() => fakeChild({ exits: false })])
  const kills = []
  await assert.rejects(
    runClaude({
      prompt: 'p',
      timeoutMs: 20,
      killGraceMs: 20,
      spawnImpl,
      killImpl: (pid, signal) => kills.push([pid, signal])
    }),
    /timed out/
  )
  assert.deepEqual(kills[0], [-4242, 'SIGTERM'])
  await new Promise((resolve) => setTimeout(resolve, 60))
  assert.deepEqual(kills[1], [-4242, 'SIGKILL'])
})

test('research returns validated data on the first attempt', async () => {
  const item = getItem('springfree-medium-oval')
  const { spawnImpl, calls } = scriptedSpawn([replyWith({ result: validReply(item) })])
  const result = await research({ item, now: NOW, spawnImpl })
  assert.equal(result.ok, true)
  assert.equal(result.attempts, 1)
  assert.equal(result.costUsd, 0.25)
  assert.equal(result.data.listings.length, 1)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].options.cwd.endsWith('claude-work'))
})

test('research resumes the session with a nudge after an invalid reply', async () => {
  const item = getItem('springfree-medium-oval')
  const { spawnImpl, calls } = scriptedSpawn([
    replyWith({ result: 'I could not format that', total_cost_usd: 0.5 }),
    replyWith({ result: validReply(item), session_id: 'sess-2', total_cost_usd: 0.1 })
  ])
  const result = await research({ item, now: NOW, spawnImpl })
  assert.equal(result.ok, true)
  assert.equal(result.attempts, 2)
  assert.ok(Math.abs(result.costUsd - 0.6) < 1e-9)
  const resumeArgs = calls[1].args
  assert.equal(resumeArgs[resumeArgs.indexOf('--resume') + 1], 'sess-1')
  assert.match(resumeArgs[1], /^Your last reply was not valid\. Return ONLY the JSON object/)
})

test('research falls back to a fresh run with the nudge when the resume fails', async () => {
  const item = getItem('springfree-medium-oval')
  const { spawnImpl, calls } = scriptedSpawn([
    replyWith({ result: 'not json' }),
    () => fakeChild({ stderr: 'no such session', code: 1 }),
    replyWith({ result: validReply(item) })
  ])
  const result = await research({ item, now: NOW, spawnImpl })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 3)
  assert.equal(calls[2].args.includes('--resume'), false)
  assert.match(calls[2].args[1], /RULES[\s\S]*Your last reply was not valid/)
})

test('research fails after two invalid replies', async () => {
  const item = getItem('springfree-medium-oval')
  const { spawnImpl } = scriptedSpawn([
    replyWith({ result: 'nope' }),
    replyWith({ result: 'still nope' })
  ])
  const result = await research({ item, now: NOW, spawnImpl })
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 2)
  assert.ok(result.errors.length > 0)
})

test('research does not retry when the run itself fails', async () => {
  const item = getItem('springfree-medium-oval')
  const { spawnImpl, calls } = scriptedSpawn([
    () => fakeChild({ stderr: 'boom', code: 2 })
  ])
  const result = await research({ item, now: NOW, spawnImpl })
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 1)
  assert.equal(calls.length, 1)
})

test('buildPrompt adds the delivery location when one is set', async () => {
  const item = await getItem('springfree-medium-oval')
  const prompt = buildPrompt({
    item,
    now: new Date('2026-11-07T00:00:00Z'),
    delivery: { postcode: '2000', suburb: 'Sydney' }
  })
  assert.match(prompt, /DELIVERY\nThe buyer lives at Sydney 2000 Australia\./)
  assert.match(prompt, /Never enter it into a checkout/)
})

test('buildPrompt leaves out the delivery section without a location', async () => {
  const item = await getItem('springfree-medium-oval')
  const prompt = buildPrompt({ item, now: new Date('2026-11-07T00:00:00Z'), delivery: null })
  assert.doesNotMatch(prompt, /DELIVERY\n/)
})

test('buildPrompt accepts new eBay AU listings from Australian business sellers only', () => {
  const prompt = buildPrompt({ item: getItem('springfree-medium-oval'), now: NOW })
  assert.match(prompt, /eBay AU: accept a listing only if the condition is New/)
  assert.match(prompt, /official eBay store/)
  assert.match(prompt, /Reject used, refurbished, open-box, overseas, grey-import, and private/)
  assert.match(prompt, /Reject Gumtree, Facebook Marketplace/)
  assert.doesNotMatch(prompt, /Reject marketplace third-party sellers, eBay,/)
  assert.match(prompt, /set retailer to "eBay AU"/)
})

test('buildPrompt lists the memberships and limits member prices to them', () => {
  const prompt = buildPrompt({
    item: getItem('springfree-medium-oval'), now: NOW, memberships: ['eBay Plus', 'Costco']
  })
  assert.match(prompt, /MEMBERSHIPS\nThe buyer holds these memberships: eBay Plus, Costco\./)
  assert.match(prompt, /only for a membership in that list/)
  assert.match(prompt, /eBay Plus coupon code/)
  assert.match(prompt, /rejectReason that names the membership/)
})

test('buildPrompt says the buyer holds no memberships when the list is empty', () => {
  const prompt = buildPrompt({ item: getItem('springfree-medium-oval'), now: NOW })
  assert.match(prompt, /The buyer holds no memberships\./)
})

test('buildPrompt adds the kit section, accessory category and part field', () => {
  const prompt = buildPrompt({ item: getItem('springfree-medium-oval'), now: NOW })
  assert.match(prompt, /\nKITS\n/)
  assert.match(prompt, /- accessory: a single kit part/)
  assert.match(prompt, /- sunshade: /)
  assert.match(prompt, /- flexrstep: /)
  assert.match(prompt, /- wheels: /)
  assert.match(prompt, /Tag each single accessory listing with category "accessory"/)
  assert.match(prompt, /ready-made bundle, from any Australian retailer/)
  assert.match(prompt, /Black Friday/)
  assert.match(prompt, /"part": null/)
})

test('buildPrompt leaves out kits when the item has none', () => {
  const prompt = buildPrompt({ item: getItem('karcher-k7'), now: NOW })
  assert.doesNotMatch(prompt, /\nKITS\n/)
  assert.doesNotMatch(prompt, /- accessory:/)
})
