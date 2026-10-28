import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseReport, pythonCandidates, runChecks, workbenchScript } from '../src/main/checks'
import { HOOK_COMMAND, installKit, mergeHooks, WORKBENCH } from '../src/main/kit'

const kitRoot = resolve(__dirname, '../../..')
const spec = JSON.parse(readFileSync(join(kitRoot, WORKBENCH, 'hooks/hooks.json'), 'utf8')).hooks

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'studio-checks-'))
  dirs.push(d)
  return d
}

function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'])
    return true
  } catch {
    return false
  }
}

describe('mergeHooks', () => {
  it('adds the workbench hooks and keeps other settings and hooks', () => {
    const settings = {
      enabledPlugins: { 'humanizer@humanizer': true },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }
    }
    const merged = mergeHooks(settings, spec) as { enabledPlugins: unknown; hooks: Record<string, { hooks: { command: string }[] }[]> }
    expect(merged.enabledPlugins).toEqual({ 'humanizer@humanizer': true })
    expect(Object.keys(merged.hooks).sort()).toEqual(['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'])
    expect(merged.hooks.Stop.map((g) => g.hooks[0].command)).toEqual(['echo mine', `${HOOK_COMMAND} hook stop`])
    expect(JSON.stringify(merged)).not.toContain('{mtd}')
  })

  it('is idempotent', () => {
    const once = mergeHooks({}, spec)
    expect(mergeHooks(once, spec)).toEqual(once)
  })

  it('matches what mtd.py install-hooks writes', () => {
    if (!hasPython()) return
    const project = temp()
    mkdirSync(join(project, '.claude/skills'), { recursive: true })
    installKit(kitRoot, project)
    const fromStudio = readFileSync(join(project, '.claude/settings.json'), 'utf8')
    execFileSync('python3', [join(project, WORKBENCH, 'scripts/mtd.py'), 'install-hooks', '--root', project])
    expect(readFileSync(join(project, '.claude/settings.json'), 'utf8')).toBe(fromStudio)
  })
})

describe('installKit', () => {
  it('installs the workbench, its hooks and the results folder', () => {
    const project = temp()
    const result = installKit(kitRoot, project)
    expect(existsSync(join(project, WORKBENCH, 'scripts/mtd.py'))).toBe(true)
    expect(existsSync(join(project, 'results'))).toBe(true)
    expect(result.installed).toContain('.claude/settings.json (workbench hooks)')
    const settings = JSON.parse(readFileSync(join(project, '.claude/settings.json'), 'utf8'))
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toContain('$CLAUDE_PROJECT_DIR')
    expect(readFileSync(join(project, 'AGENTS.md'), 'utf8')).toContain('mathodology-workbench')
  })

  it('leaves a settings file it cannot parse alone', () => {
    const project = temp()
    mkdirSync(join(project, '.claude'))
    writeFileSync(join(project, '.claude/settings.json'), '{ not json')
    installKit(kitRoot, project)
    expect(readFileSync(join(project, '.claude/settings.json'), 'utf8')).toBe('{ not json')
  })
})

describe('checks', () => {
  it('finds the project copy of the script before the kit copy', () => {
    const project = temp()
    expect(workbenchScript(project, kitRoot)).toBe(join(kitRoot, WORKBENCH, 'scripts/mtd.py'))
    installKit(kitRoot, project)
    expect(workbenchScript(project, kitRoot)).toBe(join(project, WORKBENCH, 'scripts/mtd.py'))
  })

  it('tries the Windows launcher first on Windows', () => {
    expect(pythonCandidates('win32')[0]).toEqual(['py', ['-3']])
    expect(pythonCandidates('darwin')[0]).toEqual(['python3', []])
  })

  it('reports the tool message when there is no report', () => {
    expect(() => parseReport('', 'No Mathodology workspace at or above /x.')).toThrow('No Mathodology workspace')
    expect(parseReport(JSON.stringify({ schema: 'mathodology.report/1', issues: [] }), '').issues).toEqual([])
  })

  it('runs the workbench on a kit project', async () => {
    if (!hasPython()) return
    const project = temp()
    installKit(kitRoot, project)
    writeFileSync(
      join(project, 'results/q1.json'),
      JSON.stringify({ schema: 'mathodology.results/1', values: { rmse: { value: 0.0912, digits: 3 } } })
    )
    writeFileSync(
      join(project, 'paper/main.tex'),
      '\\documentclass{article}\n\\input{results}\n\\begin{document}\nRMSE \\res{q1.rmse}, earlier 0.090 and \\res{q1.mae}.\n\\end{document}\n'
    )
    const report = await runChecks(project, kitRoot, process.env)
    expect(report.stages.map((s) => s.id)).toEqual(['brief', 'experiment', 'results', 'figures', 'paper'])
    const codes = report.issues.map((i) => i.code)
    expect(codes).toContain('numbers.unknown-key')
    expect(codes).toContain('numbers.near-miss')
    expect(report.stages.find((s) => s.id === 'paper')?.state).toBe('error')
    expect(existsSync(join(project, 'paper/results.tex'))).toBe(true)
  })
})
