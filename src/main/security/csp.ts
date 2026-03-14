import { session } from 'electron'
import { is } from '@electron-toolkit/utils'

/**
 * Configure Content Security Policy headers for all sessions.
 * In dev mode, relaxed to allow Vite HMR inline scripts/styles.
 */
export function configureCSP(): void {
  if (is.dev) {
    // Dev mode: allow inline scripts/styles for Vite HMR
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self';" +
              "script-src 'self' 'unsafe-inline';" +
              "style-src 'self' 'unsafe-inline';" +
              "img-src 'self' data:;" +
              "font-src 'self';" +
              "connect-src 'self' http://localhost:* ws://localhost:*;" +
              "frame-src 'none';" +
              "object-src 'none';",
          ],
        },
      })
    })
  } else {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self';" +
              "script-src 'self';" +
              "style-src 'self' 'unsafe-inline';" +
              "img-src 'self' data:;" +
              "font-src 'self';" +
              "connect-src 'self';" +
              "frame-src 'none';" +
              "object-src 'none';",
          ],
        },
      })
    })
  }
}
