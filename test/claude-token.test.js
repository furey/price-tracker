import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { testClaudeLogin } from '../src/claude-check.js'
import { openDb } from '../src/db.js'
import { runClaude } from '../src/research.js'
import { runItem } from '../src/runner.js'
import { claudeToken, publicSettings, setSetting } from '../src/settings.js'
import { scriptedClaude } from './fake-claude.js'

const ENV_TOKEN = 'sk-ant-oat01-from-env-1234'
const SAVED_TOKEN = 'sk-ant-oat01-saved-here-9876'

const item = {
  id: 'k7', name: 'K7', schedules: [], ntfy: { server: 'https://ntfy.sh', topic: 't' },
  categories: [{ id: 'a', description: 'a' }], rules: {}, heartbeat: { monthly: false }
}

test('the Claude token resolves from the setting first, then the env, and shows masked', () => {
  const db = openDb(':memory:')
  assert.equal(claudeToken({ db, env: {} }), null)
  assert.equal(claudeToken({ db, env: { CLAUDE_CODE_OAUTH_TOKEN: ENV_TOKEN } }), ENV_TOKEN)
  setSetting({ db, key: 'claudeOauthToken', value: SAVED_TOKEN })
  assert.equal(claudeToken({ db, env: { CLAUDE_CODE_OAUTH_TOKEN: ENV_TOKEN } }), SAVED_TOKEN)
  const shown = publicSettings({ db, env: {} }).find(({ key }) => key === 'claudeOauthToken')
  assert.deepEqual([shown.secret, shown.source, shown.value, shown.envName],
    [true, 'settings', '••••••', 'CLAUDE_CODE_OAUTH_TOKEN'])
  assert.ok(!JSON.stringify(publicSettings({ db, env: {} })).includes(SAVED_TOKEN))
  setSetting({ db, key: 'claudeOauthToken', value: null })
  assert.equal(claudeToken({ db, env: { CLAUDE_CODE_OAUTH_TOKEN: ENV_TOKEN } }), ENV_TOKEN)
})

test('runClaude passes the token to the child process env only', async () => {
  const claude = scriptedClaude([{ resultText: 'ok' }, { resultText: 'ok' }])
  await runClaude({ prompt: 'x', claudeToken: SAVED_TOKEN, spawnImpl: claude.spawnImpl,
    onEvent: () => {} })
  assert.equal(claude.calls[0].options.env.CLAUDE_CODE_OAUTH_TOKEN, SAVED_TOKEN)
  assert.ok(!claude.calls[0].args.join(' ').includes(SAVED_TOKEN))
  await runClaude({ prompt: 'x', spawnImpl: claude.spawnImpl, onEvent: () => {} })
  assert.equal(claude.calls[1].options.env.CLAUDE_CODE_OAUTH_TOKEN,
    process.env.CLAUDE_CODE_OAUTH_TOKEN)
})

test('a research run receives the resolved token', async () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'claudeOauthToken', value: SAVED_TOKEN })
  const seen = []
  await runItem({
    item, db, dryRun: true, deps: {
      log: () => {},
      research: async ({ claudeToken: token }) => {
        seen.push(token)
        return { ok: true, costUsd: 0, data: {
          checkedAt: new Date().toISOString(), sources: [], listings: []
        } }
      }
    }
  })
  assert.deepEqual(seen, [SAVED_TOKEN])
})

test('the login test reports ok, or the error with a setup-token hint', async () => {
  const db = openDb(':memory:')
  setSetting({ db, key: 'claudeOauthToken', value: SAVED_TOKEN })
  const dir = await mkdtemp(join(tmpdir(), 'claude-check-'))
  const claude = scriptedClaude([
    { resultText: 'ok' },
    { resultText: `Failed to authenticate. API Error: 401 OAuth token ${SAVED_TOKEN} is invalid.`,
      isError: true }
  ])
  const options = { db, env: {}, claudeLockPath: join(dir, 'claude.lock'), cwd: dir,
    spawnImpl: claude.spawnImpl }
  assert.deepEqual(await testClaudeLogin(options), { ok: true, reply: 'ok' })
  assert.deepEqual(claude.calls[0].args.slice(claude.calls[0].args.indexOf('--tools'), -2),
    ['--tools', '', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--restricted',
      '--disable-slash-commands', '--settings', '{"cleanupPeriodDays":14}'])
  const failed = await testClaudeLogin(options)
  assert.equal(failed.ok, false)
  assert.ok(!failed.error.includes(SAVED_TOKEN))
  assert.match(failed.hint, /claude setup-token/)
})
