import type { StudioApi } from '@shared/ipc'

export const api: StudioApi = window.studio
export const isMac = api.platform === 'darwin'
export const mod = isMac ? '⌘' : 'Ctrl+'
export const isWindows = api.platform === 'win32'
/** The separator for paths shown to the user. */
export const sep = isWindows ? '\\' : '/'

/** `path` relative to `root` with `/` separators, or undefined outside it. Windows paths ignore case. */
export function projectRel(root: string, path: string): string | undefined {
  if (!root) return undefined
  const norm = (p: string): string => (isWindows ? p.replace(/\\/g, '/').toLowerCase() : p).replace(/\/+$/, '')
  const base = norm(root)
  if (!norm(path).startsWith(base + '/')) return undefined
  return path.slice(base.length + 1).replace(/\\/g, '/')
}

/** The home folder shortened to `~` (macOS, Linux and Windows layouts). */
export function tildify(path: string): string {
  return path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/, '~')
}

/** URL for a project file, served by the main process's confined `studio-file` scheme. */
export function fileUrl(projectId: string, rel: string, version = 0): string {
  return `studio-file://project/${encodeURIComponent(projectId)}/${rel.split('/').map(encodeURIComponent).join('/')}?v=${version}`
}

/** URL for the stored bytes of one artifact version. */
export function artifactUrl(projectId: string, artifactId: string, v: number): string {
  return `studio-file://artifact/${encodeURIComponent(projectId)}/${encodeURIComponent(artifactId)}/${v}`
}
