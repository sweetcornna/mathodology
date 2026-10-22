import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { FindingSeverity, FindingStatus, Project, Review, ReviewFinding, Session, SessionEvent, Settings } from '@shared/types'
import type { Turn } from './agents/base'
import { agentEnv, resolveBinary } from './agents/detect'
import { traceCitations, traceSummary } from './citetrace'
import type { Fetcher } from './refcheck'
import { ADAPTERS } from './sessions'
import { readJson, writeAtomic, type Store } from './store'

const DIGEST_LIMIT = 60_000
const SEVERITIES: FindingSeverity[] = ['fail', 'warn', 'inconclusive', 'pass']

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max)} […${t.length - max} more characters]` : t
}

function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s+/g, ' '), max)
}

/** What a tool call did, in one line: the command for shells, the path for file tools. */
function callLine(call: Extract<SessionEvent, { kind: 'tool.call' }>): string {
  const input = (call.input ?? {}) as Record<string, unknown>
  if (typeof input.command === 'string') return `${call.name} \`${oneLine(input.command, 400)}\``
  const path = ['file_path', 'path', 'notebook_path', 'absolute_path'].map((k) => input[k]).find((v) => typeof v === 'string')
  if (typeof path === 'string') return `${call.name} ${path}`
  if (call.changes?.length) return `${call.name} ${call.changes.map((c) => `${c.kind} ${c.path}`).join(', ')}`
  return `${call.name} ${oneLine(call.title || JSON.stringify(call.input ?? {}), 300)}`
}

/**
 * A plain-text record of what happened in a session: each prompt, every tool call with its
 * outcome and output excerpt, the agent's replies and the files it produced. The reviewer
 * checks the replies against this record. Older turns are dropped first when it is too long.
 */
export function buildDigest(session: Session, project: Project, events: SessionEvent[]): string {
  const turns: string[] = []
  let current: string[] | null = null
  const results = new Map<string, Extract<SessionEvent, { kind: 'tool.result' }>>()
  for (const e of events) if (e.kind === 'tool.result') results.set(e.callId, e)

  let n = 0
  for (const e of events) {
    switch (e.kind) {
      case 'user.message':
        if (current) turns[turns.length - 1] = current.join('\n')
        current = [`## Turn ${++n}`, '', `User: ${clip(e.text, 2000)}`]
        if (e.attachments.length) current.push(`Attached: ${e.attachments.join(', ')}`)
        turns.push('')
        break
      case 'tool.call': {
        if (!current || e.toolKind === 'todo') break
        const r = results.get(e.callId)
        const outcome = !r ? 'no result recorded' : r.isError ? 'FAILED' : 'ok'
        current.push(`- [call:${e.callId}]${e.parentCallId ? ' (sub-agent)' : ''} ${callLine(e)} → ${outcome}`)
        if (r?.output.trim()) current.push(`  output: ${oneLine(r.output, r.isError ? 1200 : 600)}`)
        break
      }
      case 'assistant.text':
        if (current && !e.parentCallId) current.push(`Agent: ${clip(e.text, 4000)}`)
        break
      case 'artifact.version':
        if (current) current.push(`- produced ${e.rel} v${e.v} (${e.origin}${e.callId ? `, call:${e.callId}` : ''})`)
        break
      case 'notice':
        if (current && e.level !== 'info') current.push(`Notice (${e.level}): ${oneLine(e.text, 400)}`)
        break
      case 'turn.completed':
        if (current) {
          current.push(`Turn ${e.ok ? 'completed' : e.summary === 'interrupted' ? 'was interrupted' : 'failed'}.`)
          turns[turns.length - 1] = current.join('\n')
          current = null
        }
        break
      default:
        break
    }
  }
  if (current) turns[turns.length - 1] = current.join('\n')

  const head = [
    '# Execution digest',
    `Project folder: ${project.path}`,
    `Agent: ${session.agent}${session.model ? ` (${session.model})` : ''}`,
    'Paths are relative to the project folder. `call:<id>` names a recorded tool call.'
  ].join('\n')
  const kept: string[] = []
  let size = head.length
  for (let i = turns.length - 1; i >= 0; i--) {
    if (size + turns[i].length > DIGEST_LIMIT && kept.length) {
      kept.unshift(`(${i + 1} earlier turn(s) omitted for length)`)
      break
    }
    kept.unshift(turns[i])
    size += turns[i].length
  }
  return [head, ...kept].join('\n\n')
}

export function reviewPrompt(digest: string, language: 'zh-CN' | 'en', citations = ''): string {
  const lang = language === 'en' ? 'English' : 'Simplified Chinese'
  return `You are checking another agent's work in a mathematical-modeling project. Stay read-only: do not edit or create files and do not run anything that writes. Do not redo the analysis.

Trace the work instead of recomputing it. For each substantive claim the agent made in its replies (numbers, fitted parameters, model results, statements about figures or files, "it ran", "tests pass", conclusions), find the evidence in the execution digest below or in the project files, and judge whether that evidence supports the claim. Open files when you need to: the scripts, their outputs, the figures, the paper. Quote the exact line or output that settles a point.

Severity:
- fail: the evidence contradicts a claim; a command failed but was reported as working; a file or figure the agent described is missing or shows something else; a result rests on an error.
- warn: the claim is plausible but weakly supported; an assumption is unstated or doubtful; a method choice or unit is questionable; the result would be hard to reproduce.
- inconclusive: the evidence needed to judge an important claim is missing.
- pass: an important claim that checks out. List only the significant ones.

Reply with exactly one JSON object in a \`\`\`json fenced block and nothing after it:
{"summary": "two or three sentences", "findings": [{"severity": "fail|warn|inconclusive|pass", "title": "short claim being judged", "detail": "what the evidence shows", "evidence": ["relative/path or call:<id>"], "suggestion": "what to do, for fail and warn"}]}
Write summary, titles, details and suggestions in ${lang}. Keep each detail under 80 words.
${citations ? `\n${citations}\n` : ''}
${digest}`
}

/** Pull the findings out of the reviewer's reply; tolerates prose around the JSON. */
export function parseReview(text: string): { summary: string; findings: ReviewFinding[] } | null {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1])
  const candidates = [...fenced.reverse()]
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1))
  for (const raw of candidates) {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      continue
    }
    const obj = data as { summary?: unknown; findings?: unknown }
    if (!obj || !Array.isArray(obj.findings)) continue
    const findings = obj.findings.flatMap((f): ReviewFinding[] => {
      const x = f as Record<string, unknown>
      if (!x || typeof x.title !== 'string') return []
      const severity = SEVERITIES.includes(x.severity as FindingSeverity) ? (x.severity as FindingSeverity) : 'inconclusive'
      return [
        {
          id: randomUUID(),
          severity,
          title: x.title,
          detail: typeof x.detail === 'string' ? x.detail : '',
          evidence: Array.isArray(x.evidence) ? x.evidence.filter((v): v is string => typeof v === 'string').slice(0, 8) : [],
          suggestion: typeof x.suggestion === 'string' && x.suggestion.trim() ? x.suggestion : undefined,
          status: 'open'
        }
      ]
    })
    findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
    return { summary: typeof obj.summary === 'string' ? obj.summary : '', findings }
  }
  return null
}

/** Studio's citation findings and the reviewer's, most severe first; the trace's lead on ties. */
export function mergeFindings(citations: ReviewFinding[], reviewer: ReviewFinding[]): ReviewFinding[] {
  return [...citations, ...reviewer].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity))
}

export interface ReviewHooks {
  changed(review: Review): void
}

const TRACE_TIMEOUT = 45_000
/** How long quitting waits for running reviews to record that they stopped. */
const SHUTDOWN_WAIT = 2_000
const CUT_OFF = 'Studio closed before the review finished.'

/** Runs and stores reviews. Each session's reviews live in one JSON file beside its events. */
export class ReviewManager {
  private running = new Map<string, Turn>()
  private cancelled = new Set<string>()
  /** Reviews in progress, from start to their last save; aborting stops the citation trace. */
  private active = new Map<string, { review: Review; abort: AbortController; done: Promise<void> }>()

  constructor(
    private readonly dir: string,
    private readonly store: Store,
    private readonly settings: () => Settings,
    private readonly hooks: ReviewHooks,
    /** Registry lookups for the citation trace. */
    private readonly fetch: Fetcher
  ) {
    mkdirSync(dir, { recursive: true })
    // A review saved as running was cut off when Studio last quit or crashed; nothing will finish it.
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue
      try {
        const list = readJson<Review[]>(join(dir, name), [])
        if (!Array.isArray(list) || !list.some((r) => r.status === 'running')) continue
        const stopped = list.map((r): Review => (r.status === 'running' ? { ...r, status: 'cancelled', error: CUT_OFF, finishedAt: Date.now() } : r))
        writeAtomic(join(dir, name), JSON.stringify(stopped))
      } catch {
        // left as it is; the next launch tries again
      }
    }
  }

  private path(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`)
  }

  list(sessionId: string): Review[] {
    return readJson<Review[]>(this.path(sessionId), [])
  }

  private save(review: Review): void {
    // A session deleted while its review ran keeps no review file.
    if (!this.store.session(review.sessionId)) return
    const list = this.list(review.sessionId)
    const i = list.findIndex((r) => r.id === review.id)
    if (i >= 0) list[i] = review
    else list.push(review)
    // Keep the history short; the newest reviews are the ones that matter.
    writeAtomic(this.path(review.sessionId), JSON.stringify(list.slice(-10)))
    this.hooks.changed(review)
  }

  remove(sessionId: string): void {
    for (const { review } of this.active.values()) if (review.sessionId === sessionId) this.cancel(review.id)
    rmSync(this.path(sessionId), { force: true })
  }

  setStatus(sessionId: string, reviewId: string, findingId: string, status: FindingStatus): Review | undefined {
    const review = this.list(sessionId).find((r) => r.id === reviewId)
    const finding = review?.findings.find((f) => f.id === findingId)
    if (!review || !finding) return review
    finding.status = status
    this.save(review)
    return review
  }

  cancel(reviewId: string): void {
    const active = this.active.get(reviewId)
    if (!active) return
    this.cancelled.add(reviewId)
    active.abort.abort()
    this.running.get(reviewId)?.interrupt()
  }

  /** Record how a review ended, keeping the findings already saved with it. */
  private finish(review: Review, patch: Partial<Review>): void {
    const saved = this.list(review.sessionId).find((r) => r.id === review.id) ?? review
    this.save({ ...saved, ...patch, finishedAt: Date.now() })
  }

  async start(sessionId: string): Promise<Review> {
    const session = this.store.session(sessionId)
    const project = session && this.store.project(session.projectId)
    if (!session || !project) throw new Error('Unknown session')
    const events = this.store.events(sessionId)
    const settings = this.settings()
    const review: Review = {
      id: randomUUID(),
      sessionId,
      agent: session.agent,
      model: session.model || settings.agents[session.agent].defaultModel || undefined,
      status: 'running',
      createdAt: Date.now(),
      throughSeq: events[events.length - 1]?.seq ?? 0,
      steps: 0,
      findings: []
    }
    this.save(review)
    const abort = new AbortController()
    const done = this.run(review, session, project, events, settings, abort)
      .catch((err) => {
        try {
          this.finish(review, { status: 'error', error: String((err as Error)?.message ?? err) })
        } catch {
          // nowhere left to record it
        }
      })
      .finally(() => {
        this.active.delete(review.id)
        this.running.delete(review.id)
        this.cancelled.delete(review.id)
      })
    this.active.set(review.id, { review, abort, done })
    return review
  }

  private async run(review: Review, session: Session, project: Project, events: SessionEvent[], settings: Settings, abort: AbortController): Promise<void> {
    const adapter = ADAPTERS[session.agent]
    // Studio traces citations itself first, so the reviewer can spend its effort on substance. At the time
    // limit (or on cancel) lookups still out count as unverifiable; every finding already made is kept.
    const timer = setTimeout(() => abort.abort(), TRACE_TIMEOUT)
    const traced = await traceCitations({ project, events, fetch: this.fetch, language: settings.locale, signal: abort.signal }).catch(() => null)
    clearTimeout(timer)
    const citationFindings: ReviewFinding[] = (traced?.findings ?? []).map((f) => ({ ...f, id: randomUUID() }))
    if (traced) review.trace = traced.trace
    if (this.cancelled.has(review.id)) {
      this.save({ ...review, status: 'cancelled', findings: citationFindings, finishedAt: Date.now() })
      return
    }
    if (citationFindings.length) this.save({ ...review, findings: citationFindings })

    const env = await agentEnv()
    // A cancel can arrive while the environment is read.
    if (this.cancelled.has(review.id)) {
      this.save({ ...review, status: 'cancelled', findings: citationFindings, finishedAt: Date.now() })
      return
    }
    const binary = resolveBinary(adapter, settings, env)
    if (!binary) {
      this.save({ ...review, status: 'error', error: `${adapter.name} was not found.`, findings: citationFindings, finishedAt: Date.now() })
      return
    }

    const texts: string[] = []
    let errorText = ''
    let interrupted = false
    const turn = adapter.start(
      {
        binary,
        cwd: project.path,
        prompt: reviewPrompt(buildDigest(session, project, events), settings.locale, traced ? traceSummary(traced.trace, traced.findings) : ''),
        model: review.model,
        effort: session.effort || undefined,
        permissionMode: 'plan',
        ephemeral: true,
        settings: settings.agents[session.agent],
        env
      },
      {
        emit: (body) => {
          if (body.kind === 'assistant.text' && !body.parentCallId) texts.push(body.text)
          if (body.kind === 'tool.call') {
            review.steps++
            this.hooks.changed({ ...review, findings: citationFindings })
          }
          // The reviewer only reads; anything that asks for approval is refused.
          if (body.kind === 'permission.request') turn.respondPermission(body.requestId, false)
          if (body.kind === 'notice' && body.level === 'error') errorText = body.text
          if (body.kind === 'turn.completed' && body.summary === 'interrupted') interrupted = true
        },
        nativeSession: () => undefined
      }
    )
    this.running.set(review.id, turn)
    await turn.done.catch(() => undefined)
    this.running.delete(review.id)
    const parsed = parseReview(texts.join('\n\n'))
    const finishedAt = Date.now()
    if (interrupted) this.save({ ...review, status: 'cancelled', findings: citationFindings, finishedAt })
    else if (parsed) this.save({ ...review, status: 'done', summary: parsed.summary, findings: mergeFindings(citationFindings, parsed.findings), finishedAt })
    else if (this.cancelled.has(review.id)) this.save({ ...review, status: 'cancelled', findings: citationFindings, finishedAt })
    else
      this.save({
        ...review,
        status: 'error',
        error: errorText || clip(texts.join('\n\n'), 1500) || 'The reviewer did not return any findings.',
        findings: citationFindings,
        finishedAt
      })
  }

  /** Stop every review and wait, at most SHUTDOWN_WAIT, until each has saved that it stopped. */
  async shutdown(): Promise<void> {
    const active = [...this.active.values()]
    for (const a of active) this.cancel(a.review.id)
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([Promise.allSettled(active.map((a) => a.done)), new Promise<void>((r) => (timer = setTimeout(r, SHUTDOWN_WAIT)))])
    clearTimeout(timer)
    // One still going (an agent that ignores the interrupt) is recorded as stopped all the same.
    for (const a of active) {
      if (!this.active.has(a.review.id)) continue
      try {
        this.finish(a.review, { status: 'cancelled', error: CUT_OFF })
      } catch {
        // the next launch marks it
      }
    }
  }
}
