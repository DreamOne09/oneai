/**
 * Agent Council — 共享 thread 多輪辯論
 */
import { MEILAN_SYNTHESIS_BRIEF } from './caveman-style.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

function loadCouncilConfig() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(dir, '..', '..', '..', 'config/oneai.council.json'), 'utf-8'))
  } catch {
    return { enabled: true, default_max_rounds: 2 }
  }
}

function loadDreamTeam() {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    return JSON.parse(readFileSync(join(dir, '..', '..', '..', 'config/oneai.dream-team.json'), 'utf-8'))
  } catch {
    return { squads: {}, ad_hoc_pool: [] }
  }
}

export function getCouncilLimits() {
  const c = loadCouncilConfig()
  return {
    maxStaff: c.max_staff ?? 36,
    maxCouncilParticipants: c.max_council_participants ?? 6,
    defaultMaxRounds: c.default_max_rounds ?? 2,
    highStakesMaxRounds: c.high_stakes_max_rounds ?? 3,
  }
}

export function needsCouncil(userMsg, agentIds, config = loadCouncilConfig()) {
  if (!config.enabled) return false
  const force = (config.force_triggers ?? []).some(t =>
    userMsg.toLowerCase().includes(String(t).toLowerCase()),
  )
  if (force) return true
  return (agentIds?.length ?? 0) >= (config.min_agents_for_council ?? 2)
}

export function pickSquadForMessage(userMsg) {
  const dream = loadDreamTeam()
  const t = userMsg.toLowerCase()
  for (const [key, squad] of Object.entries(dream.squads ?? {})) {
    if ((squad.triggers ?? []).some(kw => t.includes(String(kw).toLowerCase()))) {
      return { id: key, ...squad }
    }
  }
  return null
}

export function pickAdHocExperts(userMsg) {
  const dream = loadDreamTeam()
  const t = userMsg.toLowerCase()
  return (dream.ad_hoc_pool ?? []).filter(expert =>
    (expert.triggers ?? []).some(kw => t.includes(String(kw).toLowerCase())),
  )
}

export function formatTranscriptForAgent(transcript, agentId) {
  if (!transcript?.length) return ''
  let out = '\n\n【議事錄 — 本回合前辦公室已有發言】\n'
  for (const round of transcript) {
    out += `\n--- 第 ${round.round} 輪 · ${round.phase} ---\n`
    for (const entry of round.entries ?? []) {
      const label = entry.agent === agentId ? `[你 · ${entry.display}]` : `[${entry.icon ?? ''} ${entry.display}]`
      out += `${label}\n${entry.reply}\n\n`
    }
  }
  return out
}

async function callAgentTurn(deps, agentId, ctx) {
  const {
    callOpenRouter,
    getAgentSystem,
    getAgentMeta,
    getAgentModel,
    CHAT_DEFAULT_MODEL,
    CHAT_FALLBACK_CHAIN,
    emit,
  } = deps

  const meta = getAgentMeta(agentId) ?? { icon: '🤖', display: agentId }
  const baseSystem = getAgentSystem(agentId)
  if (!baseSystem) throw new Error(`未知議員 ${agentId}`)

  const councilCfg = loadCouncilConfig()
  const phaseInstruction = ctx.phase === 'opening'
    ? councilCfg.opening_instruction
    : councilCfg.rebuttal_instruction

  const transcriptBlock = formatTranscriptForAgent(ctx.transcript ?? [], agentId)
  const system = `${baseSystem}${ctx.memoryBlock ?? ''}${ctx.searchBlock ?? ''}
${transcriptBlock}
【本輪：${ctx.phase}】
${phaseInstruction}
${ctx.phase === 'rebuttal' ? '必須引用至少一位其他議員的論點（同意或反駁）。' : ''}`

  const userContent = ctx.phase === 'opening'
    ? `孟一：${ctx.userMsg}\n\n請發表開宗明義。`
    : `孟一：${ctx.userMsg}\n\n請閱讀議事錄並回應。`

  const agentModel = getAgentModel(agentId) ?? CHAT_DEFAULT_MODEL
  const tryList = [agentModel, ...CHAT_FALLBACK_CHAIN.filter(m => m !== agentModel)]
  let lastErr = ''
  for (const m of tryList) {
    try {
      const r = await callOpenRouter(m, [
        { role: 'system', content: system },
        ...(ctx.messages ?? []).slice(0, -1),
        { role: 'user', content: userContent },
      ], { max_tokens: 1400 })
      emit?.('council_agent_done', { id: agentId, phase: ctx.phase, round: ctx.round })
      return {
        agent: agentId,
        display: meta.display,
        icon: meta.icon,
        reply: r.reply,
        model: r.model,
        phase: ctx.phase,
        round: ctx.round,
      }
    } catch (e) {
      lastErr = e.message
    }
  }
  throw new Error(`[${agentId}] 議會失敗: ${lastErr}`)
}

export async function runCouncil(deps, input) {
  const {
    agentIds,
    userMsg,
    messages,
    memoryBlock = '',
    searchBlock = '',
    emit = () => {},
    maxRounds: maxRoundsIn,
  } = input

  const councilCfg = loadCouncilConfig()
  const highStakes = (councilCfg.high_stakes_triggers ?? []).some(t =>
    userMsg.toLowerCase().includes(String(t).toLowerCase()),
  )
  const limits = getCouncilLimits()
  const maxRounds = maxRoundsIn ?? (highStakes
    ? limits.highStakesMaxRounds
    : limits.defaultMaxRounds)

  const transcript = []
  emit('council_start', {
    agents: agentIds,
    max_rounds: maxRounds,
    participants: agentIds.length,
    mode: highStakes ? 'council_high_stakes' : 'council',
  })

  emit('council_round', { round: 1, phase: 'opening', label: '第 1 輪 · 開宗明義' })
  const openingResults = await Promise.allSettled(
    agentIds.map(id => callAgentTurn(deps, id, {
      phase: 'opening',
      round: 1,
      userMsg,
      messages,
      memoryBlock,
      searchBlock,
      transcript: [],
    })),
  )
  const openings = openingResults.filter(r => r.status === 'fulfilled').map(r => r.value)
  if (!openings.length) throw new Error('議會第一輪全部失敗')
  transcript.push({ round: 1, phase: 'opening', entries: openings })

  for (let round = 2; round <= maxRounds; round++) {
    emit('council_round', {
      round,
      phase: 'rebuttal',
      label: `第 ${round} 輪 · 交叉辯論`,
      max_rounds: maxRounds,
    })
    const rebuttals = []
    for (const id of agentIds) {
      if (!openings.some(o => o.agent === id)) continue
      try {
        const entry = await callAgentTurn(deps, id, {
          phase: 'rebuttal',
          round,
          userMsg,
          messages,
          memoryBlock,
          searchBlock,
          transcript,
        })
        rebuttals.push(entry)
      } catch (e) {
        console.warn(`[council] ${id} round ${round}:`, e.message)
      }
    }
    if (rebuttals.length) transcript.push({ round, phase: 'rebuttal', entries: rebuttals })
  }

  emit('council_done', { rounds: transcript.length })
  const lastByAgent = new Map()
  for (const round of transcript) {
    for (const e of round.entries ?? []) lastByAgent.set(e.agent, e)
  }

  return {
    transcript,
    succeeded: agentIds.map(id => {
      const last = lastByAgent.get(id)
      const open = openings.find(o => o.agent === id)
      return {
        id,
        icon: last?.icon ?? open?.icon ?? '🤖',
        display: last?.display ?? open?.display ?? id,
        reply: last?.reply ?? open?.reply ?? '',
        model: last?.model ?? open?.model,
      }
    }).filter(s => s.reply),
    council: {
      mode: highStakes ? 'debate_high_stakes' : 'debate',
      rounds: transcript.length,
      max_rounds: maxRounds,
      thread_id: `council-${Date.now()}`,
      participants: agentIds,
    },
  }
}

export async function runCooBriefing(deps, input) {
  const {
    callOpenRouter,
    getAgentSystem,
    CHAT_DEFAULT_MODEL,
    userMsg,
    transcript,
    memoryBlock = '',
    searchBlock = '',
    workerHint = '',
    emit = () => {},
  } = input

  const councilCfg = loadCouncilConfig()
  const coachSystem = getAgentSystem('coach') ?? ''
  let transcriptText = ''
  for (const round of transcript ?? []) {
    transcriptText += `\n### 第 ${round.round} 輪 · ${round.phase}\n`
    for (const e of round.entries ?? []) {
      transcriptText += `\n**${e.display}** (${e.agent}):\n${e.reply}\n`
    }
  }

  emit('coo_briefing_start')
  const synth = await callOpenRouter(CHAT_DEFAULT_MODEL, [
    {
      role: 'system',
      content: `${coachSystem}${memoryBlock}${searchBlock}${MEILAN_SYNTHESIS_BRIEF}\n${councilCfg.coo_briefing_instruction ?? ''}${workerHint}`,
    },
    {
      role: 'user',
      content: `孟一：${userMsg}\n\n【完整議事錄】\n${transcriptText}\n\n定稿：`,
    },
  ], { max_tokens: 1800 })

  emit('coo_briefing_done')
  return { reply: synth.reply, model: synth.model }
}

export function buildCouncilSummaryForResponse(transcript) {
  return (transcript ?? []).map(r => ({
    round: r.round,
    phase: r.phase,
    entries: (r.entries ?? []).map(e => ({
      agent: e.agent,
      display: e.display,
      excerpt: String(e.reply ?? ''),
    })),
  }))
}
