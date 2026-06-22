import { useRef, useState, useCallback, useEffect } from 'react'
import { useOneAI } from '../state/store'
import { orchestrate, type AgentContrib, type History, type OrchestrateResult } from '../lib/librechat'

const APPROVAL_BASE = (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const APPROVAL_TOKEN = import.meta.env.VITE_APPROVAL_TOKEN as string | undefined

const PENDING_STEPS = [
  '🔍 分析意圖…',
  '🧠 調取長期記憶…',
  '🌐 搜尋最新資料…',
  '🤖 多 Agent 協作…',
  '✨ 梅蘭整合…',
]

const PENDING_BY_INTENT: [RegExp, string[]][] = [
  [/搜尋|搜索|search|查一下/i, ['🔍 分析意圖…', '🌐 搜尋最新資料…', '🧠 對照記憶…', '✨ 梅蘭整合…']],
  [/記得|記憶|記住|腦中/i, ['🔍 分析意圖…', '🫀 管家調閱記憶…', '✨ 整理回覆…']],
  [/分析|策略|程式|code|部署/i, ['🔍 分析意圖…', '🤖 專家協作…', '✨ 梅蘭整合…']],
]

function pendingStepsFor(msg: string) {
  for (const [re, steps] of PENDING_BY_INTENT) {
    if (re.test(msg)) return steps
  }
  return PENDING_STEPS
}

const QUICK_CHIPS = [
  { label: '🌐 搜尋', hint: '搜尋 ' },
  { label: '🧠 記憶', hint: '你還記得什麼關於 ' },
  { label: '📊 分析', hint: '分析 ' },
  { label: '💻 寫程式', hint: '幫我寫 ' },
]

// ── Web Speech API 語音輸入 ────────────────────────────────────────────────
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
}
type SpeechRecognitionEvent = {
  resultIndex: number
  results: { isFinal: boolean; 0: { transcript: string } }[]
}

function createSpeechRecognition(): SpeechRecognitionLike | null {
  const W = window as unknown as Record<string, unknown>
  const SR = (W['SpeechRecognition'] ?? W['webkitSpeechRecognition']) as (new () => SpeechRecognitionLike) | undefined
  if (!SR) return null
  const sr = new SR()
  sr.lang = 'zh-TW'
  sr.continuous = false
  sr.interimResults = true
  sr.maxAlternatives = 1
  return sr
}

const speechSupported = !!(
  (window as unknown as Record<string, unknown>)['SpeechRecognition'] ??
  (window as unknown as Record<string, unknown>)['webkitSpeechRecognition']
)

/** 派送任務到佇列，回傳 task ID */
async function dispatchTask(type: string, payload: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${APPROVAL_BASE}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(APPROVAL_TOKEN ? { Authorization: `Bearer ${APPROVAL_TOKEN}` } : {}),
    },
    body: JSON.stringify({ type, payload }),
  })
  if (!r.ok) throw new Error(`dispatch failed: ${r.status}`)
  const data = await r.json() as { task_id?: string; id?: string }
  return data.task_id ?? data.id ?? ''
}

/** 輪詢任務直到完成（最多等 90 秒），回傳結果摘要 */
async function pollTask(taskId: string, onStatus?: (s: string) => void): Promise<string> {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500))
    const r = await fetch(`${APPROVAL_BASE}/tasks/${taskId}`, {
      headers: APPROVAL_TOKEN ? { Authorization: `Bearer ${APPROVAL_TOKEN}` } : {},
    })
    if (!r.ok) continue
    const data = await r.json() as { status?: string; result?: { summary?: string; stdout_tail?: string; stderr_tail?: string } }
    onStatus?.(data.status ?? '...')
    if (data.status === 'done' || data.status === 'error') {
      const out = data.result?.stdout_tail || data.result?.summary || ''
      const err = data.result?.stderr_tail || ''
      return data.status === 'done'
        ? `✅ 完成${out ? `\n${out.slice(0, 300)}` : ''}`
        : `❌ 失敗${err ? `\n${err.slice(0, 200)}` : ''}`
    }
  }
  return '⏱ 等待逾時（90s），請查看桌機狀態'
}

export default function ChatInput() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [execState, setExecState] = useState<'idle' | 'dispatching' | 'running'>('idle')
  const [lastResult, setLastResult] = useState<OrchestrateResult | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const historyRef = useRef<History>([])
  const srRef = useRef<SpeechRecognitionLike | null>(null)

  const setStatus       = useOneAI((s) => s.setStatus)
  const pushActivity    = useOneAI((s) => s.pushActivity)
  const setPending      = useOneAI((s) => s.setPending)
  const setCurrentModel = useOneAI((s) => s.setCurrentModel)
  const clearActivities = useOneAI((s) => s.clearActivities)

  // 清理 speech recognition on unmount
  useEffect(() => () => { srRef.current?.stop() }, [])

  const toggleVoice = useCallback(() => {
    if (isListening) {
      srRef.current?.stop()
      setIsListening(false)
      setInterimText('')
      return
    }

    const sr = createSpeechRecognition()
    if (!sr) {
      alert('您的瀏覽器不支援語音輸入（請使用 Chrome）')
      return
    }
    srRef.current = sr

    sr.onresult = (e) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      if (final) setText(prev => (prev + final).trimStart())
      setInterimText(interim)
    }

    sr.onend = () => {
      setIsListening(false)
      setInterimText('')
      srRef.current = null
    }

    sr.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[voice] error:', e.error)
      }
      setIsListening(false)
      setInterimText('')
      srRef.current = null
    }

    sr.start()
    setIsListening(true)
    setStatus('listening')
  }, [isListening, setStatus])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const msg = text.trim()
    if (!msg || busy) return
    setText('')
    setBusy(true)
    setLastResult(null)

    // 用戶訊息氣泡
    pushActivity('user', msg, { agentId: 'user', agentIcon: '👤', agentDisplay: '你' })
    setStatus('thinking')
    let pendingIdx = 0
    const steps = pendingStepsFor(msg)
    setPending(steps[0])
    const pendingTimer = window.setInterval(() => {
      pendingIdx = (pendingIdx + 1) % steps.length
      setPending(steps[pendingIdx])
    }, 1800)

    const history = historyRef.current.slice(-12)

    try {
      const result = await orchestrate(msg, history)
      clearInterval(pendingTimer)
      historyRef.current = [
        ...history,
        { role: 'user', content: msg },
        { role: 'assistant', content: result.reply },
      ]
      setPending(null)
      setCurrentModel(result.model)
      setStatus('speaking')

      const memCount = result.brain?.memories_used ?? result.memories_used ?? 0
      if (memCount > 0) {
        const preview = result.brain?.memory_preview?.[0]
        pushActivity('memory', preview
          ? `🧠 調取 ${memCount} 條記憶：${preview.slice(0, 60)}…`
          : `🧠 調取 ${memCount} 條長期記憶`, { memoriesUsed: memCount })
      }

      if (result.web_search) {
        const ws = result.web_search
        const prov = ws.provider === 'none' ? '備援' : ws.provider
        pushActivity('search', `🌐 已搜尋「${ws.query}」(${prov} · ${ws.result_count} 筆)`, {
          agentId: 'researcher', agentIcon: '🔍', agentDisplay: '研究員',
          searchSources: ws.sources?.slice(0, 5),
        })
      }

      if (result.brain?.remembered) {
        pushActivity('memory', '📝 已寫入長期記憶', { brainLearned: true })
      }

      const showSynthesis = result.synthesis || result.agents.length > 1

      if (showSynthesis) {
        pushActivity('result', result.reply, {
          agentId: 'coach',
          agentIcon: '🌸',
          agentDisplay: '梅蘭',
          memoriesUsed: memCount,
          agentDetails: result.agents,
        })
      } else {
        const agent: AgentContrib | undefined = result.agents[0]
        pushActivity('result', result.reply, {
          agentId: agent?.id ?? 'coach',
          agentIcon: agent?.icon ?? '🌸',
          agentDisplay: agent?.display ?? '梅蘭',
          memoriesUsed: memCount,
        })
      }

      setLastResult(result)
    } catch (err) {
      clearInterval(pendingTimer)
      setPending(null)
      pushActivity('warning', `錯誤：${(err as Error).message}`, {
        agentId: 'assistant',
        agentIcon: '⚠️',
        agentDisplay: 'OneAI',
      })
      setStatus('alert')
    } finally {
      setBusy(false)
      setTimeout(() => setStatus('idle'), 2200)
    }
  }

  /** Engineer 程式碼送到 Cursor IDE 執行 */
  const dispatchToCursor = async () => {
    if (!lastResult?.execute_code) return
    setExecState('dispatching')
    try {
      const taskId = await dispatchTask('cursor_agent', {
        prompt: `請在 Cursor 中實作以下程式碼，若需要建立新檔案請自動命名：\n\`\`\`\n${lastResult.execute_code}\n\`\`\``,
        cwd: '.',
      })
      pushActivity('task', `💻 已派送 Cursor 任務 [${taskId.slice(0, 8)}]，等待桌機執行…`, {
        agentId: 'engineer', agentIcon: '💻', agentDisplay: '工程師',
      })
      setExecState('running')

      pollTask(taskId, (s) => { if (s === 'running') setExecState('running') }).then(summary => {
        pushActivity('result', `Cursor 任務 [${taskId.slice(0, 8)}]\n${summary}`, {
          agentId: 'engineer', agentIcon: '💻', agentDisplay: '工程師',
        })
        setExecState('idle')
        setLastResult(null)
      })
    } catch {
      pushActivity('warning', '派送失敗，請確認 Desktop Worker 正在運行（worker.py）', {
        agentId: 'assistant', agentIcon: '⚠️', agentDisplay: 'OneAI',
      })
      setExecState('idle')
    }
  }

  const execLabel = {
    idle: '💻 在 Cursor 執行',
    dispatching: '⏳ 派送中…',
    running: '⚙️ Cursor 執行中…',
  }[execState]

  return (
    <div className="chat-wrap">
      {lastResult?.can_execute && (
        <button
          className="execute-btn glass"
          onClick={dispatchToCursor}
          disabled={execState !== 'idle'}
          title="程式碼送到桌機 worker.py → Cursor IDE 執行並回報結果"
        >
          {execLabel}
        </button>
      )}

      {/* 語音辨識預覽條 */}
      {isListening && (
        <div className="voice-preview">
          <span className="voice-dot" />
          <span className="voice-interim">{interimText || '正在聆聽…'}</span>
        </div>
      )}

      {/* 快捷指令 chips */}
      <div className="quick-chips">
        {QUICK_CHIPS.map(c => (
          <button
            key={c.label}
            type="button"
            className="chip glass"
            disabled={busy}
            onClick={() => setText(prev => prev ? prev : c.hint)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="chat-row">
      <form className="chat glass" onSubmit={submit}>
        {/* 麥克風按鈕 */}
        {speechSupported && (
          <button
            type="button"
            className={`mic-btn ${isListening ? 'mic-active' : ''}`}
            onClick={toggleVoice}
            aria-label={isListening ? '停止語音輸入' : '語音輸入'}
            title={isListening ? '點擊停止' : '說話輸入'}
          >
            {isListening ? '⏹' : '🎤'}
          </button>
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setStatus('listening')}
          onBlur={() => useOneAI.getState().status === 'listening' && setStatus('idle')}
          placeholder={isListening ? '聆聽中…' : '對梅蘭說…（可搜尋、查記憶、寫程式）'}
          aria-label="訊息輸入"
          disabled={busy}
        />
        <button type="submit" className="send" disabled={busy || (!text.trim() && !isListening)} aria-label="送出">
          {busy ? '…' : '↑'}
        </button>
      </form>
      <button
        className="clear-btn"
        onClick={() => { clearActivities(); historyRef.current = []; setLastResult(null); setExecState('idle') }}
        title="清除對話"
      >
        ✕
      </button>
      </div>
    </div>
  )
}
