"""列舉 ChromaDB 記憶片段 — 供知識圖譜視覺化。"""
from __future__ import annotations

import chromadb

from config import CHROMA_DIR, COLLECTION, get_embedding_function
from stats import collection_stats


def catalog(limit: int = 120) -> dict:
    limit = max(1, min(limit, 200))
    stats = collection_stats()
    total = stats.get("total", 0)
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    col = client.get_or_create_collection(
        name=COLLECTION, embedding_function=get_embedding_function()
    )
    try:
        data = col.get(include=["documents", "metadatas"], limit=limit)
    except Exception:
        return {"items": [], "total": total, "shown": 0, "by_kind": stats.get("by_kind", {})}

    items = []
    for cid, doc, meta in zip(
        data.get("ids") or [],
        data.get("documents") or [],
        data.get("metadatas") or [],
    ):
        meta = meta or {}
        text = doc or ""
        items.append({
            "id": cid,
            "text": text[:500],
            "title": meta.get("title") or None,
            "kind": meta.get("kind") or "memory",
            "tags": meta.get("tags") or "",
            "path": meta.get("path") or None,
            "source": meta.get("source") or None,
        })
    return {
        "items": items,
        "total": total,
        "shown": len(items),
        "by_kind": stats.get("by_kind", {}),
    }
