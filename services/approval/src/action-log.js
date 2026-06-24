/** 外部動作日誌 — write-before-respond + 2h dedup（OneAI 2.0 §#80 #90） */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = process.env.ACTION_LOG_PATH
  || join(__dir, '..', '..', '..', 'data', 'action-log.json')

const DEDUP_MS = Number(process.env.ACTION_DEDUP_MS || 2 * 60 * 60 * 1000)

function load() {
  try {
    return JSON.parse(readFileSync(LOG_PATH, 'utf-8'))
  } catch {
    return { entries: [] }
  }
}

function save(data) {
  mkdirSync(dirname(LOG_PATH), { recursive: true })
  writeFileSync(LOG_PATH, JSON.stringify(data, null, 2), 'utf-8')
}

/** @returns {{ ok: boolean, duplicate?: boolean, id?: string }} */
export function logExternalAction(type, detail = {}) {
  const now = Date.now()
  const key = `${type}:${JSON.stringify(detail?.key ?? detail?.task_id ?? detail?.query ?? '').slice(0, 120)}`
  const data = load()
  data.entries = (data.entries ?? []).filter(e => now - e.ts < DEDUP_MS * 2)

  const dup = data.entries.find(e => e.key === key && now - e.ts < DEDUP_MS)
  if (dup) return { ok: false, duplicate: true, id: dup.id }

  const id = `act-${now}-${Math.random().toString(36).slice(2, 8)}`
  data.entries.push({ id, type, key, detail, ts: now, status: 'logged' })
  save(data)
  return { ok: true, id }
}

export function markActionDoneForTask(taskId, result = {}) {
  const data = load()
  const entry = (data.entries ?? []).find(e => e.detail?.task_id === taskId)
  if (entry) {
    entry.status = 'done'
    entry.result = result
    entry.doneAt = Date.now()
    save(data)
  }
}
