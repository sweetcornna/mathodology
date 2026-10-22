import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KitInfo } from '@shared/types'

/** Skills that serve contest work; repository-maintenance skills stay out of contest projects. */
export const CONTEST_SKILLS = [
  'mathodology-whole-project',
  'mathodology-agent-pipeline',
  'mathodology-evidence-search',
  'mathodology-figure-presets',
  'mathodology-award-gates'
]

function frontmatter(text: string): Record<string, string> {
  // A checkout made on Windows may have CRLF line endings.
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
  }
  return out
}

function listDir(path: string): string[] {
  try {
    return readdirSync(path).filter((n) => !n.startsWith('.')).sort()
  } catch {
    return []
  }
}

export function readKit(root: string): KitInfo {
  const skills = CONTEST_SKILLS.filter((name) => existsSync(join(root, '.claude/skills', name, 'SKILL.md'))).map(
    (name) => {
      const meta = frontmatter(readFileSync(join(root, '.claude/skills', name, 'SKILL.md'), 'utf8'))
      return { name, description: meta.description ?? '' }
    }
  )
  const roles = listDir(join(root, '.claude/agents'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const meta = frontmatter(readFileSync(join(root, '.claude/agents', f), 'utf8'))
      return { name: meta.name ?? f.replace(/\.md$/, ''), description: meta.description ?? '' }
    })
  const workflows = listDir(join(root, '.claude/workflows')).filter((f) => f.endsWith('.md'))
  return { source: root, skills, roles, workflows }
}

export function readWorkflow(root: string, file: string): string {
  return readFileSync(join(root, '.claude/workflows', file), 'utf8')
}

const PROJECT_AGENTS_MD = `# Contest project

This folder is a mathematical-modeling contest workspace set up by Mathodology Studio.

- Skills: \`.claude/skills/\` (Codex copy in \`.agents/skills/\`). Start with
  \`mathodology-whole-project\`; use \`mathodology-figure-presets\` before figure work,
  \`mathodology-evidence-search\` for literature and data, and
  \`mathodology-award-gates\` to review a draft. Any agent can read a skill's
  \`SKILL.md\` directly when it has no native skill loader.
- Roles for parallel or isolated work: \`.claude/agents/\` (Codex: \`.codex/agents/\`).
- Put the problem statement and data under \`problem/\`, files the user attaches
  under \`attachments/\`, code under \`code/\`, figures under \`figures/\` and the
  paper under \`paper/\`.
- Keep calculations reproducible from the actual inputs, state assumptions and
  report real limitations. Ask about image2 once, when figure work begins.
- Before handing over prose that readers will see (the paper, its summary, a
  memo or letter), run the \`humanizer\` skill over it (Claude Code: the
  humanizer plugin; others: \`.agents/skills/humanizer/SKILL.md\`). Keep every
  number, formula, citation, figure reference and claim exactly as it was.
`

export interface KitInstallResult {
  installed: string[]
  skipped: string[]
}

/**
 * Copy the contest kit into a project without overwriting anything the project already has.
 * Mathodology entries that already exist are left alone; the caller can offer an update separately.
 */
export function installKit(kitRoot: string, projectDir: string): KitInstallResult {
  const installed: string[] = []
  const skipped: string[] = []

  const copy = (from: string, to: string): void => {
    const rel = to.slice(projectDir.length + 1)
    if (!existsSync(from)) return
    if (existsSync(to)) {
      skipped.push(rel)
      return
    }
    cpSync(from, to, { recursive: true, filter: (src) => !/(__pycache__|\.pyc$|\.DS_Store$)/.test(src) })
    installed.push(rel)
  }
  const write = (rel: string, content: string): void => {
    const to = join(projectDir, rel)
    if (existsSync(to)) {
      skipped.push(rel)
      return
    }
    mkdirSync(join(to, '..'), { recursive: true })
    writeFileSync(to, content, 'utf8')
    installed.push(rel)
  }

  for (const name of CONTEST_SKILLS) {
    copy(join(kitRoot, '.claude/skills', name), join(projectDir, '.claude/skills', name))
    copy(join(kitRoot, '.claude/skills', name), join(projectDir, '.agents/skills', name))
  }
  for (const f of listDir(join(kitRoot, '.claude/agents')).filter((f) => f.endsWith('.md'))) {
    copy(join(kitRoot, '.claude/agents', f), join(projectDir, '.claude/agents', f))
  }
  for (const f of listDir(join(kitRoot, '.codex/agents')).filter((f) => f.endsWith('.toml'))) {
    copy(join(kitRoot, '.codex/agents', f), join(projectDir, '.codex/agents', f))
  }
  for (const f of listDir(join(kitRoot, '.claude/workflows'))) {
    copy(join(kitRoot, '.claude/workflows', f), join(projectDir, '.claude/workflows', f))
  }

  write('AGENTS.md', PROJECT_AGENTS_MD)
  write('CLAUDE.md', '@AGENTS.md\n')
  write('GEMINI.md', '@AGENTS.md\n')
  for (const dir of ['problem', 'attachments', 'code', 'figures', 'paper']) {
    mkdirSync(join(projectDir, dir), { recursive: true })
  }

  return { installed, skipped }
}
