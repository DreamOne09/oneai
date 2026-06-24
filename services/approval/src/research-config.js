/** 研究路由設定 — 讀取 config/oneai.research.json */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const cfgPath = join(ROOT, 'config/oneai.research.json')

let cached = null
export function loadResearchConfig() {
  if (cached) return cached
  try {
    cached = JSON.parse(readFileSync(cfgPath, 'utf8'))
  } catch {
    cached = { browser_deep: { trigger_phrases: [], url_intent_phrases: [] } }
  }
  return cached
}

export const BROWSER_DEEP = () => loadResearchConfig().browser_deep ?? {}
