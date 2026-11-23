import { useMemo } from 'react'
import type { SessionEvent } from '@shared/types'
import { projectTranscript, type Transcript } from './transcript'
import { useStudio } from '../store'

const EMPTY: SessionEvent[] = []

/** Shared memoized transcript projection across Transcript, Composer Dock, and Tasks tab. */
export function useTranscript(sessionId: string | null): Transcript {
  const events = useStudio((s) => (sessionId ? s.events[sessionId] ?? EMPTY : EMPTY))
  return useMemo(() => projectTranscript(events, sessionId ?? undefined), [events, sessionId])
}
