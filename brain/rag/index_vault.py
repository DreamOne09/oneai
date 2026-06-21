"""把 Obsidian vault 索引進 ChromaDB。

用法:
    python index_vault.py            # 全量重建
    python index_vault.py <file.md>  # 單檔更新 (供 reindex hook 呼叫)
"""
from __future__ import annotations
import sys
from pathlib import Path

import chromadb

from config import VAULT_PATH, CHROMA_DIR, COLLECTION, get_embedding_function
from chunker import iter_markdown, chunk_file


def get_collection(reset: bool = False):
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    # 全量重建時先刪舊 collection:換嵌入模型(維度/語意不同)會與既有設定衝突。
    if reset:
        try:
            client.delete_collection(COLLECTION)
        except Exception:
            pass
    return client.get_or_create_collection(
        name=COLLECTION, embedding_function=get_embedding_function()
    )


def index_file(col, path: Path, vault: Path):
    rel = str(path.relative_to(vault)).replace("\\", "/")
    # 先刪同檔舊 chunk,避免殘留
    col.delete(where={"path": rel})
    rows = chunk_file(path, vault)
    if not rows:
        return 0
    col.add(
        ids=[r["id"] for r in rows],
        documents=[r["document"] for r in rows],
        metadatas=[r["metadata"] for r in rows],
    )
    return len(rows)


def main(argv: list[str]) -> int:
    vault = VAULT_PATH
    if not vault.exists():
        print(f"[index] vault 不存在: {vault}", file=sys.stderr)
        return 1
    single_file = len(argv) > 1
    col = get_collection(reset=not single_file)

    if single_file:
        targets = [Path(argv[1])]
    else:
        targets = list(iter_markdown(vault))

    total = 0
    for f in targets:
        n = index_file(col, f, vault)
        total += n
        print(f"[index] {f.name}: {n} chunks")
    print(f"[index] 完成,共 {total} chunks,collection={COLLECTION}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
