#!/usr/bin/env node
import { mkdirSync } from 'node:fs'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { DB_PATH, loadEnv } from './config.js'
import {
  getRun, lastAlert, lastRun, lastSuccessAt, historyRows, normaliseStoredRetailers, openDb
} from './db.js'
import { lowestPerRetailerPerDay } from './decide.js'
import { startDaemon } from './daemon.js'
import { sweepItems } from './bot-check-routes.js'
import { install, uninstall } from './launchd.js'
import { LockHeldError } from './lock.js'
import { research } from './research.js'
import { createDraftWorker } from './draft-worker.js'
import { recheckDisconnected, startupProbe } from './claude-check.js'
import {
  CLAUDE_LOCK_PATH, DIRECT_MODE, RESEARCH_MODE, TICK_LOCK_PATH, recordObservation,
  runItemLocked, schedulesFor, sendTestNotification, tick
} from './runner.js'
import { activeRegion } from './region.js'
import { nextSlot } from './schedule.js'
import {
  deliveryFrom, resolveSettings, rotateAppTopic, screenshotCapMb
} from './settings.js'
import { startServer } from './server.js'
import { sweepPrompt } from './sweep.js'
import { SCREENSHOT_DIR, pruneScreenshots, saveScreenshot } from './screenshot-store.js'
import {
  MAX_SCREENSHOTS_PER_RUN, MAX_SCREENSHOT_BYTES, capBytesFromMb, detectImageType
} from './screenshots.js'
import { formatPrice } from './text.js'
import {
  exportConfig, pauseItem, pinSeeds, requireItem, resumeItem, rotateTopic, seedItems,
  itemRecords
} from './item-store.js'

const commands = {
  tick: async () => {
    await runTick(openStore())
  },

  run: async ({ args, values }) => {
    const db = openStore()
    const record = requireItem({ db, id: requireArg(args, 'item id') })
    const item = record.config
    const dryRun = values['dry-run'] === true
    const mode = values.direct === true ? DIRECT_MODE : RESEARCH_MODE
    if (record.status === 'archived') throw new Error(`Item "${item.id}" is archived`)
    if (mode === DIRECT_MODE && !item.direct?.length) {
      throw new Error(`Item "${item.id}" has no direct entries`)
    }
    const result = await runItemLocked({
      item, itemVersion: record.version, trigger: 'manual', dryRun, mode, db, deps: { log }
    })
    if (result.status === 'failed') throw new Error(`Run failed: ${result.error}`)
    const region = activeRegion({ db })
    if (dryRun) printDryRun({ result, region })
    else printRunSummary({ result, region })
  },

  record: async ({ args, values }) => {
    const db = openStore()
    const record = requireItem({ db, id: requireArg(args, 'item id') })
    const data = JSON.parse(await readFile(requireArg(args.slice(1), 'JSON file'), 'utf8'))
    const shots = values.screenshots ? await readScreenshots(values.screenshots) : []
    const result = await recordObservation({
      item: record.config, itemVersion: record.version, data, db, deps: { log }
    })
    log(`${record.id} recorded run ${result.runId}`)
    if (shots.length) attachScreenshots({ db, runId: result.runId, shots })
    printDecision({ decision: result.decision, region: activeRegion({ db }) })
  },

  research: async ({ args }) => {
    const db = openStore()
    const item = requireItem({ db, id: requireArg(args, 'item id') }).config
    const delivery = deliveryFrom(resolveSettings({ db, item }))
    const region = activeRegion({ db })
    const result = await research({ item, now: new Date(), log, delivery, region })
    if (!result.ok) throw new Error(`Research failed: ${result.errors.join('; ')}`)
    console.log(JSON.stringify(result.data, null, 2))
  },

  'test-notify': async ({ args }) => {
    const db = openStore()
    const item = requireItem({ db, id: requireArg(args, 'item id') }).config
    const outcome = await sendTestNotification({ item, db, log })
    if (!outcome.delivered) throw new Error(`Test notification not delivered: ${outcome.error}`)
    const sentAt = formatLocal({ iso: new Date().toISOString(), region: activeRegion({ db }) })
    console.log(`Test notification delivered at ${sentAt}`)
  },

  history: async ({ args, values }) => {
    const db = openStore()
    const item = requireItem({ db, id: requireArg(args, 'item id') }).config
    const days = Number.parseInt(values.days ?? '30', 10)
    const rows = historyRows({ db, itemId: item.id, days })
    const region = activeRegion({ db })
    const tz = item.schedules?.[0]?.tz ?? region.timeZone
    printHistoryTable({ rows: lowestPerRetailerPerDay(rows, { tz }), region })
  },

  sweep: async ({ values }) => {
    const db = openStore()
    const items = sweepItems({ db, records: itemRecords({ db }), now: new Date() })
    if (values.json) return console.log(JSON.stringify({ items }, null, 2))
    if (items.length === 0) return console.log('No blocked pages to check in Chrome')
    console.log(sweepPrompt({ items, labels: activeRegion({ db }).deliveryLabels }))
  },

  status: async () => {
    const db = openStore()
    const region = activeRegion({ db })
    for (const record of itemRecords({ db })) printItemStatus({ db, record, region })
  },

  pause: async ({ args, values }) => {
    const db = openStore()
    const region = activeRegion({ db })
    const record = pauseItem({
      db, id: requireArg(args, 'item id'), until: values.until, tz: region.timeZone
    })
    console.log(`${record.id} ${describeStatus({ ...record, region })}`)
  },

  resume: async ({ args }) => {
    const record = resumeItem({ db: openStore(), id: requireArg(args, 'item id') })
    console.log(`${record.id} resumed`)
  },

  export: async ({ args }) => {
    const db = openStore({ quiet: true })
    const record = requireItem({ db, id: requireArg(args, 'item id') })
    process.stdout.write(exportConfig(record.config))
  },

  'pin-seeds': async () => {
    const ids = pinSeeds({ db: openStore({ quiet: true }) })
    console.log(`Marked the seeds of ${ids.join(', ') || 'no items'} as applied`)
  },

  'rotate-topics': async () => {
    const db = openStore()
    itemRecords({ db }).forEach(({ id }) => {
      const record = rotateTopic({ db, id })
      console.log(`${id}: new ntfy topic in version ${record.version}`)
    })
    rotateAppTopic({ db })
    console.log('app: new ntfy topic')
  },

  normalise: async () => {
    const db = openStore()
    const items = itemRecords({ db }).map((record) => record.config)
    const changes = normaliseStoredRetailers({ db, items })
    console.log(`Rewrote ${changes.listings} listings and ${changes.alerts} alerts`)
  },

  install: async () => {
    await install({ log })
  },

  uninstall: async () => {
    await uninstall({ log })
  },

  serve: async () => {
    const db = openStore()
    const worker = createDraftWorker({ db, log })
    const server = await startServer({ db, worker })
    const { address, port } = server.address()
    log(`serving on http://${address}:${port} (database ${DB_PATH})`)
    worker.start()
    onShutdown(async () => {
      server.close()
      await Promise.race([worker.stop(), sleep(SHUTDOWN_GRACE_MS)])
    })
  },

  daemon: async () => {
    if (process.env.HOME) mkdirSync(process.env.HOME, { recursive: true })
    await rm(TICK_LOCK_PATH, { force: true })
    await rm(CLAUDE_LOCK_PATH, { force: true })
    const db = openStore()
    const worker = createDraftWorker({ db, log })
    const server = await startServer({ db, worker })
    const { address, port } = server.address()
    log(`serving on http://${address}:${port} (database ${DB_PATH})`)
    worker.start()
    const schedulerDisabled = process.env.DISABLE_SCHEDULER === '1'
    if (!schedulerDisabled) {
      startupProbe({ db, log }).catch((error) => log(`Claude usage probe failed: ${error.message}`))
    }
    const scheduler = startDaemon({ runTick: () => runTick(db), log, disabled: schedulerDisabled })
    onShutdown(async () => {
      log('shutting down')
      server.close()
      await Promise.race([
        Promise.all([scheduler.stop(), worker.stop()]), sleep(SHUTDOWN_GRACE_MS)
      ])
    })
  }
}

const SHUTDOWN_GRACE_MS = 8000

const openStore = ({ quiet = false } = {}) => {
  const db = openDb()
  seedItems({ db, log: quiet ? warnOnly : log })
  return db
}

const warnOnly = (message) => {
  if (message.startsWith('WARNING')) console.error(message)
}

const runTick = async (db) => {
  await recheckDisconnected({ db, log })
    .catch((error) => log(`Claude login recheck failed: ${error.message}`))
  try {
    const outcomes = await tick({ db, log })
    const ran = outcomes.filter(({ action }) => action === 'ran').length
    const deferred = outcomes.filter(({ action }) => action === 'deferred-ai-busy').length
    const guarded = outcomes.filter(({ action }) => action === 'skipped-claude-guard').length
    const deferredText = deferred ? `, ${deferred} deferred (AI busy)` : ''
    const guardedText = guarded ? `, ${guarded} skipped (Claude usage guard)` : ''
    log(`tick done: ${ran} of ${outcomes.length} checks ran${deferredText}${guardedText}`)
  } catch (error) {
    if (!(error instanceof LockHeldError)) throw error
    log(`tick skipped: ${error.message}`)
  }
}

const onShutdown = (cleanup) => {
  let shuttingDown = false
  const handle = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await cleanup()
    process.exit(0)
  }
  process.on('SIGTERM', handle)
  process.on('SIGINT', handle)
}

const readScreenshots = async (dir) => {
  const names = (await readdir(dir)).filter((name) => SCREENSHOT_FILE.test(name)).sort()
  const shots = await Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(dir, name))
    return { name, bytes, kind: detectImageType(bytes) }
  }))
  const problems = shots.flatMap(({ name, bytes, kind }) => [
    ...(kind ? [] : [`${name}: not a PNG, JPEG, or WebP image`]),
    ...(bytes.length > MAX_SCREENSHOT_BYTES ? [`${name}: over 2 MB`] : [])
  ])
  if (shots.length > MAX_SCREENSHOTS_PER_RUN) {
    problems.push(`${shots.length} screenshots: the limit is ${MAX_SCREENSHOTS_PER_RUN} per run`)
  }
  if (problems.length) throw new Error(`Screenshots not recorded: ${problems.join('; ')}`)
  return shots
}

const attachScreenshots = ({ db, runId, shots }) => {
  const run = getRun({ db, id: runId })
  const now = new Date()
  shots.forEach(({ bytes, kind }) => saveScreenshot({
    db, dir: SCREENSHOT_DIR, run, bytes, kind, now
  }))
  const pruned = pruneScreenshots({
    db, dir: SCREENSHOT_DIR, capBytes: capBytesFromMb(screenshotCapMb({ db }))
  })
  log(`run ${runId}: ${shots.length} screenshots saved, ${pruned.length} old ones pruned`)
}

const SCREENSHOT_FILE = /\.(png|jpe?g|webp)$/i

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  loadEnv()
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      direct: { type: 'boolean' },
      days: { type: 'string' },
      until: { type: 'string' },
      screenshots: { type: 'string' },
      json: { type: 'boolean' }
    }
  })
  const [name, ...args] = positionals
  const command = commands[name]
  if (!command) throw new Error(usage(name))
  await command({ args, values })
}

const printDryRun = ({ result, region }) => {
  console.log(JSON.stringify(result.research, null, 2))
  console.log('')
  printDecision({ decision: result.decision, region })
  console.log('')
  printMessage('Deal message that would be sent', result.messages.deal)
  printMessage('Heartbeat message that would be sent', result.messages.heartbeat)
}

const printRunSummary = ({ result, region }) => {
  printDecision({ decision: result.decision, region })
  const dealState = describeDelivery(result.messages.deal, result.delivery.deal)
  console.log(`Deal alert: ${dealState}`)
  const heartbeatState = describeDelivery(result.messages.heartbeat, result.delivery.heartbeat)
  console.log(`Heartbeat: ${heartbeatState}`)
}

const printDecision = ({ decision, region }) => {
  console.log(`Eligible: ${decision.eligible.length}, qualified: ${decision.qualified.length}`)
  console.log('Qualified:')
  printEntries({
    entries: decision.qualified.map(({ listing, reasons }) => ({
      listing,
      note: reasons.join(', ')
    })),
    region
  })
  console.log('Suppressed:')
  printEntries({
    entries: decision.suppressed.map(({ listing, reason }) => ({ listing, note: reason })),
    region
  })
  console.log('Kits:')
  printEntries({
    entries: (decision.kitListings ?? []).map((listing) => ({ listing, note: listing.evidence })),
    region
  })
  const best = decision.best ? describeListing({ listing: decision.best.listing, region }) : 'none'
  console.log(`Best: ${best}`)
}

const printEntries = ({ entries, region }) => {
  if (entries.length === 0) return console.log('  none')
  for (const { listing, note } of entries) {
    console.log(`  ${describeListing({ listing, region })} (${note})`)
  }
}

const printMessage = (heading, message) => {
  if (!message) return console.log(`${heading}: none`)
  console.log(`${heading}:`)
  console.log(`  Title: ${message.title}`)
  for (const line of message.message.split('\n')) console.log(`  ${line}`)
  const click = message.click ? `, click: ${message.click}` : ''
  console.log(`  Priority: ${message.priority}${click}`)
}

const printItemStatus = ({ db, record, region }) => {
  const item = record.config
  const run = lastRun({ db, itemId: item.id })
  const success = lastSuccessAt({ db, itemId: item.id })
  const alert = lastAlert({ db, itemId: item.id })
  const now = new Date()
  const local = (iso) => formatLocal({ iso, region })
  console.log(`${item.id} (${describeStatus({ ...record, region })}, version ${record.version})`)
  const lastRunText = run ? `${local(run.startedAt)} ${run.status} (${run.mode})` : 'never'
  console.log(`  Last run: ${lastRunText}`)
  console.log(`  Last research success: ${success ? local(success) : 'never'}`)
  const nextResearch = describeNextSlot({ item, mode: RESEARCH_MODE, now, region })
  console.log(`  Next research slot: ${nextResearch}`)
  if (item.direct?.length) printDirectStatus({ db, item, now, region })
  console.log(`  Last alert: ${alert ? describeAlert({ alert, region }) : 'never'}`)
}

const printDirectStatus = ({ db, item, now, region }) => {
  const success = lastSuccessAt({ db, itemId: item.id, mode: DIRECT_MODE })
  const lastSuccess = success ? formatLocal({ iso: success, region }) : 'never'
  console.log(`  Last direct success: ${lastSuccess}`)
  console.log(`  Next direct slot: ${describeNextSlot({ item, mode: DIRECT_MODE, now, region })}`)
}

const describeNextSlot = ({ item, mode, now, region }) => {
  const slot = nextSlot({ schedules: schedulesFor({ item, mode }), now })
  return slot ? formatLocal({ iso: slot.toISOString(), region }) : 'none'
}

const printHistoryTable = ({ rows, region }) => {
  const widths = [10, 24, 28, 10, 8]
  const header = ['Day', 'Retailer', 'Category', 'Lowest', 'Verified']
  const line = (cells) => cells
    .map((cell, index) => String(cell).padEnd(widths[index]))
    .join(' ')
  console.log(line(header))
  for (const row of rows) {
    const verified = row.verified ? 'yes' : 'no'
    const lowest = money({ amount: row.lowest, region })
    console.log(line([row.day, row.retailer, row.category, lowest, verified]))
  }
  if (rows.length === 0) console.log('No history yet')
}

const describeStatus = ({ status, pausedUntil, region }) => pausedUntil
  ? `${status} until ${formatLocal({ iso: pausedUntil, region })}`
  : status

const describeDelivery = (message, outcome) => {
  if (!message) return 'none'
  return outcome?.delivered ? 'delivered' : 'undelivered'
}

const describeAlert = ({ alert, region }) => {
  const state = alert.delivered ? 'delivered' : 'undelivered'
  return `${alert.kind} at ${formatLocal({ iso: alert.sentAt, region })} (${state}): ${alert.title}`
}

const describeListing = ({ listing, region }) => {
  const price = money({ amount: listing.effectivePrice ?? listing.price, region })
  return `${listing.retailer}: ${listing.title} ${price}`
}

const money = ({ amount, region }) =>
  formatPrice({ amount, currency: region.currency, locale: region.locale })

const formatLocal = ({ iso, region }) =>
  new Date(iso).toLocaleString(region.locale, { timeZone: region.timeZone })

const log = (message) => console.log(`${new Date().toISOString()} ${message}`)

const requireArg = (args, label) => {
  if (!args[0]) throw new Error(`Missing ${label}`)
  return args[0]
}

const usage = (name) => {
  const known = Object.keys(commands).join(', ')
  if (!name) return `Usage: cli.js <command>. Commands: ${known}`
  return `Unknown command "${name}". Commands: ${known}`
}

main().catch((error) => {
  console.error(`Error: ${error.message}`)
  process.exit(1)
})
