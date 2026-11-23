import { api } from './api'
import { formatIpcError } from './errors'
import { useStudio } from '../store'

/** Open a file or folder with the OS shell and surface failures as a toast. */
export function openPath(path: string): void {
  void api.call('shell:openPath', path).catch((err) => {
    useStudio.getState().showToast(formatIpcError(err), 'error')
  })
}
