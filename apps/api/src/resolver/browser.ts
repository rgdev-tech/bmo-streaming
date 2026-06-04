import { chromium, type Browser } from 'playwright'

let browserPromise: Promise<Browser> | null = null

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
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
      ],
    })
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
