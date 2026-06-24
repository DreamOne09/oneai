import express from 'express'
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { store } from './store.js'
import { publishApproval, notify } from './ntfy.js'
import { sendPush } from './push.js'
import {
  memoryScore,
  DEDUP_SCORE,
  PHASE_LABELS,
} from './brain-intel.js'
import { runOrchestrateTurn } from './orchestrate-harness.js'
import { getRagBaseUrl } from './rag-host.js'
import { seedSystemMemoryIfNeeded } from './system-memory.js'
import { buildMemoryGraph } from './brain-graph.js'
import { logExternalAction, markActionDoneForTask } from './action-log.js'
import { triggerCloudHand, getLatestWorkflowRun } from './cloud-hands.js'
import {
  AGENTS_CONFIG,
  MENGYI_BRIEF,
  AGENTS_META,
  AGENT_SYSTEMS,
  ROUTING_TRIGGERS,
  RESEARCH_KWS,
  AVAILABLE_AGENTS,
  detectAgentsFallback,
} from './agents-config.js'

const app = express()
app.use(express.json({ limit: '256kb' }))

// CORS (PWA 跨網域呼叫) — 須在所有路由(含 /health)之前註冊,否則先定義的路由收不到 CORS 標頭,
// 導致前端心跳/呼叫被瀏覽器擋下。
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*')
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Approval-Token')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

const PORT = process.env.PORT || process.env.APPROVAL_PORT || 8787
const DEFAULT_TIMEOUT = Number(process.env.APPROVAL_DEFAULT_TIMEOUT_SEC || 1800)
const SERVICE_TOKEN = process.env.APPROVAL_TOKEN || '' // agent ↔ 服務 共享密鑰（高權限，勿暴露給前端）
const WORKER_TOKEN = process.env.ONEAI_WORKER_TOKEN || '' // 本機 worker ↔ 服務 共享密鑰（最小權限）
// ⚠️ 前端專用 token：只能呼叫 /chat* 端點；預設 fallback 到 SERVICE_TOKEN（向後相容，建議正式環境設獨立值）
const CHAT_TOKEN = process.env.ONEAI_CHAT_TOKEN || SERVICE_TOKEN
const VALID_ACTIONS = ['send_email', 'spend_money', 'publish', 'delete_file', 'run_command']
const VALID_TASK_TYPES = ['shell', 'agent', 'cursor_agent', 'cloud_hand']
const MAX_MSG_LENGTH = 8000 // 單則 user message 字元上限
const TASK_LONGPOLL_MS = Number(process.env.TASK_LONGPOLL_SEC || 25) * 1000

// 逾時自動結案(由 store 計時器觸發);須在 load() 前注入
store.setOnExpire((id, onTimeout) => store.resolve(id, onTimeout || 'rejected'))
store.load()

if (!SERVICE_TOKEN) {
  console.warn('[approval] 未設定 APPROVAL_TOKEN — 服務端點未鑑權,僅限本機/開發環境!')
}

// 常數時間字串比較,避免 timing attack
function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// 服務間鑑權:agent/bridge 呼叫(/request、/notify、/pending)須帶 Bearer token
function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) return next() // 開發模式放行(已於啟動時警告)
  const h = req.get('Authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (token && safeEqual(token, SERVICE_TOKEN)) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

// 前端 Chat 專用鑑權：接受 CHAT_TOKEN（低權限）或 SERVICE_TOKEN（高權限均可）
// PWA 應設定 VITE_CHAT_TOKEN=<ONEAI_CHAT_TOKEN>，避免暴露完整 service token
function requireChatToken(req, res, next) {
  const h = req.get('Authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'unauthorized' })
  if (SERVICE_TOKEN && safeEqual(token, SERVICE_TOKEN)) return next()
  if (CHAT_TOKEN && safeEqual(token, CHAT_TOKEN)) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

// ── 簡易速率限制（不依賴外部套件；每 IP 每分鐘上限 N 次）──────────────────
function makeRateLimiter(maxPerMin = 20) {
  const buckets = new Map()
  setInterval(() => buckets.clear(), 60_000) // 每分鐘清除
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const count = (buckets.get(ip) ?? 0) + 1
    buckets.set(ip, count)
    if (count > maxPerMin) {
      return res.status(429).json({ error: '請求過於頻繁，請稍後再試', retry_after_sec: 60 })
    }
    next()
  }
}
const chatRateLimit = makeRateLimiter(20) // orchestrate 每 IP 每分鐘 ≤ 20 次

// 本機 worker 鑑權(只能拉任務 / 回報結果,不能建立審核 → 最小權限)
function requireWorkerToken(req, res, next) {
  if (!WORKER_TOKEN) return res.status(503).json({ error: 'worker queue 未啟用(未設 ONEAI_WORKER_TOKEN)' })
  const h = req.get('Authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (token && safeEqual(token, WORKER_TOKEN)) return next()
  return res.status(401).json({ error: 'unauthorized' })
}

app.get('/health', (_req, res) => res.json({ ok: true, version: '1.2.0', pending: store.listPending().length }))

// /status  ── 服務狀態快速查詢（E2E / 監控用，需 service token）
app.get('/status', requireServiceToken, (_req, res) => {
  res.json({
    ts: Date.now(),
    version: '1.2.0',
    services: {
      approval_svc: { status: 'ok', pending: store.listPending().length },
      openrouter: { status: process.env.OPENAI_API_KEY ? 'configured' : 'missing_key' },
    },
    agents: store.listAgents(),
  })
})

/**
 * 建立審核請求(非阻塞)。立即回 202 + approval_id,呼叫端改以 GET /status/:id 輪詢。
 * 修正:舊版阻塞 30 分鐘等決定,會被反向代理/負載平衡器掐斷連線。
 */
app.post('/request', requireServiceToken, (req, res) => {
  const { action, summary, details, timeout_sec, default_on_timeout, params_hash } = req.body ?? {}
  if (!VALID_ACTIONS.includes(action) || !summary) {
    return res.status(400).json({ error: 'action 無效或缺 summary', valid: VALID_ACTIONS })
  }

  const id = randomUUID()
  const actionToken = randomBytes(16).toString('hex') // 隨通知下發,decide 時驗證
  const timeoutSec = Number(timeout_sec) || DEFAULT_TIMEOUT
  const onTimeout = default_on_timeout === 'approve' ? 'approved' : 'rejected' // 預設拒絕
  const paramsHash = typeof params_hash === 'string' ? params_hash : undefined

  const approval = { id, action, summary, details, createdAt: Date.now(), timeoutSec }
  store.addPending({ ...approval, onTimeout, actionToken, paramsHash })

  // 招2 防操弄:把「真正要執行的原始參數」一起送達,讓使用者看到的是實際指令而非僅摘要
  const rawDetail = rawDetailOf(details)

  // 雙通道送達手機(夾帶 actionToken,讓收到通知者才能決定)
  publishApproval({ ...approval, actionToken })
  sendPush({
    title: `需要授權: ${action}`,
    body: summary,
    detail: rawDetail,
    approvalId: id,
    actionToken,
    requireApproval: true,
    tag: id,
  })

  res.status(202).json({ approval_id: id, status: 'pending', poll: `/status/${id}`, timeout_sec: timeoutSec })
})

// 從 details 萃取人類可讀的「原始參數」字串(用於通知顯示,防混淆)
function rawDetailOf(details) {
  if (!details || typeof details !== 'object') return ''
  return String(details.cmd ?? details.prompt ?? JSON.stringify(details)).slice(0, 500)
}

// approve/reject 需帶該審核專屬 actionToken(query ?t= 或 X-Approval-Token header)
const decide = (decisionWord) => (req, res) => {
  const p = store.getPending(req.params.id)
  if (!p) {
    const d = store.getDecision(req.params.id)
    if (d) return res.status(409).json({ error: '已結案', id: req.params.id, decision: d.decision })
    return res.status(404).json({ error: '找不到或已過期', id: req.params.id })
  }
  const token = req.query.t || req.get('X-Approval-Token') || ''
  if (!safeEqual(token, p.actionToken)) {
    return res.status(403).json({ error: 'invalid token' })
  }
  store.resolve(req.params.id, decisionWord)
  res.json({ id: req.params.id, decision: decisionWord, at: new Date().toISOString() })
}

app.post('/approve/:id', decide('approved'))
app.post('/reject/:id', decide('rejected'))

// 輪詢決定(唯讀,不含密鑰,公開)
app.get('/status/:id', (req, res) => {
  const d = store.getDecision(req.params.id)
  // 對外用 snake_case params_hash(與 /request 入參、各語言 client 一致)
  if (d) {
    return res.json({
      id: req.params.id,
      decision: d.decision,
      at: d.at,
      params_hash: d.paramsHash,
      settled: true,
    })
  }
  if (store.getPending(req.params.id)) return res.json({ id: req.params.id, settled: false })
  res.status(404).json({ error: '未知 id' })
})

app.get('/pending', requireServiceToken, (_req, res) => res.json(store.listPending()))

// Web Push 訂閱回報（瀏覽器端；須驗證基本結構，防止惡意資料污染訂閱列表）
app.post('/push/subscribe', (req, res) => {
  const sub = req.body
  // 最低限度 schema 驗證：PushSubscription 必須有 endpoint 字串
  if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) {
    return res.status(400).json({ error: '無效的 push subscription 格式' })
  }
  store.addSubscription(sub)
  res.json({ ok: true })
})

// 純通知 (非審核)
app.post('/notify', requireServiceToken, (req, res) => {
  const { title, body, tags } = req.body ?? {}
  notify(title ?? 'OneAI', body ?? '', tags ?? [])
  sendPush({ title: title ?? 'OneAI', body: body ?? '' })
  res.json({ ok: true })
})

// ── Cloud-First Hands（GitHub Actions，無需本機 worker）────────────────────
app.post('/hands/github', requireServiceToken, async (req, res) => {
  const { job, task_id: taskId } = req.body ?? {}
  if (!job) return res.status(400).json({ error: 'missing job', valid: ['smoke', 'gtx-p0', 'deploy-rag'] })
  const out = await triggerCloudHand(String(job), { taskId, triggeredBy: 'api' })
  if (!out.ok) return res.status(503).json(out)
  logExternalAction('cloud_hand', { key: job, task_id: taskId || null })
  res.status(202).json(out)
})

app.get('/hands/github/status', requireServiceToken, async (req, res) => {
  const out = await getLatestWorkflowRun(req.query.job ? String(req.query.job) : null)
  if (!out.ok) return res.status(503).json(out)
  res.json(out)
})

// ── 本機肉體任務佇列(反向輪詢)────────────────────────────────────────
// 雲端 mcp-core 入列 → 本機 worker 長輪詢認領 → worker 跑 executor.py(內含審核護欄)→ 回報。
// 審核不在此處做;由本機 executor 在執行時觸發(送手機),故此佇列僅為傳輸層。

// 雲端派發任務(agent/mcp-core 呼叫,需 service token)
app.post('/tasks', requireServiceToken, async (req, res) => {
  const { type, payload } = req.body ?? {}
  if (!VALID_TASK_TYPES.includes(type) || !payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'type 無效或缺 payload', valid: VALID_TASK_TYPES })
  }
  const id = randomUUID()
  logExternalAction('task_enqueue', {
    key: `${type}:${JSON.stringify(payload).slice(0, 80)}`,
    task_type: type,
  })

  if (type === 'cloud_hand') {
    const job = String(payload.job || 'smoke')
    const out = await triggerCloudHand(job, { taskId: id, triggeredBy: 'tasks' })
    if (!out.ok) {
      store.addTask({
        id, type, payload, status: 'error', createdAt: Date.now(),
        result: { status: 'error', output: out.error },
      })
      return res.status(503).json({ task_id: id, status: 'error', error: out.error })
    }
    store.addTask({
      id, type, payload: { ...payload, job, gha: out }, status: 'running', createdAt: Date.now(),
    })
    return res.status(202).json({
      task_id: id,
      status: 'running',
      poll: `/tasks/${id}`,
      gha_poll: out.poll,
      job,
    })
  }

  store.addTask({ id, type, payload, status: 'queued', createdAt: Date.now() })
  res.status(202).json({ task_id: id, status: 'queued', poll: `/tasks/${id}` })
})

// 本機 worker 長輪詢認領下一個任務(需 worker token);無任務則 ~25s 後回 204
// ?type=cursor_agent       → 只認領 cursor_agent 任務（cursor_worker 用）
// ?type=shell,agent        → 只認領 shell/agent 任務（agy worker 用）
// 不帶 type 參數           → 全接受（向後相容）
// 注意:此路由須定義在 `/tasks/:id` 之前,否則會被 `:id` 當成 id="next" 吃掉而走錯鑑權。
app.get('/tasks/next', requireWorkerToken, (req, res) => {
  const typeFilter = req.query.type ? String(req.query.type) : null
  const deadline = Date.now() + TASK_LONGPOLL_MS
  let done = false
  const finish = (fn) => {
    if (done) return
    done = true
    fn()
  }
  req.on('close', () => finish(() => {}))
  const tick = () => {
    if (done) return
    const t = store.claimNextQueued(typeFilter)
    if (t) return finish(() => res.json({ id: t.id, type: t.type, payload: t.payload }))
    if (Date.now() >= deadline) return finish(() => res.sendStatus(204))
    setTimeout(tick, 1000)
  }
  tick()
})

// 本機 worker 回報任務結果(需 worker token)
app.post('/tasks/:id/result', requireWorkerToken, async (req, res) => {
  const body = req.body ?? {}
  const task = store.getTask(req.params.id)
  const ok = store.setTaskResult(req.params.id, body)
  if (!ok) return res.status(404).json({ error: '未知 task id' })
  markActionDoneForTask(req.params.id, { status: body.status })
  const status = body.status === 'error' || body.status === 'rejected' ? body.status : 'done'
  const title = status === 'done' ? '✅ 本機任務完成' : '⚠️ 本機任務失敗'
  const preview = String(body.summary ?? body.output ?? '').slice(0, 120)
  const taskLabel = task?.type === 'cursor_agent' ? 'Cursor' : task?.type ?? 'task'
  try {
    sendPush({ title, body: `${taskLabel} · ${preview || req.params.id.slice(0, 8)}` })
  } catch { /* push optional */ }
  res.json({ ok: true })
})

// 雲端輪詢任務結果(需 service token);須定義在 `/tasks/next` 之後,避免 `:id` 吃掉 next。
app.get('/tasks/:id', requireServiceToken, (req, res) => {
  const t = store.getTask(req.params.id)
  if (!t) return res.status(404).json({ error: '未知 task id' })
  res.json({
    id: t.id,
    status: t.status,
    type: t.type,
    payload: t.payload ?? null,
    createdAt: t.createdAt,
    result: t.result ?? null,
  })
})

// ── 聊天代理(Chat Proxy)────────────────────────────────────────────────────
// PWA 直接呼叫此端點;API key 留在伺服器端,不暴露給前端 bundle。
// 認證:Bearer APPROVAL_TOKEN(與 service token 共用;個人工具可接受)。

// ── RAG 長期記憶（Soul L3）────────────────────────────────────────────────
const RAG_BASE = getRagBaseUrl()

/** 查詢 RAG 最相關的記憶片段，超時或失敗靜默回空 */
async function ragQuery(text, topK = 3, kind = null) {
  try {
    const body = { query: text, top_k: topK, max_chars: 800 }
    if (kind) body.kind = kind
    const res = await fetch(`${RAG_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  } catch { return [] }
}

/** 寫入記憶（await 完成，供「記住」後立即召回） */
async function ragRemember(text, title, kind = 'memory') {
  try {
    const res = await fetch(`${RAG_BASE}/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, title, kind, tags: ['oneai-chat', kind] }),
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** L：寫入前去重（相似度 ≥ 0.95 跳過） */
async function ragRememberSmart(text, title, kind = 'memory') {
  try {
    const similar = await ragQuery(String(text).slice(0, 300), 1)
    if (similar.length && memoryScore(similar[0]) >= DEDUP_SCORE) {
      console.log('[brain] skip dedup remember', memoryScore(similar[0]))
      return { skipped: true }
    }
  } catch { /* continue */ }
  await ragRemember(text, title, kind)
  return { skipped: false }
}

/** Butler Phase B — 清理 episodic 垃圾 */
async function ragCurate(dryRun = true, limit = 500) {
  try {
    const res = await fetch(`${RAG_BASE}/curate?dry_run=${dryRun ? 'true' : 'false'}&limit=${limit}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    return { ok: true, ...data }
  } catch (e) {
    return { ok: false, error: e.message?.slice(0, 80) }
  }
}

/** J：搜尋結果 5 分鐘快取 */
const searchCache = new Map()
const SEARCH_CACHE_TTL = 5 * 60 * 1000

async function webSearchCached(query, maxResults = 5) {
  const key = query.toLowerCase().trim()
  const hit = searchCache.get(key)
  if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL) return hit.data
  const data = await webSearch(query, maxResults)
  searchCache.set(key, { ts: Date.now(), data })
  if (searchCache.size > 100) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0]
    if (oldest) searchCache.delete(oldest)
  }
  return data
}

function enqueueTask(type, payload) {
  const dedup = logExternalAction('task_enqueue', {
    key: `${type}:${payload?.source ?? ''}:${String(payload?.prompt ?? payload?.cmd ?? '').slice(0, 80)}`,
    task_type: type,
  })
  if (dedup.duplicate) {
    return { id: dedup.id, status: 'duplicate', poll: null, duplicate: true }
  }
  const id = randomUUID()
  logExternalAction('task_created', { key: id, task_id: id, task_type: type })
  store.addTask({ id, type, payload, status: 'queued', createdAt: Date.now() })
  return { id, status: 'queued', poll: `/tasks/${id}` }
}

function buildOrchestrateDeps() {
  return {
    ragQuery,
    ragRememberSmart,
    ragCurate,
    webSearchCached,
    detectAgentsLLM,
    callOpenRouter,
    listWorkers: () => store.listAgents(),
    enqueueTask,
    defaultCursorCwd: process.env.CURSOR_AGENT_CWD || null,
    AGENT_SYSTEMS,
    AGENTS_META,
    AGENTS_CONFIG,
    CHAT_DEFAULT_MODEL,
    CHAT_FALLBACK_CHAIN,
    RESEARCH_KWS,
    ROUTING_TRIGGERS,
    extractCodeBlock,
    MENGYI_BRIEF,
  }
}

/** 從 Agent 回覆中提取第一個 code block（若有），用於 Cursor dispatch */
function extractCodeBlock(text) {
  const m = text.match(/```[\w]*\n?([\s\S]*?)```/)
  return m ? m[1].trim() : null
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'
const OPENROUTER_KEY = process.env.OPENAI_API_KEY || ''
const CHAT_DEFAULT_MODEL = process.env.ONEAI_CHAT_MODEL || 'google/gemini-2.5-flash'

// Fallback 順序：主模型失敗時依序嘗試，確保回應不中斷
const CHAT_FALLBACK_CHAIN = (process.env.ONEAI_CHAT_FALLBACK || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .concat([
    'google/gemini-2.5-flash',
    'google/gemini-3.5-flash',
    'openai/gpt-4.1-mini',
    'meta-llama/llama-3.3-70b-instruct:free',
  ])

// ── 網路搜尋（Researcher Agent 用）──────────────────────────────────────────
const TAVILY_KEY  = process.env.TAVILY_API_KEY || ''
const SERPAPI_KEY = process.env.SERPAPI_KEY || ''

/** @returns {{ snippets: string[], sources: { title: string, url: string }[], provider: string }} */
async function webSearch(query, maxResults = 5) {
  const empty = { snippets: [], sources: [], provider: 'none' }
  // 優先 Tavily（最佳品質），其次 SerpAPI，最後 DuckDuckGo HTML 刮取（免費備援）
  if (TAVILY_KEY) {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: maxResults, search_depth: 'basic' }),
        signal: AbortSignal.timeout(8000),
      })
      if (r.ok) {
        const d = await r.json()
        const rows = (d.results ?? []).slice(0, maxResults)
        return {
          provider: 'tavily',
          sources: rows.map(x => ({ title: x.title ?? '搜尋結果', url: x.url ?? '' })).filter(s => s.url),
          snippets: rows.map(x => `[${x.title}](${x.url})\n${x.content ?? x.snippet ?? ''}`),
        }
      }
    } catch { /* fallthrough */ }
  }
  if (SERPAPI_KEY) {
    try {
      const url = `https://serpapi.com/search?q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=${maxResults}`
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (r.ok) {
        const d = await r.json()
        const rows = (d.organic_results ?? []).slice(0, maxResults)
        return {
          provider: 'serpapi',
          sources: rows.map(x => ({ title: x.title ?? '搜尋結果', url: x.link ?? '' })).filter(s => s.url),
          snippets: rows.map(x => `[${x.title}](${x.link})\n${x.snippet ?? ''}`),
        }
      }
    } catch { /* fallthrough */ }
  }
  // DuckDuckGo HTML fallback（免費，但可能被封鎖）
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
    if (r.ok) {
      const html = await r.text()
      const snippets = [...html.matchAll(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
        .slice(0, maxResults).map(m => m[1].replace(/<[^>]+>/g, '').trim())
      const titles = [...html.matchAll(/<a class="result__a"[^>]*>([\s\S]*?)<\/a>/g)]
        .slice(0, maxResults).map(m => m[1].replace(/<[^>]+>/g, '').trim())
      return {
        provider: 'duckduckgo',
        sources: [],
        snippets: snippets.map((s, i) => `${titles[i] ?? '搜尋結果'}\n${s}`),
      }
    }
  } catch { /* fallthrough */ }
  return {
    ...empty,
    snippets: ['[搜尋失敗] 請設定 TAVILY_API_KEY 環境變數以啟用可靠的網路搜尋'],
  }
}

/**
 * 使用 LLM 智慧路由：讓梅蘭（COO）決定要調用哪些子 Agent。
 * 若 LLM 呼叫失敗，自動退回關鍵字比對。
 */
async function detectAgentsLLM(userMsg, memoryBlock) {
  const routingPrompt = `${MENGYI_BRIEF}${memoryBlock}
你是梅蘭，孟一的營運長（COO）。孟一剛說了一句話，你需要決定要調用哪些專家 Agent 來協助回覆。

可用的 Agent（只選真正需要的）：
- researcher：搜尋網路最新資訊、市場資料、新聞、競品分析、**天氣/匯率/股價等即時資料**（有即時搜尋能力）
- engineer：程式開發、技術問題、系統架構、debug、部署
- pm：商業策略、產品規劃、市場分析、OKR、簡報
- coach：人生哲學、平衡、目標設定、個人成長、情緒支持（你自己的專長）
- analyst：數據分析、報告、比較評估、風險分析
- butler：查詢記憶、整理過去說過的事、大腦狀態
- code_reviewer：程式碼審查、重構建議
- security_auditor：資安檢查、漏洞掃描

規則：
1. 只選 1-3 個最相關的 agent
2. 若只是一般問候或閒聊，返回空陣列（你自己回答）
3. 天氣、匯率、股價、即時新聞、或需要今天/明天最新外部資料 → 必須包含 researcher
4. 返回純 JSON 陣列，不加任何說明，例如：["engineer"] 或 ["researcher"]

孟一說：「${userMsg}」

返回 JSON：`

  try {
    const r = await callOpenRouter('google/gemini-2.5-flash', [
      { role: 'user', content: routingPrompt }
    ])
    const raw = r.reply.trim().replace(/```json?|```/g, '').trim()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return detectAgentsFallback(userMsg)
    const valid = parsed.filter(id => AVAILABLE_AGENTS.includes(id))
    return valid.length > 0 ? valid : []  // 空陣列 = 梅蘭直接回答
  } catch {
    return detectAgentsFallback(userMsg)
  }
}

async function callOpenRouter(model, finalMessages) {
  const upstream = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://oneai-mengyi.zeabur.app',
      'X-Title': 'OneAI Personal Assistant',
    },
    body: JSON.stringify({ model, messages: finalMessages, stream: false, max_tokens: 1024 }),
  })
  const data = await upstream.json()
  if (!upstream.ok) throw new Error(data.error?.message ?? `HTTP ${upstream.status}`)
  const reply = data.choices?.[0]?.message?.content
  if (!reply) throw new Error('空回覆')
  return { reply, model: data.model ?? model }
}

app.post('/chat', requireChatToken, chatRateLimit, async (req, res) => {
  res.set('Deprecation', 'true')
  res.set('Link', '</chat/orchestrate>; rel="successor-version"')
  console.warn('[chat] DEPRECATED: use POST /chat/orchestrate')
  const { messages, model, system } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 陣列為必填' })
  }
  // 長度防護：避免過長內容炸爆 token 用量
  const lastContent = messages[messages.length - 1]?.content ?? ''
  if (typeof lastContent === 'string' && lastContent.length > MAX_MSG_LENGTH) {
    return res.status(400).json({ error: `訊息過長，上限 ${MAX_MSG_LENGTH} 字元` })
  }
  if (!OPENROUTER_KEY) return res.status(503).json({ error: '未設定 OPENAI_API_KEY' })

  const finalMessages = system
    ? [{ role: 'system', content: system }, ...messages]
    : messages

  // 建立嘗試清單：指定模型優先，其次 fallback chain（去重）
  const primaryModel = model || CHAT_DEFAULT_MODEL
  const tryList = [primaryModel, ...CHAT_FALLBACK_CHAIN.filter(m => m !== primaryModel)]

  let lastErr = ''
  for (const m of tryList) {
    try {
      const result = await callOpenRouter(m, finalMessages)
      if (m !== primaryModel) console.log(`[chat] 主模型 ${primaryModel} 失敗，已 fallback 至 ${m}`)
      return res.json(result)
    } catch (e) {
      lastErr = e.message
      console.warn(`[chat] 模型 ${m} 失敗: ${e.message}`)
    }
  }
  // 不直接回傳 lastErr 原文（可能含 API key hint 等敏感資訊）
  res.status(502).json({ error: '上游 LLM 服務暫時不可用，請稍後再試' })
})

// ── Multi-Agent Orchestrate（單一 harness）────────────────────────────────────
async function handleOrchestrate(req, res, { stream = false } = {}) {
  const { messages } = req.body ?? {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages 陣列為必填' })
  }
  const lastContent = messages[messages.length - 1]?.content ?? ''
  if (typeof lastContent === 'string' && lastContent.length > MAX_MSG_LENGTH) {
    return res.status(400).json({ error: `訊息過長，上限 ${MAX_MSG_LENGTH} 字元` })
  }
  if (!OPENROUTER_KEY) return res.status(503).json({ error: '未設定 OPENAI_API_KEY' })

  const userMsg = messages[messages.length - 1]?.content ?? ''
  const deps = buildOrchestrateDeps()

  const emit = stream
    ? (phase, data) => {
        const label = PHASE_LABELS[phase] ?? phase
        res.write(`event: phase\ndata: ${JSON.stringify({ phase, label, ...data })}\n\n`)
      }
    : () => {}

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
  }

  try {
    const result = await runOrchestrateTurn(deps, { userMsg, messages, emit })
    if (stream) {
      res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`)
      return res.end()
    }
    return res.json(result)
  } catch (e) {
    console.error('[orchestrate]', e.message)
    if (stream) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: '上游 LLM 服務暫時不可用' })}\n\n`)
      return res.end()
    }
    return res.status(502).json({ error: '上游 LLM 服務暫時不可用，請稍後再試' })
  }
}

app.post('/chat/orchestrate', requireChatToken, chatRateLimit, (req, res) => handleOrchestrate(req, res))
app.post('/chat/orchestrate/stream', requireChatToken, chatRateLimit, (req, res) => handleOrchestrate(req, res, { stream: true }))

// ── 晨報 heartbeat（OpenClaw 借鏡）──────────────────────────────────────────
app.post('/cron/morning-digest', requireServiceToken, (_req, res) => {
  const id = randomUUID()
  store.addTask({
    id,
    type: 'agent',
    payload: {
      prompt: '【OneAI 晨報】摘要記憶庫、worker 狀態、今日 3 個優先行動。繁體中文。',
      source: 'morning-digest',
    },
    status: 'queued',
    createdAt: Date.now(),
  })
  res.json({ ok: true, task_id: id })
})

// ── Agent 狀態心跳(Multi-Agent 面板用)──────────────────────────────────────
// worker 每 30s POST /agents/heartbeat(需 worker token,最小權限);
// PWA GET /agents/status 取得全部 agent 列表(公開,無需 token)。
app.post('/agents/heartbeat', requireWorkerToken, (req, res) => {
  const { agent_id, display, org, status, current_task, workspace_cwd } = req.body ?? {}
  if (!agent_id) return res.status(400).json({ error: '缺少 agent_id' })
  store.upsertAgent({
    agent_id, display, org,
    status: status || 'idle',
    current_task: current_task || null,
    workspace_cwd: workspace_cwd || null,
    last_seen: Date.now(),
  })
  res.json({ ok: true })
})

app.get('/agents/status', (_req, res) => {
  res.json(store.listAgents())
})

// ── 數位大腦 API（管家用）───────────────────────────────────────────────────
// GET  /brain/graph?limit=120           知識圖譜 nodes+links（需 chat token）
// GET  /brain/memories?q=...&limit=20  查詢記憶庫（需 chat token）
// POST /brain/remember                 手動寫入記憶（需 chat token）
// GET  /brain/summary                  取得大腦統計摘要（公開）

app.get('/brain/graph', requireChatToken, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 120), 200)
  try {
    const RAG_HOST = getRagBaseUrl()
    const r = await fetch(`${RAG_HOST}/catalog?limit=${limit}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return res.status(502).json({ error: 'RAG catalog 失敗' })
    const data = await r.json()
    const graph = buildMemoryGraph(data.items ?? [])
    res.json({ ...graph, total_in_db: data.total ?? 0, shown: data.shown ?? graph.nodes.length })
  } catch (e) {
    res.status(502).json({ error: 'RAG 連線失敗', detail: e.message?.slice(0, 80) })
  }
})

app.post('/brain/curate', requireChatToken, async (req, res) => {
  const dryRun = req.body?.apply !== true && req.query?.apply !== 'true'
  const limit = Math.min(Number(req.body?.limit ?? req.query?.limit ?? 500), 2000)
  const result = await ragCurate(dryRun, limit)
  if (!result.ok) return res.status(502).json({ error: 'RAG curate 失敗', detail: result.error })
  res.json(result)
})

app.get('/brain/memories', requireChatToken, async (req, res) => {
  const q = String(req.query.q ?? '孟一').slice(0, 200)
  const limit = Math.min(Number(req.query.limit ?? 20), 50)
  try {
    const RAG_HOST = getRagBaseUrl()
    if (!process.env.RAG_SVC_HOST && !process.env.RAG_SVC_URL) {
      try {
        await fetch(`${RAG_HOST}/health`, { signal: AbortSignal.timeout(1500) })
      } catch {
        return res.json({ memories: [], note: 'RAG 服務未部署' })
      }
    }
    const r = await fetch(`${RAG_HOST}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, top_k: limit }),
    })
    if (!r.ok) return res.status(502).json({ error: 'RAG 查詢失敗' })
    const data = await r.json()
    const memories = (data.results ?? []).map((m, i) => ({
      id: m.id ?? `mem-${i}`,
      text: m.text ?? m.content ?? '',
      score: m.score ?? 0,
      created_at: m.metadata?.created_at ?? null,
    }))
    res.json({ memories, total: memories.length, query: q })
  } catch (e) {
    res.status(502).json({ error: 'RAG 連線失敗', detail: e.message?.slice(0, 80) })
  }
})

app.post('/brain/remember', requireChatToken, async (req, res) => {
  const text = String(req.body?.text ?? '').trim()
  if (!text || text.length < 5) return res.status(400).json({ error: '記憶內容太短（至少 5 字）' })
  if (text.length > 2000) return res.status(400).json({ error: '記憶內容過長（最多 2000 字）' })
  const kind = String(req.body?.kind ?? 'memory')
  const allowed = ['memory', 'preference', 'reflection', 'sop', 'system']
  if (!allowed.includes(kind)) return res.status(400).json({ error: `kind 須為 ${allowed.join('|')}` })
  const docId = `manual-${Date.now()}`
  await ragRemember(text, docId, kind)
  res.json({ ok: true, doc_id: docId, kind, text: text.slice(0, 100) })
})

app.get('/brain/summary', async (_req, res) => {
  const RAG_HOST = getRagBaseUrl()
  if (!process.env.RAG_SVC_HOST && !process.env.RAG_SVC_URL) {
    try {
      const probe = await fetch(`${RAG_HOST}/health`, { signal: AbortSignal.timeout(1500) })
      if (!probe.ok) throw new Error('unreachable')
    } catch {
      return res.json({
        status: 'not_deployed', total_memories: 0,
        summary: 'RAG 記憶庫尚未部署，開啟後孟一將能持久記住你的偏好與脈絡。',
        note: 'RAG 服務未部署',
      })
    }
  }
  try {
    const r = await fetch(`${RAG_HOST}/stats`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const stats = await r.json()
      const total = stats.total ?? stats.doc_count ?? 0
      const kinds = stats.by_kind ?? {}
      const kindHint = Object.keys(kinds).length
        ? `（preference ${kinds.preference ?? 0} · system ${kinds.system ?? 0} · memory ${kinds.memory ?? 0}）`
        : ''
      return res.json({
        status: 'ok',
        total_memories: total,
        by_kind: kinds,
        summary: `記憶庫運行正常，共 ${total} 個索引片段${kindHint}。`,
        rag_host: RAG_HOST.split(':')[1],
      })
    }
  } catch { /* fallback health */ }
  try {
    const r = await fetch(`${RAG_HOST}/health`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return res.json({ status: 'error', total_memories: 0, summary: '記憶庫暫時離線', note: 'RAG health check failed' })
    const health = await r.json()
    let total = health.doc_count ?? health.total ?? 0
    if (total === 0) {
      try {
        const probe = await fetch(`${RAG_HOST}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '孟一', top_k: 1 }),
          signal: AbortSignal.timeout(3000),
        })
        if (probe.ok) {
          const pdata = await probe.json()
          const hits = (pdata.results ?? []).length
          if (hits > 0) total = Math.max(total, hits)
        }
      } catch { /* ignore */ }
    }
    res.json({
      status: 'ok', total_memories: total,
      summary: `記憶庫運行正常，已儲存 ${total} 則記憶。`,
      rag_host: RAG_HOST.split(':')[1]
    })
  } catch {
    res.json({ status: 'offline', total_memories: 0, summary: '記憶庫連線逾時', note: 'RAG timeout' })
  }
})

// ── 系統總覽 (System Status) ─────────────────────────────────────────────────
// 聚合所有服務連線健康與 agent 心跳，PWA / 桌機 StatusDashboard 用。
// 公開端點，無需 token（不含敏感資料）。
app.get('/system/status', async (_req, res) => {
  const RAG_HOST = getRagBaseUrl()

  const ping = async (url, timeoutMs = 3000) => {
    const t = Date.now()
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      return { status: r.ok ? 'ok' : 'error', latency_ms: Date.now() - t }
    } catch (e) {
      return { status: 'offline', latency_ms: Date.now() - t, detail: e.message?.slice(0, 60) }
    }
  }

  const ragResult = await ping(`${RAG_HOST}/health`)

  const services = {
    approval_svc: { status: 'ok', latency_ms: 0 },
    openrouter:   { status: OPENROUTER_KEY ? 'configured' : 'missing_key' },
    rag_svc:      ragResult,
  }

  res.json({ ts: Date.now(), services, agents: store.listAgents() })
})

app.listen(PORT, () => {
  console.log(`[approval] 審核服務 listening on :${PORT}`)
  setTimeout(() => seedSystemMemoryIfNeeded(ragRememberSmart), 3000)
})

// ── 主動監控：worker 離線超過 5 分鐘自動推播 ──────────────────────────────────
const WORKER_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000   // 5 分鐘
const MONITOR_INTERVAL_MS         = 2 * 60 * 1000   // 每 2 分鐘檢查
const offlineNotified = new Set() // 避免重複推播同一 agent

setInterval(async () => {
  const now = Date.now()
  const agents = store.listAgents()
  for (const ag of agents) {
    const offlineMs = now - (ag.last_seen ?? 0)
    if (offlineMs > WORKER_OFFLINE_THRESHOLD_MS) {
      if (!offlineNotified.has(ag.agent_id)) {
        offlineNotified.add(ag.agent_id)
        const title = `⚠ Worker 離線：${ag.display ?? ag.agent_id}`
        const body  = `已離線 ${Math.round(offlineMs / 60000)} 分鐘，上次回報：${new Date(ag.last_seen ?? 0).toLocaleTimeString('zh-TW')}`
        console.warn(`[monitor] ${title} - ${body}`)
        try { await notify(title, body) } catch { /* ignore ntfy failure */ }
      }
    } else {
      // worker 恢復上線，重置通知狀態
      offlineNotified.delete(ag.agent_id)
    }
  }
}, MONITOR_INTERVAL_MS)
