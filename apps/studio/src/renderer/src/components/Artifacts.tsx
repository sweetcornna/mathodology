import { useStudio } from '../store'
import { Library } from './artifacts/Library'
import { Viewer } from './artifacts/Viewer'

export { GeneratedRow } from './artifacts/GeneratedRow'

/** Side-pane tab: the project's versioned outputs, or one of them in the viewer. */
export function ArtifactsTab() {
  const projectId = useStudio((s) => s.activeProjectId)
  const view = useStudio((s) => s.artifactView)
  const artifact = useStudio((s) => s.artifacts.find((a) => a.id === s.artifactView?.artifactId))
  if (!projectId) return null
  if (view && artifact) return <Viewer key={artifact.id} projectId={projectId} a={artifact} initial={view.v} />
  return <Library />
}
