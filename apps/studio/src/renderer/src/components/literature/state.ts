import { useEffect, useState } from 'react'
import type { LitCitation, LitGraph, LitResult } from '@shared/types'

/** Source groups of the search connector that suit modeling work. */
export const LIT_SOURCES = ['paper', 'paper.math', 'paper.preprint', 'paper.cs', 'paper.biomed', 'dataset'] as const

export interface LitState {
  view: 'search' | 'refs'
  query: string
  source: (typeof LIT_SOURCES)[number]
  results: LitResult[] | null
  error: string | null
  /** Citations added in this window, keyed by projectId then paper URL. */
  citedByProject: Record<string, Record<string, LitCitation>>
  /** Published versions found for preprints, keyed by preprint URL; null when none was found. */
  published: Record<string, LitResult | null>
  graphs: Record<string, LitGraph>
}

// Kept for the life of the window, so switching pane tabs does not lose a search.
let saved: LitState = {
  view: 'search',
  query: '',
  source: 'paper',
  results: null,
  error: null,
  citedByProject: {},
  published: {},
  graphs: {}
}

const listeners = new Set<(state: LitState) => void>()

export function updateLitState(updater: (prev: LitState) => LitState): void {
  saved = updater(saved)
  for (const listener of listeners) listener(saved)
}

export function getLitState(): LitState {
  return saved
}

export function useLitState(): LitState {
  const [state, setState] = useState<LitState>(saved)
  useEffect(() => {
    setState(saved)
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}
