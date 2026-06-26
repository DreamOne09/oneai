/**
 * OneAI 2.0 版本與能力 — SSOT loader
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const ONEAI_VERSION = '2.0.0'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

export function loadOneAI20Manifest() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'config/oneai.2.0.json'), 'utf-8'))
  } catch {
    return { version: ONEAI_VERSION, capabilities: {}, pillars: {} }
  }
}

export function buildVersionPayload(extra = {}) {
  const manifest = loadOneAI20Manifest()
  return {
    ok: true,
    version: ONEAI_VERSION,
    codename: manifest.codename ?? 'digital-office',
    released: manifest.released ?? null,
    north_star: manifest.north_star ?? '',
    pillars: manifest.pillars ?? {},
    capabilities: manifest.capabilities ?? {},
    waves: manifest.waves ?? {},
    ga_criteria: manifest.ga_criteria ?? {},
    ...extra,
  }
}
