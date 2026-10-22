import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claudeHasHumanizer, hasHumanizer, HUMANIZER, syncHumanizer, type Run } from '../src/main/humanizer'
import { refreshSearchServer } from '../src/main/updates'
import { SEARCH_CONNECTOR } from '../src/main/connectors'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'studio-hum-'))
  dirs.push(d)
  return d
}

const OLD = HUMANIZER.commit
const NEW = 'a'.repeat(40)
const skill = (v: string): string => `---\nname: humanizer\nversion: ${v}\ndescription: test\n---\n\n# Humanizer\n`
const releases: Record<string, Record<string, string>> = {
  [OLD]: { 'SKILL.md': skill('1'), LICENSE: 'MIT License', 'agents/openai.yaml': 'interface: {}\n' },
  [NEW]: { 'SKILL.md': skill('2'), LICENSE: 'MIT License', 'agents/openai.yaml': 'interface: {}\n' }
}

/** GitHub as Studio sees it: the newest commit on the default branch, and raw files by commit. */
function github(head: string | null): { fetch: (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>; urls: string[] } {
  const urls: string[] = []
  const fetch = async (url: string) => {
    urls.push(url)
    if (url.includes('api.github.com')) return { ok: head !== null, text: async () => JSON.stringify([{ sha: head }]) }
    const [commit, ...rest] = url.split(`/${HUMANIZER.repo}/`)[1].split('/')
    const text = releases[commit]?.[rest.join('/')]
    return { ok: text !== undefined, text: async () => text ?? '' }
  }
  return { fetch, urls }
}

/** A stand-in for `claude plugin`: the install step writes the project settings as the CLI does. */
function fakeClaude(outcome = 'ok', update = { oldVersion: '3.1.0', newVersion: '3.1.0' }): { run: Run; calls: string[][] } {
  const calls: string[][] = []
  const run: Run = async (_cmd, args, cwd) => {
    calls.push(args)
    if (args[1] === 'install' && outcome === 'ok') {
      mkdirSync(join(cwd, '.claude'), { recursive: true })
      writeFileSync(join(cwd, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { [HUMANIZER.plugin]: true } }))
    }
    const extra = args[1] === 'update' ? update : {}
    return { code: outcome === 'ok' ? 0 : 1, stdout: JSON.stringify({ outcome, ...extra }) }
  }
  return { run, calls }
}

const agentsSkill = (dir: string): string => readFileSync(join(dir, '.agents/skills/humanizer/SKILL.md'), 'utf8')

describe('syncHumanizer', () => {
  it('installs the Claude plugin at project scope and the newest skill for Codex and Gemini', async () => {
    const dir = temp()
    const { run, calls } = fakeClaude()
    const { fetch } = github(NEW)
    expect(await syncHumanizer(dir, { claudeBinary: '/bin/claude', run, fetch })).toEqual({ claude: 'plugin', skill: 'installed' })
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'add', 'blader/humanizer', '--scope', 'project', '--json'],
      ['plugin', 'install', 'humanizer@humanizer', '--scope', 'project', '--json']
    ])
    expect(agentsSkill(dir)).toBe(skill('2'))
    expect(existsSync(join(dir, '.agents/skills/humanizer/LICENSE'))).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/humanizer'))).toBe(false)
    expect(hasHumanizer(dir)).toBe(true)
  })

  it('falls back to the known commit when GitHub does not answer', async () => {
    const dir = temp()
    expect(await syncHumanizer(dir, { run: fakeClaude().run, fetch: github(null).fetch })).toEqual({ claude: 'skill', skill: 'installed' })
    expect(agentsSkill(dir)).toBe(skill('1'))
    expect(readFileSync(join(dir, '.claude/skills/humanizer/SKILL.md'), 'utf8')).toBe(skill('1'))
  })

  it('falls back to a project skill for Claude Code when the plugin install fails', async () => {
    const dir = temp()
    const result = await syncHumanizer(dir, { claudeBinary: '/bin/claude', run: fakeClaude('error').run, fetch: github(OLD).fetch })
    expect(result.claude).toBe('skill')
    expect(result.error).toMatch(/marketplace add failed/)
    expect(claudeHasHumanizer(dir)).toBe(true)
  })

  it('updates copies Studio installed, and asks GitHub and the marketplace once per launch', async () => {
    const a = temp()
    const b = temp()
    for (const dir of [a, b]) await syncHumanizer(dir, { run: fakeClaude().run, fetch: github(OLD).fetch })

    const { fetch, urls } = github(NEW)
    const { run, calls } = fakeClaude('ok', { oldVersion: '3.1.0', newVersion: '3.2.0' })
    const cache = {}
    expect(await syncHumanizer(a, { claudeBinary: '/bin/claude', run, fetch, cache })).toEqual({ claude: 'updated', skill: 'updated' })
    expect(agentsSkill(a)).toBe(skill('2'))
    expect(readFileSync(join(a, '.claude/skills/humanizer/SKILL.md'), 'utf8')).toBe(skill('2'))
    // Project b uses the plugin: Claude Code updates it, Studio refreshes the marketplace only once.
    writeFileSync(join(b, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { [HUMANIZER.plugin]: true } }))
    rmSync(join(b, '.claude/skills'), { recursive: true })
    expect(await syncHumanizer(b, { claudeBinary: '/bin/claude', run, fetch, cache })).toEqual({ claude: 'updated', skill: 'updated' })
    expect(calls).toEqual([
      ['plugin', 'marketplace', 'update', 'humanizer', '--json'],
      ['plugin', 'update', 'humanizer@humanizer', '--scope', 'project', '--json']
    ])
    expect(urls.filter((u) => u.includes('api.github.com'))).toHaveLength(1)
    expect(urls.filter((u) => u.endsWith('/SKILL.md'))).toHaveLength(1)

    // Already current: nothing is downloaded again.
    urls.length = 0
    expect(await syncHumanizer(a, { run, fetch, cache })).toEqual({ claude: 'present', skill: 'present' })
    expect(urls).toEqual([])
  })

  it('leaves copies the user edited or installed alone', async () => {
    const edited = temp()
    await syncHumanizer(edited, { run: fakeClaude().run, fetch: github(OLD).fetch })
    writeFileSync(join(edited, '.agents/skills/humanizer/SKILL.md'), 'edited by the user')

    const own = temp()
    mkdirSync(join(own, '.claude'), { recursive: true })
    writeFileSync(join(own, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { [HUMANIZER.plugin]: true } }))
    mkdirSync(join(own, '.agents/skills/humanizer'), { recursive: true })
    writeFileSync(join(own, '.agents/skills/humanizer/SKILL.md'), 'installed by the user')

    const { fetch } = github(NEW)
    expect((await syncHumanizer(edited, { run: fakeClaude().run, fetch })).skill).toBe('present')
    expect(agentsSkill(edited)).toBe('edited by the user')
    expect(await syncHumanizer(own, { run: fakeClaude().run, fetch })).toEqual({ claude: 'present', skill: 'present' })
    expect(agentsSkill(own)).toBe('installed by the user')
  })

  it('refuses a download that is not the humanizer skill', async () => {
    const dir = temp()
    const bad = async (url: string) =>
      url.includes('api.github.com')
        ? { ok: true, text: async () => JSON.stringify([{ sha: NEW }]) }
        : { ok: true, text: async () => '<html>captive portal</html>' }
    const result = await syncHumanizer(dir, { run: fakeClaude().run, fetch: bad })
    expect(result).toMatchObject({ claude: 'failed', skill: 'failed' })
    expect(existsSync(join(dir, '.agents/skills/humanizer'))).toBe(false)
    expect(existsSync(join(dir, '.claude/skills/humanizer'))).toBe(false)
  })
})

describe('refreshSearchServer', () => {
  it('refreshes the built-in server as shipped and leaves a customised one alone', async () => {
    const calls: string[][] = []
    const run: Run = async (cmd, args) => {
      calls.push([cmd, ...args])
      return { code: 0, stdout: '' }
    }
    expect(await refreshSearchServer([SEARCH_CONNECTOR], run, '/')).toBe('refreshed')
    expect(calls).toEqual([['uvx', 'free-search-mcp@latest', '--help']])
    expect(await refreshSearchServer([{ ...SEARCH_CONNECTOR, args: ['free-search-mcp==0.9.0'] }], run, '/')).toBe('skipped')
    expect(await refreshSearchServer([{ ...SEARCH_CONNECTOR, enabled: false }], run, '/')).toBe('skipped')
    expect(calls).toHaveLength(1)
  })
})
