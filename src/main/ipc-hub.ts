import { ipcMain } from 'electron'

export class IpcHub {
  private handlers = new Map<string, boolean>()

  // 注册 handler，防止重复注册
  register(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
    if (this.handlers.has(channel)) {
      ipcMain.removeHandler(channel)
    }
    ipcMain.handle(channel, handler)
    this.handlers.set(channel, true)
  }

  // 移除 handler
  unregister(channel: string): void {
    ipcMain.removeHandler(channel)
    this.handlers.delete(channel)
  }

  // 获取所有已注册的 channel 列表
  getRegisteredChannels(): string[] {
    return Array.from(this.handlers.keys())
  }
}

export const ipcHub = new IpcHub()
