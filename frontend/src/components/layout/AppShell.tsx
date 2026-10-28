import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useTelemetry } from '../../state/TelemetryProvider'
import { StatusDot, type Tone } from '../ui/primitives'
import { ConnectionBadge, Header } from './Header'
import { Sidebar } from './Sidebar'

function Footer() {
  const { snapshot, config, connection } = useTelemetry()
  const mode = snapshot?.mode ?? config?.mode
  const tone: Tone = { live: 'ok', demo: 'demo', stale: 'warn', offline: 'bad', connecting: 'neutral' }[connection.state] as Tone
  return (
    <footer className="flex h-[46px] shrink-0 items-center gap-4 border-t border-line bg-header px-6 text-[13px] text-muted xl:pl-[38px]">
      <span className="truncate">LightSync<span className="hidden sm:inline"> • Hardware telemetry dashboard</span></span>
      <span className="hidden h-5 w-px bg-line-strong sm:block" />
      <span className="ml-auto flex shrink-0 items-center gap-2 whitespace-nowrap" title={connection.reason ?? undefined}>
        <StatusDot tone={tone} className="!size-2.5" />
        {mode === 'demo' ? 'Demo data' : mode === 'live' ? `Live mode · Blynk ${config?.blynk_server ?? ''} · ${connection.state}` : 'Connecting'}
      </span>
    </footer>
  )
}

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  return (
    <div className="flex h-full min-h-0 bg-bg">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setNavOpen(true)} />
        <div className="border-b border-line px-4 py-2 md:hidden">
          <ConnectionBadge />
        </div>
        <main className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
        <Footer />
      </div>
    </div>
  )
}
