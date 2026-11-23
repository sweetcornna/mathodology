import { createTwoFilesPatch } from 'diff'
import type { DiffWorkerRequest, DiffWorkerResponse } from './diff.worker'

const SMALL_CHARS = 30_000
const SMALL_LINES = 1_000
const SYNC_TIMEOUT_MS = 250
const SYNC_MAX_EDIT_LENGTH = 4_000
const WORKER_WAIT_MS = 2_500

export interface PatchResult {
  patch: string | null
  tooLarge?: boolean
}

function stripPatchHeader(raw: string): string {
  const lines = raw.split('\n')
  return lines.slice(Math.max(0, lines.findIndex((l) => l.startsWith('@@')))).join('\n')
}

function countLinesBounded(s: string, limit: number): number {
  let count = 1
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10 && ++count > limit) return count
  }
  return count
}

function isSmall(oldStr: string, newStr: string): boolean {
  if (oldStr.length + newStr.length > SMALL_CHARS) return false
  return countLinesBounded(oldStr, SMALL_LINES) <= SMALL_LINES && countLinesBounded(newStr, SMALL_LINES) <= SMALL_LINES
}

let worker: Worker | null = null
let workerBroken = false
let nextReqId = 1
const pending = new Map<number, { resolve: (r: PatchResult) => void; timer: ReturnType<typeof setTimeout> }>()

function resetWorker(): void {
  if (worker) {
    worker.terminate()
    worker = null
  }
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer)
    pending.delete(id)
    entry.resolve({ patch: null, tooLarge: true })
  }
}

function runInWorker(name: string, oldStr: string, newStr: string, full: boolean): Promise<PatchResult> | null {
  if (workerBroken || typeof Worker === 'undefined') return null
  try {
    if (!worker) {
      worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<DiffWorkerResponse>) => {
        const entry = pending.get(e.data.id)
        if (!entry) return
        pending.delete(e.data.id)
        clearTimeout(entry.timer)
        entry.resolve(e.data.aborted ? { patch: null, tooLarge: true } : { patch: e.data.patch })
      }
      worker.onerror = () => {
        workerBroken = true
        resetWorker()
      }
    }
    const id = nextReqId++
    return new Promise<PatchResult>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        // Terminate a wedged worker rather than letting it keep burning CPU.
        resetWorker()
        resolve({ patch: null, tooLarge: true })
      }, full ? 10_000 : WORKER_WAIT_MS)
      pending.set(id, { resolve, timer })
      const req: DiffWorkerRequest = { id, name, oldStr, newStr, full }
      worker!.postMessage(req)
    })
  } catch {
    workerBroken = true
    return null
  }
}

/**
 * Compute a unified diff patch without freezing the UI thread.
 * Small inputs run synchronously; large inputs run in a Web Worker (or a bounded fallback).
 */
export async function computeUnifiedPatch(name: string, oldStr: string, newStr: string, full = false): Promise<PatchResult> {
  if (oldStr === newStr) return { patch: '' }
  if (!full && isSmall(oldStr, newStr)) {
    const raw = createTwoFilesPatch(name, name, oldStr, newStr, '', '', {
      context: 3,
      timeout: SYNC_TIMEOUT_MS,
      maxEditLength: SYNC_MAX_EDIT_LENGTH
    })
    return raw === undefined ? { patch: null, tooLarge: true } : { patch: stripPatchHeader(raw) }
  }
  const viaWorker = runInWorker(name, oldStr, newStr, full)
  if (viaWorker) return viaWorker
  const raw = full
    ? createTwoFilesPatch(name, name, oldStr, newStr, '', '', { context: 3 })
    : createTwoFilesPatch(name, name, oldStr, newStr, '', '', {
        context: 3,
        timeout: SYNC_TIMEOUT_MS,
        maxEditLength: SYNC_MAX_EDIT_LENGTH
      })
  return raw === undefined ? { patch: null, tooLarge: true } : { patch: stripPatchHeader(raw) }
}
