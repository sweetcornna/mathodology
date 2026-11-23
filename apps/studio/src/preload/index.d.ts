import type { StudioApi } from '../shared/ipc'

declare global {
  interface Window {
    readonly studio: StudioApi
  }
}

export {}
