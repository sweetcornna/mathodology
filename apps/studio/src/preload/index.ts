import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { STUDIO_PUSH_CHANNELS, type StudioApi } from '@shared/ipc'
import { STUDIO_CALL_ARGUMENTS } from '@shared/ipc-validation'

const api: StudioApi = {
  call: ((channel: string, ...args: unknown[]) => {
    if (!Object.hasOwn(STUDIO_CALL_ARGUMENTS, channel)) return Promise.reject(new Error('Unknown Studio call'))
    return ipcRenderer.invoke(channel, ...args)
  }) as StudioApi['call'],
  on: (channel, listener) => {
    if (!Object.hasOwn(STUDIO_PUSH_CHANNELS, channel) || typeof listener !== 'function') throw new Error('Unknown Studio subscription')
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  platform: process.platform,
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('studio', api)
