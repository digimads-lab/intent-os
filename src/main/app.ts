import { app, BrowserWindow } from 'electron'

import { windowManager } from './window-manager'

export class App {
  async initialize(): Promise<void> {
    // 单实例锁
    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
      app.quit()
      return
    }

    app.on('second-instance', () => {
      windowManager.focusMainWindow()
    })

    await app.whenReady()

    windowManager.createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        windowManager.createMainWindow()
      }
    })
  }
}

export const intentOSApp = new App()
