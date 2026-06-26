/**
 * COO Handoff — 議會/定稿後派工（OneAI 2.0 Wave 1）
 * 明確執行意圖 → Cloud GHA 或提示 Cursor 確認
 */

const EXECUTE_RE = /執行|幫我部署|馬上|立刻|gogo|go go|幫我跑|trigger|跑一下/i

const CLOUD_RULES = [
  { job: 'deploy-rag', re: /deploy.*rag|部署.*rag|rag.*部署|redeploy.*rag/i },
  { job: 'gtx-p0', re: /\bgtx\b|gtx-p0|gtx100/i },
  { job: 'smoke', re: /smoke|煙霧|brain-smoke|e2e/i },
]

/** @returns {{ channel: string, job?: string, reason: string } | null} */
export function detectHandoffIntent(userMsg, reply = '') {
  const combined = `${userMsg}\n${reply}`
  const explicit = EXECUTE_RE.test(userMsg)
  if (!explicit) return null

  for (const rule of CLOUD_RULES) {
    if (rule.re.test(combined)) {
      return { channel: 'cloud_hand', job: rule.job, reason: `match ${rule.job}` }
    }
  }

  if (/cursor|送到桌機|本機執行/i.test(combined)) {
    return { channel: 'cursor_hint', reason: 'needs PWA Cursor 確認' }
  }

  return null
}

/**
 * @returns {{ handoff: object, replyAppend: string } | null}
 */
export async function runCooHandoff(deps, input) {
  const { userMsg, reply, codeBlock, emit = () => {} } = input
  const plan = detectHandoffIntent(userMsg, reply)
  if (!plan) return null

  if (plan.channel === 'cursor_hint' && codeBlock) {
    return {
      handoff: { channel: 'cursor', status: 'await_confirm', reason: plan.reason },
      replyAppend: '\n\n💻 工程師方案已備妥 — 請在 PWA 點「送到 Cursor」執行。',
    }
  }

  if (plan.channel !== 'cloud_hand' || !plan.job) return null

  const { triggerCloudHand, randomId } = deps
  if (!triggerCloudHand) return null

  emit('handoff_start', { channel: 'cloud_hand', job: plan.job })
  const taskId = randomId?.() ?? `handoff-${Date.now()}`
  const out = await triggerCloudHand(plan.job, { taskId, triggeredBy: 'coo-handoff' })

  if (!out.ok) {
    emit('handoff_done', { ok: false, job: plan.job })
    return {
      handoff: { channel: 'cloud_hand', job: plan.job, status: 'error', error: out.error },
      replyAppend: `\n\n⚠️ 雲端派工失敗（${plan.job}）：${out.error}\n請在 Zeabur 設定 GITHUB_TOKEN 或改走本機 worker。`,
    }
  }

  emit('handoff_done', { ok: true, job: plan.job, task_id: taskId })
  return {
    handoff: {
      channel: 'cloud_hand',
      job: plan.job,
      status: 'running',
      task_id: taskId,
      poll: out.poll,
      repo: out.repo,
    },
    replyAppend: `\n\n☁️ 已派工 **${plan.job}**（Cloud GHA）\ntask: \`${taskId.slice(0, 8)}…\`\n追蹤：${out.poll}`,
  }
}
