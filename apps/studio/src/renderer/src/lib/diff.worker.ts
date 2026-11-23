import { createTwoFilesPatch } from 'diff'

export interface DiffWorkerRequest {
  id: number
  name: string
  oldStr: string
  newStr: string
  full?: boolean
}

export interface DiffWorkerResponse {
  id: number
  patch: string | null
  aborted?: boolean
}

function stripPatchHeader(raw: string): string {
  const lines = raw.split('\n')
  return lines.slice(Math.max(0, lines.findIndex((l) => l.startsWith('@@')))).join('\n')
}

self.onmessage = (e: MessageEvent<DiffWorkerRequest>) => {
  const { id, name, oldStr, newStr, full } = e.data
  const raw = full
    ? createTwoFilesPatch(name, name, oldStr, newStr, '', '', { context: 3 })
    : createTwoFilesPatch(name, name, oldStr, newStr, '', '', { context: 3, timeout: 1500, maxEditLength: 15_000 })
  if (raw === undefined) {
    self.postMessage({ id, patch: null, aborted: true } satisfies DiffWorkerResponse)
    return
  }
  self.postMessage({ id, patch: stripPatchHeader(raw) } satisfies DiffWorkerResponse)
}
