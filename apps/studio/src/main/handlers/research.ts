import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { agentEnv } from '../agents/detect'
import type { ArtifactStore } from '../artifacts'
import { editBibliography } from '../bibliography'
import { parseBibtex, withDoi } from '../bibtex'
import { runChecks } from '../checks'
import type { McpPool } from '../connectors'
import { previewBytes } from '../files'
import { cite, mergeResults, parseGraph, parseResults, publishedVersion } from '../literature'
import { checkBibliography, checkEntry } from '../refcheck'
import type { Fetcher } from '../registry'
import type { ReviewManager } from '../reviews'
import type { SessionManager } from '../sessions'
import type { Store } from '../store'
import type { StudioHandlers, StudioPush } from '../ipc'

export function researchHandlers(deps: {
  store: Store; sessions: SessionManager; reviews: ReviewManager; artifacts: ArtifactStore;
  mcp: McpPool; registryFetch: Fetcher; kitRoot: string; getSettings(): Settings; push: StudioPush
}) {
  const { store, sessions, reviews, artifacts, mcp, registryFetch, kitRoot, getSettings, push } = deps
  return {
    'artifacts:list': async (projectId) => {
      const project = store.project(projectId)
      if (!project) return []
      // While a turn runs, new files are left for the turn's own scan to attribute.
      if (existsSync(project.path) && !sessions.projectBusy(projectId)) await artifacts.captureAvailable(project, 'scan', () => ({ origin: 'external' }))
      return artifacts.list(projectId)
    },
    'artifacts:read': (projectId, artifactId, v) => {
      const project = store.project(projectId)
      const artifact = project && artifacts.get(projectId, artifactId)
      if (!project || !artifact) throw new Error('Unknown artifact')
      const bytes = artifacts.read(projectId, artifactId, v)
      const path = join(project.path, artifact.rel)
      if (!bytes) return { path, kind: 'too-large', size: artifact.versions.find((x) => x.v === v)?.size ?? 0 }
      return previewBytes(path, bytes)
    },
    'artifacts:restore': (projectId, artifactId, v) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      const restored = artifacts.restore(project, artifactId, v)
      push('files:changed', { projectId })
      push('artifacts:changed', { projectId })
      return restored?.artifact ?? null
    },
    'connectors:check': (connector) => mcp.check(connector),
    'lit:search': async (query, category) => {
      const search = getSettings().connectors.find((c) => c.builtin)
      if (!search) throw new Error('The search connector is missing.')
      const text = await mcp.callText(search, 'search', { query, category: category || 'paper', max_results: 12, format: 'json' })
      return mergeResults(parseResults(text), category)
    },
    'lit:cite': async (projectId, paper) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      const result = await cite(project.path, paper, registryFetch)
      if (result.added) push('files:changed', { projectId })
      return result
    },
    'lit:graph': async (paper) => {
      const search = getSettings().connectors.find((c) => c.builtin)
      if (!search) throw new Error('The search connector is missing.')
      const text = await mcp.callText(search, 'paper_graph', { paper: paper.doi ?? paper.title, direction: 'both', limit: 8, format: 'json' }, 60_000)
      return parseGraph(text)
    },
    'lit:published': (paper) => publishedVersion(paper, registryFetch),
    'refs:check': async (projectId, file) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      return checkBibliography(project.path, file, registryFetch, (done, total) => push('refs:progress', { projectId, done, total }))
    },
    'refs:setDoi': async (projectId, file, key, doi) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      const entry = editBibliography(project.path, file, (source) => {
        const next = withDoi(source, key, doi)
        if (next === null) throw new Error(`${key} already has a DOI or is not in ${file}`)
        const updated = parseBibtex(next).find((e) => e.key === key)
        if (!updated) throw new Error('Invalid bibliography entry')
        return { text: next, result: updated }
      })
      push('files:changed', { projectId })
      return checkEntry(entry, registryFetch)
    },
    'checks:run': async (projectId, options) => {
      const project = store.project(projectId)
      if (!project) throw new Error('Unknown project')
      const report = await runChecks(project.path, kitRoot, await agentEnv(), options)
      push('files:changed', { projectId })
      return report
    },
    // Review files are named after the session, so only stored sessions are looked up.
    'reviews:list': (sessionId) => (store.session(sessionId) ? reviews.list(sessionId) : []),
    'reviews:start': (sessionId) => {
      if (sessions.isRunning(sessionId)) throw new Error('Wait for the current turn to finish before reviewing.')
      return reviews.start(sessionId)
    },
    'reviews:cancel': (reviewId) => reviews.cancel(reviewId),
    'reviews:setStatus': (sessionId, reviewId, findingId, status) =>
      store.session(sessionId) ? reviews.setStatus(sessionId, reviewId, findingId, status) : undefined,
  } satisfies Partial<StudioHandlers>
}
