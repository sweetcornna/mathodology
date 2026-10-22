/** Mathodology mark: a summation sign drawn as one continuous stroke inside a rounded tile. */
export function Logo({ size = 22, tile = true }: { size?: number; tile?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      {tile && (
        <>
          <defs>
            <linearGradient id="mt-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5b74f0" />
              <stop offset="1" stopColor="#2c43b8" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#mt-g)" />
        </>
      )}
      <path
        d="M40 17H17l14 15-14 15h23"
        fill="none"
        stroke={tile ? '#fff' : 'currentColor'}
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="48" cy="47" r="3.2" fill={tile ? '#ffd27a' : 'currentColor'} />
    </svg>
  )
}
