/**
 * 記憶知識圖譜 — 力導向圖（靈感：Obsidian Graph / react-force-graph）
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

const APPROVAL_BASE = (import.meta.env.VITE_APPROVAL_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''
const CHAT_TOKEN = (import.meta.env.VITE_CHAT_TOKEN as string | undefined) ?? (import.meta.env.VITE_APPROVAL_TOKEN as string | undefined) ?? ''

export interface GraphNode {
  id: string
  label: string
  nodeType?: 'memory' | 'hub' | 'tag'
  kind?: string
  val?: number
  color?: string
  text?: string
  title?: string
  path?: string
  source?: string
  tags?: string[]
}

export interface GraphLink {
  source: string
  target: string
  type?: string
  strength?: number
}

interface GraphPayload {
  nodes: GraphNode[]
  links: GraphLink[]
  total_in_db?: number
  shown?: number
  stats?: { memories: number; tags: number; links: number }
}

function authHeader(): Record<string, string> {
  return CHAT_TOKEN ? { Authorization: `Bearer ${CHAT_TOKEN}` } : {}
}

async function fetchGraph(): Promise<GraphPayload> {
  const r = await fetch(`${APPROVAL_BASE}/brain/graph?limit=120`, { headers: authHeader() })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<GraphPayload>
}

interface MemoryGraphViewProps {
  onSelectMemory?: (node: GraphNode) => void
  highlightQuery?: string | null
}

export function MemoryGraphView({ onSelectMemory, highlightQuery }: MemoryGraphViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<{ zoomToFit: (ms?: number, pad?: number) => void } | null>(null)
  const [graph, setGraph] = useState<GraphPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [size, setSize] = useState({ w: 320, h: 360 })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchGraph()
      setGraph(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]?.contentRect ?? { width: 320, height: 360 }
      setSize({ w: Math.max(280, width), h: Math.max(280, height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!graph?.nodes.length || !highlightQuery) return
    const needle = highlightQuery.slice(0, 30).toLowerCase()
    const hit = graph.nodes.find(
      n => n.nodeType === 'memory' && (n.label?.toLowerCase().includes(needle) || n.text?.toLowerCase().includes(needle)),
    )
    if (hit) {
      setSelected(hit)
      onSelectMemory?.(hit)
    }
  }, [graph, highlightQuery, onSelectMemory])

  useEffect(() => {
    if (graph?.nodes.length) {
      window.setTimeout(() => fgRef.current?.zoomToFit(400, 48), 300)
    }
  }, [graph])

  const graphData = graph
    ? {
        nodes: graph.nodes.map(n => ({ ...n })),
        links: graph.links.map(l => ({
          ...l,
          source: typeof l.source === 'object' ? (l.source as GraphNode).id : l.source,
          target: typeof l.target === 'object' ? (l.target as GraphNode).id : l.target,
        })),
      }
    : { nodes: [], links: [] }

  return (
    <div className="memory-graph">
      <div className="memory-graph-toolbar">
        <span className="memory-graph-legend">
          <span className="legend-dot legend-dot--memory" /> 記憶
          <span className="legend-dot legend-dot--tag" /> 標籤
          <span className="legend-dot legend-dot--hub" /> 類別
        </span>
        {graph && (
          <span className="memory-graph-stats">
            {graph.stats?.memories ?? graph.shown} 節點 · {graph.stats?.links ?? graph.links.length} 連結
            {graph.total_in_db != null && graph.total_in_db > (graph.shown ?? 0) && (
              <> · 庫內 {graph.total_in_db}</>
            )}
          </span>
        )}
        <button type="button" className="brain-btn memory-graph-btn" onClick={load} disabled={loading}>
          {loading ? '…' : '重新整理'}
        </button>
      </div>

      {error && <div className="brain-error">⚠ {error}</div>}

      <div className="memory-graph-canvas-wrap" ref={wrapRef}>
        {!loading && graphData.nodes.length === 0 && (
          <div className="brain-empty">尚無記憶節點 — 對話或手動寫入後再來</div>
        )}
        {graphData.nodes.length > 0 && (
          <ForceGraph2D
            ref={fgRef as never}
            width={size.w}
            height={size.h}
            graphData={graphData}
            nodeLabel={n => {
              const x = n as GraphNode
              if (x.nodeType === 'memory' && x.text) return `${x.label}\n\n${x.text.slice(0, 160)}…`
              return x.label ?? x.id
            }}
            nodeVal={n => (n as GraphNode).val ?? 3}
            nodeColor={n => (n as GraphNode).color ?? '#60a5fa'}
            linkColor={() => 'rgba(148, 163, 184, 0.35)'}
            linkWidth={l => Math.max(0.5, ((l as GraphLink).strength ?? 1) * 0.6)}
            linkDirectionalParticles={2}
            linkDirectionalParticleWidth={l => ((l as GraphLink).type === 'related' ? 2 : 0)}
            cooldownTicks={80}
            onNodeClick={n => {
              const node = n as GraphNode
              setSelected(node)
              if (node.nodeType === 'memory') onSelectMemory?.(node)
            }}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GraphNode & { x?: number; y?: number }
              const label = n.label ?? ''
              const fontSize = Math.max(10 / globalScale, n.nodeType === 'hub' ? 11 : 9)
              const r = Math.sqrt(n.val ?? 3) * (n.nodeType === 'hub' ? 5 : 4)
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI)
              ctx.fillStyle = n.color ?? '#60a5fa'
              ctx.fill()
              if (selected?.id === n.id) {
                ctx.strokeStyle = '#fbbf24'
                ctx.lineWidth = 2 / globalScale
                ctx.stroke()
              }
              if (globalScale > 0.55 || n.nodeType !== 'memory') {
                ctx.font = `${fontSize}px sans-serif`
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.fillStyle = 'rgba(226, 232, 240, 0.9)'
                ctx.fillText(label.slice(0, 18), n.x ?? 0, (n.y ?? 0) + r + 2)
              }
            }}
            nodePointerAreaPaint={(node, color, ctx) => {
              const n = node as GraphNode & { x?: number; y?: number }
              const r = Math.sqrt(n.val ?? 3) * 5
              ctx.fillStyle = color
              ctx.beginPath()
              ctx.arc(n.x ?? 0, n.y ?? 0, r, 0, 2 * Math.PI)
              ctx.fill()
            }}
          />
        )}
      </div>

      {selected && selected.nodeType === 'memory' && (
        <div className="memory-graph-detail glass">
          <div className="memory-graph-detail-title">{selected.title || selected.label}</div>
          <div className="memory-graph-detail-meta">
            {selected.kind && <span className={`kind-badge kind-${selected.kind}`}>{selected.kind}</span>}
            {selected.tags?.map(t => <span key={t} className="tag-chip">#{t}</span>)}
          </div>
          <p className="memory-graph-detail-text">{selected.text}</p>
        </div>
      )}
    </div>
  )
}
