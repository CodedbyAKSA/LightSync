import { RotateCcw } from 'lucide-react'
import { Component, lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { useTheme } from '../../theme/ThemeProvider'
import type { ProximityLevel } from '../../types/telemetry'
import { MAX_CM, type SensorView } from './sensors'
import type { VehicleSceneHandle } from './VehicleScene'

const VehicleScene = lazy(() => import('./VehicleScene'))

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('3D vehicle scene failed; using 2D fallback', error)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const SIDE_LABEL: Record<SensorView['side'], string> = { front: 'ahead', rear: 'behind', left: 'on the left', right: 'on the right' }

function fallbackColor(p: ProximityLevel, active: boolean): string {
  return !active ? 'var(--fg-dim)' : p === 'critical' ? 'var(--red)' : p === 'warning' ? 'var(--amber)' : 'var(--teal)'
}

/** 2D top-down stand-in used while the 3D chunk loads, or when WebGL is unavailable. */
export function VehicleFallback({ sensors, active, note }: { sensors: SensorView[]; active: boolean; note?: string }) {
  // Car body 120x60 centred at (200,100), front facing right.
  const span = (cm: number | null, max: number) => 14 + Math.min(MAX_CM, Math.max(0, cm ?? MAX_CM)) / MAX_CM * max
  const label = sensors
    .map((s) => s.distanceCm === null ? `${s.side} unavailable` : `obstacle ${Math.round(s.distanceCm)} centimetres ${SIDE_LABEL[s.side]}`)
    .join(', ')
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 400 200" className="h-full w-full" role="img" aria-label={label || 'Obstacle distances unavailable'}>
        <rect x="140" y="70" width="120" height="60" rx="18" fill="#e8edf2" />
        <rect x="165" y="80" width="62" height="40" rx="10" fill="#1b2a3b" />
        <rect x="257" y="78" width="4" height="44" rx="2" fill="var(--accent)" />
        {sensors.map(({ side, distanceCm, proximity }) => {
          const color = fallbackColor(proximity, active)
          const inRange = distanceCm !== null && distanceCm < MAX_CM
          if (side === 'front' || side === 'rear') {
            const dir = side === 'front' ? 1 : -1
            const x0 = side === 'front' ? 262 : 138
            const x1 = x0 + dir * span(distanceCm, 110)
            return (
              <g key={side}>
                {distanceCm !== null && <line x1={x0} y1="100" x2={x1} y2="100" stroke={color} strokeWidth="2.5" strokeDasharray="8 7" />}
                {inRange && <rect x={dir > 0 ? x1 : x1 - 12} y="52" width="12" height="96" rx="3" fill="#3b4b5f" stroke={color} strokeWidth="2" />}
              </g>
            )
          }
          const dir = side === 'right' ? 1 : -1
          const y0 = side === 'right' ? 132 : 68
          const y1 = y0 + dir * span(distanceCm, 50)
          return (
            <g key={side}>
              {distanceCm !== null && <line x1="200" y1={y0} x2="200" y2={y1} stroke={color} strokeWidth="2.5" strokeDasharray="6 6" />}
              {inRange && <rect x="130" y={dir > 0 ? y1 : y1 - 8} width="140" height="8" rx="3" fill="#3b4b5f" stroke={color} strokeWidth="2" />}
            </g>
          )
        })}
      </svg>
      {note && <p className="absolute bottom-1 left-2 text-[11px] text-dim">{note}</p>}
    </div>
  )
}

export function VehicleViewport(props: { sensors: SensorView[]; active: boolean; hazard: boolean; pulseKey: string | null }) {
  const { theme, colors } = useTheme()
  const [supported] = useState(webglAvailable)
  const scene = useRef<VehicleSceneHandle>(null)
  const fallback = <VehicleFallback {...props} />

  if (!supported) {
    return <VehicleFallback {...props} note="WebGL unavailable — showing 2D view" />
  }
  return (
    <div className="relative h-full w-full">
      <SceneBoundary fallback={<VehicleFallback {...props} note="3D view failed to load — showing 2D view" />}>
        <Suspense fallback={fallback}>
          <VehicleScene ref={scene} {...props} theme={theme} colors={colors} />
        </Suspense>
      </SceneBoundary>
      <button
        type="button"
        onClick={() => scene.current?.resetView()}
        className="absolute bottom-1 left-1 rounded-md p-1.5 text-dim hover:bg-inset hover:text-fg"
        aria-label="Reset 3D view"
        title="Reset view (drag to rotate)"
      >
        <RotateCcw size={15} />
      </button>
    </div>
  )
}
