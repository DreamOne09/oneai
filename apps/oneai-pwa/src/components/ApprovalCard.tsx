import { AnimatePresence, motion } from 'framer-motion'
import { useOneAI } from '../state/store'
import { decide } from '../lib/approval'
import type { ApprovalAction } from '../types'

const ACTION_LABEL: Record<ApprovalAction, string> = {
  send_email: '寄出 Email',
  spend_money: '花費 / 下單',
  publish: '發布內容',
  delete_file: '刪除檔案',
  run_command: '執行指令',
}

// 招2 防操弄:從 details 取出「真正要執行的原始參數」直接攤給使用者看
function rawDetail(details?: Record<string, unknown>): string {
  if (!details) return ''
  const d = details as { cmd?: unknown; prompt?: unknown }
  if (typeof d.cmd === 'string') return d.cmd
  if (typeof d.prompt === 'string') return d.prompt
  return JSON.stringify(details)
}

export default function ApprovalCard() {
  const approvals = useOneAI((s) => s.approvals)
  const resolveApproval = useOneAI((s) => s.resolveApproval)
  const pushActivity = useOneAI((s) => s.pushActivity)
  const setStatus = useOneAI((s) => s.setStatus)
  const top = approvals[0]

  const onDecide = async (id: string, d: 'approve' | 'reject', token?: string) => {
    resolveApproval(id)
    const ok = await decide(id, d, token)
    pushActivity(d === 'approve' ? 'result' : 'warning', `${d === 'approve' ? '已授權' : '已拒絕'}${ok ? '' : '(回報失敗)'}`)
    if (d === 'approve') {
      setStatus('success')
      setTimeout(() => setStatus('idle'), 1800)
    }
  }

  return (
    <AnimatePresence>
      {top && (
        <motion.div
          key={top.id}
          className="approval glass"
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        >
          <div className="approval-head">
            <span className="approval-badge">需要授權</span>
            <span className="approval-action">{ACTION_LABEL[top.action] ?? top.action}</span>
          </div>
          <p className="approval-summary">{top.summary}</p>
          {rawDetail(top.details) && (
            <pre className="approval-detail" aria-label="實際執行內容">
              {rawDetail(top.details)}
            </pre>
          )}
          <div className="approval-actions">
            <button className="btn reject" onClick={() => onDecide(top.id, 'reject', top.actionToken)}>
              拒絕
            </button>
            <button className="btn approve" onClick={() => onDecide(top.id, 'approve', top.actionToken)}>
              允許
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
