import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../docs/public/diagrams/', import.meta.url))
const ICONS = JSON.parse(readFileSync(new URL('./lucide-icons.json', import.meta.url), 'utf8'))

export const buildDiagrams = (only) => {
  mkdirSync(OUT, { recursive: true })
  Object.entries(diagrams)
    .filter(([name]) => !only || only.includes(name))
    .forEach(([name, draw]) => {
      Object.entries(themes).forEach(([themeName, theme]) => {
        writeFileSync(`${OUT}${name}-${themeName}.svg`, svg({ ...draw(theme), theme }))
      })
    })
}

const themes = {
  light: {
    text: '#3c3c43', muted: '#67676c', faint: '#929295', line: '#a8a8ae', panel: '#f6f6f7',
    tile: 'rgba(142, 150, 170, 0.14)', page: '#ffffff',
    tones: {
      amber: '#b45309', sky: '#0369a1', fuchsia: '#a21caf', cyan: '#0e7490', orange: '#c2410c',
      indigo: '#4338ca', violet: '#6d28d9', green: '#15803d', blue: '#1d4ed8', rose: '#be123c',
      neutral: '#67676c'
    }
  },
  dark: {
    text: '#dfdfd6', muted: '#98989f', faint: '#6a6a71', line: '#5c5c63', panel: '#18181b',
    tile: 'rgba(101, 117, 133, 0.16)', page: '#09090b',
    tones: {
      amber: '#fbbf24', sky: '#38bdf8', fuchsia: '#e879f9', cyan: '#67e8f9', orange: '#fb923c',
      indigo: '#818cf8', violet: '#a78bfa', green: '#4ade80', blue: '#60a5fa', rose: '#fb7185',
      neutral: '#98989f'
    }
  }
}

const architecture = (t) => {
  const outputs = [
    { x: 100, icon: 'bell-ring', tone: 'rose', title: 'ntfy', sub: ['deal alerts', 'to your phone'], internet: true },
    { x: 260, icon: 'layout-dashboard', tone: 'violet', title: 'Dashboard', sub: ['Vue app,', 'port 4280'] },
    { x: 420, icon: 'braces', tone: 'orange', title: 'HTTP API', sub: ['JSON under', '/api'] },
    { x: 580, icon: 'terminal', tone: 'green', title: 'CLI', sub: ['node src/cli.js', 'commands'] }
  ]
  const panel = { x: 60, y: 196, w: 560, h: 150 }
  const fanY = panel.y + panel.h
  const outY = 444
  return {
    width: 680,
    height: 650,
    body: [
      endpoint({ x: 210, y: 40, icon: 'sparkles', tone: 'fuchsia', title: 'Claude Code', sub: ['claude -p with', 'WebSearch, WebFetch'] }, t),
      endpoint({ x: 470, y: 40, icon: 'globe', tone: 'sky', title: 'Retailer pages', sub: ['free direct checks,', 'no AI'] }, t),
      link({ d: `M210 164 V${panel.y - 4}`, t, dashed: true, arrow: true }),
      note({ x: 222, y: 184, text: 'research JSON', t, anchor: 'start' }),
      link({ d: `M470 164 V${panel.y - 4}`, t, dashed: true, arrow: true }),
      note({ x: 482, y: 184, text: 'shopify, jsonld', t, anchor: 'start' }),
      `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="18" fill="${t.panel}"/>`,
      text({ x: panel.x + 28, y: panel.y + 40, text: 'price-tracker', size: 17, weight: 650, fill: t.text, anchor: 'start' }),
      text({ x: panel.x + 28, y: panel.y + 62, text: 'a Docker container, or two LaunchAgents on a Mac', size: 13, fill: t.muted, anchor: 'start' }),
      fact({ x: panel.x + 28, y: panel.y + 104, icon: 'timer', title: 'Ticks every 15 min', sub: 'runs the due checks', t }),
      fact({ x: panel.x + 208, y: panel.y + 104, icon: 'scale', title: 'Decides in code', sub: 'rules, ranking, dedupe', t }),
      fact({ x: panel.x + 388, y: panel.y + 104, icon: 'database', title: 'Keeps history', sub: 'SQLite in state/', t }),
      ...outputs.map((o) => link({
        d: `M340 ${fanY} C340 ${fanY + 46} ${o.x} ${outY - 50} ${o.x} ${outY - 4}`,
        t,
        dashed: o.internet,
        arrow: true
      })),
      ...outputs.map((o) => endpoint({ ...o, y: outY }, t)),
      legend({ x: 340, y: 618, t })
    ]
  }
}

const runFlow = (t) => {
  const panel = { x: 60, y: 496, w: 560, h: 150 }
  const fanY = panel.y + panel.h
  const outY = 706
  return {
    width: 680,
    height: 850,
    body: [
      endpoint({ x: 340, y: 30, icon: 'timer', tone: 'amber', title: 'Daemon tick', sub: ['every 15 minutes'] }, t),
      link({ d: 'M340 142 V184', t, arrow: true }),
      note({ x: 352, y: 168, text: 'each active item', t, anchor: 'start' }),
      endpoint({ x: 340, y: 190, icon: 'calendar-clock', tone: 'indigo', title: 'Due items', sub: ['a cron slot passed since the last run'] }, t),
      link({ d: 'M340 302 C340 322 210 316 210 326', t, arrow: true }),
      link({ d: 'M340 302 C340 322 470 316 470 326', t, arrow: true }),
      endpoint({ x: 210, y: 332, icon: 'sparkles', tone: 'fuchsia', title: 'AI research run', sub: ['claude -p with web tools,', 'one AI job at a time'] }, t),
      endpoint({ x: 470, y: 332, icon: 'globe', tone: 'sky', title: 'Direct check', sub: ['free page fetch,', 'no AI'] }, t),
      link({ d: 'M210 456 V492', t, arrow: true }),
      note({ x: 222, y: 480, text: 'research JSON', t, anchor: 'start' }),
      link({ d: 'M470 456 V492', t, arrow: true }),
      note({ x: 482, y: 480, text: 'page listings', t, anchor: 'start' }),
      `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="18" fill="${t.panel}"/>`,
      text({ x: panel.x + 28, y: panel.y + 40, text: 'Checks and decision', size: 17, weight: 650, fill: t.text, anchor: 'start' }),
      text({ x: panel.x + 28, y: panel.y + 62, text: 'plain code, no model call', size: 13, fill: t.muted, anchor: 'start' }),
      fact({ x: panel.x + 28, y: panel.y + 104, icon: 'shield-check', title: 'Validates', sub: 'research JSON only', t }),
      fact({ x: panel.x + 208, y: panel.y + 104, icon: 'sliders-horizontal', title: 'Applies tuning', sub: 'mutes and never-show', t }),
      fact({ x: panel.x + 388, y: panel.y + 104, icon: 'scale', title: 'Decides', sub: 'rules, trust, dedupe', t }),
      link({ d: `M340 ${fanY} C340 ${fanY + 30} 210 ${outY - 36} 210 ${outY - 4}`, t, arrow: true }),
      link({ d: `M340 ${fanY} C340 ${fanY + 30} 470 ${outY - 36} 470 ${outY - 4}`, t, arrow: true }),
      endpoint({ x: 210, y: outY, icon: 'bell-ring', tone: 'rose', title: 'Alert', sub: ['stored, then sent', 'through ntfy'] }, t),
      endpoint({ x: 470, y: outY, icon: 'database', tone: 'cyan', title: 'History', sub: ['listings and runs', 'in SQLite'] }, t)
    ]
  }
}

const alertDecision = (t) => {
  const panel = { x: 60, y: 30, w: 560, h: 416 }
  const rowY = (i) => panel.y + 106 + i * 66
  const rows = [
    { icon: 'list-checks', title: 'Eligible', sub: 'in stock, with a price and a URL', end: ['else: nothing'] },
    { icon: 'sliders-horizontal', title: 'Tuning', sub: 'not a muted model or never-show', end: ['tuned: muted-price', 'notice or nothing'] },
    { icon: 'scale', title: 'Rules', sub: 'price cap, clearance cap, or % below RRP', end: ['else: nothing'] },
    { icon: 'shield-check', title: 'Trust', sub: 'recognised site and a plausible price', end: ['else: check notice'] },
    { icon: 'copy-check', title: 'Dedupe', sub: 'new, or cheaper by the minimum drop', end: ['already sent: nothing'] }
  ]
  const fanY = panel.y + panel.h
  const outY = 540
  const outputs = [
    { x: 100, icon: 'bell-ring', tone: 'rose', title: 'Deal alert', sub: ['passed every check,', 'with Open listing'] },
    { x: 260, icon: 'triangle-alert', tone: 'amber', title: 'Check notice', sub: ['site or price fails,', 'no button'] },
    { x: 420, icon: 'bell-off', tone: 'violet', title: 'Muted-price notice', sub: ['tuned, and at or', 'below its price'] },
    { x: 580, icon: 'ban', tone: 'neutral', title: 'Nothing', sub: ['any other stop,', 'no alert'], dashed: true }
  ]
  return {
    width: 680,
    height: 712,
    body: [
      `<rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="18" fill="${t.panel}"/>`,
      text({ x: panel.x + 28, y: panel.y + 40, text: 'One listing, in order', size: 17, weight: 650, fill: t.text, anchor: 'start' }),
      text({ x: panel.x + 28, y: panel.y + 62, text: 'the first check a listing fails stops it', size: 13, fill: t.muted, anchor: 'start' }),
      ...rows.flatMap((row, i) => [
        i > 0 ? `<path d="M${panel.x + 28} ${rowY(i) - 33} H${panel.x + panel.w - 28}" stroke="${t.line}" stroke-width="1" opacity="0.4"/>` : '',
        fact({ x: panel.x + 28, y: rowY(i), icon: row.icon, title: row.title, sub: row.sub, t }),
        ...row.end.map((line, j) => text({
          x: panel.x + panel.w - 28,
          y: rowY(i) + 5 + (j - (row.end.length - 1) / 2) * 17,
          text: line,
          size: 12.5,
          fill: t.faint,
          anchor: 'end'
        }))
      ]),
      ...outputs.map((o) => link({
        d: `M340 ${fanY} C340 ${fanY + 46} ${o.x} ${outY - 50} ${o.x} ${outY - 4}`,
        t,
        dashed: o.dashed,
        arrow: true
      })),
      ...outputs.map((o) => endpoint({ ...o, y: outY }, t)),
      legend({ x: 340, y: 688, t, left: 'alert sent', right: 'no alert' })
    ]
  }
}

const endpoint = ({ x, y, icon, tone, title, sub = [] }, t) => [
  `<rect x="${x - 26}" y="${y}" width="52" height="52" rx="12" fill="${t.tile}"/>`,
  iconAt({ name: icon, x: x - 13, y: y + 13, size: 26, colour: t.tones[tone] }),
  text({ x, y: y + 78, text: title, size: 15, weight: 600, fill: t.text }),
  ...sub.map((line, i) => text({ x, y: y + 98 + i * 17, text: line, size: 13, fill: t.muted }))
].join('')

const fact = ({ x, y, icon, title, sub, t }) => [
  iconAt({ name: icon, x, y: y - 14, size: 18, colour: t.muted }),
  text({ x: x + 28, y, text: title, size: 14, weight: 600, fill: t.text, anchor: 'start' }),
  text({ x: x + 28, y: y + 19, text: sub, size: 12.5, fill: t.muted, anchor: 'start' })
].join('')

const legend = ({ x, y, t, left = 'on your network', right = 'over the internet' }) => [
  `<path d="M${x - 200} ${y} h30" stroke="${t.line}" stroke-width="1.5"/>`,
  text({ x: x - 160, y: y + 4.5, text: left, size: 12.5, fill: t.muted, anchor: 'start' }),
  `<path d="M${x + 30} ${y} h30" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="4 4"/>`,
  text({ x: x + 70, y: y + 4.5, text: right, size: 12.5, fill: t.muted, anchor: 'start' })
].join('')

const link = ({ d, t, dashed = false, arrow = false }) =>
  `<path d="${d}" fill="none" stroke="${t.line}" stroke-width="1.5" stroke-linecap="round"${dashed ? ' stroke-dasharray="4 4"' : ''}${arrow ? ' marker-end="url(#tip)"' : ''}/>`

const note = ({ x, y, text: content, t, anchor = 'middle' }) =>
  text({ x, y, text: content, size: 12.5, fill: t.muted, anchor, halo: t.page })

const iconAt = ({ name, x, y, size, colour }) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>`

const text = ({ x, y, text: content, size, weight = 400, fill, anchor = 'middle', halo }) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${halo ? ` stroke="${halo}" stroke-width="6" stroke-linejoin="round" paint-order="stroke"` : ''}>${escape(content)}</text>`

const svg = ({ width, height, body, theme }) => [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">`,
  `<defs><marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M1 1.5 L8 5 L1 8.5" fill="none" stroke="${theme.line}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`,
  ...body,
  '</svg>',
  ''
].join('\n')

const escape = (content) => content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const diagrams = { architecture, 'run-flow': runFlow, 'alert-decision': alertDecision }

if (process.argv[1] === fileURLToPath(import.meta.url)) buildDiagrams(process.argv[2]?.split(','))
