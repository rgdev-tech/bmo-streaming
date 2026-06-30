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
        // Intentar Chrome del sistema primero (fingerprints reales → bypasea CF bot protection).
        // Si no está instalado, usar Chromium bundled con Playwright.
        const { execSync } = await import('child_process')
        let chromePath: string | null = null
        try {
          chromePath = execSync(
            'ls "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" 2>/dev/null || ' +
            'ls "/Applications/Chromium.app/Contents/MacOS/Chromium" 2>/dev/null || echo ""',
            { encoding: 'utf8' }
          ).trim() || null
        } catch {}

        if (chromePath) {
          console.error(`[browser] usando Chrome del sistema: ${chromePath}`)
          browser = await chromium.launch({
            headless: true,
            executablePath: chromePath,
            args: LOCAL_ARGS,
          })
        } else {
          console.error('[browser] Chrome no encontrado, usando Chromium bundled')
          browser = await chromium.launch({ headless: true, args: LOCAL_ARGS })
        }
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
