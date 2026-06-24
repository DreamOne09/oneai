/** 記憶政策 — 來自 config/oneai.memory.json（SSOT） */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

function loadMemoryConfig() {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    const p = join(__dir, '..', '..', '..', 'config', 'oneai.memory.json')
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return {}
  }
}

export const MEMORY_CONFIG = loadMemoryConfig()
export const MEMORY_WRITE = MEMORY_CONFIG.write ?? {}
export const MEMORY_INJECT = MEMORY_CONFIG.inject ?? {}
