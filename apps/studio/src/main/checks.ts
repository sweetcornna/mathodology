import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckReport } from '@shared/types'
import { WORKBENCH } from './kit'

export interface CheckOptions {
  compile?: boolean
}

/** The workbench script: the project's own copy first, so checks match its hooks; else the kit's. */
export function workbenchScript(projectDir: string, kitRoot: string): string | undefined {
  return [projectDir, kitRoot].map((root) => join(root, WORKBENCH, 'scripts/mtd.py')).find((p) => existsSync(p))
}

/** Python interpreters to try, in order. */
export function pythonCandidates(platform: NodeJS.Platform = process.platform): [string, string[]][] {
  const unix: [string, string[]][] = [
    ['python3', []],
    ['python', []]
  ]
  return platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : unix
}

/** Parse `mtd.py status --json`; anything else is a failure with the tool's own message. */
export function parseReport(stdout: string, stderr: string): CheckReport {
  try {
    const report = JSON.parse(stdout) as CheckReport
    if (report?.schema === 'mathodology.report/1') return report
  } catch {
    // fall through to the error below
  }
  const message = (stderr || stdout).trim().split('\n').slice(-3).join(' ') || 'The workbench returned no report.'
  throw new Error(message)
}

/**
 * Run the workbench on a project and return its report. The checks never change project files
 * except the generated `paper/results.tex` macros and `.mathodology/report.json`.
 */
export function runChecks(
  projectDir: string,
  kitRoot: string,
  env: NodeJS.ProcessEnv,
  options: CheckOptions = {}
): Promise<CheckReport> {
  const script = workbenchScript(projectDir, kitRoot)
  if (!script) return Promise.reject(new Error('The workbench skill is not installed in this project.'))
  const args = [script, '--root', projectDir, 'status', '--json', ...(options.compile ? ['--compile'] : [])]
  const timeout = options.compile ? 420_000 : 120_000
  const attempt = (i: number): Promise<CheckReport> => {
    const candidates = pythonCandidates()
    if (i >= candidates.length) return Promise.reject(new Error('python-missing'))
    const [python, pre] = candidates[i]
    return new Promise((resolve, reject) => {
      execFile(
        python,
        [...pre, ...args],
        { cwd: projectDir, env: { ...env, PYTHONIOENCODING: 'utf-8' }, timeout, maxBuffer: 16 << 20, windowsHide: true },
        (err, stdout, stderr) => {
          if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') return resolve(attempt(i + 1))
          // The Windows Store alias for `python` exits with 9009 and prints nothing useful.
          if (err && !stdout && /not found|9009|Microsoft Store/i.test(`${stderr} ${err.code}`)) return resolve(attempt(i + 1))
          try {
            resolve(parseReport(stdout, stderr))
          } catch (e) {
            reject(e)
          }
        }
      )
    })
  }
  return attempt(0)
}
