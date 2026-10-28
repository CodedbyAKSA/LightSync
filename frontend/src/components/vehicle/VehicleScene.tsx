import { ContactShadows, Line, OrbitControls, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ComponentRef } from 'react'
import * as THREE from 'three'
import type { ThemeColors } from '../../theme/colors'
import type { ProximityLevel, Side } from '../../types/telemetry'
import { MAX_CM, type SensorView } from './sensors'

/**
 * Procedural compact EV built from primitives (no external model), facing +X.
 * Each ultrasonic (front, rear, left, right) sends waves toward an obstacle
 * whose position follows that sensor's measured distance.
 */

export interface VehicleSceneProps {
  sensors: SensorView[]
  /** False while telemetry is stale/offline: waves stop, scene dims. */
  active: boolean
  hazard: boolean
  /** Changes on every telemetry update to trigger a wave pulse. */
  pulseKey: string | null
  theme: 'light' | 'dark'
  colors: ThemeColors
}

export interface VehicleSceneHandle {
  resetView: () => void
}

const MIN_GAP = 0.35
const MAX_GAP = 2.4
const OBSTACLE_HALF = 0.16

/**
 * Per-side geometry in the side's own frame, where +X points away from the car.
 * yaw turns that frame around Y: right (+Z) is -90°, left (-Z) is +90°.
 * Side obstacles are low and translucent so they don't hide the car.
 */
const SIDES: Record<Side, { yaw: number; sensor: number; width: number; height: number; maxGap: number; ghost: boolean }> = {
  front: { yaw: 0, sensor: 1.06, width: 1.2, height: 1.16, maxGap: 1.4, ghost: false },
  rear: { yaw: Math.PI, sensor: 1.06, width: 1.2, height: 1.16, maxGap: 1.4, ghost: false },
  left: { yaw: Math.PI / 2, sensor: 0.56, width: 1.7, height: 0.55, maxGap: 1.1, ghost: false },
  right: { yaw: -Math.PI / 2, sensor: 0.56, width: 1.7, height: 0.22, maxGap: 1.1, ghost: true },
}

export function distanceToGap(distanceCm: number | null, maxGap = MAX_GAP): number {
  if (distanceCm === null) return maxGap
  const clamped = Math.max(0, Math.min(MAX_CM, distanceCm))
  return MIN_GAP + (clamped / MAX_CM) * (maxGap - MIN_GAP)
}

function proximityColor(p: ProximityLevel, c: ThemeColors): string {
  return p === 'critical' ? c.red : p === 'warning' ? c.amber : p === 'clear' ? c.teal : c.dim
}

function Wheel({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation={[Math.PI / 2, 0, 0]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.16, 28]} />
        <meshStandardMaterial color="#141b24" roughness={0.85} />
      </mesh>
      <mesh position={[0, position[2] > 0 ? 0.082 : -0.082, 0]}>
        <cylinderGeometry args={[0.11, 0.11, 0.01, 20]} />
        <meshStandardMaterial color="#9aa7b4" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  )
}

function Car({ colors, theme, hazard }: { colors: ThemeColors; theme: 'light' | 'dark'; hazard: boolean }) {
  const hazardMats = useRef<THREE.MeshStandardMaterial[]>([])
  const body = theme === 'dark' ? '#e8edf2' : '#f4f6f8'
  const glass = '#0c1622'

  useFrame(({ clock }) => {
    const on = hazard && Math.floor(clock.elapsedTime * 2.5) % 2 === 0
    for (const m of hazardMats.current) m.emissiveIntensity = on ? 2.4 : 0.15
  })

  return (
    <group>
      {/* Lower body */}
      <RoundedBox args={[2.05, 0.36, 1.0]} radius={0.15} smoothness={4} position={[0, 0.34, 0]} castShadow>
        <meshStandardMaterial color={body} metalness={0.25} roughness={0.35} />
      </RoundedBox>
      {/* Glass band (slightly wider than the cabin so it reads as windows) */}
      <RoundedBox args={[1.2, 0.22, 0.9]} radius={0.1} smoothness={4} position={[-0.08, 0.62, 0]}>
        <meshStandardMaterial color={glass} metalness={0.6} roughness={0.12} />
      </RoundedBox>
      {/* Cabin + roof */}
      <RoundedBox args={[1.12, 0.3, 0.84]} radius={0.13} smoothness={4} position={[-0.08, 0.66, 0]} castShadow>
        <meshStandardMaterial color={body} metalness={0.25} roughness={0.35} />
      </RoundedBox>
      <RoundedBox args={[0.82, 0.04, 0.66]} radius={0.02} position={[-0.08, 0.815, 0]}>
        <meshStandardMaterial color={glass} metalness={0.5} roughness={0.15} />
      </RoundedBox>
      {/* Front light bar / sensor face */}
      <mesh position={[1.03, 0.4, 0]}>
        <boxGeometry args={[0.03, 0.08, 0.72]} />
        <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      {/* Ultrasonic sensor "eyes" */}
      {[-0.11, 0.11].map((z) => (
        <mesh key={z} position={[1.035, 0.27, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.055, 0.055, 0.04, 20]} />
          <meshStandardMaterial color="#1d2733" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* Rear ultrasonic */}
      {[-0.11, 0.11].map((z) => (
        <mesh key={`r${z}`} position={[-1.035, 0.27, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.055, 0.055, 0.04, 20]} />
          <meshStandardMaterial color="#1d2733" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* Headlights */}
      {[-0.4, 0.4].map((z) => (
        <mesh key={`h${z}`} position={[1.02, 0.42, z]}>
          <boxGeometry args={[0.03, 0.06, 0.14]} />
          <meshStandardMaterial color="#ffffff" emissive="#dff6ff" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      ))}
      {/* Tail lights double as hazard indicators */}
      {[-0.38, 0.38].map((z, i) => (
        <mesh key={`t${z}`} position={[-1.025, 0.42, z]}>
          <boxGeometry args={[0.03, 0.06, 0.18]} />
          <meshStandardMaterial
            ref={(m) => { if (m) hazardMats.current[i] = m }}
            color="#ff6a3d"
            emissive="#ff8a1f"
            emissiveIntensity={0.15}
            toneMapped={false}
          />
        </mesh>
      ))}
      <Wheel position={[0.64, 0.2, 0.5]} />
      <Wheel position={[0.64, 0.2, -0.5]} />
      <Wheel position={[-0.64, 0.2, 0.5]} />
      <Wheel position={[-0.64, 0.2, -0.5]} />
    </group>
  )
}

function SensorWaves({ gapRef, color, active, speed, pulseRef, sensorX }: {
  gapRef: React.RefObject<number>
  color: string
  active: boolean
  speed: number
  pulseRef: React.RefObject<number>
  sensorX: number
}) {
  const group = useRef<THREE.Group>(null)
  const geometry = useMemo(() => new THREE.TorusGeometry(1, 0.022, 8, 40, Math.PI / 2.4), [])
  const materials = useMemo(
    () => [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })),
    [],
  )
  useEffect(() => {
    materials.forEach((m) => m.color.set(color))
  }, [materials, color])
  useEffect(() => () => {
    geometry.dispose()
    materials.forEach((m) => m.dispose())
  }, [geometry, materials])

  useFrame(({ clock }, delta) => {
    if (!group.current) return
    const reach = Math.max(0.25, gapRef.current - 0.08)
    const pulse = pulseRef.current
    pulseRef.current = Math.max(0, pulse - delta * 1.5)
    group.current.children.forEach((child, i) => {
      const phase = (clock.elapsedTime * speed + i / 3) % 1
      const r = 0.12 + phase * reach
      child.scale.setScalar(r)
      child.position.x = 0
      const m = materials[i]
      m.opacity = active ? (1 - phase) * (0.55 + 0.45 * pulse) : 0
    })
  })

  return (
    <group ref={group} position={[sensorX, 0.3, 0]} rotation={[0, 0, -Math.PI / 4.8]}>
      {materials.map((m, i) => (
        <mesh key={i} geometry={geometry} material={m} />
      ))}
    </group>
  )
}

function Obstacle({ gapRef, targetGap, color, warn, sensorX, width, height, ghost }: {
  gapRef: React.RefObject<number>
  targetGap: number
  color: string
  warn: boolean
  sensorX: number
  width: number
  height: number
  ghost: boolean
}) {
  const mesh = useRef<THREE.Mesh>(null)
  const line = useRef<THREE.Group>(null)
  const mat = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(({ clock }) => {
    const x = sensorX + gapRef.current + OBSTACLE_HALF
    if (mesh.current) mesh.current.position.x = x
    if (line.current) line.current.scale.x = gapRef.current
    if (mat.current) mat.current.emissiveIntensity = warn ? 0.35 + 0.35 * Math.sin(clock.elapsedTime * 6) : 0.04
  })

  return (
    <>
      <mesh ref={mesh} position={[sensorX + targetGap + OBSTACLE_HALF, height / 2, 0]} castShadow={!ghost}>
        <boxGeometry args={[OBSTACLE_HALF * 2, height, width]} />
        <meshStandardMaterial ref={mat} color="#3b4b5f" emissive={color} emissiveIntensity={0.04} roughness={0.7}
          transparent={ghost} opacity={ghost ? 0.3 : 1} depthWrite={!ghost} />
      </mesh>
      <group ref={line} position={[sensorX, 0.3, 0]}>
        <Line points={[[0, 0, 0], [1, 0, 0]]} color={color} lineWidth={1.5} dashed dashSize={0.06} gapSize={0.05} transparent opacity={0.8} />
      </group>
    </>
  )
}

function SideSensor({ sensor, active, pulseKey, colors, maxGap }: { sensor: SensorView; active: boolean; pulseKey: string | null; colors: ThemeColors; maxGap: number }) {
  const geo = SIDES[sensor.side]
  const targetGap = distanceToGap(sensor.distanceCm, maxGap)
  const gapRef = useRef(targetGap)
  const pulseRef = useRef(0)
  useEffect(() => {
    pulseRef.current = 1
  }, [pulseKey])
  useFrame((_, delta) => {
    gapRef.current += (targetGap - gapRef.current) * Math.min(1, delta * 4)
  })
  const { proximity, distanceCm } = sensor
  const color = proximityColor(active ? proximity : 'unknown', colors)
  const speed = proximity === 'critical' ? 1.6 : proximity === 'warning' ? 1.1 : 0.7
  const inRange = distanceCm !== null && distanceCm < MAX_CM

  return (
    <group rotation={[0, geo.yaw, 0]}>
      <SensorWaves gapRef={gapRef} color={color} active={active && distanceCm !== null} speed={speed} pulseRef={pulseRef} sensorX={geo.sensor} />
      {inRange && (
        <Obstacle gapRef={gapRef} targetGap={targetGap} color={color} warn={active && proximity !== 'clear'}
          sensorX={geo.sensor} width={geo.width} height={geo.height} ghost={geo.ghost} />
      )}
    </group>
  )
}

/** Zooms out on narrow canvases so the rear and side obstacles stay in frame. */
function FitCamera({ surround }: { surround: boolean }) {
  useFrame(({ camera, size }) => {
    const zoom = surround ? Math.min(1, size.width / Math.max(1, size.height) / 2.1) : 1
    if (camera instanceof THREE.PerspectiveCamera && Math.abs(camera.zoom - zoom) > 1e-3) {
      camera.zoom = zoom
      camera.updateProjectionMatrix()
    }
  })
  return null
}

function Scene({ sensors, active, hazard, pulseKey, theme, colors }: VehicleSceneProps) {
  // With only a front sensor the car sits left so the obstacle has room; otherwise it's centred.
  const surround = sensors.some((s) => s.side !== 'front')

  return (
    <>
      <hemisphereLight args={[theme === 'dark' ? '#b8d4ff' : '#ffffff', theme === 'dark' ? '#0a1621' : '#d8dee6', 0.9]} />
      <directionalLight position={[2.5, 5, 3]} intensity={theme === 'dark' ? 1.8 : 2.2} castShadow />
      <directionalLight position={[-3, 2, -2]} intensity={0.45} color="#9ad8ff" />
      <group position={[surround ? -0.15 : -0.9, 0, 0]}>
        <Car colors={colors} theme={theme} hazard={hazard} />
        {sensors.map((s) => (
          <SideSensor key={s.side} sensor={s} active={active} pulseKey={pulseKey} colors={colors}
            maxGap={surround ? SIDES[s.side].maxGap : MAX_GAP} />
        ))}
      </group>
      <FitCamera surround={surround} />
      <ContactShadows position={[0, 0, 0]} opacity={theme === 'dark' ? 0.55 : 0.3} scale={7} blur={2.2} far={1.2} frames={1} />
    </>
  )
}

const VehicleScene = forwardRef<VehicleSceneHandle, VehicleSceneProps>(function VehicleScene(props, ref) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  useImperativeHandle(ref, () => ({ resetView: () => controls.current?.reset() }), [])
  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [1.45, 1.95, 5.0], fov: 30 }}
      gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      style={{ background: 'transparent' }}
      aria-label="3D vehicle with front, rear and side obstacle distances"
    >
      <Scene {...props} />
      <OrbitControls
        ref={controls}
        target={[0.2, 0.36, 0]}
        enablePan={false}
        enableZoom={false}
        minPolarAngle={0.35}
        maxPolarAngle={1.42}
        rotateSpeed={0.6}
        enableDamping
      />
    </Canvas>
  )
})

export default VehicleScene
