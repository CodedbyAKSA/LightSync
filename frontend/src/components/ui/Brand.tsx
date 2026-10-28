export function LogoMark({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <g stroke="var(--accent)" strokeLinejoin="round" strokeLinecap="round">
        <path d="M32 4 56.2 18v28L32 60 7.8 46V18Z" strokeWidth="3.2" />
        <path d="M32 17.5 44.5 24.7v14.6L32 46.5l-12.5-7.2V24.7Z" strokeWidth="3" />
        <path d="M19.5 24.7 32 32l12.5-7.3M32 32v14.5" strokeWidth="3" />
        <path d="M32 4v13.5M56.2 18l-11.7 6.7M7.8 18l11.7 6.7" strokeWidth="2" opacity="0.55" />
      </g>
    </svg>
  )
}

/** Decorative circuit traces at the bottom of the sidebar. */
export function CircuitArt() {
  return (
    <svg viewBox="0 0 200 130" className="w-full text-line-strong" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.2">
        <path d="M0 22h46l22 22h52l18 18h22" />
        <path d="M0 52h28l22 22h44l24 24h40" />
        <path d="M0 84h18l20 20h34" />
        <path d="M60 4v18l16 16" />
      </g>
      <g fill="none" stroke="currentColor" strokeWidth="1.2">
        <circle cx="163" cy="62" r="3" />
        <circle cx="161" cy="98" r="3" />
        <circle cx="75" cy="104" r="3" />
        <circle cx="79" cy="41" r="3" />
        <circle cx="25" cy="122" r="2.5" />
      </g>
    </svg>
  )
}
