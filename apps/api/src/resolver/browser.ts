import { chromium, type Browser } from 'playwright-core'
import sparticuzChromium from '@sparticuz/chromium-min'

let browserPromise: Promise<Browser> | null = null

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = (async () => {
      const isVercel = !!process.env.VERCEL
      const executablePath = isVercel
        ? await sparticuzChromium.executablePath(
            'https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.tar'
          )
        : undefined

      return chromium.launch({
        headless: true,
        executablePath,
        args: isVercel
          ? [...sparticuzChromium.args, '--disable-blink-features=AutomationControlled']
          : ['--disable-blink-features=AutomationControlled'],
      })
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
