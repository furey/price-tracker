import { join } from 'node:path'
import express from 'express'
import { getRun } from './db.js'
import {
  getScreenshot, pruneScreenshots, saveScreenshot, screenshotCount, screenshotsByRun
} from './screenshot-store.js'
import {
  MAX_SCREENSHOTS_PER_RUN, MAX_SCREENSHOT_BYTES, SCREENSHOT_TYPES, capBytesFromMb,
  detectImageType
} from './screenshots.js'
import { screenshotCapMb } from './settings.js'
import { MANUAL_MODE } from './site-stats.js'

export const SCREENSHOT_UPLOAD_PATH = /^\/runs\/\d+\/screenshots$/

export const isScreenshotUpload = (req) => req.method === 'POST'
  && SCREENSHOT_UPLOAD_PATH.test(req.path)
  && Boolean(req.is(SCREENSHOT_TYPES))

export const addScreenshotRoutes = ({ app, db, now, env, dir }) => {
  const rawImage = express.raw({ type: SCREENSHOT_TYPES, limit: MAX_SCREENSHOT_BYTES })

  app.post('/api/runs/:id/screenshots', rawImage, (req, res) => {
    const run = getRun({ db, id: idParam(req.params.id) })
    if (!run) return res.status(404).json({ error: 'Unknown run' })
    if (run.mode !== MANUAL_MODE) {
      return res.status(409).json({ error: 'Only Chrome check runs take screenshots' })
    }
    const kind = uploadKind(req)
    if (!kind) {
      return res.status(415).json({ error: 'Upload a PNG, JPEG, or WebP image' })
    }
    if (screenshotCount({ db, runId: run.id }) >= MAX_SCREENSHOTS_PER_RUN) {
      return res.status(409).json({
        error: `This run already has ${MAX_SCREENSHOTS_PER_RUN} screenshots`
      })
    }
    const saved = saveScreenshot({ db, dir, run, bytes: req.body, kind, now: now() })
    const capBytes = capBytesFromMb(screenshotCapMb({ db, env }))
    const pruned = pruneScreenshots({ db, dir, capBytes })
    res.status(201).json({ ...saved, pruned })
  })

  app.get('/api/screenshots/:id', (req, res) => {
    const shot = getScreenshot({ db, id: idParam(req.params.id) })
    if (!shot?.file) return res.status(404).json({ error: 'Unknown screenshot' })
    res.setHeader('Content-Type', shot.contentType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'")
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.sendFile(join(dir, shot.file), (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'Screenshot file missing' })
    })
  })
}

export const withScreenshots = ({ db, runs }) => {
  const byRun = screenshotsByRun({ db, runIds: runs.map(({ id }) => id) })
  return runs.map((run) => {
    const screenshots = byRun.get(run.id) ?? []
    return { ...run, screenshotCount: screenshots.length, screenshots }
  })
}

const uploadKind = (req) => {
  if (!Buffer.isBuffer(req.body)) return null
  const kind = detectImageType(req.body)
  return kind && req.is(kind.contentType) ? kind : null
}

const idParam = (value) => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : -1
}
