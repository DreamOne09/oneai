import express from 'express'
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { store } from './store.js'
import { publishApproval, notify } from './ntfy.js'
import { sendPush } from './push.js'

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
const VALID_TASK_TYPES = ['shell', 'agent', 'cursor_agent'] // cursor_agent 由 cursor_worker.py 處理
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

// ── 本機肉體任務佇列(反向輪詢)────────────────────────────────────────
// 雲端 mcp-core 入列 → 本機 worker 長輪詢認領 → worker 跑 executor.py(內含審核護欄)→ 回報。
// 審核不在此處做;由本機 executor 在執行時觸發(送手機),故此佇列僅為傳輸層。

// 雲端派發任務(agent/mcp-core 呼叫,需 service token)
app.post('/tasks', requireServiceToken, (req, res) => {
  const { type, payload } = req.body ?? {}
  if (!VALID_TASK_TYPES.includes(type) || !payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'type 無效或缺 payload', valid: VALID_TASK_TYPES })
  }
  const id = randomUUID()
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
app.post('/tasks/:id/result', requireWorkerToken, (req, res) => {
  const ok = store.setTaskResult(req.params.id, req.body ?? {})
  if (!ok) return res.status(404).json({ error: '未知 task id' })
  res.json({ ok: true })
})

// 雲端輪詢任務結果(需 service token);須定義在 `/tasks/next` 之後,避免 `:id` 吃掉 next。
app.get('/tasks/:id', requireServiceToken, (req, res) => {
  const t = store.getTask(req.params.id)
  if (!t) return res.status(404).json({ error: '未知 task id' })
  res.json({ id: t.id, status: t.status, result: t.result ?? null })
})

// ── 聊天代理(Chat Proxy)────────────────────────────────────────────────────
// PWA 直接呼叫此端點;API key 留在伺服器端,不暴露給前端 bundle。
// 認證:Bearer APPROVAL_TOKEN(與 service token 共用;個人工具可接受)。

// ── RAG 長期記憶（Soul L3）────────────────────────────────────────────────
const RAG_BASE = process.env.RAG_SVC_HOST
  ? `http://${process.env.RAG_SVC_HOST}:8080`
  : 'http://rag-svc.zeabur.internal:8080'

/** 查詢 RAG 最相關的記憶片段，超時或失敗靜默回空 */
async function ragQuery(text, topK = 3) {
  try {
    const res = await fetch(`${RAG_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, top_k: topK, max_chars: 800 }),
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  } catch { return [] }
}

/** 非同步存入記憶，失敗不阻塞主流程 */
function ragRemember(text, title) {
  fetch(`${RAG_BASE}/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, title, kind: 'memory', tags: ['oneai-chat'] }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
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

// ── 載入 agents 設定（SSOT）──────────────────────────────────────────────────
function loadAgentsConfig() {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    // 路徑：services/approval/src/ → 往上 3 層到 repo 根 → config/
    const configPath = join(__dir, '..', '..', '..', 'config', 'oneai.agents.json')
    return JSON.parse(readFileSync(configPath, 'utf-8'))
  } catch {
    return { context: {}, agents: {}, orgs: {} }
  }
}
const AGENTS_CONFIG = loadAgentsConfig()
const MENGYI_CONTEXT = AGENTS_CONFIG.context ?? {}

// 李孟一個人背景摘要（注入所有 agent system prompt 的 header）
// 包含：核心哲學、三大支柱身份隔離規則、管理模型、Meilan 人格
const trinity = MENGYI_CONTEXT.trinity ?? {}
const meilan  = MENGYI_CONTEXT.meilan_persona ?? {}
const MENGYI_BRIEF = `【用戶背景：李孟一 (Meng-Yi Li)】
核心哲學：${MENGYI_CONTEXT.core_philosophy ?? '全方位平衡 (Holistic Balance)'}
使命：${MENGYI_CONTEXT.mission ?? '以效率換取自由，利他'}
願景：${MENGYI_CONTEXT.vision ?? '坐在山上看夕陽，擁有時間幫助他人'}

【三大支柱 Trinity — 嚴格隔離，禁止跨品牌洩漏】
① 個人核心 (Identity)   one@dreamcube.tw — ${trinity.identity?.focus ?? '主導戰略與行程'}
② 夢想一號 (DreamOne)  hi@dreamcube.tw  — ${trinity.dreamone?.focus ?? '賦能、教育、營運'}
③ 琢奧科技 (DropOut)   info@dropout.tw  — ${trinity.dropout?.focus ?? '技術自動化與產品開發'}

【思維模型】${(MENGYI_CONTEXT.thinking_models ?? []).join(' | ')}

【管理模型】${(MENGYI_CONTEXT.management_models ?? ['多贏原則', '木桶理論', '破窗效應', '峰終定律', '突破框架']).join('・')}

【核心原則】${(MENGYI_CONTEXT.values ?? []).join('；')}

【你的身份：${meilan.name ?? 'เหมยหลาน (Meilan)'}】
性格：${meilan.character ?? '嚴格、批判、絕對忠誠'}
隔離守則：${meilan.isolation_rule ?? '嚴格區分三種身份的數據與權限，禁止跨品牌資訊洩漏'}
互動風格：${MENGYI_CONTEXT.interaction_style ?? '冷靜直率，繁體中文，偶爾泰式冷幽默'}
`

// 各子 Agent 的 metadata + system prompt（同步自 config/oneai.agents.json，硬編避免容器讀檔問題）
const AGENTS_META = {
  assistant:        { icon: '🧠', display: 'OneAI' },
  butler:           { icon: '🫀', display: '管家' },
  researcher:       { icon: '🌐', display: '研究員' },
  engineer:         { icon: '💻', display: '工程師' },
  pm:               { icon: '📊', display: 'PM' },
  coach:            { icon: '🧘', display: '教練' },
  analyst:          { icon: '🔍', display: '分析師' },
  code_reviewer:    { icon: '🔎', display: 'Code Review' },
  security_auditor: { icon: '🛡️', display: '資安審查' },
}

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

const AGENT_SYSTEMS = {
  // ── 管家 (數位大腦管理者) ──────────────────────────────────────────────────
  butler: `${MENGYI_BRIEF}
你是孟一的數位管家，負責管理他的數位大腦（記憶庫）。
你是唯一知道孟一記憶庫裡有什麼的人，也是他的「數位腦總管」。
核心職責：
- 主動整理記憶庫，摘要什麼已被記住、哪些可能過時
- 在對話時提醒孟一他曾說過或記錄過的相關內容
- 提供記憶庫的健康狀態報告（有多少條記憶、最近的主題是什麼）
- 判斷目前的對話是否值得寫入長期記憶，並告知孟一
- 若孟一詢問「你還記得什麼」「腦中有什麼」「你知道我什麼」，立即調取記憶摘要
原則：
- 透明：永遠告訴孟一你在記憶庫裡找到什麼
- 謹慎：只在真正有價值時才建議寫入長期記憶，避免雜訊
- 結構化：整理記憶時以三大支柱（Identity/DreamOne/DropOut）分類`,

  // ── 工程師 (DropOut 技術體系) ──────────────────────────────────────────────
  engineer: `${MENGYI_BRIEF}
你是孟一的資深工程師夥伴，主要服務 DropOut（info@dropout.tw）技術體系。
守則：
- 優先給出可直接執行的程式碼或指令，簡短解釋關鍵決策
- 遵循 KISS、DRY、SRP 原則；程式碼必須有錯誤處理，不過度工程化
- 破窗效應：看到任何細節問題立即指出，不容許小漏洞累積
- 若涉及 Identity/DreamOne/DropOut 三個品牌，明確標注是哪個體系的程式碼，絕不混用`,

  // ── PM（三大支柱產品策略）────────────────────────────────────────────────
  pm: `${MENGYI_BRIEF}
你是孟一的產品策略夥伴，服務三大支柱的商業決策。
守則：
- 以第一性原理思考，用 5-Why 追溯問題根因，拒絕表面答案
- 決策時套用三爽原則（學員滿意・講師順心・職員無痛）+ 多贏原則
- 木桶理論：找出三個支柱中最薄弱的環節優先補強
- 峰終定律：聚焦用戶最高點體驗與最終印象
- 輸出聚焦可落地行動方案，明確標注影響哪個品牌（Identity/DreamOne/DropOut）
- 嚴格品牌隔離：三個體系的資源與決策不得互相干擾`,

  // ── 教練 Meilan（絕對忠誠・嚴格批判）────────────────────────────────────
  coach: `${MENGYI_BRIEF}
你是孟一的超級助理 เหมยหลาน (Meilan)，性格嚴格、批判、絕對忠誠。
核心守則：
- 核心使命：確保孟一不偏離「全方位平衡 (Holistic Balance)」的人生哲學
- 批判性忠誠：如果孟一做出低效、偏離目標或破壞三大支柱平衡的決定，立即嚴厲糾正，出發點是絕對的利他忠誠
- 0.1% 經理人思維：極致效率，任何決策都要問「這是最優解嗎？」
- 三大支柱守護：若某個支柱（Identity/DreamOne/DropOut）被忽視或資源不平衡，主動提醒
- 突破框架：挑戰孟一的既有假設，提供他可能沒想到的角度
- 口吻：冷靜直率，高信號，偶爾帶泰式冷幽默（สวัสดี），不說廢話`,

  // ── 分析師 ──────────────────────────────────────────────────────────────
  analyst: `${MENGYI_BRIEF}
你是孟一的數據分析師，服務三大支柱的決策支援。
守則：
- 提供有數字根據的分析，用表格或清單整理資訊
- 在得出結論前先列出假設和限制條件，避免主觀判斷
- 跨支柱分析時，明確區分 Identity / DreamOne / DropOut 各自的數據
- 套用峰終定律和木桶理論來解讀數據趨勢`,

  // ── Code Review ─────────────────────────────────────────────────────────
  code_reviewer: `${MENGYI_BRIEF}
你是孟一的資深 Code Review 專家（服務 DropOut 技術體系）。
審查重點（套用破窗效應，零容忍細節漏洞）：
1. 可讀性與命名清晰度
2. 函式單一職責（SRP）與模組化程度
3. 錯誤處理完整性（特別是 async/await 路徑）
4. 重複程式碼（DRY 違反）
5. 效能陷阱（N+1 查詢、無必要的 await、記憶體洩漏）
6. 測試覆蓋缺口
7. 三大支柱資料隔離：程式碼是否可能洩漏跨品牌資料
輸出格式：嚴重性分級（🔴 Critical / 🟡 Warning / 🔵 Suggestion），每條附具體行號與改進建議。`,

  // ── 研究員（上網搜尋） ────────────────────────────────────────────────────
  researcher: `${MENGYI_BRIEF}
你是孟一的研究員，負責搜尋最新資訊、市場資料、技術文章、競品資訊。
你已獲得搜尋結果作為工作材料，請基於這些結果給出有依據的分析，並標注資料來源。
若搜尋結果不足，誠實說明並建議替代查詢方向。
輸出風格：簡潔、有數據、繁體中文。`,

  // ── 資安審查 ────────────────────────────────────────────────────────────
  security_auditor: `${MENGYI_BRIEF}
你是孟一的資安審查專家（OWASP Top 10 + SANS 25），服務三大支柱的安全邊界。
審查重點：
1. 注入攻擊（SQL/Command/Prompt injection）
2. 認證與授權（token 暴露、權限提升）
3. 敏感資料曝光（API key 硬編碼、日誌洩漏、error message 揭露）
4. 跨品牌資料洩漏風險（Identity/DreamOne/DropOut 隔離是否完整）
5. CORS / CSP 設定不當
6. 速率限制缺失
7. 輸入驗證與輸出跳脫（XSS、path traversal）
8. 依賴套件已知漏洞（CVE）
輸出格式：風險等級（🔴 High / 🟡 Medium / 🟢 Low），每條附 CWE 編號（若適用）與修復方向。`,
}

// 關鍵字路由（若未能從 agents.json 讀到）
const DEFAULT_ROUTING = {
  butler:           ['記憶', '記得', '你知道我', '腦中', '管家', '整理記憶', '知識庫', '你記得', '你學到', '你知道什麼', '備忘', '我說過', '之前提到', '數位大腦', '大腦狀態'],
  researcher:       ['搜尋', '查一下', '最新', '新聞', '市場研究', '找資料', '調查', '競品', '幫我看', '上網', '查查', 'search', '參考資料', '有沒有'],
  engineer:         ['程式', 'code', 'bug', '部署', 'deploy', '架構', 'api', '資料庫', 'docker', 'git', 'terminal', 'script', '修', '錯誤', 'dropout', '琢奧'],
  pm:               ['策略', '產品', '商業', 'okr', '路線圖', '競爭', '用戶', '定價', '市場', '提案', '簡報', '客戶', 'dreamone', '夢想一號', '木桶', '峰終', '三爽'],
  coach:            ['平衡', '時間', '壓力', '目標', '決定', '選擇', '累了', '迷失', '意義', '方向', '放棄', '值不值得', '人生', '三大支柱', 'meilan', '梅蘭', 'holistic', '多贏'],
  analyst:          ['分析', '數據', '報告', '比較', '統計', '趨勢', '評估', '風險', '調查', '木桶理論'],
  code_reviewer:    ['code review', 'review', '審查程式', '看程式', '程式碼審查', '重構建議', 'refactor'],
  security_auditor: ['資安', 'security', '漏洞', 'vulnerability', 'xss', 'injection', 'cve', '資訊安全', '安全檢查', '安全審查', 'owasp', '隔離', '跨品牌'],
}

function needsWebSearch(text) {
  const t = text.toLowerCase()
  const kws = AGENTS_CONFIG.agents?.orchestrator?.routing_triggers?.researcher ?? DEFAULT_ROUTING.researcher
  return kws.some(kw => t.includes(kw.toLowerCase()))
}

function mergeAgentRoute(llmIds, userMsg) {
  const ids = [...llmIds]
  if (needsWebSearch(userMsg) && !ids.includes('researcher')) ids.unshift('researcher')
  return [...new Set(ids)].slice(0, 3)
}

function memoryToText(m) {
  if (typeof m === 'string') return m
  if (m && typeof m === 'object') return m.text ?? m.content ?? m.snippet ?? JSON.stringify(m)
  return String(m ?? '')
}

function buildBrainMeta(memories) {
  return {
    memories_used: memories.length,
    memory_preview: memories.slice(0, 2).map(m => memoryToText(m).slice(0, 100)),
    remembered: true,
  }
}

/**
 * 以關鍵字做快速路由（備用，當 LLM 路由失敗時使用）。
 */
function detectAgentsFallback(text) {
  const t = text.toLowerCase()
  const routing = AGENTS_CONFIG.agents?.orchestrator?.routing_triggers ?? DEFAULT_ROUTING
  const matched = []
  for (const [agentId, keywords] of Object.entries(routing)) {
    if (keywords.some(kw => t.includes(kw.toLowerCase()))) matched.push(agentId)
  }
  return matched.length ? matched : ['assistant']
}

const AVAILABLE_AGENTS = Object.keys(AGENTS_META).filter(id => id !== 'assistant')

/**
 * 使用 LLM 智慧路由：讓梅蘭（COO）決定要調用哪些子 Agent。
 * 若 LLM 呼叫失敗，自動退回關鍵字比對。
 */
async function detectAgentsLLM(userMsg, memoryBlock) {
  const routingPrompt = `${MENGYI_BRIEF}${memoryBlock}
你是梅蘭，孟一的營運長（COO）。孟一剛說了一句話，你需要決定要調用哪些專家 Agent 來協助回覆。

可用的 Agent（只選真正需要的）：
- researcher：搜尋網路最新資訊、市場資料、新聞、競品分析（有即時搜尋能力）
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
3. 返回純 JSON 陣列，不加任何說明，例如：["engineer"] 或 ["pm","analyst"]

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

// ── Multi-Agent Orchestrate ────────────────────────────────────────────────
// PWA 呼叫此端點觸發多 Agent 協作；Orchestrator 決定路由，子 Agent 並行回覆，最終合成。
// Body: { messages, system? }
// Response: { reply, model, agents: [{ id, icon, display, reply, model }] }
// ── Multi-Agent Orchestrate（含長期記憶迴圈）──────────────────────────────
// 流程：① 查 RAG 記憶 → ② 注入上下文 → ③ 路由子 Agent 並行 → ④ 合成 → ⑤ 存回記憶
// Body: { messages }
// Response: { reply, model, agents, memories_used, can_execute?, execute_code? }
// ── Multi-Agent Orchestrate（梅蘭 COO 主導）────────────────────────────────
// 架構：執行長（孟一）→ 梅蘭 COO（主人格，接待、決策、合成）→ 專家子 Agent
// 流程：① RAG 記憶查詢 ② 梅蘭 LLM 路由決策 ③ 子 Agent 並行 ④ 梅蘭合成 ⑤ 存記憶
app.post('/chat/orchestrate', requireChatToken, chatRateLimit, async (req, res) => {
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

  // ① RAG 記憶查詢（與路由決策並行）
  const memories = await ragQuery(userMsg, 4)
  const memoryBlock = memories.length > 0
    ? `\n\n【孟一的長期記憶（累積自歷次對話）】\n${memories.map((m, i) => `${i + 1}. ${memoryToText(m)}`).join('\n')}\n`
    : ''

  // ② 梅蘭作為 COO 決定要調用哪些子 Agent（LLM 路由 + 搜尋關鍵字保底）
  const agentIds = mergeAgentRoute(await detectAgentsLLM(userMsg, memoryBlock), userMsg)
  console.log(`[orchestrate] 梅蘭路由決策: [${agentIds.join(', ') || '直接回答'}] | 記憶: ${memories.length} 條`)

  // ③ 若梅蘭決定直接回答（無子 Agent），由梅蘭 COO 本人回覆
  if (agentIds.length === 0) {
    const meilanSystem = AGENT_SYSTEMS.coach + memoryBlock  // coach = 梅蘭 COO 人格
    const meilanMsgs = [{ role: 'system', content: meilanSystem }, ...messages]
    try {
      const r = await callOpenRouter(CHAT_DEFAULT_MODEL, meilanMsgs)
      ragRemember(`[梅蘭直答 ${new Date().toISOString().slice(0, 10)}]\n問：${userMsg}\n答：${r.reply.slice(0, 600)}`, `meilan-${Date.now()}`)
      return res.json({
        reply: r.reply,
        model: r.model,
        agents: [{ id: 'coach', icon: '🧘', display: '梅蘭', reply: r.reply, model: r.model }],
        memories_used: memories.length,
        brain: buildBrainMeta(memories),
      })
    } catch (e) {
      return res.status(502).json({ error: '上游 LLM 服務暫時不可用，請稍後再試' })
    }
  }

  // ④ 若 researcher 被調用，先執行網路搜尋
  let searchResults = ''
  let webSearchMeta = null
  if (agentIds.includes('researcher')) {
    const search = await webSearch(userMsg, 5)
    webSearchMeta = {
      query: userMsg.slice(0, 120),
      provider: search.provider,
      sources: search.sources,
      result_count: search.snippets.length,
    }
    searchResults = `\n\n【網路搜尋結果（關鍵字：${userMsg.slice(0, 60)}）】\n${search.snippets.join('\n\n')}\n`
    console.log(`[orchestrate] 研究員網路搜尋完成（${search.provider}），取得 ${search.snippets.length} 筆結果`)
  }

  // ⑤ 子 Agent 並行呼叫（system prompt 含記憶）
  const subResults = await Promise.allSettled(
    agentIds.map(async (id) => {
      const agentCfg = AGENTS_CONFIG.agents?.[id] ?? {}
      const meta = AGENTS_META[id] ?? { icon: '🤖', display: id }
      const baseSystem = AGENT_SYSTEMS[id] ?? `${MENGYI_BRIEF}\n你是孟一的 AI 助理，用繁體中文簡潔回覆。`
      // researcher 額外注入搜尋結果
      const agentSystem = baseSystem + memoryBlock + (id === 'researcher' ? searchResults : '')
      const agentModel = agentCfg.model ?? CHAT_DEFAULT_MODEL
      const finalMsgs = [{ role: 'system', content: agentSystem }, ...messages]
      const tryList = [agentModel, ...CHAT_FALLBACK_CHAIN.filter(m => m !== agentModel)]

      let lastErr = ''
      for (const m of tryList) {
        try {
          const r = await callOpenRouter(m, finalMsgs)
          return { id, icon: meta.icon, display: meta.display, reply: r.reply, model: r.model }
        } catch (e) {
          lastErr = e.message
        }
      }
      throw new Error(`[${id}] 所有模型失敗: ${lastErr}`)
    })
  )

  const succeeded = subResults
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)

  if (succeeded.length === 0) {
    return res.status(502).json({ error: '上游 LLM 服務暫時不可用，請稍後再試' })
  }

  // ⑤ 梅蘭作為 COO 合成所有子 Agent 回覆（不是無名 Orchestrator）
  let finalReply, finalModel
  if (succeeded.length === 1) {
    finalReply = succeeded[0].reply
    finalModel = succeeded[0].model
  } else {
    const synthContext = succeeded.map(a => `[${a.icon} ${a.display}]\n${a.reply}`).join('\n\n---\n\n')
    const synthSystem = `${AGENT_SYSTEMS.coach}${memoryBlock}
作為孟一的營運長，你剛剛調用了以下專家。現在用你自己的口吻（嚴格、直率、繁體中文），整合這些專家意見，提供最終建議。避免重複，只保留最關鍵的行動點。`
    const synthMsgs = [
      { role: 'system', content: synthSystem },
      { role: 'user', content: `孟一的問題：${userMsg}\n\n各專家回覆：\n${synthContext}\n\n你的最終整合：` },
    ]
    try {
      const synth = await callOpenRouter(CHAT_DEFAULT_MODEL, synthMsgs)
      finalReply = synth.reply
      finalModel = synth.model
    } catch {
      finalReply = succeeded.map(a => `**${a.icon} ${a.display}：** ${a.reply}`).join('\n\n')
      finalModel = succeeded[0].model
    }
  }

  // ⑥ 存回記憶（非同步，不阻塞）
  ragRemember(`[對話記憶 ${new Date().toISOString().slice(0, 10)}]\n問：${userMsg}\n答：${finalReply.slice(0, 600)}`, `chat-${Date.now()}`)

  // ⑦ 偵測 Engineer 程式碼
  const engineerAgent = succeeded.find(a => a.id === 'engineer')
  const codeBlock = engineerAgent ? extractCodeBlock(engineerAgent.reply) : null

  res.json({
    reply: finalReply,
    model: finalModel,
    agents: succeeded,
    memories_used: memories.length,
    brain: buildBrainMeta(memories),
    ...(webSearchMeta ? { web_search: webSearchMeta } : {}),
    ...(codeBlock ? { can_execute: true, execute_code: codeBlock } : {}),
  })
})

// ── Agent 狀態心跳(Multi-Agent 面板用)──────────────────────────────────────
// worker 每 30s POST /agents/heartbeat(需 worker token,最小權限);
// PWA GET /agents/status 取得全部 agent 列表(公開,無需 token)。
app.post('/agents/heartbeat', requireWorkerToken, (req, res) => {
  const { agent_id, display, org, status, current_task } = req.body ?? {}
  if (!agent_id) return res.status(400).json({ error: '缺少 agent_id' })
  store.upsertAgent({ agent_id, display, org, status: status || 'idle', current_task: current_task || null, last_seen: Date.now() })
  res.json({ ok: true })
})

app.get('/agents/status', (_req, res) => {
  res.json(store.listAgents())
})

// ── 數位大腦 API（管家用）───────────────────────────────────────────────────
// GET  /brain/memories?q=...&limit=20  查詢記憶庫（需 chat token）
// POST /brain/remember                 手動寫入記憶（需 chat token）
// GET  /brain/summary                  取得大腦統計摘要（公開）

app.get('/brain/memories', requireChatToken, async (req, res) => {
  const q = String(req.query.q ?? '孟一').slice(0, 200)
  const limit = Math.min(Number(req.query.limit ?? 20), 50)
  try {
    const RAG_HOST = process.env.RAG_SVC_HOST ? `http://${process.env.RAG_SVC_HOST}:8080` : null
    if (!RAG_HOST) return res.json({ memories: [], note: 'RAG 服務未部署' })
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
  const docId = `manual-${Date.now()}`
  await ragRemember(text, docId)
  res.json({ ok: true, doc_id: docId, text: text.slice(0, 100) })
})

app.get('/brain/summary', async (_req, res) => {
  const RAG_HOST = process.env.RAG_SVC_HOST ? `http://${process.env.RAG_SVC_HOST}:8080` : null
  if (!RAG_HOST) return res.json({
    status: 'not_deployed', total_memories: 0,
    summary: 'RAG 記憶庫尚未部署，開啟後孟一將能持久記住你的偏好與脈絡。',
    note: 'RAG 服務未部署'
  })
  try {
    const r = await fetch(`${RAG_HOST}/health`, { signal: AbortSignal.timeout(3000) })
    if (!r.ok) return res.json({ status: 'error', total_memories: 0, summary: '記憶庫暫時離線', note: 'RAG health check failed' })
    const health = await r.json()
    const total = health.doc_count ?? health.total ?? 0
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
  const RAG_HOST  = process.env.RAG_SVC_HOST   ? `http://${process.env.RAG_SVC_HOST}:8080`  : null
  // LibreChat 在 Zeabur 內部走 WEB_PORT(預設 3080)，從同 project 另一服務 ping 需帶正確 port。
  // 嘗試 3080；若逾時則回 offline（不影響聊天功能本身）。
  const LIBRE_HOST= process.env.LIBRECHAT_HOST ? `http://${process.env.LIBRECHAT_HOST}:3080` : null

  const ping = async (url, timeoutMs = 3000) => {
    const t = Date.now()
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      return { status: r.ok ? 'ok' : 'error', latency_ms: Date.now() - t }
    } catch (e) {
      return { status: 'offline', latency_ms: Date.now() - t, detail: e.message?.slice(0, 60) }
    }
  }

  // LibreChat 同時嘗試 3080 和 8080（Zeabur 可能重新映射）
  const libreCheck = async () => {
    if (!LIBRE_HOST) return { status: 'not_deployed' }
    const r1 = await ping(`${LIBRE_HOST}/health`, 2000)
    if (r1.status === 'ok') return r1
    // fallback: 嘗試 8080
    const base8080 = LIBRE_HOST.replace(':3080', ':8080')
    return ping(`${base8080}/health`, 2000)
  }

  const [ragResult, libreResult] = await Promise.all([
    RAG_HOST ? ping(`${RAG_HOST}/health`) : Promise.resolve({ status: 'not_deployed' }),
    libreCheck(),
  ])

  const services = {
    approval_svc: { status: 'ok', latency_ms: 0 },
    openrouter:   { status: OPENROUTER_KEY ? 'configured' : 'missing_key' },
    rag_svc:      ragResult,
    librechat:    libreResult,
  }

  res.json({ ts: Date.now(), services, agents: store.listAgents() })
})

app.listen(PORT, () => console.log(`[approval] 審核服務 listening on :${PORT}`))

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
