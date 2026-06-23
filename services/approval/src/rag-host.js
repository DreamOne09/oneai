/** RAG 服務 host 解析 — 單一 SSOT，避免 server.js 多處硬編 fallback。 */
export function getRagBaseUrl() {
  const host = process.env.RAG_SVC_HOST?.trim()
  if (host) return `http://${host}:8080`
  if (process.env.RAG_SVC_URL?.trim()) return process.env.RAG_SVC_URL.replace(/\/$/, '')
  return 'http://rag-svc.zeabur.internal:8080'
}
