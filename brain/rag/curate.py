"""Butler Phase B — 清理 episodic 垃圾記憶（舊版 Q&A transcript 洪水）。"""
from __future__ import annotations

import re
from pathlib import Path

import chromadb

from config import CHROMA_DIR, COLLECTION, VAULT_PATH, get_embedding_function

KEEP_KINDS = frozenset({"preference", "system", "sop", "reflection"})
JUNK_MARKERS = (
    "## 對話摘要",
    "**答：**",
    "**问：**",
    "**問：**",
    "梅蘭直答",
    "chat-",
)
CURATED_MARKERS = ("curated", "仅存事实", "僅存事實", "## 事實")


def is_junk_chunk(text: str, meta: dict | None) -> tuple[bool, str]:
    meta = meta or {}
    text = text or ""
    kind = str(meta.get("kind") or "memory")
    tags = str(meta.get("tags") or "")
    title = str(meta.get("title") or "")
    combined = f"{title}\n{text}"

    if kind in KEEP_KINDS:
        return False, "keep_kind"
    if any(m in tags for m in ("curated", "system", "sop")):
        return False, "curated_tag"
    if any(m in combined for m in CURATED_MARKERS):
        return False, "fact_format"
    if any(m in combined for m in JUNK_MARKERS):
        return True, "episodic_transcript"
    if meta.get("source") == "oneai-orchestrate" and kind == "memory":
        return True, "legacy_orchestrate_memory"
    if re.search(r"\[E2E TEST\]", combined, re.I):
        return True, "e2e_test"
    return False, "keep"


def _collection():
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    return client.get_or_create_collection(
        name=COLLECTION, embedding_function=get_embedding_function()
    )


def curate_memory(*, dry_run: bool = True, limit: int = 500) -> dict:
    col = _collection()
    data = col.get(include=["documents", "metadatas"], limit=max(1, min(limit, 2000)))
    ids = data.get("ids") or []
    docs = data.get("documents") or []
    metas = data.get("metadatas") or []

    junk_ids: list[str] = []
    junk_paths: set[str] = set()
    reasons: dict[str, int] = {}
    samples: list[dict] = []

    for cid, doc, meta in zip(ids, docs, metas):
        junk, reason = is_junk_chunk(doc or "", meta)
        if not junk:
            continue
        junk_ids.append(cid)
        reasons[reason] = reasons.get(reason, 0) + 1
        path = (meta or {}).get("path")
        if path:
            junk_paths.add(str(path))
        if len(samples) < 5:
            samples.append({
                "id": cid,
                "reason": reason,
                "title": (meta or {}).get("title"),
                "preview": (doc or "")[:80],
            })

    deleted_files = 0
    if not dry_run and junk_ids:
        col.delete(ids=junk_ids)
        for rel in junk_paths:
            fp = VAULT_PATH / rel.replace("/", "\\") if "\\" not in rel else VAULT_PATH / rel
            try:
                if fp.is_file() and "insights/agent" in rel.replace("\\", "/"):
                    fp.unlink()
                    deleted_files += 1
            except OSError:
                pass

    return {
        "dry_run": dry_run,
        "scanned": len(ids),
        "junk_chunks": len(junk_ids),
        "junk_files": len(junk_paths),
        "deleted_files": deleted_files if not dry_run else 0,
        "reasons": reasons,
        "samples": samples,
    }


if __name__ == "__main__":
    import sys
    dry = "--apply" not in sys.argv
    out = curate_memory(dry_run=dry)
    print(out)
