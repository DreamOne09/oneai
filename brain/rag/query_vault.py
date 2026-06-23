"""檢索知識庫。供 Agent / MCP 取回最相關片段以對齊語氣與事實。

用法:
    python query_vault.py "客戶提案怎麼開頭" [top_k] [max_chars]

max_chars:整體回傳的字元預算(預設 8000)。LibreChat 等 MCP host 會把工具回傳
整包讀進記憶,過大會 OOM,故在此先限長。
"""
from __future__ import annotations
import sys
import json

import chromadb

from config import CHROMA_DIR, COLLECTION, get_embedding_function

DEFAULT_MAX_CHARS = 8000


def query(text: str, top_k: int = 5, max_chars: int = DEFAULT_MAX_CHARS,
          kind: str | None = None) -> list[dict]:
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    col = client.get_or_create_collection(
        name=COLLECTION, embedding_function=get_embedding_function()
    )
    fetch_k = min(top_k * 4, 20) if kind else top_k
    where = {"kind": kind} if kind else None
    try:
        res = col.query(query_texts=[text], n_results=fetch_k, where=where)
    except Exception:
        res = col.query(query_texts=[text], n_results=fetch_k)
    out: list[dict] = []
    docs = res.get("documents", [[]])[0]
    metas = res.get("metadatas", [[]])[0]
    dists = res.get("distances", [[]])[0]

    # 為每個片段分配字元預算,確保整體不超過 max_chars(防 host OOM)。
    budget = max(0, max_chars)
    per_chunk = max(200, budget // max(1, top_k)) if top_k else 0

    for doc, meta, dist in zip(docs, metas, dists):
        if len(out) >= top_k:
            break
        if kind and meta.get("kind") and meta.get("kind") != kind:
            continue
        if budget <= 0:
            break
        allow = min(per_chunk, budget)
        text_out = doc or ""
        truncated = False
        if len(text_out) > allow:
            text_out = text_out[:allow]
            truncated = True
        budget -= len(text_out)
        out.append({
            "text": text_out,
            "truncated": truncated,
            "path": meta.get("path"),
            "title": meta.get("title"),
            "kind": meta.get("kind"),
            "score": 1 - dist,
        })
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python query_vault.py <查詢> [top_k] [max_chars]", file=sys.stderr)
        raise SystemExit(2)
    q = sys.argv[1]
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    mc = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_MAX_CHARS
    print(json.dumps(query(q, k, mc), ensure_ascii=False, indent=2))
