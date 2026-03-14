import { app } from 'electron'

/**
 * Register will-navigate handler on all BrowserWindows to block navigation
 * to external URLs (anything not starting with intentos:// or app://).
 *
 * Call once during app initialization.
 */
export function registerNavigationGuard(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(navigationUrl)
      } catch {
        event.preventDefault()
        console.warn(`[SecurityGuard] Blocked unparseable navigation URL: ${navigationUrl}`)
        return
      }
      const ALLOWED_PROTOCOLS = ['intentos:', 'app:', 'file:']
      if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        event.preventDefault()
        console.warn(`[SecurityGuard] Blocked navigation to: ${navigationUrl}`)
      }
    })

    // Block new window creation from renderer (e.g., window.open())
    contents.setWindowOpenHandler(({ url }) => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        console.warn(`[SecurityGuard] Blocked window.open() with unparseable URL: ${url}`)
        return { action: 'deny' }
      }
      const ALLOWED_PROTOCOLS = ['intentos:', 'app:', 'file:']
      if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        console.warn(`[SecurityGuard] Blocked window.open() to: ${url}`)
        return { action: 'deny' }
      }
      return { action: 'allow' }
    })
  })
}
