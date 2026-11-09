import { execFile } from 'node:child_process'
import { access, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { LOGS_DIR, PROJECT_ROOT } from './config.js'

export const TICK_LABEL = 'com.furey.price-tracker'
export const WEB_LABEL = 'com.furey.price-tracker.web'
export const TICK_INTERVAL_SECONDS = 900

const run = promisify(execFile)

const SYSTEM_PATH = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'

export const plistXml = ({
  label,
  programArguments,
  env = {},
  workingDirectory,
  stdoutPath,
  stderrPath,
  startInterval,
  runAtLoad = false,
  keepAlive = false
}) => {
  const entries = [
    ['Label', stringXml(label)],
    ['ProgramArguments', arrayXml(programArguments)],
    workingDirectory && ['WorkingDirectory', stringXml(workingDirectory)],
    ['EnvironmentVariables', dictXml(env)],
    startInterval && ['StartInterval', `<integer>${startInterval}</integer>`],
    ['RunAtLoad', booleanXml(runAtLoad)],
    keepAlive && ['KeepAlive', booleanXml(keepAlive)],
    stdoutPath && ['StandardOutPath', stringXml(stdoutPath)],
    stderrPath && ['StandardErrorPath', stringXml(stderrPath)]
  ].filter(Boolean)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
      '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entries.map(([key, value]) => `  <key>${escapeXml(key)}</key>\n  ${value}`),
    '</dict>',
    '</plist>',
    ''
  ].join('\n')
}

export const agentDefinitions = ({
  root, nodePath, claudePath, home, port, launchAgentsDir, logsDir = join(root, 'logs')
}) => {
  const env = {
    PATH: unique([dirname(nodePath), dirname(claudePath), ...SYSTEM_PATH.split(':')]).join(':'),
    HOME: home,
    CLAUDE_BIN: claudePath,
    PORT: String(port)
  }
  const cli = join(root, 'src', 'cli.js')
  const shared = { env, workingDirectory: root }
  return [
    {
      label: TICK_LABEL,
      xml: plistXml({
        ...shared,
        label: TICK_LABEL,
        programArguments: [nodePath, cli, 'tick'],
        startInterval: TICK_INTERVAL_SECONDS,
        runAtLoad: true,
        stdoutPath: join(logsDir, 'tick.out.log'),
        stderrPath: join(logsDir, 'tick.err.log')
      })
    },
    {
      label: WEB_LABEL,
      xml: plistXml({
        ...shared,
        label: WEB_LABEL,
        programArguments: [nodePath, cli, 'serve'],
        runAtLoad: true,
        keepAlive: true,
        stdoutPath: join(logsDir, 'web.out.log'),
        stderrPath: join(logsDir, 'web.err.log')
      })
    }
  ].map((agent) => ({ ...agent, path: join(launchAgentsDir, `${agent.label}.plist`) }))
}

export const install = async ({ log = console.log, platform = process.platform } = {}) => {
  assertMacOs(platform)
  const claudePath = await resolveClaude()
  await ensureWebBuilt(log)
  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
  const agents = agentDefinitions({
    root: PROJECT_ROOT,
    nodePath: process.execPath,
    claudePath,
    home: homedir(),
    port: process.env.PORT ?? 4280,
    launchAgentsDir,
    logsDir: LOGS_DIR
  })
  await mkdir(LOGS_DIR, { recursive: true })
  await mkdir(launchAgentsDir, { recursive: true })
  for (const agent of agents) {
    await writeFile(agent.path, agent.xml)
    await bootout(agent.label)
    await run('launchctl', ['bootstrap', guiDomain(), agent.path])
    log(`installed ${agent.label} (${agent.path})`)
  }
  return agents.map(({ label, path }) => ({ label, path }))
}

export const uninstall = async ({ log = console.log, platform = process.platform } = {}) => {
  assertMacOs(platform)
  const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
  for (const label of [TICK_LABEL, WEB_LABEL]) {
    await bootout(label)
    await rm(join(launchAgentsDir, `${label}.plist`), { force: true })
    log(`removed ${label}`)
  }
}

export const assertMacOs = (platform) => {
  if (platform === 'darwin') return
  throw new Error('install and uninstall need macOS (launchd). Use the Docker deploy instead.')
}

export const resolveClaude = async () => {
  const candidate = process.env.CLAUDE_BIN || (await findOnPath('claude'))
  if (!candidate) {
    throw new Error('claude CLI not found on PATH. Install Claude Code or set CLAUDE_BIN.')
  }
  return realpath(candidate)
}

const findOnPath = async (command) => {
  try {
    const { stdout } = await run('/bin/sh', ['-c', `command -v ${command}`])
    return stdout.trim() || null
  } catch {
    return null
  }
}

const ensureWebBuilt = async (log) => {
  const built = await access(join(PROJECT_ROOT, 'web', 'dist', 'index.html')).then(
    () => true,
    () => false
  )
  if (built) return
  log('web/dist is missing, running npm run build')
  await run('npm', ['run', 'build'], { cwd: PROJECT_ROOT })
}

const bootout = async (label) => {
  try {
    await run('launchctl', ['bootout', `${guiDomain()}/${label}`])
  } catch {
    return
  }
}

const guiDomain = () => `gui/${process.getuid()}`

const stringXml = (value) => `<string>${escapeXml(value)}</string>`

const booleanXml = (value) => (value ? '<true/>' : '<false/>')

const arrayXml = (items) => [
  '<array>',
  ...items.map((item) => `    ${stringXml(item)}`),
  '  </array>'
].join('\n')

const dictXml = (record) => [
  '<dict>',
  ...Object.entries(record).flatMap(([key, value]) => [
    `    <key>${escapeXml(key)}</key>`,
    `    ${stringXml(value)}`
  ]),
  '  </dict>'
].join('\n')

const unique = (items) => [...new Set(items)]

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')
