import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type Fetch = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>
export type Run = (cmd: string, args: string[], cwd: string) => Promise<{ code: number; stdout: string }>

/**
 * blader/humanizer (MIT), which rewrites AI-sounding prose without changing what it says.
 * Claude Code installs it as a plugin; Codex and Gemini CLI read a copy of the skill. Both follow
 * the repository's default branch; `commit` is used when GitHub cannot be asked for the newest one.
 */
export const HUMANIZER = {
  repo: 'blader/humanizer',
  commit: '8c307f367c91bd974002f10f2be2965d642c13df',
  files: ['SKILL.md', 'LICENSE', 'agents/openai.yaml'],
  marketplace: 'humanizer',
  plugin: 'humanizer@humanizer'
}

/** Written next to a copy Studio installed: its commit and the hash of each file it wrote. */
const MARKER = '.studio.json'

interface Marker {
  commit: string
  files: Record<string, string>
}

export interface HumanizerResult {
  /** plugin: installed now; skill: copied into .claude/skills instead; updated: a newer version replaced the old one. */
  claude: 'plugin' | 'present' | 'skill' | 'updated' | 'failed'
  /** The copy in .agents/skills that Codex and Gemini CLI read. */
  skill: 'installed' | 'present' | 'updated' | 'failed'
  error?: string
}

/** Lookups shared by every project during one launch, so GitHub and the marketplace are asked once. */
export interface HumanizerCache {
  latest?: Promise<string>
  marketplace?: Promise<boolean>
  downloads?: Map<string, Promise<Record<string, string>>>
}

/** Run a command in the agents' environment (the marketplace step needs git on PATH). */
export function runner(env: NodeJS.ProcessEnv): Run {
  return (cmd, args, cwd) =>
    new Promise((resolve) => {
      execFile(cmd, args, { cwd, env, timeout: 180_000, maxBuffer: 1 << 20 }, (err, stdout) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, stdout: String(stdout) })
      })
    })
}

function pluginEnabled(projectDir: string): boolean {
  try {
    const settings = JSON.parse(readFileSync(join(projectDir, '.claude/settings.json'), 'utf8'))
    return settings?.enabledPlugins?.[HUMANIZER.plugin] === true
  } catch {
    return false
  }
}

/** Claude Code already has it: the plugin enabled in project settings, or a project skill. */
export function claudeHasHumanizer(projectDir: string): boolean {
  return existsSync(join(projectDir, '.claude/skills/humanizer/SKILL.md')) || pluginEnabled(projectDir)
}

/** Both copies are in place. */
export function hasHumanizer(projectDir: string): boolean {
  return claudeHasHumanizer(projectDir) && existsSync(join(projectDir, '.agents/skills/humanizer/SKILL.md'))
}

/** The newest commit on the default branch; the known one when GitHub does not answer. */
async function latestCommit(fetch: Fetch): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${HUMANIZER.repo}/commits?per_page=1`)
    if (res.ok) {
      const sha = JSON.parse(await res.text())?.[0]?.sha
      if (typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)) return sha
    }
  } catch {
    // Offline or rate limited: fall back to the commit Studio knows.
  }
  return HUMANIZER.commit
}

async function fetchSkill(fetch: Fetch, commit: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const file of HUMANIZER.files) {
    const res = await fetch(`https://raw.githubusercontent.com/${HUMANIZER.repo}/${commit}/${file}`)
    if (!res.ok) throw new Error(`Could not download ${file} from ${HUMANIZER.repo}`)
    files[file] = await res.text()
  }
  if (!/^---\n(?:[\s\S]*?\n)?name:\s*humanizer\s*\n/.test(files['SKILL.md'])) throw new Error('The downloaded SKILL.md is not the humanizer skill')
  return files
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

function readMarker(dir: string): Marker | null {
  try {
    const marker = JSON.parse(readFileSync(join(dir, MARKER), 'utf8'))
    return typeof marker?.commit === 'string' && marker.files && typeof marker.files === 'object' ? marker : null
  } catch {
    return null
  }
}

/** Every file Studio wrote is still as it wrote it, so replacing them loses nothing. */
function unmodified(dir: string, marker: Marker): boolean {
  return Object.entries(marker.files).every(([rel, hash]) => {
    try {
      return sha256(readFileSync(join(dir, rel), 'utf8')) === hash
    } catch {
      return false
    }
  })
}

/** Write the skill and its marker. Files the project already had are kept unless Studio wrote them. */
function writeSkill(dir: string, files: Record<string, string>, commit: string, ours: Record<string, string> = {}): void {
  const written: Record<string, string> = {}
  for (const [rel, text] of Object.entries(files)) {
    const to = join(dir, rel)
    if (existsSync(to) && !(rel in ours)) continue
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, text, 'utf8')
    written[rel] = sha256(text)
  }
  writeFileSync(join(dir, MARKER), JSON.stringify({ commit, files: written }, null, 2) + '\n', 'utf8')
}

/**
 * Install the skill in `dir`, or bring a copy Studio installed up to the newest commit. A copy
 * without a marker, or one whose files were edited, belongs to the user and is left alone.
 */
async function syncSkill(
  dir: string,
  latest: () => Promise<string>,
  download: (commit: string) => Promise<Record<string, string>>
): Promise<'installed' | 'present' | 'updated'> {
  if (!existsSync(join(dir, 'SKILL.md'))) {
    const commit = await latest()
    writeSkill(dir, await download(commit), commit)
    return 'installed'
  }
  const marker = readMarker(dir)
  if (!marker || !unmodified(dir, marker)) return 'present'
  const commit = await latest()
  if (commit === marker.commit) return 'present'
  writeSkill(dir, await download(commit), commit, marker.files)
  return 'updated'
}

function lastJson(stdout: string): { outcome?: string; oldVersion?: string; newVersion?: string } | null {
  const line = stdout.trim().split('\n').pop() ?? ''
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/**
 * Give a project's three agents the humanizer and keep it current. Claude Code gets the plugin at
 * project scope through its own `claude plugin` commands, which leave user settings alone, and
 * `claude plugin update` on later launches; without the CLI or a path to the marketplace, the skill
 * goes into `.claude/skills` instead. Skill copies Studio installed follow the default branch.
 */
export async function syncHumanizer(
  projectDir: string,
  deps: { claudeBinary?: string; run: Run; fetch: Fetch; cache?: HumanizerCache }
): Promise<HumanizerResult> {
  const cache = deps.cache ?? {}
  const downloads = (cache.downloads ??= new Map())
  const latest = (): Promise<string> => (cache.latest ??= latestCommit(deps.fetch))
  const download = (commit: string): Promise<Record<string, string>> => {
    let files = downloads.get(commit)
    if (!files) {
      files = fetchSkill(deps.fetch, commit)
      // A failed download is retried by the next project rather than remembered.
      files.catch(() => downloads.delete(commit))
      downloads.set(commit, files)
    }
    return files
  }
  const errors: string[] = []

  let skill: HumanizerResult['skill']
  try {
    skill = await syncSkill(join(projectDir, '.agents/skills/humanizer'), latest, download)
  } catch (err) {
    skill = 'failed'
    errors.push((err as Error).message)
  }

  let claude: HumanizerResult['claude'] = 'present'
  const bin = deps.claudeBinary
  if (pluginEnabled(projectDir)) {
    if (bin) {
      const fresh = await (cache.marketplace ??= deps
        .run(bin, ['plugin', 'marketplace', 'update', HUMANIZER.marketplace, '--json'], projectDir)
        .then((r) => r.code === 0))
      if (fresh) {
        const res = await deps.run(bin, ['plugin', 'update', HUMANIZER.plugin, '--scope', 'project', '--json'], projectDir)
        const out = lastJson(res.stdout)
        if (res.code !== 0 || out?.outcome !== 'ok') errors.push('claude plugin update failed')
        else if (out.newVersion && out.newVersion !== out.oldVersion) claude = 'updated'
      } else errors.push('claude plugin marketplace update failed')
    }
  } else if (existsSync(join(projectDir, '.claude/skills/humanizer/SKILL.md'))) {
    try {
      if ((await syncSkill(join(projectDir, '.claude/skills/humanizer'), latest, download)) === 'updated') claude = 'updated'
    } catch (err) {
      errors.push((err as Error).message)
    }
  } else {
    let installed = false
    if (bin) {
      const add = await deps.run(bin, ['plugin', 'marketplace', 'add', HUMANIZER.repo, '--scope', 'project', '--json'], projectDir)
      if (add.code === 0) {
        const res = await deps.run(bin, ['plugin', 'install', HUMANIZER.plugin, '--scope', 'project', '--json'], projectDir)
        installed = res.code === 0 && lastJson(res.stdout)?.outcome === 'ok'
        if (!installed) errors.push('claude plugin install failed')
      } else errors.push('claude plugin marketplace add failed')
    }
    if (installed) claude = 'plugin'
    else {
      try {
        await syncSkill(join(projectDir, '.claude/skills/humanizer'), latest, download)
        claude = 'skill'
      } catch (err) {
        claude = 'failed'
        errors.push((err as Error).message)
      }
    }
  }
  return { claude, skill, ...(errors.length ? { error: [...new Set(errors)].join('; ') } : {}) }
}
