#!/usr/bin/env node
/**
 * MCP 橋接伺服器 (stdio)。把「我們的差異化能力」包成 Agent 可呼叫的工具,
 * 掛進 LibreChat(或任何支援 MCP 的 host):
 *  - vault_query        → 檢索核心大腦知識庫 (The Brain)
 *  - remember           → 寫回記憶到 vault (自我進化)
 *  - request_approval   → 送手機審核 (The Guardrail)
 *  - run_local_command  → 本機指令 (The Hands,內含政策/審核)
 *  - run_local_task     → 交給 Antigravity 的高層任務
 *
 * 註:雲端大腦/LLM 對話由 host(LibreChat)負責,本橋樑只提供 host 沒有的能力。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  loadRegistry,
  activeModel,
  listAliases,
  setActive,
} from '../../../scripts/oneaiModels.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../..')

const APPROVAL_BASE = process.env.APPROVAL_BASE_URL || 'http://localhost:8787'
const APPROVAL_TOKEN = process.env.APPROVAL_TOKEN || ''
const APPROVAL_POLL_MS = Number(process.env.APPROVAL_POLL_INTERVAL_SEC || 3) * 1000

// 雲端派發本機任務的輪詢設定(任務可能要等手機審核,故 deadline 須夠長)
const TASK_POLL_MS = Number(process.env.LOCAL_TASK_POLL_SEC || 3) * 1000
const TASK_DEADLINE_MS = Number(process.env.LOCAL_TASK_TIMEOUT_SEC || 1830) * 1000

// 設了 RAG_API_URL 就走常駐 RAG 服務(模型載一次,查詢即時);
// 未設則 fallback 成 spawn python(本機開發備援)。見 brain/rag/service.py。
const RAG_API_URL = process.env.RAG_API_URL || ''

// 雲端模式(ONEAI_CLOUD=1):本機肉體工具(run_local_*)不在雲端直接 spawn python,
// 而是「派發到 approval-svc 任務佇列」,由你電腦上的 OneAI worker 認領、經手機審核後執行。
// 非雲端(本機)則直接 spawn python executor。
const CLOUD = process.env.ONEAI_CLOUD === '1'

async function ragHttp(pathname, payload) {
  const base = RAG_API_URL.replace(/\/$/, '')
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`RAG 服務 HTTP ${res.status}`)
  return res.json()
}

function approvalHeaders(extra = {}) {
  return APPROVAL_TOKEN
    ? { Authorization: `Bearer ${APPROVAL_TOKEN}`, ...extra }
    : { ...extra }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 雲端:把本機任務入列到 approval-svc 佇列,輪詢直到本機 worker 執行(經審核)回報結果。
// 本機 worker 離線時,任務會留在佇列,直到 deadline 逾時(回提示)。
async function dispatchLocalTask(type, payload) {
  const base = APPROVAL_BASE.replace(/\/$/, '')
  let taskId
  try {
    const res = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: approvalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ type, payload }),
    })
    if (!res.ok) return err(`派發本機任務失敗: HTTP ${res.status}`)
    taskId = (await res.json()).task_id
  } catch (e) {
    return err(`任務佇列不可達: ${e.message}`)
  }
  if (!taskId) return err('派發本機任務失敗')

  const deadline = Date.now() + TASK_DEADLINE_MS
  while (Date.now() < deadline) {
    await sleep(TASK_POLL_MS)
    try {
      const r = await fetch(`${base}/tasks/${taskId}`, { headers: approvalHeaders() })
      if (!r.ok) continue
      const t = await r.json()
      if (t.status === 'done' || t.status === 'error' || t.status === 'rejected') {
        const res = t.result || {}
        const body = [res.summary, res.stdout_tail, res.stderr_tail].filter(Boolean).join('\n')
        return t.status === 'done' ? ok(body || '完成') : err(body || `本機任務 ${t.status}`)
      }
    } catch {
      /* 暫時性失敗,繼續輪詢 */
    }
  }
  return err(`本機任務逾時(id=${taskId});請確認你電腦的 OneAI worker 是否在執行`)
}

// LibreChat 會把 MCP 工具回傳整包讀進記憶,過大會 OOM。
// 故對 vault_query 結果設預設字元預算(可用 env 覆寫)。
const VAULT_MAX_CHARS = Number(process.env.VAULT_MAX_CHARS || 8000)

// 預設用 brain/rag 的 venv python(裝了 chromadb);可用 PYTHON_BIN 覆寫。
const VENV_PY = path.join(
  REPO_ROOT, 'brain', 'rag', '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
)
const PYTHON = process.env.PYTHON_BIN || (fs.existsSync(VENV_PY) ? VENV_PY : 'python')

function ok(text) {
  return { content: [{ type: 'text', text }] }
}
function err(text) {
  return { content: [{ type: 'text', text }], isError: true }
}

// 執行 python 腳本並收集 stdout。
// script 以 REPO_ROOT 為基準解析成絕對路徑(Python 會把腳本所在目錄加入 sys.path,
// 故同目錄 import 正常);workingDir 控制行程 cwd(預設 REPO_ROOT)。
function runPython(script, args, workingDir) {
  const scriptAbs = path.isAbsolute(script) ? script : path.join(REPO_ROOT, script)
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [scriptAbs, ...args], { cwd: workingDir || REPO_ROOT })
    let out = '', errOut = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.stderr.on('data', (d) => (errOut += d))
    proc.on('close', (code) => resolve({ code, out, errOut }))
    proc.on('error', (e) => resolve({ code: -1, out: '', errOut: String(e) }))
  })
}

const server = new McpServer({ name: 'mcp-core-bridge', version: '0.0.0' })

server.tool(
  'vault_query',
  '檢索李孟一核心大腦知識庫,取回最相關片段以對齊語氣與事實(回傳已限長,避免 host OOM)',
  { query: z.string(), top_k: z.number().int().min(1).max(20).optional() },
  async ({ query, top_k }) => {
    const k = top_k ?? 5
    if (RAG_API_URL) {
      try {
        const data = await ragHttp('/query', { query, top_k: k, max_chars: VAULT_MAX_CHARS })
        return ok(JSON.stringify(data.results ?? [], null, 2))
      } catch (e) {
        return err(`RAG 服務檢索失敗: ${e.message}`)
      }
    }
    const r = await runPython('brain/rag/query_vault.py', [query, String(k), String(VAULT_MAX_CHARS)])
    return r.code === 0 ? ok(r.out) : err(r.errOut || '檢索失敗')
  }
)

server.tool(
  'remember',
  '寫回一則記憶到核心大腦(vault),使其下次可被檢索 — 自我進化的核心',
  {
    text: z.string().describe('要記住的內容(偏好/反思/SOP)'),
    title: z.string().optional(),
    kind: z.enum(['memory', 'preference', 'reflection', 'sop', 'system']).optional(),
    tags: z.string().optional().describe('逗號分隔'),
  },
  async ({ text, title, kind, tags }) => {
    if (RAG_API_URL) {
      try {
        const data = await ragHttp('/remember', {
          text,
          title: title ?? null,
          kind: kind ?? 'memory',
          tags: tags ? tags.split(',').map((s) => s.trim()).filter(Boolean) : null,
        })
        return ok(`已記住 → ${data.path}`)
      } catch (e) {
        return err(`寫回記憶失敗: ${e.message}`)
      }
    }
    const args = [text]
    if (title) args.push('--title', title)
    if (kind) args.push('--kind', kind)
    if (tags) args.push('--tags', tags)
    const r = await runPython('brain/rag/remember.py', args)
    return r.code === 0 ? ok(r.out) : err(r.errOut || '寫回記憶失敗')
  }
)

server.tool(
  'request_approval',
  '對關鍵動作送手機審核;非阻塞建立後輪詢結果取回允許/拒絕(逾時預設拒絕)',
  {
    action: z.enum(['send_email', 'spend_money', 'publish', 'delete_file', 'run_command']),
    summary: z.string(),
    timeout_sec: z.number().int().optional(),
  },
  async ({ action, summary, timeout_sec }) => {
    const base = APPROVAL_BASE.replace(/\/$/, '')
    const timeoutSec = timeout_sec || Number(process.env.APPROVAL_DEFAULT_TIMEOUT_SEC || 1800)
    let approvalId
    try {
      const res = await fetch(`${base}/request`, {
        method: 'POST',
        headers: approvalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action, summary, timeout_sec: timeoutSec }),
      })
      if (!res.ok) return err(`建立審核失敗(視為拒絕): HTTP ${res.status}`)
      const data = await res.json()
      approvalId = data.approval_id
    } catch (e) {
      return err(`審核服務不可達(視為拒絕): ${e.message}`)
    }
    if (!approvalId) return err('建立審核失敗(視為拒絕)')

    // 短連線輪詢 /status/:id,避免長連線被反向代理掐斷
    const deadline = Date.now() + (timeoutSec + 15) * 1000
    while (Date.now() < deadline) {
      await sleep(APPROVAL_POLL_MS)
      try {
        const r = await fetch(`${base}/status/${approvalId}`, { headers: approvalHeaders() })
        if (r.ok) {
          const s = await r.json()
          if (s.settled) return ok(`decision=${s.decision} (id=${approvalId})`)
        }
      } catch {
        /* 暫時性失敗,繼續輪詢 */
      }
    }
    return err(`審核逾時(視為拒絕) (id=${approvalId})`)
  }
)

// 本機肉體工具:
//  - 雲端(CLOUD):派發到 approval-svc 任務佇列,由你電腦的 OneAI worker 認領執行(經手機審核)。
//  - 本機(非 CLOUD):直接 spawn 本機 python executor。
if (CLOUD) {
  server.tool(
    'run_local_command',
    '在「使用者本機電腦」執行 shell 指令(經手機審核;由本機 OneAI worker 實際執行)',
    { cmd: z.string(), cwd: z.string().optional() },
    async ({ cmd, cwd }) => dispatchLocalTask('shell', { cmd, cwd: cwd ?? null })
  )

  server.tool(
    'run_local_task',
    '把高層任務(編碼/測試/重構)交給「使用者本機」的 Antigravity 自主完成(經手機審核)',
    { task_type: z.string(), prompt: z.string() },
    async ({ task_type, prompt }) => dispatchLocalTask('agent', { task_type, prompt })
  )
} else {
  server.tool(
    'run_local_command',
    '在本機執行 shell 指令(危險指令會自動先送審核)',
    { cmd: z.string(), cwd: z.string().optional() },
    async ({ cmd, cwd }) => {
      const r = await runPython('hands/antigravity/executor.py', [cmd], cwd || REPO_ROOT)
      return r.code === 0 ? ok(r.out) : err(r.errOut || r.out || '執行失敗')
    }
  )

  server.tool(
    'run_local_task',
    '把高層任務(編碼/測試/重構)交給本機 Antigravity 自主完成',
    { task_type: z.string(), prompt: z.string() },
    async ({ task_type, prompt }) => {
      const r = await runPython('hands/antigravity/executor.py', ['--task', task_type, prompt])
      return r.code === 0 ? ok(r.out) : err(r.errOut || r.out || '任務失敗')
    }
  )
}

server.tool(
  'oneai_list_models',
  '列出 OneAI 可用的模型別名與目前作用中的模型(供使用者選擇要切到哪個)',
  {},
  async () => {
    try {
      const reg = loadRegistry()
      const lines = Object.entries(listAliases(reg)).map(
        ([alias, id]) => `  ${alias} → ${id}`
      )
      return ok(`目前: ${reg.active} → ${activeModel(reg)}\n可用別名:\n${lines.join('\n')}`)
    } catch (e) {
      return err(`讀取模型登錄表失敗: ${e.message}`)
    }
  }
)

server.tool(
  'oneai_set_model',
  '切換 OneAI 全域預設模型(一句話換腦);傳入別名如 smart/claude/gemini/deepseek',
  { alias: z.string().describe('模型別名,見 oneai_list_models') },
  async ({ alias }) => {
    try {
      const id = setActive(alias)
      return ok(`已切換 OneAI 預設模型為「${alias}」→ ${id}`)
    } catch (e) {
      return err(e.message)
    }
  }
)

// ── Cursor Agent 派發工具(本機模式,需 CURSOR_API_KEY;雲端模式走任務佇列) ──
server.tool(
  'cursor_agent',
  '把程式編碼/重構/測試任務派給本機 Cursor Agent 執行。Cursor Agent 有完整的程式碼理解、修改、git 能力。適合需要「真的動程式碼」的任務。',
  {
    prompt: z.string().describe('要 Cursor Agent 做的事,越具體越好'),
    cwd: z.string().optional().describe('工作目錄路徑(預設 repo 根目錄)'),
  },
  async ({ prompt, cwd }) => {
    if (CLOUD) {
      // 雲端模式:派到佇列,由 cursor-worker 認領
      return dispatchLocalTask('cursor_agent', { prompt, cwd: cwd ?? null })
    }
    // 本機模式:直接用 cursor-sdk(Python)呼叫
    const workerScript = path.resolve(__dirname, '../../../hands/cursor-agent/cursor_worker.py')
    const r = await runPython(workerScript, ['--once', prompt, ...(cwd ? ['--cwd', cwd] : [])])
    return r.code === 0 ? ok(r.out) : err(r.errOut || r.out || 'Cursor Agent 失敗')
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[mcp-core-bridge] 已啟動 (stdio);模式=${CLOUD ? '雲端(大腦/記憶/審核/換腦 + Cursor Agent)' : '本機(直接執行+Cursor Agent)'}`)
