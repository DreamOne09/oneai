import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ActivityItem, ActivityKind, AgentStatus, Approval, CursorJob, TaskMeta } from '../types'

interface PushOpts {
  agentId?: string
  agentIcon?: string
  agentDisplay?: string
  memoriesUsed?: number
  searchSources?: import('../types').SearchSource[]
  brainLearned?: boolean
  memoryQuery?: string
  agentDetails?: import('../types').AgentDetail[]
  taskMeta?: TaskMeta
}

interface OneAIState {
  status: AgentStatus
  connected: boolean
  pushEnabled: boolean
  activities: ActivityItem[]
  approvals: Approval[]
  pendingMessage: string | null
  currentModel: string | null
  hiddenAgentIds: string[]
  memoryHighlight: string | null
  requestedTab: 'chat' | 'agents' | 'memory' | 'settings' | null
  cursorJobs: CursorJob[]

  setStatus: (s: AgentStatus) => void
  setConnected: (c: boolean) => void
  setPushEnabled: (e: boolean) => void
  pushActivity: (kind: ActivityKind, text: string, opts?: PushOpts) => void
  clearActivities: () => void
  addApproval: (a: Approval) => void
  resolveApproval: (id: string) => void
  setPending: (msg: string | null) => void
  setCurrentModel: (m: string | null) => void
  toggleAgentVisibility: (agentId: string) => void
  openMemoryTab: (query: string) => void
  requestTab: (tab: NonNullable<OneAIState['requestedTab']>) => void
  clearRequestedTab: () => void
  clearMemoryHighlight: () => void
  upsertCursorJob: (job: CursorJob) => void
  updateCursorJob: (taskId: string, patch: Partial<CursorJob>) => void
}

const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`)

export const useOneAI = create<OneAIState>()(
  persist(
    (set) => ({
      status: 'idle',
      connected: false,
      pushEnabled: false,
      activities: [],
      approvals: [],
      pendingMessage: null,
      currentModel: null,
      hiddenAgentIds: [],
      memoryHighlight: null,
      requestedTab: null,
      cursorJobs: [],

      setStatus: (status) => set({ status }),
      setConnected: (connected) => set({ connected }),
      setPushEnabled: (pushEnabled) => set({ pushEnabled }),
      setPending: (pendingMessage) => set({ pendingMessage }),
      setCurrentModel: (currentModel) => set({ currentModel }),

      pushActivity: (kind, text, opts) =>
        set((st) => ({
          activities: [
            {
              id: uid(),
              kind,
              text,
              ts: Date.now(),
              agentId: opts?.agentId,
              agentIcon: opts?.agentIcon,
              agentDisplay: opts?.agentDisplay,
              memoriesUsed: opts?.memoriesUsed,
              searchSources: opts?.searchSources,
              brainLearned: opts?.brainLearned,
              memoryQuery: opts?.memoryQuery,
              agentDetails: opts?.agentDetails,
              taskMeta: opts?.taskMeta,
            },
            ...st.activities,
          ].slice(0, 80),
        })),

      clearActivities: () => set({ activities: [], pendingMessage: null }),

      addApproval: (a) =>
        set((st) => ({
          approvals: [a, ...st.approvals.filter((x) => x.id !== a.id)],
          status: 'alert',
        })),

      resolveApproval: (id) =>
        set((st) => {
          const approvals = st.approvals.filter((x) => x.id !== id)
          return { approvals, status: approvals.length ? 'alert' : 'idle' }
        }),

      toggleAgentVisibility: (agentId) =>
        set((st) => ({
          hiddenAgentIds: st.hiddenAgentIds.includes(agentId)
            ? st.hiddenAgentIds.filter((id) => id !== agentId)
            : [...st.hiddenAgentIds, agentId],
        })),

      openMemoryTab: (query) => set({ requestedTab: 'memory', memoryHighlight: query }),
      requestTab: (tab) => set({ requestedTab: tab }),
      clearRequestedTab: () => set({ requestedTab: null }),
      clearMemoryHighlight: () => set({ memoryHighlight: null }),

      upsertCursorJob: (job) =>
        set((st) => ({
          cursorJobs: [job, ...st.cursorJobs.filter(j => j.taskId !== job.taskId)].slice(0, 12),
        })),

      updateCursorJob: (taskId, patch) =>
        set((st) => ({
          cursorJobs: st.cursorJobs.map(j => j.taskId === taskId ? { ...j, ...patch } : j),
        })),
    }),
    {
      name: 'oneai-state',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (st) => ({
        activities: st.activities,
        currentModel: st.currentModel,
        hiddenAgentIds: st.hiddenAgentIds,
        cursorJobs: st.cursorJobs,
      }),
    },
  ),
)
