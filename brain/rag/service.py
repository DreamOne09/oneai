"""常駐 RAG 服務 (FastAPI)。

為什麼存在:mcp-core 原本每次 vault_query 都 spawn 一個 python,重載嵌入模型
(本機 bge 約 15 秒/次)。改成常駐服務後模型只載一次,查詢變即時。
同一份程式可本機或部署到 Zeabur(雲端大腦),mcp-core 設 RAG_API_URL 即改走 HTTP。

端點:
    GET  /health            存活檢查(供 Zeabur/編排器)
    POST /query             檢索 vault,回傳最相關片段(已限長,防 host OOM)
    POST /remember          寫回一則記憶並即時索引

重用既有邏輯(DRY):query_vault.query / remember.remember / config。
"""
from __future__ import annotations
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import config
import chromadb
from query_vault import query as _query, DEFAULT_MAX_CHARS
from remember import remember as _remember
from catalog import catalog as _catalog
from stats import collection_stats as _stats
from curate import curate_memory as _curate


class QueryReq(BaseModel):
    query: str = Field(min_length=1)
    top_k: int = Field(default=5, ge=1, le=20)
    max_chars: int = Field(default=DEFAULT_MAX_CHARS, ge=200)
    kind: str | None = Field(default=None, pattern="^(memory|preference|reflection|sop|system)$")


class RememberReq(BaseModel):
    text: str = Field(min_length=1)
    title: str | None = None
    kind: str = Field(default="memory", pattern="^(memory|preference|reflection|sop|system)$")
    tags: list[str] | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 啟動即暖機:預載嵌入模型(已記憶化),讓首次查詢就快。
    try:
        config.get_embedding_function()
    except Exception as e:  # 暖機失敗不擋啟動,留待請求時再報錯
        print(f"[rag-service] 暖機載入嵌入模型失敗: {e}")
    yield


app = FastAPI(title="OneAI RAG", version="0.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    s = _stats()
    if not s.get("ok"):
        return {"ok": False, "collection": config.COLLECTION, "doc_count": 0, "total": 0}
    return {
        "ok": True,
        "collection": s.get("collection", config.COLLECTION),
        "doc_count": s["total"],
        "total": s["total"],
        "by_kind": s.get("by_kind", {}),
        "raw_count": s.get("raw_count"),
    }


@app.get("/stats")
def stats():
    try:
        return _stats()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"stats 失敗: {e}")


@app.post("/query")
def do_query(req: QueryReq):
    try:
        return {"results": _query(req.query, req.top_k, req.max_chars, req.kind)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"檢索失敗: {e}")


@app.post("/remember")
def do_remember(req: RememberReq):
    try:
        path = _remember(req.text, title=req.title, tags=req.tags, kind=req.kind)
        return {"ok": True, "path": str(path.relative_to(config.VAULT_PATH))}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"寫回記憶失敗: {e}")


@app.get("/catalog")
def do_catalog(limit: int = 120):
    """列舉記憶片段（知識圖譜用）。"""
    try:
        lim = max(1, min(limit, 200))
        out = _catalog(lim)
        stats = _stats()
        out["total"] = stats.get("total", out.get("total", 0))
        out["by_kind"] = stats.get("by_kind", {})
        return out
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"catalog 失敗: {e}")


@app.post("/curate")
def do_curate(dry_run: bool = True, limit: int = 500):
    """Butler Phase B — 清理 episodic 垃圾（預設 dry_run）。"""
    try:
        return _curate(dry_run=dry_run, limit=limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"curate 失敗: {e}")
