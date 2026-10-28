import { ChevronDown, Clock, KeyRound, Menu, Moon, Settings, Sun, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatHeaderTimestamp } from '../../lib/format'
import { getOperatorKey } from '../../services/api'
import { useTelemetry } from '../../state/TelemetryProvider'
import { useTheme } from '../../theme/ThemeProvider'
import type { ConnectionStateName } from '../../types/telemetry'
import { cx, StatusDot, type Tone } from '../ui/primitives'

const STATUS: Record<ConnectionStateName, { label: string; tone: Tone; ring: string }> = {
  live: { label: 'SYSTEM ONLINE', tone: 'ok', ring: 'border-ok/45 bg-ok-soft text-ok' },
  demo: { label: 'DEMO MODE', tone: 'demo', ring: 'border-demo/45 bg-demo-soft text-demo' },
  stale: { label: 'DATA STALE', tone: 'warn', ring: 'border-warn/45 bg-warn-soft text-warn' },
  offline: { label: 'OFFLINE', tone: 'bad', ring: 'border-bad/45 bg-bad-soft text-bad' },
  connecting: { label: 'CONNECTING', tone: 'neutral', ring: 'border-line-strong bg-inset text-muted' },
}

export function ConnectionBadge() {
  const { connection } = useTelemetry()
  const s = STATUS[connection.state]
  return (
    <div
      className={cx('flex h-[38px] items-center gap-2.5 rounded-full border px-4 text-[13px] font-semibold tracking-wide', s.ring)}
      title={connection.reason ?? undefined}
      role="status"
      aria-live="polite"
    >
      <StatusDot tone={s.tone} pulse={connection.state === 'live'} className="!size-[13px]" />
      {s.label}
    </div>
  )
}

function ProfileMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { theme, toggle } = useTheme()
  const { config } = useTelemetry()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hasKey = getOperatorKey() !== ''
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full p-0.5 hover:bg-inset"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Operator menu"
      >
        <span className="flex size-[40px] items-center justify-center rounded-full bg-[#2f7cf6] text-[18px] font-semibold text-white">A</span>
        <ChevronDown size={18} className="text-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-line-strong bg-card shadow-2xl">
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-fg"><User size={15} /> Operator</div>
            <div className="mt-1 text-xs text-dim">
              {config?.operator_auth_required
                ? hasKey ? 'Operator key set for this session' : 'No operator key — controls are read-only'
                : 'Demo mode: no operator key required'}
            </div>
          </div>
          <button role="menuitem" type="button" onClick={toggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-fg hover:bg-inset">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} Switch to {theme === 'dark' ? 'light' : 'dark'} mode
          </button>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-fg hover:bg-inset">
            <KeyRound size={16} /> Operator key
          </Link>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 px-4 py-2.5 text-sm text-fg hover:bg-inset">
            <Settings size={16} /> Settings
          </Link>
        </div>
      )}
    </div>
  )
}

export function Header({ onMenu }: { onMenu: () => void }) {
  const { connection } = useTelemetry()
  const { theme, toggle } = useTheme()
  return (
    <header className="relative flex min-h-[78px] items-center gap-3 border-b border-accent/35 bg-header px-4 sm:px-6 xl:h-[95px] xl:pl-[38px] xl:pr-7">
      <button type="button" onClick={onMenu} className="rounded-md p-2 text-muted hover:bg-inset lg:hidden" aria-label="Open navigation">
        <Menu size={22} />
      </button>
      <div className="min-w-0">
        <h1 className="truncate text-[20px] font-bold leading-tight tracking-[-0.015em] text-fg sm:text-[24px] xl:text-[26px]">LightSync Safety Console</h1>
        <p className="mt-0.5 hidden truncate text-[15px] text-muted sm:block xl:mt-1 xl:text-[17px]">Connected mobility &amp; intelligent automation</p>
      </div>
      <div className="ml-auto flex items-center gap-3 xl:gap-6">
        <div className="hidden md:block"><ConnectionBadge /></div>
        <div className="hidden h-[42px] w-px bg-line-strong xl:block" />
        <div className="hidden items-center gap-3 lg:flex" title={connection.reason ?? undefined}>
          <Clock size={26} className="text-muted" strokeWidth={1.7} />
          <div className="text-[13px] leading-snug">
            <div className="text-muted">Last Updated:</div>
            <div className="font-medium text-fg tabular-nums">{formatHeaderTimestamp(connection.lastUpdate)}</div>
          </div>
        </div>
        <div className="hidden h-[42px] w-px bg-line-strong xl:block" />
        <button
          type="button"
          onClick={toggle}
          className="rounded-full border border-line-strong p-2 text-muted hover:bg-inset hover:text-fg"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <ProfileMenu />
      </div>
    </header>
  )
}
