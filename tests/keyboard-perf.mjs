/**
 * Playwright script to simulate keyboard open/close and measure layout performance.
 *
 * Since we can't trigger a real iOS keyboard, we simulate it by:
 * 1. Using CDP to resize the viewport height (mimics what visualViewport does)
 * 2. Capturing a performance trace during the resize
 * 3. Measuring frame durations and layout shift
 *
 * Run: npx playwright test tests/keyboard-perf.mjs --headed
 * Or:  node tests/keyboard-perf.mjs
 */

import { chromium } from 'playwright'

const URL = 'https://localhost:5173'
const FULL_HEIGHT = 844
const KB_HEIGHT = 340 // typical iOS keyboard height
const SMALL_HEIGHT = FULL_HEIGHT - KB_HEIGHT // 504
const WIDTH = 390 // iPhone 14 Pro width
const ANIMATION_STEPS = 20 // frames over ~300ms
const FRAME_MS = 16 // ~60fps

async function run() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--ignore-certificate-errors'],
  })

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: FULL_HEIGHT },
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
    hasTouch: true,
  })

  const page = await context.newPage()

  // Navigate and wait for app to load
  console.log('Loading Clavus...')
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(2000) // let React settle

  const cdp = await page.context().newCDPSession(page)

  // Inject performance measurement script
  await page.evaluate(() => {
    window.__kbPerf = {
      frames: [],
      layoutShifts: [],
      longTasks: [],
    }

    // Track layout shifts
    const lsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__kbPerf.layoutShifts.push({
          ts: performance.now(),
          value: entry.value,
        })
      }
    })
    try { lsObserver.observe({ type: 'layout-shift', buffered: false }) } catch {}

    // Track long tasks
    const ltObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__kbPerf.longTasks.push({
          ts: entry.startTime,
          duration: entry.duration,
        })
      }
    })
    try { ltObserver.observe({ type: 'longtask', buffered: false }) } catch {}

    // Track frame times via rAF
    let lastFrame = performance.now()
    function measureFrame() {
      const now = performance.now()
      window.__kbPerf.frames.push({
        ts: now,
        dt: now - lastFrame,
      })
      lastFrame = now
      requestAnimationFrame(measureFrame)
    }
    requestAnimationFrame(measureFrame)
  })

  // Simulate keyboard opening: shrink viewport from FULL_HEIGHT to SMALL_HEIGHT
  console.log('\n--- Simulating keyboard OPEN ---')
  await page.evaluate(() => { window.__kbPerf.frames = []; window.__kbPerf.openStart = performance.now() })

  for (let i = 1; i <= ANIMATION_STEPS; i++) {
    const progress = i / ANIMATION_STEPS
    // iOS keyboard uses an ease-out curve
    const eased = 1 - Math.pow(1 - progress, 3)
    const height = Math.round(FULL_HEIGHT - (FULL_HEIGHT - SMALL_HEIGHT) * eased)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height,
      deviceScaleFactor: 3,
      mobile: true,
    })
    await page.waitForTimeout(FRAME_MS)
  }

  await page.waitForTimeout(200) // settle

  const openMetrics = await page.evaluate(() => {
    const perf = window.__kbPerf
    const openEnd = performance.now()
    const duration = openEnd - perf.openStart
    const frameDts = perf.frames.map(f => f.dt)
    const avgFrame = frameDts.reduce((a, b) => a + b, 0) / frameDts.length
    const maxFrame = Math.max(...frameDts)
    const droppedFrames = frameDts.filter(dt => dt > 25).length // >25ms = dropped
    const jank = frameDts.filter(dt => dt > 50).length // >50ms = major jank
    const totalLayoutShift = perf.layoutShifts.reduce((a, s) => a + s.value, 0)
    const longTasks = perf.longTasks.filter(t => t.ts >= perf.openStart)

    return {
      duration: Math.round(duration),
      totalFrames: frameDts.length,
      avgFrameMs: Math.round(avgFrame * 10) / 10,
      maxFrameMs: Math.round(maxFrame * 10) / 10,
      droppedFrames,
      majorJank: jank,
      totalLayoutShift: Math.round(totalLayoutShift * 1000) / 1000,
      longTasks: longTasks.length,
      longestTask: longTasks.length ? Math.round(Math.max(...longTasks.map(t => t.duration))) : 0,
    }
  })

  console.log('Open metrics:', JSON.stringify(openMetrics, null, 2))

  // Wait a bit then simulate keyboard closing
  await page.waitForTimeout(500)
  console.log('\n--- Simulating keyboard CLOSE ---')
  await page.evaluate(() => { window.__kbPerf.frames = []; window.__kbPerf.layoutShifts = []; window.__kbPerf.longTasks = []; window.__kbPerf.closeStart = performance.now() })

  for (let i = 1; i <= ANIMATION_STEPS; i++) {
    const progress = i / ANIMATION_STEPS
    const eased = 1 - Math.pow(1 - progress, 3)
    const height = Math.round(SMALL_HEIGHT + (FULL_HEIGHT - SMALL_HEIGHT) * eased)

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height,
      deviceScaleFactor: 3,
      mobile: true,
    })
    await page.waitForTimeout(FRAME_MS)
  }

  await page.waitForTimeout(200) // settle

  const closeMetrics = await page.evaluate(() => {
    const perf = window.__kbPerf
    const closeEnd = performance.now()
    const duration = closeEnd - perf.closeStart
    const frameDts = perf.frames.map(f => f.dt)
    const avgFrame = frameDts.reduce((a, b) => a + b, 0) / frameDts.length
    const maxFrame = Math.max(...frameDts)
    const droppedFrames = frameDts.filter(dt => dt > 25).length
    const jank = frameDts.filter(dt => dt > 50).length
    const totalLayoutShift = perf.layoutShifts.reduce((a, s) => a + s.value, 0)
    const longTasks = perf.longTasks.filter(t => t.ts >= perf.closeStart)

    return {
      duration: Math.round(duration),
      totalFrames: frameDts.length,
      avgFrameMs: Math.round(avgFrame * 10) / 10,
      maxFrameMs: Math.round(maxFrame * 10) / 10,
      droppedFrames,
      majorJank: jank,
      totalLayoutShift: Math.round(totalLayoutShift * 1000) / 1000,
      longTasks: longTasks.length,
      longestTask: longTasks.length ? Math.round(Math.max(...longTasks.map(t => t.duration))) : 0,
    }
  })

  console.log('Close metrics:', JSON.stringify(closeMetrics, null, 2))

  // Also capture the current root height behavior
  const rootInfo = await page.evaluate(() => {
    const root = document.getElementById('root')
    const computed = root ? getComputedStyle(root) : null
    return {
      rootHeight: computed?.height,
      kbInset: getComputedStyle(document.documentElement).getPropertyValue('--kb-inset'),
      dataKeyboardOpen: document.documentElement.getAttribute('data-keyboard-open'),
    }
  })
  console.log('\nFinal state:', JSON.stringify(rootInfo, null, 2))

  await browser.close()
  console.log('\nDone!')
}

run().catch(console.error)
