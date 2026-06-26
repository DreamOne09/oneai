// OneAI agent 狀態機:驅動呼吸核心的節奏與色彩
export type AgentStatus =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'alert'
  | 'success'

export type ActivityKind = 'info' | 'task' | 'result' | 'warning' | 'user' | 'thinking' | 'memory' | 'search'

export interface SearchSource {
  title: string
  url: string
}

export interface AgentDetail {
  id: string
  icon: string
  display: string
  reply: string
}

export interface CouncilTranscriptRound {
  round: number
  phase: string
  entries: Array<{
    agent: string
    display: string
    excerpt: string
  }>
}

export interface CouncilMeta {
  mode: string
  rounds: number
  max_rounds?: number
  thread_id: string
  participants: string[]
}

export type OrchestrateMode = 'idle' | 'fast' | 'council' | 'council_high_stakes' | 'staff'

export interface CouncilLiveState {
  active: boolean
  mode: OrchestrateMode
  round: number
  maxRounds: number
  phase: string
  phaseLabel?: string
  participants: Array<{ id: string; icon: string; display: string }>
  squad?: string
  squadDisplay?: string
  lastSpeaker?: string
}

export interface ActivityItem {
  id: string
  kind: ActivityKind
  text: string
  ts: number
  agentId?: string
  agentIcon?: string
  agentDisplay?: string
  memoriesUsed?: number
  searchSources?: SearchSource[]
  brainLearned?: boolean
  memoryQuery?: string
  agentDetails?: AgentDetail[]
  councilTranscript?: CouncilTranscriptRound[]
  councilMeta?: CouncilMeta
  orchestrateMode?: OrchestrateMode
  /** Cursor / 桌機任務卡片（不顯示程式碼） */
  taskMeta?: TaskMeta
}

export interface TaskMeta {
  taskId: string
  projectPath: string
  projectName: string
  summary: string
  status: 'queued' | 'running' | 'done' | 'error' | 'timeout' | 'rejected'
  worker?: 'cursor' | 'shell' | 'cloud'
}

export interface CursorJob {
  taskId: string
  projectPath: string
  projectName: string
  summary: string
  status: TaskMeta['status']
  ts: number
}

export type ApprovalAction =
  | 'send_email'
  | 'spend_money'
  | 'publish'
  | 'delete_file'
  | 'run_command'

// ── Multi-Agent 狀態面板 ────────────────────────────────────────────────────
export interface AgentInfo {
  agent_id: string
  display?: string
  org?: string
  status: 'idle' | 'running' | 'error' | string
  current_task?: string | null
  workspace_cwd?: string | null
  last_seen: number
  online: boolean
}

export type ServiceStatus = 'ok' | 'error' | 'offline' | 'configured' | 'missing_key' | 'not_deployed' | 'unknown'

export interface ServiceInfo {
  status: ServiceStatus
  latency_ms?: number | null
  detail?: string
}

export interface SystemStatus {
  ts: number
  services: {
    approval_svc: ServiceInfo
    openrouter: ServiceInfo
    rag_svc: ServiceInfo
  }
  agents: AgentInfo[]
}

export interface Approval {
  id: string
  action: ApprovalAction
  summary: string
  details?: Record<string, unknown>
  createdAt: number
  timeoutSec: number
  // 該審核專屬一次性 token,隨通知下發;decide 時須回傳供伺服器驗證
  actionToken?: string
  // 參數雜湊(批准的==執行的);供稽核與一致性比對
  paramsHash?: string
}
