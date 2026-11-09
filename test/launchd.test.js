import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TICK_LABEL, WEB_LABEL, agentDefinitions, install, plistXml, uninstall
} from '../src/launchd.js'

const baseOptions = {
  label: 'com.example.job',
  programArguments: ['/usr/bin/node', '/app/cli.js', 'tick'],
  env: { PATH: '/usr/bin', HOME: '/Users/x' },
  workingDirectory: '/app',
  stdoutPath: '/app/logs/out.log',
  stderrPath: '/app/logs/err.log'
}

test('plistXml emits the expected keys and values', () => {
  const xml = plistXml({ ...baseOptions, startInterval: 900, runAtLoad: true })
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/)
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.example\.job<\/string>/)
  assert.match(xml, /<string>\/usr\/bin\/node<\/string>\s*<string>\/app\/cli\.js<\/string>/)
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>900<\/integer>/)
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/)
  assert.match(xml, /<key>HOME<\/key>\s*<string>\/Users\/x<\/string>/)
  assert.match(xml, /<key>StandardErrorPath<\/key>\s*<string>\/app\/logs\/err\.log<\/string>/)
  assert.doesNotMatch(xml, /KeepAlive/)
})

test('plistXml escapes XML special characters', () => {
  const xml = plistXml({
    ...baseOptions,
    programArguments: ['/bin/node', 'a&b', '<x>"y"'],
    env: { NOTE: "it's <fine> & ok" }
  })
  assert.match(xml, /<string>a&amp;b<\/string>/)
  assert.match(xml, /<string>&lt;x&gt;&quot;y&quot;<\/string>/)
  assert.match(xml, /<string>it&apos;s &lt;fine&gt; &amp; ok<\/string>/)
})

test('plistXml sets KeepAlive and omits StartInterval when not given', () => {
  const xml = plistXml({ ...baseOptions, keepAlive: true })
  assert.match(xml, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<false\/>/)
  assert.doesNotMatch(xml, /StartInterval/)
})

test('agentDefinitions builds the tick and web agents', () => {
  const agents = agentDefinitions({
    root: '/proj',
    nodePath: '/opt/node/bin/node',
    claudePath: '/opt/claude/bin/claude',
    home: '/Users/x',
    port: 4280,
    launchAgentsDir: '/Users/x/Library/LaunchAgents'
  })
  const [tick, web] = agents
  assert.equal(tick.label, TICK_LABEL)
  assert.equal(tick.path, '/Users/x/Library/LaunchAgents/com.furey.price-tracker.plist')
  assert.match(tick.xml, /<string>\/proj\/src\/cli\.js<\/string>\s*<string>tick<\/string>/)
  assert.match(tick.xml, /<integer>900<\/integer>/)
  assert.match(tick.xml, /\/proj\/logs\/tick\.out\.log/)
  assert.equal(web.label, WEB_LABEL)
  assert.match(web.xml, /<string>serve<\/string>/)
  assert.match(web.xml, /<key>KeepAlive<\/key>\s*<true\/>/)
  assert.match(web.xml, /\/proj\/logs\/web\.err\.log/)
  for (const { xml } of agents) {
    assert.match(xml, /<key>WorkingDirectory<\/key>\s*<string>\/proj<\/string>/)
    assert.match(xml, /<key>CLAUDE_BIN<\/key>\s*<string>\/opt\/claude\/bin\/claude<\/string>/)
    assert.match(xml, /<key>PORT<\/key>\s*<string>4280<\/string>/)
    assert.match(xml, /<string>\/opt\/node\/bin:\/opt\/claude\/bin:\/usr\/local\/bin:/)
  }
})

test('install and uninstall refuse off macOS', async () => {
  await assert.rejects(install({ platform: 'linux' }), /need macOS/)
  await assert.rejects(uninstall({ platform: 'linux' }), /need macOS/)
})
