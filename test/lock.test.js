import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LockHeldError, lockHolder, withLock } from '../src/lock.js'

const makeLockPath = async () => join(await mkdtemp(join(tmpdir(), 'lock-')), 'nested', 'tick.lock')

const DEAD_PID = 2 ** 30

test('withLock runs fn, holds a lockfile meanwhile, and releases after', async () => {
  const path = await makeLockPath()
  const result = await withLock({
    path,
    fn: async () => {
      const holder = JSON.parse(await readFile(path, 'utf8'))
      assert.equal(holder.pid, process.pid)
      assert.ok(holder.startedAt)
      return 'done'
    }
  })
  assert.equal(result, 'done')
  assert.equal(existsSync(path), false)
})

test('withLock throws LockHeldError when a live pid holds the lock', async () => {
  const path = await makeLockPath()
  await withLock({
    path,
    fn: async () => {
      await assert.rejects(withLock({ path, fn: async () => 'never' }), LockHeldError)
      assert.equal((await lockHolder(path)).pid, process.pid)
    }
  })
})

test('withLock replaces a stale lock from a dead pid', async () => {
  const path = await makeLockPath()
  await withLock({ path, fn: async () => {} })
  await writeFile(path, JSON.stringify({ pid: DEAD_PID, startedAt: '2026-01-01T00:00:00Z' }))
  assert.equal(await lockHolder(path), null)
  const result = await withLock({ path, fn: async () => 'recovered' })
  assert.equal(result, 'recovered')
})

test('withLock replaces a corrupt lockfile', async () => {
  const path = await makeLockPath()
  await withLock({ path, fn: async () => {} })
  await writeFile(path, 'not json')
  assert.equal(await withLock({ path, fn: async () => 'ok' }), 'ok')
})

test('withLock releases the lock when fn throws', async () => {
  const path = await makeLockPath()
  await assert.rejects(
    withLock({ path, fn: async () => { throw new Error('boom') } }),
    /boom/
  )
  assert.equal(existsSync(path), false)
})
