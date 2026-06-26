import { useRef, useState, useCallback, useEffect } from 'react'
import { useOneAI } from '../state/store'
import { orchestrateStream, resolveOrchestrateMode, type AgentContrib, type History, type OrchestrateResult, type OrchestratePhaseEvent } from '../lib/orchestrate-client'
import type { OrchestrateMode } from '../types'
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
  council_start: '🏛️ 議會開議…',
  council_round: '🗣️ 辦公室辯論中…',
  council_agent_done: '💬 議員發言…',
  council_done: '🏛️ 辯論回合結束',
  coo_briefing_start: '🌸 梅蘭篩選定稿…',
  coo_briefing_done: '🌸 定稿完成',
  staff_done: '👥 人事異動…',
  synth_start: '✨ 梅蘭整合…',
  synth_done: '✨ 整合完成',
  memory_saved: '📝 寫入記憶…',
  skill_saved: '💾 儲存 Skill…',
  handoff_start: '☁️ 梅蘭派工中…',
  handoff_done: '☁️ 派工完成',
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
  const setCouncilLive = useOneAI((s) => s.setCouncilLive)
  const setOrchestrateMode = useOneAI((s) => s.setOrchestrateMode)

  const handleOrchestratePhase = useCallback((ev: OrchestratePhaseEvent, agentSnapshot: AgentContrib[]) => {
    const d = ev.data ?? {}
    const label = ev.label ?? PHASE_FALLBACK[ev.phase] ?? ev.phase
    if (label) setPending(label)

    if (ev.phase === 'staff_done') {
      setOrchestrateMode('staff')
      setCouncilLive(null)
      return
    }

    if (ev.phase === 'route_done') {
      const agents = (d.agents as string[]) ?? []
      const isCouncil = agents.length >= 2
      setOrchestrateMode(isCouncil ? 'council' : 'fast')
      if (!isCouncil) {
        setCouncilLive(null)
      } else {
        setCouncilLive({
          active: true,
          mode: 'council',
          round: 0,
          maxRounds: 2,
          phase: 'routing',
          phaseLabel: d.squad_display ? `${d.squad_display} 編制` : '組編制中',
          participants: agents.map(id => {
            const a = agentSnapshot.find(x => x.id === id)
            return { id, icon: a?.icon ?? '🤖', display: a?.display ?? id }
          }),
          squad: d.squad as string | undefined,
          squadDisplay: d.squad_display as string | undefined,
        })
      }
    }

    if (ev.phase === 'council_start') {
      const mode = (d.mode as string)?.includes('high_stakes') ? 'council_high_stakes' : 'council'
      setOrchestrateMode(mode as OrchestrateMode)
      const ids = (d.agents as string[]) ?? []
      setCouncilLive({
        active: true,
        mode: mode as OrchestrateMode,
        round: 0,
        maxRounds: (d.max_rounds as number) ?? 2,
        phase: 'opening',
        phaseLabel: '🏛️ 議會開議',
        participants: ids.map(id => {
          const a = agentSnapshot.find(x => x.id === id)
          return { id, icon: a?.icon ?? '🤖', display: a?.display ?? id }
        }),
      })
    }

    if (ev.phase === 'council_round') {
      setCouncilLive(prev => prev ? {
        ...prev,
        active: true,
        round: (d.round as number) ?? prev.round,
        maxRounds: (d.max_rounds as number) ?? prev.maxRounds,
        phase: (d.phase as string) ?? prev.phase,
        phaseLabel: (d.label as string) ?? label,
      } : prev)
    }

    if (ev.phase === 'council_agent_done') {
      const id = d.id as string
      setCouncilLive(prev => prev ? { ...prev, lastSpeaker: id } : prev)
    }

    if (ev.phase === 'council_done' || ev.phase === 'coo_briefing_start') {
      setCouncilLive(prev => prev ? {
        ...prev,
        phase: ev.phase === 'coo_briefing_start' ? 'briefing' : 'done',
        phaseLabel: ev.phase === 'coo_briefing_start' ? '🌸 梅蘭定稿' : '辯論完成',
      } : prev)
    }

    if (ev.phase === 'done' || ev.phase === 'coo_briefing_done' || ev.phase === 'synth_done') {
      setCouncilLive(prev => prev ? { ...prev, active: false, phaseLabel: '完成' } : null)
    }
  }, [setPending, setCouncilLive, setOrchestrateMode])

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
    setCouncilLive(null)
    setOrchestrateMode('idle')

    const history = historyRef.current.slice(-12)
    const agentSnapshot: AgentContrib[] = []

    try {
      const result = await orchestrateStream(msg, history, (ev) => {
        handleOrchestratePhase(ev, agentSnapshot)
      })
      historyRef.current = [
        ...history,
        { role: 'user', content: msg },
        { role: 'assistant', content: result.reply },
      ]
      setPending(null)
      setCurrentModel(result.model)
      setStatus('speaking')
      agentSnapshot.push(...result.agents)

      const mode = resolveOrchestrateMode(result)
      setOrchestrateMode(mode)
      setCouncilLive(null)

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

      if (result.handoff) {
        const h = result.handoff
        const jobLabel = h.job ?? h.channel
        const statusIcon = h.status === 'running' ? '☁️' : h.status === 'error' ? '⚠️' : '💻'
        pushActivity('task', `${statusIcon} COO 派工 · ${jobLabel} (${h.status})`, {
          agentId: 'coach',
          agentIcon: '🌸',
          agentDisplay: '梅蘭',
          taskMeta: h.task_id ? {
            taskId: h.task_id,
            projectPath: '',
            projectName: `Cloud ${jobLabel}`,
            summary: h.poll ?? '',
            status: h.status === 'running' ? 'running' : h.status === 'error' ? 'error' : 'queued',
            worker: 'cloud' as const,
          } : undefined,
        })
      }

      if (result.brain?.remembered) {
        pushActivity('memory', '📝 已寫入長期記憶', { brainLearned: true })
      }

      const showSynthesis = result.synthesis || result.agents.length > 1 || !!result.council

      if (showSynthesis) {
        pushActivity('result', result.reply, {
          agentId: 'coach',
          agentIcon: '🌸',
          agentDisplay: '梅蘭',
          memoriesUsed: memCount,
          agentDetails: result.agents,
          councilTranscript: result.council_transcript,
          councilMeta: result.council,
          orchestrateMode: mode,
        })
        if (result.council_transcript?.length) {
          pushActivity('info', `🏛️ 議會 ${result.council?.rounds ?? ''} 輪辯論 · 可展開議事錄`, {
            agentId: 'coach',
            agentIcon: '🏛️',
            agentDisplay: '議會',
            councilTranscript: result.council_transcript,
            councilMeta: result.council,
            orchestrateMode: mode,
          })
        }
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
