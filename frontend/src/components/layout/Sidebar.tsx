import { Activity, BatteryMedium, Home, Network, Settings, ShieldCheck, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { CircuitArt, LogoMark } from '../ui/Brand'
import { RobotArmIcon } from '../ui/icons'
import { cx } from '../ui/primitives'

export const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: Home },
  { to: '/sensors', label: 'Live Sensors', icon: Activity },
  { to: '/events', label: 'Safety Events', icon: ShieldCheck },
  { to: '/battery', label: 'Battery Health', icon: BatteryMedium },
  { to: '/automation', label: 'Automation', icon: RobotArmIcon },
  { to: '/network', label: 'Device Network', icon: Network },
] as const

function NavItem({ to, label, Icon, onNavigate }: { to: string; label: string; Icon: (typeof NAV_ITEMS)[number]['icon'] | typeof Settings; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          'group relative flex h-[52px] items-center gap-3.5 whitespace-nowrap rounded-r-[10px] pl-[22px] pr-2 text-[16px] font-medium transition-colors',
          isActive
            ? 'bg-accent-soft text-fg before:absolute before:inset-y-0 before:left-0 before:w-[4px] before:bg-accent'
            : 'text-muted hover:bg-inset hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={22} strokeWidth={isActive ? 2.2 : 1.9} className={isActive ? 'text-fg' : 'text-muted group-hover:text-fg'} />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  )
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cx('fixed inset-0 z-30 bg-black/50 transition-opacity lg:hidden', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-[200px] flex-col border-r border-line bg-sidebar transition-transform lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 rounded-md p-1.5 text-muted hover:bg-inset lg:hidden"
          aria-label="Close navigation"
        >
          <X size={18} />
        </button>
        <div className="flex flex-col items-center pt-7 pb-9">
          <LogoMark size={62} />
          <span className="mt-2 text-[24px] font-semibold tracking-[-0.01em] text-fg">LightSync</span>
        </div>
        <nav className="flex flex-col gap-[6px] pr-2.5">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.to} to={item.to} label={item.label} Icon={item.icon} onNavigate={onClose} />
          ))}
          <div className="mx-6 my-3 h-px bg-line" />
          <NavItem to="/settings" label="Settings" Icon={Settings} onNavigate={onClose} />
        </nav>
        <div className="mt-auto">
          <div className="opacity-80">
            <CircuitArt />
          </div>
          <p className="px-4 pb-8 pt-4 text-center text-[15px] leading-relaxed text-muted">
            Smarter Safety.
            <br />A Safer Tomorrow.
          </p>
        </div>
      </aside>
    </>
  )
}
