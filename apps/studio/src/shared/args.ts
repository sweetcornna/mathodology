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
