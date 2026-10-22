import type { StudioApi } from '@shared/ipc'

export const api: StudioApi = window.studio
export const isMac = api.platform === 'darwin'
export const mod = isMac ? '⌘' : 'Ctrl+'

/** URL for a project file, served by the main process's confined `studio-file` scheme. */
export function fileUrl(projectId: string, rel: string, version = 0): string {
  return `studio-file://project/${encodeURIComponent(projectId)}/${rel.split('/').map(encodeURIComponent).join('/')}?v=${version}`
}

/** URL for the stored bytes of one artifact version. */
export function artifactUrl(projectId: string, artifactId: string, v: number): string {
  return `studio-file://artifact/${encodeURIComponent(projectId)}/${encodeURIComponent(artifactId)}/${v}`
}
