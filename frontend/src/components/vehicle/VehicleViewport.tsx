import { RotateCcw } from 'lucide-react'
import { Component, lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { useTheme } from '../../theme/ThemeProvider'
import type { ProximityLevel } from '../../types/telemetry'
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

/** 2D SVG stand-in used while the 3D chunk loads, or when WebGL is unavailable. */
export function VehicleFallback({ distanceCm, proximity, active, note }: { distanceCm: number | null; proximity: ProximityLevel; active: boolean; note?: string }) {
  const color = !active ? 'var(--fg-dim)' : proximity === 'critical' ? 'var(--red)' : proximity === 'warning' ? 'var(--amber)' : 'var(--teal)'
  const gap = distanceCm === null ? 150 : 40 + Math.min(200, Math.max(0, distanceCm)) / 200 * 150
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 400 200" className="h-full w-full" role="img" aria-label={distanceCm === null ? 'Obstacle distance unavailable' : `Obstacle ${Math.round(distanceCm)} centimetres ahead`}>
        <g transform="translate(20 52)">
          <rect x="0" y="6" width="150" height="84" rx="34" fill="#e8edf2" />
          <rect x="34" y="18" width="78" height="60" rx="18" fill="#0c1622" />
          <rect x="44" y="26" width="58" height="44" rx="12" fill="#1b2a3b" />
          <rect x="146" y="22" width="5" height="52" rx="2" fill="var(--accent)" />
          {[[22, -4], [104, -4], [22, 88], [104, 88]].map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="30" height="12" rx="5" fill="#141b24" />
          ))}
        </g>
        {distanceCm !== null && active && [0, 1, 2].map((i) => (
          <path key={i} d={`M ${180 + i * 14} 70 q 14 30 0 60`} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" opacity={1 - i * 0.25} />
        ))}
        {distanceCm !== null && (
          <>
            <line x1="176" y1="100" x2={176 + gap} y2="100" stroke={color} strokeWidth="2.5" strokeDasharray="8 7" />
            <rect x={176 + gap} y="40" width="28" height="122" rx="3" fill="#3b4b5f" stroke={color} strokeOpacity={proximity === 'clear' ? 0 : 0.8} strokeWidth="2" />
          </>
        )}
      </svg>
      {note && <p className="absolute bottom-1 left-2 text-[11px] text-dim">{note}</p>}
    </div>
  )
}

export function VehicleViewport(props: { distanceCm: number | null; proximity: ProximityLevel; active: boolean; hazard: boolean; pulseKey: string | null }) {
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
