/**
 * 版本演進議會 — 離線結構化辯論（OneAI 2.0→10.0 管線）
 * 輸入：diagnostic + GTX 失敗 + 使用者模擬失敗
 * 輸出：2 輪 transcript + COO 定稿（可選 LLM 增強）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROADMAP = JSON.parse(readFileSync(join(ROOT, 'config/oneai.version-roadmap.json'), 'utf-8'))

const PERSONAS = {
  coach: {
    icon: '🌸',
    display: '梅蘭 COO',
    opening: (ctx) =>
      `【開場】${ctx.version} 週期診斷：GTX 自動 ${ctx.gtxPass}/${ctx.gtxTotal}，使用者模擬 ${ctx.userPass}/${ctx.userTotal}。\n` +
      `GA 門檻：GTX≥${ctx.gtxTarget}、使用者模擬≥${ctx.userSimMin}${ctx.expectedVersion ? `、版本=${ctx.expectedVersion}` : ''}。\n` +
      `P0 阻塞：${ctx.blockers.join('；') || '無'}。\n` +
      `我建議以「多贏、拒絕零和」篩選：先修根因（LLM/Volume/Worker），再衝 Wave 交付。`,
    rebuttal: (ctx) =>
      `【回應】同意工程與管家優先序。但若使用者仍看到 502，PWA 議會 UI 再漂亮也無意義。\n` +
      `定稿：本週 P0 = ${ctx.p0Actions.slice(0, 3).join(' → ')}。`,
  },
  engineer: {
    icon: '💻',
    display: '工程師',
    opening: (ctx) =>
      `【開場】失敗項：${ctx.failures.slice(0, 5).join(' | ') || '無自動失敗'}。\n` +
      `#34 Cursor 需 cursor_worker 常駐或改 Cloud-First 預設。\n` +
      `Handoff 已接 2.0，但 GITHUB_TOKEN 未設會 503。`,
    rebuttal: (ctx) =>
      `【回應】PM 說的驗收腳本要進 CI；我補：rag Volume 掛載應寫進 zeabur redeploy 一鍵腳本。`,
  },
  pm: {
    icon: '📋',
    display: 'PM',
    opening: (ctx) =>
      `【開場】下一版 ${ctx.nextVersion}（${ctx.nextCodename}）焦點：${ctx.nextDeliverables.slice(0, 2).join('、')}。\n` +
      `本週文檔須同步：deploy-state、23-release、本 cycle report。`,
    rebuttal: (ctx) =>
      `【回應】安全審計員提醒的 HITL 可放到 ${ctx.hitlVersion}，不阻塞 ${ctx.nextVersion} GA。`,
  },
  researcher: {
    icon: '🔬',
    display: '研究員',
    opening: (ctx) =>
      `【開場】搜尋/深研情境失敗多與 502 同源。\n` +
      `Tavily 有 key 時 R 維度應 ≥2；需分離「上游掛」與「路由錯」。`,
    rebuttal: (ctx) =>
      `【回應】同意。GTX 報告應標註 failure_class: upstream|routing|worker。`,
  },
  butler: {
    icon: '🫀',
    display: '管家',
    opening: (ctx) =>
      `【開場】記憶情境 #02 #03 若 LLM 正常應綠。\n` +
      `curate/graph 502 是 rag 映像問題，非 butler 邏輯。`,
    rebuttal: (ctx) =>
      `【回應】4.0 再做 FAMA；2.0/3.0 先確保寫入/召回不被 502 污染假陽性。`,
  },
  security_auditor: {
    icon: '🛡️',
    display: '安全審計',
    opening: (ctx) =>
      `【開場】token 分離（#85）已配置則 OK。\n` +
      `Handoff 派工須審核高風險 deploy-rag；建議 7.0 全面 HITL。`,
    rebuttal: (ctx) =>
      `【回應】同意延後全面 HITL，但 smoke/gtx 派工應寫入 action-log 可追溯。`,
  },
}

function buildContext(input) {
  const ver = input.version ?? '2.0'
  const vCfg = ROADMAP.versions[ver] ?? {}
  const keys = Object.keys(ROADMAP.versions).sort((a, b) => parseFloat(a) - parseFloat(b))
  const idx = keys.indexOf(ver)
  const nextKey = keys[idx + 1] ?? '10.0'
  const nextCfg = ROADMAP.versions[nextKey] ?? {}

  const failures = [
    ...(input.gtx_failures ?? []).map(f => `#${f.id} ${f.title}`),
    ...(input.user_sim_failures ?? []).map(f => f.name ?? f.scenario),
  ]

  const blockers = vCfg.next_blockers ?? input.blockers ?? []
  const p0Actions = [
    blockers[0] ? `修復 ${blockers[0]}` : null,
    failures[0] ? `修復 ${failures[0]}` : null,
    `更新 docs/evolution/${ver}-cycle-report.md`,
    `準備 ${nextKey} wave 交付`,
  ].filter(Boolean)

  const ga = vCfg.ga_criteria ?? {}
  return {
    version: ver,
    nextVersion: nextKey,
    nextCodename: nextCfg.codename ?? '',
    nextDeliverables: nextCfg.wave_deliverables ?? [],
    hitlVersion: '7.0',
    gtxPass: input.gtx_pass ?? 0,
    gtxTotal: input.gtx_total ?? 0,
    gtxTarget: ga.gtx_auto_pass_min ?? Math.ceil((input.gtx_auto_total ?? 22) * ROADMAP.pipeline.gtx_target_pass_rate),
    userPass: input.user_sim_pass ?? 0,
    userTotal: input.user_sim_total ?? 0,
    userSimMin: ga.user_sim_pass_min ?? ROADMAP.pipeline.user_sim_min_pass ?? 8,
    expectedVersion: ga.health_version ?? null,
    failures,
    blockers,
    p0Actions,
  }
}

export function runEvolutionCouncil(input) {
  const agentIds = ROADMAP.pipeline.debate_agents ?? Object.keys(PERSONAS)
  const ctx = buildContext(input)
  const transcript = []

  // Round 1 — opening
  const r1 = { round: 1, phase: 'opening', entries: [] }
  for (const id of agentIds) {
    const p = PERSONAS[id]
    if (!p) continue
    r1.entries.push({
      agent: id,
      icon: p.icon,
      display: p.display,
      reply: p.opening(ctx),
    })
  }
  transcript.push(r1)

  // Round 2 — rebuttal
  const r2 = { round: 2, phase: 'rebuttal', entries: [] }
  for (const id of agentIds) {
    const p = PERSONAS[id]
    if (!p) continue
    r2.entries.push({
      agent: id,
      icon: p.icon,
      display: p.display,
      reply: p.rebuttal(ctx),
    })
  }
  transcript.push(r2)

  const gatePassed =
    ctx.gtxPass >= (ROADMAP.versions[ctx.version]?.ga_criteria?.gtx_auto_pass_min ?? 18) &&
    ctx.userPass >= (ROADMAP.versions[ctx.version]?.ga_criteria?.user_sim_pass_min ?? ROADMAP.pipeline.user_sim_min_pass ?? 8) &&
    (!ctx.expectedVersion || input.health_version_ok !== false)

  const cooBriefing = {
    agent: 'coach',
    icon: '🌸',
    display: '梅蘭 COO 定稿',
    reply:
      `【營運長定稿 · ${ctx.version} 週期】\n\n` +
      `1. **診斷**：GTX ${ctx.gtxPass}/${ctx.gtxTotal}；使用者模擬 ${ctx.userPass}/${ctx.userTotal}。\n` +
      `2. **GA 判定**：${gatePassed ? '✅ 達本版自動門檻（程式 GA）' : '⚠️ 未達門檻，續跑優化 loop'}。\n` +
      `3. **P0 行動**：\n${ctx.p0Actions.map((a, i) => `   ${i + 1}. ${a}`).join('\n')}\n` +
      `4. **下一版 ${ctx.nextVersion}（${ctx.nextCodename}）**：${ctx.nextDeliverables.slice(0, 3).join('；')}。\n` +
      `5. **多贏原則**：修根因讓孟一、雲端、本機 worker 三方都受益，不做零和裁剪功能。`,
  }

  return {
    version: ctx.version,
    council: {
      mode: 'evolution_offline',
      rounds: 2,
      participants: agentIds,
      gate_passed: gatePassed,
    },
    transcript,
    coo_briefing: cooBriefing,
    next_version: ctx.nextVersion,
    p0_actions: ctx.p0Actions,
  }
}

function formatMarkdown(result) {
  let md = `# OneAI ${result.version} 議會辯論紀錄\n\n`
  md += `> 模式：evolution_offline · 參與：${result.council.participants.join(', ')}\n\n`
  for (const round of result.transcript) {
    md += `## 第 ${round.round} 輪 · ${round.phase}\n\n`
    for (const e of round.entries) {
      md += `### ${e.icon} ${e.display}\n\n${e.reply}\n\n`
    }
  }
  md += `## ${result.coo_briefing.icon} ${result.coo_briefing.display}\n\n${result.coo_briefing.reply}\n`
  return md
}

// CLI
if (process.argv[1]?.includes('version-council-debate')) {
  const inPath = process.argv[2]
  const outDir = process.argv[3] ?? join(ROOT, 'docs/evolution')
  if (!inPath) {
    console.error('Usage: node scripts/version-council-debate.js <input.json> [outDir]')
    process.exit(1)
  }
  const input = JSON.parse(readFileSync(inPath, 'utf-8'))
  const result = runEvolutionCouncil(input)
  mkdirSync(outDir, { recursive: true })
  const ver = result.version
  writeFileSync(join(outDir, `council-${ver}.json`), JSON.stringify(result, null, 2), 'utf-8')
  writeFileSync(join(outDir, `council-${ver}.md`), formatMarkdown(result), 'utf-8')
  console.log(JSON.stringify({ ok: true, version: ver, gate_passed: result.council.gate_passed, outDir }))
}
