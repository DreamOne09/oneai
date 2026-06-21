"""RAG 設定:集中讀取環境變數,單一職責。

嵌入(embeddings)設定獨立於對話 LLM,讀 EMBEDDING_*(預設與對話同走 OpenRouter):
  - 有 EMBEDDING_API_KEY → 走 OpenAI 相容端點(EMBEDDING_BASE_URL,雲端用 OpenRouter,
    模型如 openai/text-embedding-3-small);
  - 否則 → 用本機模型(免費、免金鑰):
      設 RAG_LOCAL_EMBED_MODEL 用該 sentence-transformers 多語模型(中文較準),
      未設則退回 chromadb 內建 DefaultEmbeddingFunction(英文為主)。
分離的好處:本機跑免費 bge、雲端跑 OpenRouter 嵌入,僅靠 .env 切換,程式不動。
"""
import os
import sys
from functools import lru_cache
from pathlib import Path

# vault 含中文+泰文(persona 有泰式問候),Windows 預設 cp950 輸出會 UnicodeEncodeError;
# 強制 stdout/stderr UTF-8,確保 mcp-core 擷取的結果不會因混語內容而崩。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except Exception:
        pass

# vault 路徑:預設指向 repo 內 vault,可用環境變數覆寫成你的 Obsidian 庫
VAULT_PATH = Path(os.getenv("OBSIDIAN_VAULT_PATH", Path(__file__).parent.parent / "vault"))

# ChromaDB 持久化目錄
CHROMA_DIR = Path(os.getenv("CHROMA_DIR", Path(__file__).parent / ".chroma"))
COLLECTION = os.getenv("CHROMA_COLLECTION", "limengyi_vault")

# 切塊參數
CHUNK_SIZE = int(os.getenv("RAG_CHUNK_SIZE", "800"))
CHUNK_OVERLAP = int(os.getenv("RAG_CHUNK_OVERLAP", "120"))

# 嵌入設定(與對話 LLM 分離)
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY")
EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL") or "https://api.openai.com/v1"
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
# 本機多語嵌入模型(免金鑰)。預設 bge-small-zh:即使啟動時忘了設環境變數,
# 建索引/查詢也都用同一模型,避免與既有索引的嵌入設定衝突。
LOCAL_EMBED_MODEL = os.getenv("RAG_LOCAL_EMBED_MODEL", "BAAI/bge-small-zh-v1.5")


@lru_cache(maxsize=1)
def get_embedding_function():
    """依設定回傳嵌入函式;雲端(有 key)優先,否則本機。

    記憶化:常駐服務(service.py)只在首次呼叫載入嵌入模型,後續查詢直接重用,
    避免每次重載(本機 bge 載入約 15 秒)。一次性 CLI 不受影響。
    """
    from chromadb.utils import embedding_functions

    if EMBEDDING_API_KEY:
        return embedding_functions.OpenAIEmbeddingFunction(
            api_key=EMBEDDING_API_KEY,
            model_name=EMBEDDING_MODEL,
            api_base=EMBEDDING_BASE_URL,
        )

    if LOCAL_EMBED_MODEL:
        return embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=LOCAL_EMBED_MODEL
        )

    return embedding_functions.DefaultEmbeddingFunction()
