import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { StudioApi } from '@shared/ipc'

const api: StudioApi = {
  call: ((channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as StudioApi['call'],
  on: (channel, listener) => {
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('studio', api)
