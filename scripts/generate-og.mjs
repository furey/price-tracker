import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const REPO = process.env.OG_REPO || '/work'
const DOCS_URL = 'furey.github.io/<b>price-tracker</b>'
const HEADLINE = [
  '<span>Tell it what you want to buy.</span>',
  '<span>Get notified when the price is right.</span>'
].join(' ')
const SUB = 'Self-hosted. Searches sites on a schedule and pings your&nbsp;phone.'

const cards = [
  { width: 1200, height: 630, out: 'docs/public/og.png' },
  { width: 1280, height: 640, out: 'docs/public/social/github-social-preview.png' }
]

const generate = async () => {
  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] })
  for (const card of cards) {
    const out = `${REPO}/${card.out}`
    const context = await browser.newContext({
      viewport: { width: card.width, height: card.height },
      deviceScaleFactor: 1
    })
    const page = await context.newPage()
    await page.setContent(cardHtml(card), { waitUntil: 'load' })
    await waitForInter(page)
    mkdirSync(dirname(out), { recursive: true })
    await page.screenshot({
      path: out,
      type: 'png',
      clip: { x: 0, y: 0, width: card.width, height: card.height }
    })
    await context.close()
    console.log(`[og] wrote ${card.out} (${card.width}x${card.height})`)
  }
  await browser.close()
}

const waitForInter = async (page) => {
  await page.evaluate(() => document.fonts.load('700 60px "Inter cv01"'))
  await page
    .waitForFunction(() => document.fonts.check('700 60px "Inter cv01"'), null, { timeout: 9000 })
    .catch(() => console.warn('[og] Inter did not confirm in time; continuing'))
  await page.evaluate(() => document.fonts.ready)
}

const layoutOf = ({ width, height }) => {
  const unit = height / 630
  const px = (value) => Math.round(value * unit)
  return {
    width,
    height,
    pad: px(64),
    copyWidth: px(468),
    logo: px(50),
    nameSize: px(28),
    headlineSize: px(46),
    subSize: px(23),
    urlSize: px(20),
    frameLeft: px(588) + (width - px(1200)),
    frameTop: px(96),
    frameWidth: px(700),
    barHeight: px(34),
    dot: px(11),
    radius: px(14)
  }
}

const cardHtml = (card) => {
  const l = layoutOf(card)
  const font = base64(`${REPO}/docs/.vitepress/theme/fonts/inter-latin-cv01.woff2`)
  const shot = base64(`${REPO}/docs/public/hero/item-list-dark.webp`)
  const logo = readFileSync(`${REPO}/docs/public/logo.svg`, 'utf8').trim()
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Inter cv01';
    font-style: normal;
    font-weight: 100 900;
    src: url(data:font/woff2;base64,${font}) format('woff2');
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${l.width}px; height: ${l.height}px; }
  body {
    position: relative;
    overflow: hidden;
    background: #09090b;
    color: #fafafa;
    font-family: 'Inter cv01', system-ui, sans-serif;
    font-feature-settings: 'cv01' 1;
    -webkit-font-smoothing: antialiased;
  }
  .glow {
    position: absolute;
    top: 50%;
    left: ${l.frameLeft + Math.round(l.frameWidth * 0.35)}px;
    width: ${Math.round(l.height * 1.2)}px;
    height: ${Math.round(l.height * 1.2)}px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: radial-gradient(circle at center,
      rgba(124, 58, 237, 0.85) 0%,
      rgba(139, 92, 246, 0.45) 45%,
      transparent 72%);
    filter: blur(${Math.round(l.height * 0.12)}px);
    opacity: 0.75;
  }
  .copy {
    position: absolute;
    top: ${l.pad}px;
    bottom: ${l.pad}px;
    left: ${l.pad}px;
    width: ${l.copyWidth}px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .brand { display: flex; align-items: center; gap: ${Math.round(l.logo * 0.3)}px; }
  .brand svg { width: ${l.logo}px; height: ${l.logo}px; }
  .brand .name {
    font-size: ${l.nameSize}px;
    font-weight: 600;
    letter-spacing: -0.025em;
  }
  .headline {
    font-size: ${l.headlineSize}px;
    line-height: 1.1;
    font-weight: 700;
    letter-spacing: -0.03em;
  }
  .headline span { display: block; text-wrap: balance; }
  .headline span + span { margin-top: ${Math.round(l.headlineSize * 0.28)}px; color: #c4b5fd; }
  .sub {
    margin-top: ${Math.round(l.subSize * 1)}px;
    font-size: ${l.subSize}px;
    line-height: 1.38;
    letter-spacing: -0.01em;
    color: #a1a1aa;
    text-wrap: balance;
  }
  .url {
    font-size: ${l.urlSize}px;
    letter-spacing: -0.01em;
    color: #71717a;
  }
  .url b { color: #a78bfa; font-weight: 600; }
  .frame {
    position: absolute;
    left: ${l.frameLeft}px;
    top: ${l.frameTop}px;
    width: ${l.frameWidth}px;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: ${l.radius}px;
    overflow: hidden;
    background: #141417;
    box-shadow: 0 ${Math.round(l.radius * 3)}px ${Math.round(l.radius * 6)}px -${Math.round(l.radius * 2)}px rgba(0, 0, 0, 0.85);
  }
  .bar {
    display: flex;
    align-items: center;
    gap: ${Math.round(l.dot * 0.75)}px;
    height: ${l.barHeight}px;
    padding: 0 ${Math.round(l.dot * 1.3)}px;
    background: #141417;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  }
  .bar i { width: ${l.dot}px; height: ${l.dot}px; border-radius: 50%; background: #2a2a30; }
  .frame img { display: block; width: 100%; height: auto; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="copy">
    <div class="brand">${logo}<span class="name">Price Tracker</span></div>
    <div>
      <h1 class="headline">${HEADLINE}</h1>
      <p class="sub">${SUB}</p>
    </div>
    <p class="url">${DOCS_URL}</p>
  </div>
  <div class="frame">
    <div class="bar"><i></i><i></i><i></i></div>
    <img src="data:image/webp;base64,${shot}" alt="">
  </div>
</body>
</html>`
}

const base64 = (path) => readFileSync(path).toString('base64')

generate()
