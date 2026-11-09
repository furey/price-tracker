import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateItem } from './item-validate.js'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ITEMS_DIR = path.join(PROJECT_ROOT, 'items')
export const STATE_DIR = path.join(PROJECT_ROOT, 'state')
export const LOGS_DIR = path.join(PROJECT_ROOT, 'logs')
export const DB_PATH = process.env.DB_PATH || path.join(STATE_DIR, 'price-tracker.db')

export const loadEnv = () => {
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (existsSync(envPath)) process.loadEnvFile(envPath)
}

export const loadItems = ({ dir = ITEMS_DIR } = {}) => {
  const files = readdirSync(dir).filter((file) => file.endsWith('.json')).sort()
  return files
    .map((file) => readItemFile({ dir, file }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export const getItem = (id, { dir = ITEMS_DIR } = {}) => {
  const items = loadItems({ dir })
  const found = items.find((item) => item.id === id)
  if (found) return found
  const known = items.map((item) => item.id).join(', ')
  throw new Error(`Unknown item "${id}". Known: ${known}`)
}

export { validateItem }

const readItemFile = ({ dir, file }) => {
  const item = parseItemJson({ dir, file })
  const errors = validateItem(item, file.replace(/\.json$/, ''))
  if (errors.length === 0) return item
  throw new Error(`Invalid item file ${file}:\n- ${errors.join('\n- ')}`)
}

const parseItemJson = ({ dir, file }) => {
  try {
    return JSON.parse(readFileSync(path.join(dir, file), 'utf8'))
  } catch (error) {
    throw new Error(`Cannot parse item file ${file}: ${error.message}`)
  }
}
