import type { Browser } from 'playwright-core'

let browserPromise: Promise<Browser> | null = null

const LOCAL_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--no-first-run',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-hang-monitor',
  '--disable-prompt-on-repost',
  '--disable-client-side-phishing-detection',
  '--disable-component-update',
  '--metrics-recording-only',
  '--mute-audio',
]

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright-core')
      const isVercel = !!process.env.VERCEL

      let browser: Browser
      if (isVercel) {
        const sparticuzChromium = (await import('@sparticuz/chromium-min')).default
        const executablePath = await sparticuzChromium.executablePath(
          'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar'
        )
        browser = await chromium.launch({
          headless: true,
          executablePath,
          args: [...sparticuzChromium.args, '--disable-blink-features=AutomationControlled'],
        })
      } else {
        browser = await chromium.launch({ headless: true, args: LOCAL_ARGS })
      }

      browser.on('disconnected', () => { browserPromise = null })
      return browser
    })()
  }
  return browserPromise
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise
    await browser.close()
    browserPromise = null
  }
}
