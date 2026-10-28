import type { HTMLAttributes, ReactNode } from 'react'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'accent' | 'demo' | 'neutral'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-info',
  accent: 'text-accent',
  demo: 'text-demo',
  neutral: 'text-muted',
}

const toneDot: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
  accent: 'bg-accent',
  demo: 'bg-demo',
  neutral: 'bg-dim',
}

const tonePill: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info/15 text-info',
  accent: 'bg-accent-soft text-accent',
  demo: 'bg-demo-soft text-demo',
  neutral: 'bg-inset text-muted',
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx('rounded-[10px] border border-line bg-card shadow-card', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardTitle({ icon, children, right, className }: { icon?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      {icon && <span className="shrink-0 text-fg">{icon}</span>}
      <h2 className="min-w-0 text-[19px] font-semibold leading-tight tracking-[-0.01em] text-fg">{children}</h2>
      {right && <div className="ml-auto shrink-0">{right}</div>}
    </div>
  )
}

export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('relative inline-flex size-3 shrink-0', className)} aria-hidden="true">
      {pulse && <span className={cx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-50', toneDot[tone])} />}
      <span className={cx('relative inline-flex size-3 rounded-full', toneDot[tone])} />
    </span>
  )
}

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center rounded-full px-3 py-1 text-[15px] font-semibold leading-tight', tonePill[tone], className)}>
      {children}
    </span>
  )
}

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { tone: Tone; label: string }> = {
    blynk: { tone: 'ok', label: 'Hardware' },
    demo: { tone: 'demo', label: 'Demo' },
    system: { tone: 'neutral', label: 'System' },
    computed: { tone: 'accent', label: 'Computed' },
  }
  const { tone, label } = map[source] ?? { tone: 'neutral' as Tone, label: source }
  return <Pill tone={tone} className="!px-2 !py-0.5 !text-[11px] uppercase tracking-wide">{label}</Pill>
}

export function PageHeader({ icon, title, subtitle, right }: { icon: ReactNode; title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <div className="shrink-0 text-accent">{icon}</div>
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-fg sm:text-[26px] xl:text-[29px]">{title}</h1>
          <p className="mt-1 text-[14px] text-muted sm:text-[15px] xl:text-[16px]">{subtitle}</p>
        </div>
      </div>
      {right && <div className="ml-auto">{right}</div>}
    </div>
  )
}

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={cx('rounded-lg border px-4 py-3 text-sm leading-relaxed', tonePill[tone], 'border-current/20')}>
      {children}
    </div>
  )
}

export function Stat({ label, value, unit, hint, tone }: { label: string; value: ReactNode; unit?: string | null; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-medium uppercase tracking-wide text-dim">{label}</div>
      <div className={cx('mt-1 flex items-baseline gap-1 text-[26px] font-bold leading-none tracking-tight', tone ? toneText[tone] : 'text-fg')}>
        {value}
        {unit && <span className="text-[15px] font-semibold text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs text-dim">{hint}</div>}
    </div>
  )
}
