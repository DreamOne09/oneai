/**
 * 單一 Orchestrate Harness — chat / SSE 共用同一套大腦邏輯。
 * emit(phase, data?) 供 SSE 推送真實進度。
 */
import {
  filterMemories,
  isSmallTalk,
  needsExplicitRemember,
  isSecretMemoryAttempt,
  cleanSearchQuery,
  buildMemoryBlock,
  shouldRemember,
  formatRememberPayload,
  buildBrainMeta,
  mergeAgentRoute,
  enrichSearchReply,
  enforceSearchReply,
  buildWorkerContext,
  needsRecall,
  needsSystemKnowledge,
  filterSystemMemories,
  buildSystemKnowledgeBlock,
  classifyMemoryKind,
  memoryWriteDecision,
} from './brain-intel.js'
import { needsMemoryCurate } from './memory-curator.js'
import {
  needsDeepBrowserResearch,
  isCursorWorkerOnline,
  buildBrowserResearchPrompt,
  buildDeepResearchQueuedReply,
  buildDeepResearchFallbackNote,
} from './deep-research.js'
import { MEILAN_SYNTHESIS_BRIEF, shouldAlwaysSynthesize } from './caveman-style.js'
import {
  runCouncil,
  runCooBriefing,
  needsCouncil,
  buildCouncilSummaryForResponse,
} from './agent-council.js'
import {
  isStaffManagementIntent,
  parseStaffCommand,
  executeStaffCommand,
  formatStaffActionReply,
  buildCouncilRoster,
} from './coo-staffing.js'
import { runCooHandoff } from './coo-handoff.js'

export async function runOrchestrateTurn(deps, input) {
  const {
    userMsg,
    messages,
    emit = () => {},
  } = input

  const {
    ragQuery,
    ragRememberSmart,
    ragCurate,
    webSearchCached,
    detectAgentsLLM,
    callOpenRouter,
    listWorkers,
    getAgentSystem,
    getAgentMeta,
    getAgentModel,
    detectAgentsFallback,
    AGENT_SYSTEMS,
    AGENTS_META,
    AGENTS_CONFIG,
    CHAT_DEFAULT_MODEL,
    CHAT_FALLBACK_CHAIN,
    RESEARCH_KWS,
    ROUTING_TRIGGERS,
    extractCodeBlock,
    MENGYI_BRIEF,
    enqueueTask,
    defaultCursorCwd,
  } = deps

  const smallTalk = isSmallTalk(userMsg)
  const explicitRemember = needsExplicitRemember(userMsg)
  const curateIntent = needsMemoryCurate(userMsg)

  if (isSecretMemoryAttempt(userMsg)) {
    emit('route_done', { agents: ['butler'], secret_denied: true })
    const reply = '🔒 為安全起見，API 金鑰、密碼、token 不能寫進記憶庫。請放在本機 `.env` 或密碼管理器，並在 Zeabur Dashboard 設定環境變數。'
    emit('synth_done')
    return {
      reply,
      model: 'butler-guard',
      agents: [{ id: 'butler', icon: '🫀', display: '管家', reply, model: 'guard' }],
      memories_used: 0,
      brain: { memories_used: 0, remembered: false, memory_write: 'secret_denied' },
      synthesis: false,
      workers: buildWorkerContext(listWorkers()).summary,
    }
  }

  const persistIfNeeded = async (reply, agentIds = []) => {
    const writeDecision = memoryWriteDecision(userMsg, { explicitRemember, smallTalk })
    const remembered = writeDecision !== 'skip'
    if (remembered) {
      const p = formatRememberPayload(userMsg, reply, explicitRemember)
      const kind = classifyMemoryKind(userMsg, explicitRemember)
      await ragRememberSmart(p.text, p.title, kind)
      emit('memory_saved', { kind, write: writeDecision })
    }
    return { remembered, writeDecision }
  }

  const workerCtx = buildWorkerContext(listWorkers())
  let workerBlock = workerCtx.block
  let deepResearchFallback = false

  // ⓪ 營運長人事管理（增刪改議員）
  if (isStaffManagementIntent(userMsg)) {
    const cmd = parseStaffCommand(userMsg)
    const result = executeStaffCommand(cmd)
    const reply = formatStaffActionReply(cmd, result)
    emit('staff_done', { action: cmd?.action })
    emit('route_done', { agents: ['coach'], staff: true })
    emit('synth_done')
    return {
      reply,
      model: 'coo-staff',
      agents: [{ id: 'coach', icon: '🌸', display: '梅蘭', reply, model: 'coo-staff' }],
      memories_used: 0,
      brain: buildBrainMeta([], false, 'skip'),
      synthesis: false,
      staff: result.ok ? result.staff : undefined,
      workers: workerCtx.summary,
    }
  }

  // ①a 本機 Browser 深度研究（Cursor + Browser MCP）
  if (needsDeepBrowserResearch(userMsg) && enqueueTask) {
    const agents = listWorkers()
    if (isCursorWorkerOnline(agents)) {
      emit('route_done', { agents: ['researcher'], mode: 'browser_deep' })
      const prompt = buildBrowserResearchPrompt(userMsg)
      const task = enqueueTask('cursor_agent', {
        prompt,
        cwd: defaultCursorCwd || '.',
        source: 'browser_deep_research',
        user_request: userMsg.slice(0, 500),
      })
      const reply = buildDeepResearchQueuedReply(task.id, userMsg)
      emit('browser_research_queued', { task_id: task.id })
      emit('synth_done')
      return {
        reply,
        model: 'browser-deep-queue',
        agents: [{ id: 'researcher', icon: '🌐', display: '深度研究', reply, model: 'cursor-browser' }],
        memories_used: 0,
        brain: buildBrainMeta([], false, 'skip'),
        synthesis: false,
        workers: workerCtx.summary,
        browser_research: { task_id: task.id, status: 'queued', mode: 'browser' },
      }
    }
    deepResearchFallback = true
    workerBlock += `\n\n${buildDeepResearchFallbackNote()}`
  }

  // ①b Butler 整理記憶（Phase B）
  if (curateIntent) {
    emit('route_done', { agents: ['butler'], curate: true })
    const dryFirst = !/確認|真的|apply|執行/i.test(userMsg)
    const result = await ragCurate(dryFirst, 500)
    const n = result.junk_chunks ?? 0
    const reply = result.ok
      ? (dryFirst && n > 0
        ? `🧹 掃描完成：發現 ${n} 個可清理的舊對話摘要片段（episodic 垃圾）。\n\n若要刪除，請回覆「確認整理記憶」。`
        : dryFirst
          ? '🧹 掃描完成：未發現需清理的 episodic 垃圾，記憶庫乾淨。'
          : `✅ 已清理 ${n} 個垃圾片段${result.deleted_files ? `，刪除 ${result.deleted_files} 個 vault 檔` : ''}。`)
      : `⚠️ 整理失敗：${result.error ?? 'RAG 離線或未部署 curate'}`
    emit('synth_done')
    return {
      reply,
      model: 'butler-curate',
      agents: [{ id: 'butler', icon: '🫀', display: '管家', reply, model: 'curate' }],
      memories_used: 0,
      brain: { memories_used: 0, remembered: false, memory_write: 'skip', curate: result },
      synthesis: false,
      workers: workerCtx.summary,
    }
  }

  // ① 快徑寒暄
  if (smallTalk && !explicitRemember) {
    emit('route_done', { agents: ['coach'], fast: true })
    const r = await callOpenRouter(CHAT_DEFAULT_MODEL, [
      { role: 'system', content: AGENT_SYSTEMS.coach + workerBlock },
      ...messages,
    ])
    emit('synth_done')
    return {
      reply: r.reply,
      model: r.model,
      agents: [{ id: 'coach', icon: '🌸', display: '梅蘭', reply: r.reply, model: r.model }],
      memories_used: 0,
      brain: buildBrainMeta([], false),
      synthesis: false,
      workers: workerCtx.summary,
    }
  }

  // ② RAG + 路由並行（個人記憶 + 系統知識分開查）
  emit('rag_start')
  const recallIntent = needsRecall(userMsg) || explicitRemember
  const systemIntent = needsSystemKnowledge(userMsg)
  const [rawMemories, rawSystem, agentIdsFromLLM] = await Promise.all([
    (async () => {
      let rows = await ragQuery(userMsg, recallIntent ? 8 : 4, null)
      if (recallIntent && rows.length === 0) {
        for (const fq of ['繁體中文', '李孟一 偏好 繁體中文', '偏好 語言']) {
          rows = await ragQuery(fq, 6, null)
          if (rows.length) break
        }
      }
      return rows
    })(),
    systemIntent
      ? ragQuery('OneAI 系統架構 worker cursor 部署', 4, 'system')
      : Promise.resolve([]),
    detectAgentsLLM(userMsg, ''),
  ])
  const memories = filterMemories(rawMemories, userMsg)
  const systemMemories = filterSystemMemories(rawSystem)
  const memoryBlock = buildMemoryBlock(memories) + buildSystemKnowledgeBlock(systemMemories) + workerBlock
  emit('rag_done', { count: memories.length, system: systemMemories.length })

  const butlerKws = ROUTING_TRIGGERS.butler ?? []
  let agentIds = mergeAgentRoute(agentIdsFromLLM, userMsg, RESEARCH_KWS, butlerKws)
  if (deepResearchFallback && !agentIds.includes('researcher')) {
    agentIds = ['researcher', ...agentIds]
  }

  const roster = buildCouncilRoster(userMsg, agentIds)
  agentIds = roster.agentIds.length ? roster.agentIds : agentIds
  agentIds = [...new Set(agentIds)].slice(0, 4)
  emit('route_done', {
    agents: agentIds.length ? agentIds : ['coach'],
    squad: roster.squad,
    squad_display: roster.squad_display,
    mode: agentIds.length >= 2 ? 'council' : 'fast',
  })

  // ③ 梅蘭直答
  if (agentIds.length === 0) {
    const r = await callOpenRouter(CHAT_DEFAULT_MODEL, [
      { role: 'system', content: AGENT_SYSTEMS.coach + memoryBlock },
      ...messages,
    ])
    const { remembered, writeDecision } = await persistIfNeeded(r.reply, [])
    emit('synth_done')
    return {
      reply: r.reply,
      model: r.model,
      agents: [{ id: 'coach', icon: '🌸', display: '梅蘭', reply: r.reply, model: r.model }],
      memories_used: memories.length,
      brain: buildBrainMeta(memories, remembered, writeDecision),
      synthesis: false,
      workers: workerCtx.summary,
    }
  }

  // ④ 搜尋
  let searchResults = ''
  let webSearchMeta = null
  if (agentIds.includes('researcher')) {
    emit('search_start')
    const q = cleanSearchQuery(userMsg)
    const search = await webSearchCached(q, 5)
    webSearchMeta = {
      query: q.slice(0, 120),
      provider: search.provider,
      sources: search.sources,
      snippets: search.snippets,
      result_count: search.snippets.length,
    }
    searchResults = `\n\n【網路搜尋結果（${q.slice(0, 80)}）】\n${search.snippets.join('\n\n')}\n`
    emit('search_done', { provider: search.provider, count: search.snippets.length })
  }

  // ⑤ 子 Agent — 議會模式（≥2 人共享 thread 辯論）或單人快徑
  const councilMode = needsCouncil(userMsg, agentIds)
  let succeeded = []
  let councilMeta = null
  let councilTranscript = null

  const councilDeps = {
    callOpenRouter,
    getAgentSystem: getAgentSystem ?? ((id) => AGENT_SYSTEMS[id]),
    getAgentMeta: getAgentMeta ?? ((id) => AGENTS_META[id] ?? { icon: '🤖', display: id }),
    getAgentModel,
    CHAT_DEFAULT_MODEL,
    CHAT_FALLBACK_CHAIN,
    emit,
  }

  if (councilMode && agentIds.length >= 2) {
    const councilResult = await runCouncil(councilDeps, {
      agentIds,
      userMsg,
      messages,
      memoryBlock,
      searchBlock: searchResults,
      emit,
    })
    succeeded = councilResult.succeeded
    councilMeta = councilResult.council
    councilTranscript = councilResult.transcript
    if (!succeeded.length) throw new Error('議會無有效發言')
  } else {
    const subResults = await Promise.allSettled(
      agentIds.map(async (id) => {
        const agentCfg = AGENTS_CONFIG.agents?.[id] ?? {}
        const meta = (getAgentMeta?.(id)) ?? AGENTS_META[id] ?? { icon: '🤖', display: id }
        const baseSystem = (getAgentSystem?.(id)) ?? AGENT_SYSTEMS[id] ?? `${MENGYI_BRIEF}\n你是孟一的 AI 助理，用繁體中文簡潔回覆。`
        const agentSystem = baseSystem + memoryBlock + (id === 'researcher' ? searchResults : '')
        const agentModel = getAgentModel?.(id) ?? agentCfg.model ?? CHAT_DEFAULT_MODEL
        const finalMsgs = [{ role: 'system', content: agentSystem }, ...messages]
        const tryList = [agentModel, ...CHAT_FALLBACK_CHAIN.filter(m => m !== agentModel)]
        let lastErr = ''
        for (const m of tryList) {
          try {
            const r = await callOpenRouter(m, finalMsgs)
            emit('agent_done', { id })
            return { id, icon: meta.icon, display: meta.display, reply: r.reply, model: r.model }
          } catch (e) {
            lastErr = e.message
          }
        }
        throw new Error(`[${id}] 所有模型失敗: ${lastErr}`)
      }),
    )
    succeeded = subResults.filter(r => r.status === 'fulfilled').map(r => r.value)
    if (!succeeded.length) throw new Error('所有子 Agent 失敗')
  }

  // ⑥ 合成 — 議會由梅蘭 COO Briefing；其餘沿用原合成邏輯
  let finalReply
  let finalModel
  const needsSynth = councilMode
    ? true
    : (shouldAlwaysSynthesize()
      ? succeeded.length >= 1
      : succeeded.length > 1 || (webSearchMeta && succeeded.length >= 1))

  if (!needsSynth) {
    finalReply = enforceSearchReply(enrichSearchReply(succeeded[0].reply, webSearchMeta), webSearchMeta)
    finalModel = succeeded[0].model
  } else if (councilMode && councilTranscript) {
    const briefing = await runCooBriefing(councilDeps, {
      userMsg,
      transcript: councilTranscript,
      memoryBlock,
      searchBlock: searchResults,
      workerHint: workerCtx.offlineHint,
      emit,
    })
    finalReply = enforceSearchReply(enrichSearchReply(briefing.reply, webSearchMeta), webSearchMeta)
    finalModel = briefing.model
    emit('synth_done')
  } else {
    emit('synth_start')
    const synthContext = succeeded.map(a => `[${a.icon} ${a.display} · 內部速報]\n${a.reply}`).join('\n\n---\n\n')
    const synthSystem = `${AGENT_SYSTEMS.coach}${memoryBlock}${searchResults}${MEILAN_SYNTHESIS_BRIEF}
${succeeded.length === 1 ? '僅一位專家：仍請以營運長口吻完整回覆孟一，不要只轉貼速報。' : '整合多位專家意見。'}
若含搜尋：必須列出至少 3 個關鍵發現，每項附來源標題。${workerCtx.offlineHint}`
    const synth = await callOpenRouter(CHAT_DEFAULT_MODEL, [
      { role: 'system', content: synthSystem },
      { role: 'user', content: `孟一：${userMsg}\n\n專家：\n${synthContext}\n\n整合：` },
    ])
    finalReply = enforceSearchReply(enrichSearchReply(synth.reply, webSearchMeta), webSearchMeta)
    finalModel = synth.model
    emit('synth_done')
  }

  const { remembered, writeDecision } = await persistIfNeeded(finalReply, agentIds)

  let replyOut = finalReply
  if (deepResearchFallback && !String(replyOut).includes('Cursor worker 離線')) {
    replyOut = buildDeepResearchFallbackNote() + replyOut
  }

  // Skill 自動生成（engineer 參與且回覆含程式）
  const engineerAgent = succeeded.find(a => a.id === 'engineer')
  const codeBlock = engineerAgent ? extractCodeBlock(engineerAgent.reply) : null
  if (engineerAgent && codeBlock) {
    const skillMd = `# Skill: ${userMsg.slice(0, 40)}\n\n## 觸發\n${userMsg.slice(0, 120)}\n\n## 程式\n\`\`\`\n${codeBlock.slice(0, 800)}\n\`\`\`\n`
    await ragRememberSmart(skillMd, `skill-${Date.now()}`, 'sop')
    emit('skill_saved', { agent: 'engineer' })
  }

  // ⑦ COO Handoff（OneAI 2.0 — 明確執行意圖 → Cloud GHA / Cursor 提示）
  let handoff = null
  const handoffResult = await runCooHandoff(deps, { userMsg, reply: replyOut, codeBlock, emit })
  if (handoffResult) {
    replyOut += handoffResult.replyAppend
    handoff = handoffResult.handoff
  }

  return {
    reply: replyOut,
    model: finalModel,
    agents: succeeded,
    orchestrator: { id: 'coach', display: '梅蘭', role: councilMode ? 'coo_chair' : 'coo_synthesis' },
    memories_used: memories.length,
    brain: buildBrainMeta(memories, remembered, writeDecision),
    synthesis: needsSynth,
    workers: workerCtx.summary,
    ...(councilMeta ? { council: councilMeta } : {}),
    ...(councilTranscript ? { council_transcript: buildCouncilSummaryForResponse(councilTranscript) } : {}),
    ...(roster.squad ? { squad: roster.squad, squad_display: roster.squad_display } : {}),
    ...(webSearchMeta ? { web_search: webSearchMeta } : {}),
    ...(codeBlock ? { can_execute: true, execute_code: codeBlock } : {}),
    ...(handoff ? { handoff } : {}),
  }
}
