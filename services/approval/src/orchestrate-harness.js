/**
 * 單一 Orchestrate Harness — chat / SSE 共用同一套大腦邏輯。
 * emit(phase, data?) 供 SSE 推送真實進度。
 */
import {
  filterMemories,
  isSmallTalk,
  needsExplicitRemember,
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
  classifyMemoryKind,
} from './brain-intel.js'

export async function runOrchestrateTurn(deps, input) {
  const {
    userMsg,
    messages,
    emit = () => {},
  } = input

  const {
    ragQuery,
    ragRememberSmart,
    webSearchCached,
    detectAgentsLLM,
    callOpenRouter,
    listWorkers,
    AGENT_SYSTEMS,
    AGENTS_META,
    AGENTS_CONFIG,
    CHAT_DEFAULT_MODEL,
    CHAT_FALLBACK_CHAIN,
    RESEARCH_KWS,
    ROUTING_TRIGGERS,
    extractCodeBlock,
    MENGYI_BRIEF,
  } = deps

  const smallTalk = isSmallTalk(userMsg)
  const explicitRemember = needsExplicitRemember(userMsg)

  const persistIfNeeded = async (reply, agentIds = []) => {
    const remembered = shouldRemember(userMsg, reply, { explicitRemember, smallTalk })
    if (remembered) {
      const p = formatRememberPayload(userMsg, reply, explicitRemember)
      const kind = classifyMemoryKind(userMsg, explicitRemember)
      await ragRememberSmart(p.text, p.title, kind)
      emit('memory_saved', { kind })
    }
    return remembered
  }

  const workerCtx = buildWorkerContext(listWorkers())
  const workerBlock = workerCtx.block

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

  // ② RAG + 路由並行（召回時不過濾 kind — 舊 chunk 可能無 metadata）
  emit('rag_start')
  const recallIntent = needsRecall(userMsg) || explicitRemember
  const [rawMemories, agentIdsFromLLM] = await Promise.all([
    ragQuery(userMsg, recallIntent ? 6 : 4, null),
    detectAgentsLLM(userMsg, ''),
  ])
  const memories = filterMemories(rawMemories, userMsg)
  const memoryBlock = buildMemoryBlock(memories) + workerBlock
  emit('rag_done', { count: memories.length })

  const butlerKws = ROUTING_TRIGGERS.butler ?? []
  const agentIds = mergeAgentRoute(agentIdsFromLLM, userMsg, RESEARCH_KWS, butlerKws)
  emit('route_done', { agents: agentIds.length ? agentIds : ['coach'] })

  // ③ 梅蘭直答
  if (agentIds.length === 0) {
    const r = await callOpenRouter(CHAT_DEFAULT_MODEL, [
      { role: 'system', content: AGENT_SYSTEMS.coach + memoryBlock },
      ...messages,
    ])
    const remembered = await persistIfNeeded(r.reply, [])
    emit('synth_done')
    return {
      reply: r.reply,
      model: r.model,
      agents: [{ id: 'coach', icon: '🌸', display: '梅蘭', reply: r.reply, model: r.model }],
      memories_used: memories.length,
      brain: buildBrainMeta(memories, remembered),
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

  // ⑤ 子 Agent 並行
  const subResults = await Promise.allSettled(
    agentIds.map(async (id) => {
      const agentCfg = AGENTS_CONFIG.agents?.[id] ?? {}
      const meta = AGENTS_META[id] ?? { icon: '🤖', display: id }
      const baseSystem = AGENT_SYSTEMS[id] ?? `${MENGYI_BRIEF}\n你是孟一的 AI 助理，用繁體中文簡潔回覆。`
      const agentSystem = baseSystem + memoryBlock + (id === 'researcher' ? searchResults : '')
      const agentModel = agentCfg.model ?? CHAT_DEFAULT_MODEL
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

  const succeeded = subResults.filter(r => r.status === 'fulfilled').map(r => r.value)
  if (!succeeded.length) throw new Error('所有子 Agent 失敗')

  // ⑥ 合成
  let finalReply
  let finalModel
  const needsSynth = succeeded.length > 1 || (webSearchMeta && succeeded.length >= 1)

  if (!needsSynth) {
    finalReply = enforceSearchReply(enrichSearchReply(succeeded[0].reply, webSearchMeta), webSearchMeta)
    finalModel = succeeded[0].model
  } else {
    emit('synth_start')
    const synthContext = succeeded.map(a => `[${a.icon} ${a.display}]\n${a.reply}`).join('\n\n---\n\n')
    const synthSystem = `${AGENT_SYSTEMS.coach}${memoryBlock}${searchResults}
作為孟一的營運長，整合專家意見，用嚴格直率的繁體中文給最終建議。
若含搜尋：必須列出至少 3 個關鍵發現，每項附來源標題。${workerCtx.offlineHint}`
    const synth = await callOpenRouter(CHAT_DEFAULT_MODEL, [
      { role: 'system', content: synthSystem },
      { role: 'user', content: `孟一：${userMsg}\n\n專家：\n${synthContext}\n\n整合：` },
    ])
    finalReply = enforceSearchReply(enrichSearchReply(synth.reply, webSearchMeta), webSearchMeta)
    finalModel = synth.model
    emit('synth_done')
  }

  const remembered = await persistIfNeeded(finalReply, agentIds)

  // Skill 自動生成（engineer 參與且回覆含程式）
  const engineerAgent = succeeded.find(a => a.id === 'engineer')
  const codeBlock = engineerAgent ? extractCodeBlock(engineerAgent.reply) : null
  if (engineerAgent && codeBlock) {
    const skillMd = `# Skill: ${userMsg.slice(0, 40)}\n\n## 觸發\n${userMsg.slice(0, 120)}\n\n## 程式\n\`\`\`\n${codeBlock.slice(0, 800)}\n\`\`\`\n`
    await ragRememberSmart(skillMd, `skill-${Date.now()}`, 'sop')
    emit('skill_saved', { agent: 'engineer' })
  }

  return {
    reply: finalReply,
    model: finalModel,
    agents: succeeded,
    memories_used: memories.length,
    brain: buildBrainMeta(memories, remembered),
    synthesis: needsSynth,
    workers: workerCtx.summary,
    ...(webSearchMeta ? { web_search: webSearchMeta } : {}),
    ...(codeBlock ? { can_execute: true, execute_code: codeBlock } : {}),
  }
}
