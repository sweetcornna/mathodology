import type { HighlighterCore } from 'shiki/core'

const LANGS: Record<string, () => Promise<unknown>> = {
  python: () => import('shiki/langs/python.mjs'),
  py: () => import('shiki/langs/python.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  sh: () => import('shiki/langs/bash.mjs'),
  shell: () => import('shiki/langs/bash.mjs'),
  zsh: () => import('shiki/langs/bash.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  latex: () => import('shiki/langs/latex.mjs'),
  tex: () => import('shiki/langs/latex.mjs'),
  matlab: () => import('shiki/langs/matlab.mjs'),
  r: () => import('shiki/langs/r.mjs'),
  julia: () => import('shiki/langs/julia.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  js: () => import('shiki/langs/javascript.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  ts: () => import('shiki/langs/typescript.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  md: () => import('shiki/langs/markdown.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  csv: () => import('shiki/langs/csv.mjs'),
  sql: () => import('shiki/langs/sql.mjs')
}

const ALIAS: Record<string, string> = {
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  tex: 'latex',
  js: 'javascript',
  ts: 'typescript',
  md: 'markdown'
}

let core: Promise<HighlighterCore> | null = null
const loaded = new Set<string>()

function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript')
    ])
    return createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark-dimmed.mjs')],
      langs: [],
      engine: createJavaScriptRegexEngine()
    })
  })()
  return core
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
}

/** HTML for a code block, with light and dark colours as CSS variables. */
export async function highlight(code: string, lang: string): Promise<string> {
  const key = lang.toLowerCase()
  const loader = LANGS[key]
  if (!loader) return `<pre><code>${escape(code)}</code></pre>`
  const h = await highlighter()
  const name = ALIAS[key] ?? key
  if (!loaded.has(name)) {
    await h.loadLanguage((await loader()) as never)
    loaded.add(name)
  }
  return h.codeToHtml(code, {
    lang: name,
    themes: { light: 'github-light', dark: 'github-dark-dimmed' },
    defaultColor: false
  })
}
