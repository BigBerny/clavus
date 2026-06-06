#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { chromium, devices } = require('playwright')

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const key = arg.slice(2)
  const next = process.argv[i + 1]
  if (next && !next.startsWith('--')) {
    args.set(key, next)
    i += 1
  } else {
    args.set(key, '1')
  }
}

const url = args.get('url') || process.env.CLAVUS_BROWSER_URL || 'http://127.0.0.1:5183/'
const outDir = args.get('out') || process.env.CLAVUS_BROWSER_OUT || '/private/tmp/clavus-browser-check'
const cdpUrl = args.get('cdp') || process.env.CLAVUS_CDP_URL || 'http://127.0.0.1:9222'
const includeDesktop = args.get('mobile-only') !== '1'
const includeMobile = args.get('desktop-only') !== '1'
const fullPage = args.get('full-page') === '1'
const allowLaunch = args.get('launch') === '1'
  || process.env.CLAVUS_BROWSER_LAUNCH === '1'
  || process.env.CLAVUS_ALLOW_BROWSER_LAUNCH === '1'

fs.mkdirSync(outDir, { recursive: true })

function screenshotPath(name) {
  return path.join(outDir, `${name}.png`)
}

async function waitForApp(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForSelector('#root', { timeout: 10000 })
  await page.waitForTimeout(750)
}

async function probeCdp(endpoint) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`, {
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function openBrowser(summary) {
  if (await probeCdp(cdpUrl)) {
    summary.browser = { mode: 'cdp', endpoint: cdpUrl }
    return chromium.connectOverCDP(cdpUrl)
  }

  if (allowLaunch) {
    summary.browser = { mode: 'playwright-launch' }
    return chromium.launch()
  }

  const error = new Error([
    `No browser control endpoint answered at ${cdpUrl}.`,
    'Start the Codex in-app Browser if available, or run scripts/start-cdp-chrome.command outside Codex, then retry npm run browser:check.',
    'Set CLAVUS_BROWSER_LAUNCH=1 only outside the Codex macOS sandbox; sandboxed browser launches are known to crash here.',
  ].join('\n'))
  error.code = 'CLAVUS_BROWSER_UNAVAILABLE'
  throw error
}

async function captureConsole(page, logs) {
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (error) => logs.push(`[pageerror] ${error.message}`))
}

async function horizontalScrollState(page) {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'))
    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        const overflowX = style.overflowX
        const maxLeft = el.scrollWidth - el.clientWidth
        return {
          el,
          rect,
          overflowX,
          maxLeft,
          score: Math.max(0, maxLeft) * Math.max(0, rect.width) * Math.max(0, rect.height),
        }
      })
      .filter(({ rect, maxLeft, overflowX }) => (
        maxLeft > 40
        && rect.width > window.innerWidth * 0.5
        && rect.height > window.innerHeight * 0.35
        && ['auto', 'scroll'].includes(overflowX)
      ))
      .sort((a, b) => b.score - a.score)

    const target = candidates[0]?.el || null
    if (!target) return null
    return {
      tag: target.tagName.toLowerCase(),
      className: String(target.className || ''),
      left: target.scrollLeft,
      maxLeft: target.scrollWidth - target.clientWidth,
      width: target.clientWidth,
    }
  })
}

async function setHorizontalScroll(page, fraction) {
  return page.evaluate((fractionValue) => {
    const elements = Array.from(document.querySelectorAll('*'))
    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        const maxLeft = el.scrollWidth - el.clientWidth
        return {
          el,
          rect,
          maxLeft,
          overflowX: style.overflowX,
          score: Math.max(0, maxLeft) * Math.max(0, rect.width) * Math.max(0, rect.height),
        }
      })
      .filter(({ rect, maxLeft, overflowX }) => (
        maxLeft > 40
        && rect.width > window.innerWidth * 0.5
        && rect.height > window.innerHeight * 0.35
        && ['auto', 'scroll'].includes(overflowX)
      ))
      .sort((a, b) => b.score - a.score)

    const target = candidates[0]?.el || null
    if (!target) return null
    const maxLeft = target.scrollWidth - target.clientWidth
    target.scrollLeft = Math.min(maxLeft, Math.max(0, maxLeft * fractionValue))
    target.dispatchEvent(new Event('scroll', { bubbles: true }))
    return {
      tag: target.tagName.toLowerCase(),
      className: String(target.className || ''),
      left: target.scrollLeft,
      maxLeft,
      width: target.clientWidth,
    }
  }, fraction)
}

async function setBetweenAdjacentPanels(page) {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'))
    const candidates = elements
      .map((el) => {
        const rect = el.getBoundingClientRect()
        const style = window.getComputedStyle(el)
        const maxLeft = el.scrollWidth - el.clientWidth
        return {
          el,
          rect,
          maxLeft,
          overflowX: style.overflowX,
          score: Math.max(0, maxLeft) * Math.max(0, rect.width) * Math.max(0, rect.height),
        }
      })
      .filter(({ rect, maxLeft, overflowX }) => (
        maxLeft > 40
        && rect.width > window.innerWidth * 0.5
        && rect.height > window.innerHeight * 0.35
        && ['auto', 'scroll'].includes(overflowX)
      ))
      .sort((a, b) => b.score - a.score)

    const target = candidates[0]?.el || null
    if (!target) return null
    const width = target.clientWidth || window.innerWidth
    const maxLeft = target.scrollWidth - target.clientWidth
    const currentIndex = Math.round(target.scrollLeft / width)
    const midpointIndex = currentIndex > 0 ? currentIndex - 0.5 : 0.5
    target.scrollLeft = Math.min(maxLeft, Math.max(0, midpointIndex * width))
    target.dispatchEvent(new Event('scroll', { bubbles: true }))
    return {
      tag: target.tagName.toLowerCase(),
      className: String(target.className || ''),
      left: target.scrollLeft,
      maxLeft,
      width: target.clientWidth,
      currentIndex,
      midpointIndex,
    }
  })
}

async function dispatchTouchSwipe(page, startX, startY, endX, endY, steps = 16, onMidpoint) {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY }],
  })
  const midpointStep = Math.max(1, Math.floor(steps / 2))
  for (let i = 1; i <= steps; i += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: startX + ((endX - startX) * i) / steps,
        y: startY + ((endY - startY) * i) / steps,
      }],
    })
    if (i === midpointStep && onMidpoint) {
      await onMidpoint()
    }
    await page.waitForTimeout(16)
  }
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

async function runDesktop(browser, summary) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  const logs = []
  await captureConsole(page, logs)
  await waitForApp(page)

  const screenshot = screenshotPath('desktop')
  await page.screenshot({ path: screenshot, fullPage })
  summary.screenshots.push(screenshot)
  summary.desktop = { url: page.url(), logs }
  await context.close()
}

async function runMobile(browser, summary) {
  const context = await browser.newContext({
    ...devices['iPhone 15'],
    viewport: { width: 393, height: 852 },
  })
  const page = await context.newPage()
  const logs = []
  await captureConsole(page, logs)
  await waitForApp(page)

  const before = screenshotPath('mobile-before')
  await page.screenshot({ path: before, fullPage })
  summary.screenshots.push(before)

  const initialScroll = await horizontalScrollState(page)
  const midScroll = await setBetweenAdjacentPanels(page)
  await page.waitForTimeout(250)
  const mid = screenshotPath('mobile-mid-horizontal-scroll')
  await page.screenshot({ path: mid, fullPage })
  summary.screenshots.push(mid)

  const size = page.viewportSize()
  if (size) {
    const during = screenshotPath('mobile-during-touch-swipe')
    await dispatchTouchSwipe(
      page,
      size.width - 24,
      Math.round(size.height * 0.5),
      24,
      Math.round(size.height * 0.5),
      24,
      async () => {
        await page.waitForTimeout(50)
        await page.screenshot({ path: during, fullPage })
        summary.screenshots.push(during)
      },
    )
    await page.waitForTimeout(500)
  }

  const afterScroll = await horizontalScrollState(page)
  const after = screenshotPath('mobile-after-swipe')
  await page.screenshot({ path: after, fullPage })
  summary.screenshots.push(after)

  summary.mobile = {
    url: page.url(),
    initialScroll,
    midScroll,
    afterScroll,
    logs,
  }
  await context.close()
}

(async () => {
  const summary = {
    url,
    outDir,
    screenshots: [],
    startedAt: new Date().toISOString(),
  }

  const browser = await openBrowser(summary)
  try {
    if (includeDesktop) await runDesktop(browser, summary)
    if (includeMobile) await runMobile(browser, summary)
  } finally {
    await browser.close()
  }
  summary.finishedAt = new Date().toISOString()
  console.log(JSON.stringify(summary, null, 2))
})().catch((error) => {
  if (error?.code === 'CLAVUS_BROWSER_UNAVAILABLE') {
    console.error(error.message)
  } else {
    console.error(error && error.stack ? error.stack : error)
  }
  process.exit(1)
})
