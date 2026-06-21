import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useOneAI } from '../state/store'

// ── 中心發光核心 ─────────────────────────────────────────────────────────────
function GlowCore() {
  const meshRef = useRef<THREE.Mesh>(null)
  const status = useOneAI((s) => s.status)

  useFrame((state) => {
    if (!meshRef.current) return
    const freq = status === 'thinking' ? 4.5 : status === 'listening' ? 2.8 : 1.6
    meshRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * freq) * 0.22)
  })

  return (
    <group>
      <pointLight color="#22d3ee" intensity={10} distance={4} />
      <pointLight color="#a5f3fc" intensity={5}  distance={2} />
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.11, 16, 16]} />
        <meshBasicMaterial color="#ccfbff" />
      </mesh>
    </group>
  )
}

// ── 四個傾斜旋轉光環（Torus）────────────────────────────────────────────────
function VortexRings() {
  const r0 = useRef<THREE.Mesh>(null)
  const r1 = useRef<THREE.Mesh>(null)
  const r2 = useRef<THREE.Mesh>(null)
  const r3 = useRef<THREE.Mesh>(null)
  const status = useOneAI((s) => s.status)

  useFrame((_, dt) => {
    const spd = status === 'thinking' ? 2.8 : status === 'alert' ? 3.2 : 1.0
    if (r0.current) { r0.current.rotation.z += dt * 0.42 * spd; r0.current.rotation.y += dt * 0.18 * spd }
    if (r1.current) { r1.current.rotation.z -= dt * 0.28 * spd; r1.current.rotation.x += dt * 0.12 * spd }
    if (r2.current) { r2.current.rotation.y += dt * 0.20 * spd; r2.current.rotation.z -= dt * 0.10 * spd }
    if (r3.current) { r3.current.rotation.x -= dt * 0.10 * spd; r3.current.rotation.z += dt * 0.07 * spd }
  })

  return (
    <>
      {/* 最內環：最亮、最快 */}
      <mesh ref={r0} rotation={[1.10, 0.28, 0.00]}>
        <torusGeometry args={[0.72, 0.022, 16, 120]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.92} />
      </mesh>
      <mesh ref={r1} rotation={[0.75, -0.50, 0.38]}>
        <torusGeometry args={[1.18, 0.015, 16, 120]} />
        <meshBasicMaterial color="#0891b2" transparent opacity={0.72} />
      </mesh>
      <mesh ref={r2} rotation={[0.35, 0.90, 0.22]}>
        <torusGeometry args={[1.62, 0.011, 16, 120]} />
        <meshBasicMaterial color="#164e63" transparent opacity={0.55} />
      </mesh>
      {/* 最外環：最暗、最慢 */}
      <mesh ref={r3} rotation={[0.15, -0.30, 0.70]}>
        <torusGeometry args={[2.05, 0.007, 16, 120]} />
        <meshBasicMaterial color="#083344" transparent opacity={0.38} />
      </mesh>
    </>
  )
}

// ── 螺旋粒子流 ───────────────────────────────────────────────────────────────
function SpiralParticles() {
  const ref    = useRef<THREE.Points>(null)
  const status = useOneAI((s) => s.status)
  const N = 700

  const phases = useMemo(() => new Float32Array(N).map((_, i) => (i / N) * Math.PI * 10), [])
  const radii  = useMemo(() => new Float32Array(N).map(() => 0.45 + Math.random() * 1.85), [])
  const tilts  = useMemo(() => new Float32Array(N).map((_, i) => Math.sin(i * 1.37) * 0.38), [])
  const pos    = useMemo(() => new Float32Array(N * 3), [])

  useFrame((_, dt) => {
    const speed = status === 'thinking' ? 0.80 : status === 'listening' ? 0.48 : 0.22
    for (let i = 0; i < N; i++) {
      // 內圈轉更快（行星力學感）
      phases[i] += dt * speed * (1.3 - radii[i] * 0.35)
      const u = phases[i]
      const r = radii[i]
      pos[i * 3]     = r * Math.cos(u)
      pos[i * 3 + 1] = r * Math.sin(u)
      pos[i * 3 + 2] = tilts[i] * Math.sin(u * 0.7)
    }
    if (ref.current) {
      (ref.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={pos} itemSize={3} count={N} />
      </bufferGeometry>
      <pointsMaterial size={0.024} color="#22d3ee" transparent opacity={0.62} sizeAttenuation />
    </points>
  )
}

// ── 外圍能量霧（稀疏粒子）────────────────────────────────────────────────────
function EnergyHaze() {
  const ref    = useRef<THREE.Points>(null)
  const status = useOneAI((s) => s.status)
  const N = 280
  const phases = useMemo(() => new Float32Array(N).map((_, i) => (i / N) * Math.PI * 6), [])
  const radii  = useMemo(() => new Float32Array(N).map(() => 2.0 + Math.random() * 0.9), [])
  const pos    = useMemo(() => new Float32Array(N * 3), [])

  useFrame((_, dt) => {
    const speed = status === 'thinking' ? 0.35 : 0.10
    for (let i = 0; i < N; i++) {
      phases[i] += dt * speed * (0.5 + Math.sin(i) * 0.3)
      const u = phases[i]
      const r = radii[i]
      pos[i * 3]     = r * Math.cos(u)
      pos[i * 3 + 1] = r * Math.sin(u) * 0.6  // 扁平化
      pos[i * 3 + 2] = Math.sin(u * 2) * 0.2
    }
    if (ref.current) {
      (ref.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" array={pos} itemSize={3} count={N} />
      </bufferGeometry>
      <pointsMaterial size={0.018} color="#0e7490" transparent opacity={0.40} sizeAttenuation />
    </points>
  )
}

// ── 背景星場 ─────────────────────────────────────────────────────────────────
function StarField() {
  const ref = useRef<THREE.Points>(null)
  const pos = useMemo(() => {
    const arr = new Float32Array(1600 * 3)
    for (let i = 0; i < 1600; i++) {
      const r  = 3.8 + Math.random() * 4.5
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      arr[i * 3]     = r * Math.sin(ph) * Math.cos(th)
      arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
      arr[i * 3 + 2] = r * Math.cos(ph)
    }
    return arr
  }, [])

  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.008
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[pos, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.015} color="#a0c8f0" transparent opacity={0.48} sizeAttenuation />
    </points>
  )
}

// ── 主元件 ───────────────────────────────────────────────────────────────────
export default function Orb() {
  const status = useOneAI((s) => s.status)
  const bloomIntensity = status === 'thinking' ? 3.2 : status === 'alert' ? 2.8 : 2.0

  return (
    <Canvas
      camera={{ position: [0, 0.3, 4.8], fov: 46 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
    >
      <ambientLight intensity={0.04} />
      <GlowCore />
      <VortexRings />
      <SpiralParticles />
      <EnergyHaze />
      <StarField />
      <EffectComposer>
        <Bloom
          intensity={bloomIntensity}
          luminanceThreshold={0.12}
          luminanceSmoothing={0.85}
          mipmapBlur
          radius={0.82}
        />
      </EffectComposer>
    </Canvas>
  )
}
