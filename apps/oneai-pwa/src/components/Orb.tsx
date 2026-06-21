import { Canvas, useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useOneAI } from '../state/store'

function damp(current: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.damp(current, target, lambda, dt)
}

// ── 銀色金屬莫比烏斯環帶 ──────────────────────────────────────────────────────
// 材質：MeshPhysicalMaterial，metalness=1、roughness≈0.04，模擬鏡面拋光銀/鉻質感。
// 多組方向光從上方/側面/背面打光，讓帶面各角度都有高光反射，如同圖中的珠寶效果。
function MobiusBand({ radius = 2.0, halfWidth = 0.52, segments = 280 }: {
  radius?: number; halfWidth?: number; segments?: number
}) {
  const status = useOneAI((s) => s.status)
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null)
  const rotSpeed = useRef(0.06)

  // 莫比烏斯帶幾何（參數方程同前）
  const geometry = useMemo(() => {
    const R = radius, w = halfWidth, N = segments, M = 24
    const verts: number[] = [], idxs: number[] = [], uvs: number[] = []
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * Math.PI * 2
      for (let j = 0; j <= M; j++) {
        const t = (j / M) * 2 * w - w
        verts.push(
          (R + t * Math.cos(u / 2)) * Math.cos(u),
          (R + t * Math.cos(u / 2)) * Math.sin(u),
          t * Math.sin(u / 2),
        )
        uvs.push(i / N, j / M)
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j, b = a + 1, c = a + (M + 1), d = c + 1
        idxs.push(a, b, d, a, d, c)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(idxs)
    geo.computeVertexNormals()
    return geo
  }, [radius, halfWidth, segments])

  useFrame((state, dt) => {
    const targetSpeed = status === 'thinking' ? 0.20 : status === 'alert' ? 0.28 : status === 'listening' ? 0.12 : 0.06
    rotSpeed.current = damp(rotSpeed.current, targetSpeed, 2.5, dt)
    if (meshRef.current) {
      meshRef.current.rotation.z += dt * rotSpeed.current
      // 輕微傾斜搖擺，讓不同帶面持續呈現
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.08) * 0.22
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.05) * 0.08
    }
    // 思考時帶面稍微閃爍（metalness 微調讓高光跳動）
    if (matRef.current) {
      const pulse = status === 'thinking'
        ? 0.94 + Math.sin(state.clock.elapsedTime * 4) * 0.04
        : status === 'alert'
        ? 0.92 + Math.sin(state.clock.elapsedTime * 6) * 0.06
        : 0.98
      matRef.current.roughness = damp(matRef.current.roughness, 1 - pulse, 3, dt)
    }
  })

  return (
    <mesh ref={meshRef} geometry={geometry}>
      {/*
        MeshPhysicalMaterial 模擬鏡面拋光銀：
        - metalness: 1.0 → 完全金屬，反射光源顏色
        - roughness ≈ 0.02–0.06 → 幾乎鏡面（越低越像拋光鉻）
        - color: 銀灰 → 調和多個光源的色彩混合後呈現銀色
      */}
      <meshPhysicalMaterial
        ref={matRef}
        color="#d8d8d8"
        metalness={1.0}
        roughness={0.04}
        reflectivity={1.0}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// ── 銀河粒子系統 ──────────────────────────────────────────────────────────────
// 三層：① 均勻背景星 ② 對數螺旋臂（銀河特有結構）③ 沿莫比烏斯流動粒子
function GalaxyParticles() {
  const status = useOneAI((s) => s.status)

  const N_BG      = 1800  // 均勻背景星
  const N_SPIRAL  = 600   // 螺旋臂星
  const N_MOBIUS  = 200   // 莫比烏斯流動粒子
  const N_CORE    = 120   // 銀河核心亮團

  const bgRef      = useRef<THREE.Points>(null)
  const spiralRef  = useRef<THREE.Points>(null)
  const mobiusRef  = useRef<THREE.Points>(null)
  const coreRef    = useRef<THREE.Points>(null)

  // 均勻背景星（球面分布，半徑 3–7）
  const bgPos = useMemo(() => {
    const arr = new Float32Array(N_BG * 3)
    for (let i = 0; i < N_BG; i++) {
      const r = 3.2 + Math.random() * 3.8
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      arr[i * 3]     = r * Math.sin(ph) * Math.cos(th)
      arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
      arr[i * 3 + 2] = r * Math.cos(ph)
    }
    return arr
  }, [])

  // 對數螺旋臂（2 條臂，銀河結構感）
  const spiralPos = useMemo(() => {
    const arr = new Float32Array(N_SPIRAL * 3)
    for (let i = 0; i < N_SPIRAL; i++) {
      const arm = i % 2  // 0 或 1（兩條臂）
      const t = (i / N_SPIRAL) * 4.5             // 沿臂延伸量
      const angle = t * 1.2 + arm * Math.PI       // 螺旋角
      const rBase = 1.5 + t * 0.8                  // 對數螺旋半徑
      const scatter = (Math.random() - 0.5) * 0.4  // 橫向散布
      const zScatter = (Math.random() - 0.5) * 0.3
      arr[i * 3]     = Math.cos(angle) * (rBase + scatter)
      arr[i * 3 + 1] = Math.sin(angle) * (rBase + scatter)
      arr[i * 3 + 2] = zScatter
    }
    return arr
  }, [])

  // 銀河核心（密集亮團，中心附近）
  const corePos = useMemo(() => {
    const arr = new Float32Array(N_CORE * 3)
    for (let i = 0; i < N_CORE; i++) {
      const r = Math.random() * 0.8
      const th = Math.random() * Math.PI * 2
      const ph = Math.acos(2 * Math.random() - 1)
      arr[i * 3]     = r * Math.sin(ph) * Math.cos(th)
      arr[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th)
      arr[i * 3 + 2] = r * Math.cos(ph) * 0.2  // 扁平核心
    }
    return arr
  }, [])

  // 莫比烏斯粒子初始相位
  const mobiusPhases = useMemo(
    () => new Float32Array(N_MOBIUS).map((_, i) => (i / N_MOBIUS) * Math.PI * 4),
    [],
  )
  const mobiusPos = useMemo(() => new Float32Array(N_MOBIUS * 3), [])

  useFrame((_s, dt) => {
    const speed = status === 'thinking' ? 0.55 : status === 'alert' ? 0.9 : 0.22
    const R = 2.0, w = 0.5

    for (let i = 0; i < N_MOBIUS; i++) {
      mobiusPhases[i] += dt * speed * (0.7 + 0.6 * (i % 3))
      const u = mobiusPhases[i]
      const t = (Math.sin(i * 1.37) * 0.5 + 0.5) * 2 * w - w
      mobiusPos[i * 3]     = (R + t * Math.cos(u / 2)) * Math.cos(u)
      mobiusPos[i * 3 + 1] = (R + t * Math.cos(u / 2)) * Math.sin(u)
      mobiusPos[i * 3 + 2] = t * Math.sin(u / 2)
    }
    if (mobiusRef.current) {
      (mobiusRef.current.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
    }

    // 整個銀河系緩慢自轉
    if (bgRef.current) bgRef.current.rotation.y += dt * 0.012
    if (spiralRef.current) spiralRef.current.rotation.z += dt * 0.008
    if (coreRef.current) coreRef.current.rotation.y += dt * 0.018
  })

  return (
    <>
      {/* 均勻背景星 */}
      <points ref={bgRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[bgPos, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.014} color="#b8d4f0" transparent opacity={0.55} sizeAttenuation />
      </points>

      {/* 螺旋臂（帶藍紫色調，銀河感）*/}
      <points ref={spiralRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[spiralPos, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.022} color="#8ab4f8" transparent opacity={0.70} sizeAttenuation />
      </points>

      {/* 銀河核心 — 暖白光 */}
      <points ref={coreRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[corePos, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.036} color="#ffe8a0" transparent opacity={0.82} sizeAttenuation />
      </points>

      {/* 莫比烏斯流動粒子 */}
      <points ref={mobiusRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" array={mobiusPos} itemSize={3} count={N_MOBIUS} />
        </bufferGeometry>
        <pointsMaterial size={0.028} color="#a5f3fc" transparent opacity={0.75} sizeAttenuation />
      </points>
    </>
  )
}

export default function Orb() {
  return (
    <Canvas camera={{ position: [0, 0.5, 5.2], fov: 48 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }}>
      {/* 環境光（極弱，讓暗面不全黑）*/}
      <ambientLight intensity={0.08} />

      {/*
        多組方向光模擬銀色拋光鉻的反射環境：
        - 頂部強白光 → 頂面亮高光
        - 左上冷藍光 → 左邊反射天空色
        - 右側暖白光 → 另一面高光
        - 背面緣光   → 輪廓反射（jewelry 效果）
        - 底部暗暖光 → 地面反射陰影色
      */}
      <directionalLight position={[1, 6, 2]}  intensity={3.2} color="#ffffff" />
      <directionalLight position={[-5, 2, 1]} intensity={1.8} color="#99bbdd" />
      <directionalLight position={[4, -1, 2]} intensity={1.4} color="#e8eeff" />
      <directionalLight position={[0, -4, -1]} intensity={0.6} color="#332211" />
      <pointLight position={[0, 3, -5]} intensity={2.5} color="#ddeeff" />
      <pointLight position={[-2, 0, 3]} intensity={0.8} color="#ffffff" />

      <MobiusBand radius={2.1} halfWidth={0.52} />
      <GalaxyParticles />

      <EffectComposer>
        <Bloom
          intensity={status === 'thinking' ? 2.8 : 1.8}
          luminanceThreshold={0.18}
          luminanceSmoothing={0.82}
          mipmapBlur
          radius={0.72}
        />
      </EffectComposer>
    </Canvas>
  )
}
