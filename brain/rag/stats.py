"""ChromaDB 準確統計 — 修正 col.count() 與實際 chunk 數不一致。"""
from __future__ import annotations

import chromadb

from config import CHROMA_DIR, COLLECTION, get_embedding_function


def _collection():
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION, embedding_function=get_embedding_function()
    )


def collection_stats(max_scan: int = 5000) -> dict:
    """回傳 total、by_kind、catalog_available 等。"""
    try:
        col = _collection()
        data = col.get(include=["metadatas"], limit=max_scan)
        ids = data.get("ids") or []
        metas = data.get("metadatas") or []
        total = len(ids)
        by_kind: dict[str, int] = {}
        by_source: dict[str, int] = {}
        for meta in metas:
            meta = meta or {}
            k = str(meta.get("kind") or "memory")
            by_kind[k] = by_kind.get(k, 0) + 1
            src = str(meta.get("source") or "unknown")
            by_source[src] = by_source.get(src, 0) + 1
        # col.count() 僅供對照
        try:
            raw_count = col.count()
        except Exception:
            raw_count = total
        return {
            "ok": True,
            "collection": COLLECTION,
            "total": total,
            "doc_count": total,
            "raw_count": raw_count,
            "count_mismatch": raw_count != total and raw_count > 0,
            "by_kind": by_kind,
            "by_source": by_source,
            "scanned": total,
        }
    except Exception as e:
        return {"ok": False, "total": 0, "doc_count": 0, "error": str(e)[:120]}
