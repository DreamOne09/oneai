const APPROVAL_BASE = import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined

export type Decision = 'approve' | 'reject'

/** 對審核服務回報決定。需帶該審核專屬 actionToken。回傳是否成功。 */
export async function decide(id: string, decision: Decision, token?: string): Promise<boolean> {
  if (!APPROVAL_BASE) {
    console.warn('[approval] 缺少 VITE_APPROVAL_BASE_URL (離線/示範模式)')
    return true
  }
  try {
    const q = token ? `?t=${encodeURIComponent(token)}` : ''
    const res = await fetch(`${APPROVAL_BASE.replace(/\/$/, '')}/${decision}/${id}${q}`, {
      method: 'POST',
    })
    return res.ok
  } catch (e) {
    console.error('[approval] 回報失敗', e)
    return false
  }
}
