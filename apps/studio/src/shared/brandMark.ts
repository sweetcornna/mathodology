// The Mathodology mark: a summation sign written as a series. Each term is a point that grows as the
// sum accumulates, and the last term, the result, is the one warm colour. At small sizes the series
// converges into a single stroke so the Σ stays legible. Coordinates are on the macOS 1024 icon grid,
// where the tile spans 100..924.

export const MARK = {
  ink: '#F1ECE3',
  result: '#EDA23C',
  tile: ['#303237', '#141518'],
  /** The Σ's centre line in writing order; the diagonals meet the bars at about 47°. */
  path: [
    [680, 306],
    [344, 306],
    [532, 512],
    [344, 718],
    [680, 718]
  ] as [number, number][]
}

export type Term = [x: number, y: number, r: number]

export type MarkLayout =
  | { kind: 'stroke'; width: number; result: Term }
  | { kind: 'terms'; terms: Term[]; result: Term; ring: number }

/** The Σ's centre line as an SVG path. */
export const markStroke = 'M' + MARK.path.map((p) => p.join(' ')).join('L')

/**
 * Terms along the path, radius rising linearly from r0 to r1. The spacing follows the radius
 * (gap × r between neighbours), so the stroke keeps an even rhythm while the terms grow, and every
 * vertex carries a term so the corners stay sharp.
 */
export function markTerms(r0: number, r1: number, gap: number): Term[] {
  const P = MARK.path
  const seg = P.slice(1).map((p, i) => Math.hypot(p[0] - P[i][0], p[1] - P[i][1]))
  const total = seg.reduce((a, b) => a + b)
  const rad = (s: number): number => r0 + ((r1 - r0) * s) / total
  const N = 64
  const pts: Term[] = []
  let s0 = 0
  seg.forEach((len, i) => {
    // Distance along the segment measured in "term widths", so small terms sit closer together.
    const cum = [0]
    for (let k = 0; k < N; k++) cum.push(cum[k] + len / N / (2 * rad(s0 + ((k + 0.5) / N) * len)))
    const m = Math.max(1, Math.round(cum[N] / (1 + gap / 2)))
    for (let j = i ? 1 : 0; j <= m; j++) {
      const target = (j / m) * cum[N]
      let k = 0
      while (k < N - 1 && cum[k + 1] < target) k++
      const t = (k + (target - cum[k]) / (cum[k + 1] - cum[k])) / N
      const [a, b] = [P[i], P[i + 1]]
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, rad(s0 + t * len)])
    }
    s0 += len
  })
  // Where a diagonal meets a bar the neighbours of the corner term can crowd it: keep the corners and
  // drop any other term that would touch one already kept.
  const corner = (q: Term): boolean => P.some((v) => Math.hypot(v[0] - q[0], v[1] - q[1]) < 0.5)
  const kept = pts.filter(corner)
  for (const q of pts) {
    if (corner(q)) continue
    if (kept.every((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) > (o[2] + q[2]) * 1.1)) kept.push(q)
  }
  return pts.filter((q) => kept.includes(q))
}

/** The optical variant of the mark for a given size in points. */
export function markLayout(pt: number): MarkLayout {
  if (pt <= 20) return { kind: 'stroke', width: 78, result: [806, 718, 54] }
  if (pt <= 40) return { kind: 'stroke', width: 62, result: [788, 718, 46] }
  const terms = pt <= 80 ? markTerms(24, 34, 0.85) : markTerms(18, 30, 0.8)
  const [x, y, r] = terms.pop() as Term
  const R = r * 1.18
  return { kind: 'terms', terms, result: [x, y, R], ring: pt <= 80 ? 0 : R + 22 }
}
