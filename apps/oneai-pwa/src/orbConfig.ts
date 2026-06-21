import type { AgentStatus } from './types'

export interface OrbVisual {
  color: string
  emissive: string
  breathPeriod: number  // 一次完整呼吸的秒數(越大越慢)
  breathAmp: number     // scale 起伏幅度
  distort: number       // 表面形變(活著的流動感)
  distortSpeed: number
  intensity: number     // 輝光強度
}

// 莫比烏斯主題色調:深藍→青綠連續過渡,沒有內外之分
export const ORB: Record<AgentStatus, OrbVisual> = {
  idle: {
    color: '#0a1628',
    emissive: '#22d3ee',
    breathPeriod: 5.5,
    breathAmp: 0.025,
    distort: 0.16,
    distortSpeed: 0.5,
    intensity: 0.85,
  },
  listening: {
    color: '#082033',
    emissive: '#67e8f9',
    breathPeriod: 2.8,
    breathAmp: 0.055,
    distort: 0.30,
    distortSpeed: 1.5,
    intensity: 1.15,
  },
  thinking: {
    // 莫比烏斯扭轉感:紫→靛藍,像意識在帶上滑行
    color: '#1e1348',
    emissive: '#a78bfa',
    breathPeriod: 1.6,
    breathAmp: 0.07,
    distort: 0.48,
    distortSpeed: 3.0,
    intensity: 1.4,
  },
  speaking: {
    color: '#052e2a',
    emissive: '#5eead4',
    breathPeriod: 2.0,
    breathAmp: 0.09,
    distort: 0.36,
    distortSpeed: 2.2,
    intensity: 1.5,
  },
  alert: {
    color: '#2a1200',
    emissive: '#fbbf24',
    breathPeriod: 0.9,
    breathAmp: 0.12,
    distort: 0.55,
    distortSpeed: 3.8,
    intensity: 2.0,
  },
  success: {
    color: '#042014',
    emissive: '#4ade80',
    breathPeriod: 2.4,
    breathAmp: 0.065,
    distort: 0.22,
    distortSpeed: 1.1,
    intensity: 1.6,
  },
}
