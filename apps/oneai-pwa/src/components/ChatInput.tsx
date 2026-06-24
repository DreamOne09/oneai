import { useRef, useState, useCallback, useEffect } from 'react'
import { useOneAI } from '../state/store'
import { orchestrateStream, type AgentContrib, type History, type OrchestrateResult } from '../lib/orchestrate-client'
import { dispatchTask, pollTaskUntilDone } from '../lib/task-client'
import { CursorPanel, type CursorDispatchPayload } from './CursorPanel'
import { rememberProject } from '../lib/cursor-projects'

const PHASE_FALLBACK: Record<string, string> = {
  rag_start: '🧠 調取長期記憶…',
  rag_done: '🧠 記憶就緒',
  route_done: '🔍 路由決策…',
  search_start: '🌐 搜尋最新資料…',
  search_done: '🌐 搜尋完成',
  browser_research_queued: '🖥️ 派發本機 Browser 深度研究…',
  agent_done: '🤖 專家回覆…',
  synth_start: '✨ 梅蘭整合…',
  synth_done: '✨ 整合完成',
  memory_saved: '📝 寫入記憶…',
  skill_saved: '💾 儲存 Skill…',
}

const QUICK_CHIPS = [
  { label: '🌐 搜尋', hint: '搜尋 ' },
  { label: '🔬 深度', hint: '深度研究 ' },
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

export default function ChatInput() {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [execState, setExecState] = useState<'idle' | 'dispatching' | 'running'>('idle')
  const [lastResult, setLastResult] = useState<OrchestrateResult | null>(null)
  const [showCursorPanel, setShowCursorPanel] = useState(false)
  const [lastUserMsg, setLastUserMsg] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [interimText, setInterimText] = useState('')
  const historyRef = useRef<History>([])
  const srRef = useRef<SpeechRecognitionLike | null>(null)

  const setStatus       = useOneAI((s) => s.setStatus)
  const pushActivity    = useOneAI((s) => s.pushActivity)
  const setPending      = useOneAI((s) => s.setPending)
  const setCurrentModel = useOneAI((s) => s.setCurrentModel)
  const clearActivities = useOneAI((s) => s.clearActivities)
  const upsertCursorJob = useOneAI((s) => s.upsertCursorJob)
  const updateCursorJob = useOneAI((s) => s.updateCursorJob)

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
    setLastUserMsg(msg)

    // 用戶訊息氣泡
    pushActivity('user', msg, { agentId: 'user', agentIcon: '👤', agentDisplay: '你' })
    setStatus('thinking')
    setPending('🔍 分析意圖…')

    const history = historyRef.current.slice(-12)

    try {
      const result = await orchestrateStream(msg, history, (ev) => {
        const label = ev.label ?? PHASE_FALLBACK[ev.phase] ?? ev.phase
        if (label) setPending(label)
      })
      historyRef.current = [
        ...history,
        { role: 'user', content: msg },
        { role: 'assistant', content: result.reply },
      ]
      setPending(null)
      setCurrentModel(result.model)
      setStatus('speaking')

      const memCount = result.brain?.memories_used ?? result.memories_used ?? 0
      const memQuery = result.brain?.memory_preview?.[0]?.slice(0, 80) ?? msg.slice(0, 80)
      if (memCount > 0) {
        const preview = result.brain?.memory_preview?.[0]
        pushActivity('memory', preview
          ? `🧠 調取 ${memCount} 條記憶：${preview.slice(0, 60)}…`
          : `🧠 調取 ${memCount} 條長期記憶`, { memoriesUsed: memCount, memoryQuery: memQuery })
      }

      if (result.web_search) {
        const ws = result.web_search
        const prov = ws.provider === 'none' ? '備援' : ws.provider
        pushActivity('search', `🌐 已搜尋「${ws.query}」(${prov} · ${ws.result_count} 筆)`, {
          agentId: 'researcher', agentIcon: '🔍', agentDisplay: '研究員',
          searchSources: ws.sources?.slice(0, 5),
        })
      }

      if (result.browser_research?.task_id) {
        const tid = result.browser_research.task_id
        const taskMeta = {
          taskId: tid,
          projectPath: '',
          projectName: 'Browser 深度研究',
          summary: msg.slice(0, 120),
          status: 'queued' as const,
          worker: 'cursor' as const,
        }
        upsertCursorJob({ ...taskMeta, ts: Date.now() })
        pushActivity('task', `🌐 Browser 深度研究 · ${tid.slice(0, 8)}…`, {
          agentId: 'researcher', agentIcon: '🌐', agentDisplay: '深度研究',
          taskMeta,
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

  /** 開啟確認面板（顯示 repo + 摘要，不顯示 code） */
  const openCursorPanel = () => {
    if (!lastResult?.execute_code) return
    setShowCursorPanel(true)
  }

  const confirmCursorDispatch = async ({ cwd, projectName, summary }: CursorDispatchPayload) => {
    if (!lastResult?.execute_code) return
    setShowCursorPanel(false)
    setExecState('dispatching')
    rememberProject(cwd)

    const taskSummary = summary.slice(0, 120) || '在 Cursor 實作工程師方案'
    const prompt = `專案：${projectName}\n使用者需求：${summary}\n\n請在 Cursor 中實作（可建立/修改檔案）：\n\`\`\`\n${lastResult.execute_code}\n\`\`\``

    try {
      const taskId = await dispatchTask('cursor_agent', { prompt, cwd })
      const taskMeta = {
        taskId,
        projectPath: cwd,
        projectName,
        summary: taskSummary,
        status: 'queued' as const,
        worker: 'cursor' as const,
      }
      upsertCursorJob({ ...taskMeta, ts: Date.now() })
      pushActivity('task', `💻 Cursor · ${projectName}`, {
        agentId: 'engineer', agentIcon: '💻', agentDisplay: 'Cursor',
        taskMeta,
      })
      setExecState('running')
      updateCursorJob(taskId, { status: 'running' })

      pollTaskUntilDone(taskId, {
        onStatus: (s) => {
          if (s === 'running') {
            setExecState('running')
            updateCursorJob(taskId, { status: 'running' })
          }
        },
      }).then(({ status, summary: resultText }) => {
        const finalStatus = (status === 'done' ? 'done' : status === 'rejected' ? 'rejected' : status === 'timeout' ? 'timeout' : 'error') as typeof taskMeta.status
        updateCursorJob(taskId, { status: finalStatus })
        pushActivity('result', resultText, {
          agentId: 'engineer', agentIcon: '💻', agentDisplay: 'Cursor',
          taskMeta: { ...taskMeta, status: finalStatus },
        })
        setExecState('idle')
        setLastResult(null)
      })
    } catch {
      pushActivity('warning', '派送失敗 — 請確認 cursor_worker.py 常駐且 VITE_APPROVAL_TOKEN 已設', {
        agentId: 'assistant', agentIcon: '⚠️', agentDisplay: 'OneAI',
      })
      setExecState('idle')
    }
  }

  const execLabel = {
    idle: '💻 送到 Cursor（選專案）',
    dispatching: '⏳ 派送中…',
    running: '⚙️ Cursor 執行中…',
  }[execState]

  const cursorSummary = lastUserMsg.slice(0, 120) || '實作工程師方案'

  return (
    <div className="chat-wrap">
      {lastResult?.can_execute && (
        <button
          className="execute-btn glass"
          onClick={openCursorPanel}
          disabled={execState !== 'idle'}
          title="選擇 repo 專案 → 送到桌機 Cursor IDE（手機不看 code）"
        >
          {execLabel}
        </button>
      )}

      {showCursorPanel && (
        <CursorPanel
          taskSummary={cursorSummary}
          onClose={() => setShowCursorPanel(false)}
          onConfirm={confirmCursorDispatch}
          busy={execState !== 'idle'}
        />
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
