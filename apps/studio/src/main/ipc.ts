import { ipcMain, type BrowserWindow } from 'electron'
import type { StudioCalls, StudioPushes } from '@shared/ipc'
import { validStudioArgs } from '@shared/ipc-validation'

export type StudioPush = <K extends keyof StudioPushes>(channel: K, payload: StudioPushes[K]) => void

export type StudioHandlers = {
  [K in keyof StudioCalls]: (...args: Parameters<StudioCalls[K]>) => ReturnType<StudioCalls[K]> | Promise<ReturnType<StudioCalls[K]>>
}

export function isStudioPage(url: string, entry: string): boolean {
  try {
    const actual = new URL(url)
    const expected = new URL(entry)
    actual.hash = ''
    expected.hash = ''
    return actual.href === expected.href
  } catch {
    return false
  }
}

export function registerStudioIpc(handlers: Partial<StudioHandlers>, window: () => BrowserWindow | null, entry: string): void {
  for (const channel of Object.keys(handlers) as (keyof StudioCalls)[]) {
    const handler = handlers[channel] as (...args: unknown[]) => unknown
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const win = window()
      const senderFrame = event.senderFrame
      if (!win || win.isDestroyed() || event.sender !== win.webContents ||
          !senderFrame || senderFrame !== win.webContents.mainFrame || !isStudioPage(senderFrame.url, entry)) {
        throw new Error('Invalid Studio IPC sender')
      }
      if (!validStudioArgs(channel, args)) throw new Error(`Invalid arguments for ${channel}`)
      return handler(...args)
    })
  }
}
