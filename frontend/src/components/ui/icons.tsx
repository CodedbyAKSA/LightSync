import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

/** Robotic arm (lucide has no equivalent); used for Automation. */
export function RobotArmIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d="M4 21h10" />
      <path d="M6 21v-3a3 3 0 0 1 6 0v3" />
      <circle cx="9" cy="12.5" r="1.6" />
      <path d="m9.9 11.2 4.6-5.4" />
      <circle cx="15.3" cy="4.8" r="1.6" />
      <path d="M16.5 5.8 19.5 9" />
      <path d="M18.3 10.4 20.6 8.1M19.4 11.6l2.1-2.1" />
    </svg>
  )
}

/** Sleeping face with "zzz", matching the reference drowsiness tile. */
export function DrowsyIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d="M6 28c0 9 8 14 16 14s16-5 16-14" />
      <path d="M11 29c2.2 2 5 2 7.2 0M25.8 29c2.2 2 5 2 7.2 0" />
      <path d="M18 36c2.6 1.6 5.4 1.6 8 0" />
      <path d="M27 17h5l-5 6h5M35 9h6l-6 7h6M22 21h3l-3 3.5h3" strokeWidth="2.6" />
    </svg>
  )
}
