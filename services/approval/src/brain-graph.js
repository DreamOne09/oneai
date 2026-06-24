/** 記憶知識圖譜 — 節點（記憶/標籤/kind hub）+ 連結（同類/共標籤） */

const KIND_HUBS = {
  memory: { label: '對話記憶', color: '#60a5fa' },
  preference: { label: '偏好事實', color: '#a78bfa' },
  system: { label: '系統 SSOT', color: '#4ade80' },
  reflection: { label: '反思', color: '#fb923c' },
  sop: { label: 'SOP', color: '#94a3b8' },
}

const TAG_RE = /tags:\s*\[([^\]]+)\]/i

export function parseTags(tagsStr, text = '') {
  const out = new Set()
  if (tagsStr) {
    for (const t of String(tagsStr).split(',')) {
      const s = t.trim().replace(/^#/, '')
      if (s) out.add(s)
    }
  }
  const m = TAG_RE.exec(text)
  if (m) {
    for (const t of m[1].split(',')) {
      const s = t.trim().replace(/^['"]|['"]$/g, '')
      if (s) out.add(s)
    }
  }
  return [...out].slice(0, 10)
}

function nodeLabel(item) {
  const t = item.title || item.text || ''
  const line = t.replace(/\s+/g, ' ').trim()
  return line.slice(0, 40) + (line.length > 40 ? '…' : '')
}

/** @param {Array<{id:string,text?:string,title?:string,kind?:string,tags?:string,path?:string,source?:string}>} items */
export function buildMemoryGraph(items) {
  const nodes = []
  const links = []
  const linkKeys = new Set()
  const addLink = (source, target, type, strength = 1) => {
    const key = `${source}|${target}|${type}`
    if (linkKeys.has(key) || source === target) return
    linkKeys.add(key)
    links.push({ source, target, type, strength })
  }

  const tagCounts = new Map()
  const enriched = items.map(m => ({
    ...m,
    kind: m.kind || 'memory',
    tagList: parseTags(m.tags, m.text),
  }))
  for (const m of enriched) {
    for (const t of m.tagList) tagCounts.set(t, (tagCounts.get(t) || 0) + 1)
  }

  const kinds = new Set(enriched.map(m => m.kind))
  for (const kind of kinds) {
    const hub = KIND_HUBS[kind] ?? KIND_HUBS.memory
    nodes.push({
      id: `hub:${kind}`,
      label: hub.label,
      nodeType: 'hub',
      kind,
      val: 12,
      color: hub.color,
    })
  }

  for (const m of enriched) {
    const hub = KIND_HUBS[m.kind] ?? KIND_HUBS.memory
    nodes.push({
      id: m.id,
      label: nodeLabel(m),
      nodeType: 'memory',
      kind: m.kind,
      val: 3 + Math.min(4, Math.floor((m.text?.length ?? 0) / 120)),
      color: hub.color,
      text: m.text,
      title: m.title,
      path: m.path,
      source: m.source,
      tags: m.tagList,
    })
    addLink(m.id, `hub:${m.kind}`, 'kind', 2)
  }

  for (const m of enriched) {
    for (const t of m.tagList) {
      if ((tagCounts.get(t) ?? 0) < 2) continue
      const tid = `tag:${t}`
      if (!nodes.find(n => n.id === tid)) {
        nodes.push({
          id: tid,
          label: `#${t}`,
          nodeType: 'tag',
          kind: 'tag',
          val: 5 + Math.min(6, tagCounts.get(t) ?? 0),
          color: '#e879f9',
        })
      }
      addLink(m.id, tid, 'tag', 1.5)
    }
  }

  // 共標籤記憶互連（社會網絡感）
  let pairEdges = 0
  const maxPair = 120
  for (let i = 0; i < enriched.length && pairEdges < maxPair; i++) {
    for (let j = i + 1; j < enriched.length && pairEdges < maxPair; j++) {
      const shared = enriched[i].tagList.filter(t => enriched[j].tagList.includes(t))
      if (shared.length >= 2) {
        addLink(enriched[i].id, enriched[j].id, 'related', shared.length)
        pairEdges++
      } else if (shared.length === 1 && enriched[i].kind === enriched[j].kind && enriched[i].source && enriched[i].source === enriched[j].source) {
        addLink(enriched[i].id, enriched[j].id, 'related', 0.8)
        pairEdges++
      }
    }
  }

  return { nodes, links, stats: { memories: enriched.length, tags: [...tagCounts.keys()].length, links: links.length } }
}
