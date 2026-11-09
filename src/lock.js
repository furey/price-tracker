import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class LockHeldError extends Error {
  constructor({ path, pid, startedAt, label = null }) {
    const holder = label ? ` (${label})` : ''
    super(`Lock ${path} is held by pid ${pid}${holder} since ${startedAt}`)
    this.name = 'LockHeldError'
    this.pid = pid
    this.startedAt = startedAt
    this.label = label
  }
}

export const withLock = async ({ path, fn, label = null }) => {
  await mkdir(dirname(path), { recursive: true })
  await acquire({ path, label, attemptsLeft: 3 })
  try {
    return await fn()
  } finally {
    await release(path)
  }
}

export const lockHolder = async (path) => {
  const holder = await readHolder(path)
  return holder && isAlive(holder.pid) ? holder : null
}

const acquire = async ({ path, label, attemptsLeft }) => {
  try {
    const holder = { pid: process.pid, startedAt: new Date().toISOString(), label }
    await writeFile(path, JSON.stringify(holder), { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const live = await lockHolder(path)
    if (live) throw new LockHeldError({ path, ...live })
    if (attemptsLeft === 0) throw error
    await unlink(path).catch(() => {})
    await acquire({ path, label, attemptsLeft: attemptsLeft - 1 })
  }
}

const release = async (path) => {
  const holder = await readHolder(path)
  if (holder?.pid !== process.pid) return
  await unlink(path).catch(() => {})
}

const readHolder = async (path) => {
  try {
    const holder = JSON.parse(await readFile(path, 'utf8'))
    return Number.isInteger(holder?.pid) ? holder : null
  } catch {
    return null
  }
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}
