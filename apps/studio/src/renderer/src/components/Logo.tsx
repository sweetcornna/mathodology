import { useId } from 'react'
import { MARK, markLayout, markStroke } from '@shared/brandMark'

/**
 * Mathodology mark: a summation sign written as a growing series of terms, the last one amber, on a
 * graphite tile. Small sizes draw the converged single stroke. Without the tile it is drawn in
 * currentColor.
 */
export function Logo({ size = 22, tile = true }: { size?: number; tile?: boolean }) {
  const id = 'mk' + useId().replace(/[^\w-]/g, '')
  const L = markLayout(size)
  const ink = tile ? MARK.ink : 'currentColor'
  const result = tile ? MARK.result : 'currentColor'
  const [rx, ry, rr] = L.result
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden>
      {tile && (
        <>
          <defs>
            <linearGradient id={`${id}t`} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0" stopColor={MARK.tile[0]} />
              <stop offset="1" stopColor={MARK.tile[1]} />
            </linearGradient>
            <radialGradient id={`${id}p`} cx="0.36" cy="0.3" r="0.78">
              <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
              <stop offset="0.22" stopColor="#fff" stopOpacity="0.18" />
              <stop offset="0.6" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="0.38" />
            </radialGradient>
          </defs>
          <rect x="100" y="100" width="824" height="824" rx="185" fill={`url(#${id}t)`} />
        </>
      )}
      {L.kind === 'stroke' ? (
        <path
          d={markStroke}
          fill="none"
          stroke={ink}
          strokeWidth={L.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        [...L.terms, L.result].map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill={i === L.terms.length ? result : ink} />
            {tile && <circle cx={x} cy={y} r={r} fill={`url(#${id}p)`} />}
          </g>
        ))
      )}
      {L.kind === 'stroke' && <circle cx={rx} cy={ry} r={rr} fill={result} />}
    </svg>
  )
}
