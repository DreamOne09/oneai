// 審核狀態儲存:pending 審核 + 決定 + Web Push 訂閱。
// v0 以「單一 JSON 檔 + 原子寫入」持久化,使服務重啟不遺失待審/決定,
// 並於載入時重新武裝逾時計時器(避免阻塞式連線,改由 /status 輪詢取回結果)。
// 量大或多實例時可再換 SQLite/Redis,介面維持不變。
import fs from 'node:fs'
import path from 'node:path'

const DATA_FILE = process.env.APPROVAL_DATA_FILE || path.resolve('data/approval.json')

/** @typedef {{ id:string, action:string, summary:string, details?:object, createdAt:number, timeoutSec:number, onTimeout:string, actionToken:string, paramsHash?:string }} Pending */
/** @typedef {{ id:string, type:'shell'|'agent', payload:object, status:'queued'|'running'|'done'|'error', createdAt:number, claimedAt?:number, finishedAt?:number, result?:object }} Task */
/** @typedef {{ agent_id:string, display?:string, org?:string, status:string, current_task?:string, last_seen:number }} AgentInfo */

/** @type {Map<string, Pending>} */
const pending = new Map()
/** @type {Map<string, {decision:string, at:number}>} */
const decisions = new Map()
/** @type {object[]} */
let subscriptions = []
/** @type {Map<string, Task>} 本機肉體任務佇列(雲端派發 → 本機 worker 認領執行) */
const tasks = new Map()
/** @type {Map<string, AgentInfo>} agent 心跳狀態(不持久化,重啟自然清空視為離線) */
const agents = new Map()
/** @type {Map<string, NodeJS.Timeout>} 計時器不持久化,載入時重新武裝 */
const timers = new Map()

// 逾時結案回呼,由 server 注入(在 load() 之前呼叫 setOnExpire)
let onExpire = () => {}

function persist() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
    const data = {
      pending: [...pending.values()],
      decisions: [...decisions.entries()].map(([id, d]) => ({ id, ...d })),
      subscriptions,
      tasks: [...tasks.values()],
    }
    const tmp = `${DATA_FILE}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data))
    fs.renameSync(tmp, DATA_FILE) // 原子替換,避免半寫入損毀
  } catch (e) {
    console.warn('[store] 持久化失敗', e.message)
  }
}

function arm(id) {
  const p = pending.get(id)
  if (!p) return
  const remaining = p.createdAt + p.timeoutSec * 1000 - Date.now()
  if (remaining <= 0) {
    onExpire(id, p.onTimeout)
    return
  }
  timers.set(id, setTimeout(() => onExpire(id, p.onTimeout), remaining))
}

export const store = {
  /** server 注入逾時結案邏輯 */
  setOnExpire(fn) {
    onExpire = fn
  },

  /** 啟動時載入磁碟狀態並重新武裝計時器 */
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'))
      for (const p of raw.pending ?? []) pending.set(p.id, p)
      for (const d of raw.decisions ?? [])
        decisions.set(d.id, { decision: d.decision, at: d.at, paramsHash: d.paramsHash })
      subscriptions = raw.subscriptions ?? []
      for (const t of raw.tasks ?? []) {
        // 重啟時把「執行中但未回報」的任務退回佇列,避免卡死(worker 會重新認領)
        if (t.status === 'running') t.status = 'queued'
        tasks.set(t.id, t)
      }
    } catch {
      /* 尚無資料檔,首次啟動 */
    }
    for (const id of [...pending.keys()]) arm(id)
  },

  addPending(p) {
    pending.set(p.id, p)
    persist()
    arm(p.id)
  },
  getPending(id) {
    return pending.get(id)
  },
  resolve(id, decision) {
    const p = pending.get(id)
    if (!p) return false
    const t = timers.get(id)
    if (t) clearTimeout(t)
    timers.delete(id)
    pending.delete(id)
    // 把 paramsHash 一併寫進決定記錄:呼叫端可驗證「批准的參數 == 將執行的參數」(防 TOCTOU)
    decisions.set(id, { decision, at: Date.now(), paramsHash: p.paramsHash })
    persist()
    return true
  },
  getDecision(id) {
    return decisions.get(id)
  },
  // 對外列表隱去 actionToken / onTimeout 等敏感欄位
  listPending() {
    return [...pending.values()].map(({ actionToken, onTimeout, ...rest }) => rest)
  },
  addSubscription(sub) {
    const key = JSON.stringify(sub?.keys ?? sub)
    if (!subscriptions.find((s) => JSON.stringify(s?.keys ?? s) === key)) {
      subscriptions.push(sub)
      persist()
    }
  },
  listSubscriptions() {
    return subscriptions
  },
  removeSubscription(endpoint) {
    const i = subscriptions.findIndex((s) => s.endpoint === endpoint)
    if (i >= 0) {
      subscriptions.splice(i, 1)
      persist()
    }
  },

  // ── Agent 心跳(不持久化;重啟後 last_seen 自然舊掉,前端視為離線)────────
  upsertAgent(info) {
    agents.set(info.agent_id, { ...info })
  },
  /** 回傳全部 agent,附加 online 旗標(60s 內有心跳視為在線) */
  listAgents() {
    const now = Date.now()
    return [...agents.values()].map((a) => ({
      ...a,
      online: now - a.last_seen < 60_000,
    }))
  },

  // ── 本機肉體任務佇列 ──────────────────────────────────────────────
  // 雲端 mcp-core 入列任務;本機 worker 長輪詢認領、執行(經審核)後回報結果。
  addTask(task) {
    tasks.set(task.id, task)
    persist()
  },
  getTask(id) {
    return tasks.get(id)
  },
  /**
   * 認領最舊的 queued 任務並標記 running。
   * @param {string|string[]|null} typeFilter - 限定任務型別（null = 接受全部）
   *   例: 'cursor_agent' | ['shell','agent']
   */
  claimNextQueued(typeFilter = null) {
    const staleMs = Number(process.env.TASK_STALE_MS || 5 * 60 * 1000)
    const now = Date.now()
    for (const t of tasks.values()) {
      if (t.status === 'running' && t.claimedAt && now - t.claimedAt > staleMs) {
        t.status = 'queued'
        t.requeuedAt = now
        delete t.claimedAt
      }
    }
    const allowed = typeFilter
      ? (Array.isArray(typeFilter) ? typeFilter : typeFilter.split(',').map(s => s.trim()))
      : null
    let oldest = null
    for (const t of tasks.values()) {
      if (t.status !== 'queued') continue
      if (allowed && !allowed.includes(t.type)) continue
      if (!oldest || t.createdAt < oldest.createdAt) oldest = t
    }
    if (!oldest) return null
    oldest.status = 'running'
    oldest.claimedAt = Date.now()
    persist()
    return oldest
  },
  /** worker 回報結果;result 形如 {status:'done'|'error'|'rejected', summary, code, stdout_tail, stderr_tail} */
  setTaskResult(id, result) {
    const t = tasks.get(id)
    if (!t) return false
    t.status = result?.status === 'error' || result?.status === 'rejected' ? result.status : 'done'
    t.result = result
    t.finishedAt = Date.now()
    persist()
    return true
  },
}
