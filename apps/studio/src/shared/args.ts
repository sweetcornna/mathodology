/** Split a user-entered command line, honouring simple quotes. */
export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/**
 * The inverse of `splitArgs` for display: quote the parts that contain spaces. `splitArgs` reads
 * quotes literally, so backslashes (Windows paths) are kept as they are rather than escaped.
 */
export function joinArgs(parts: string[]): string {
  return parts.map((p) => (/\s/.test(p) || !p ? (p.includes('"') ? `'${p}'` : `"${p}"`) : p)).join(' ')
}

/** `KEY=VALUE` lines (blank lines and `#` comments skipped) as an environment patch. */
export function parseEnv(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of (s ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    const key = (i > 0 ? line.slice(0, i) : '').replace(/^export\s+/, '').trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}
