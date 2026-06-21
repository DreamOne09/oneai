"""Markdown 讀取與切塊。單一職責:把 vault 檔案變成可索引的 chunk。"""
from __future__ import annotations
from pathlib import Path
from typing import Iterator
import hashlib

import frontmatter

from config import CHUNK_SIZE, CHUNK_OVERLAP

SKIP_DIRS = {".git", ".obsidian", ".chroma", "templates"}
SKIP_FILES = {"AGENTS.md", "CLAUDE.md", "README.md"}  # meta 守則不進語意索引


def iter_markdown(vault: Path) -> Iterator[Path]:
    for p in vault.rglob("*.md"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.name in SKIP_FILES:
            continue
        yield p


def _split_text(text: str, size: int, overlap: int) -> list[str]:
    if len(text) <= size:
        return [text] if text.strip() else []
    chunks, start = [], 0
    while start < len(text):
        end = start + size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start = end - overlap
    return chunks


def chunk_file(path: Path, vault: Path) -> list[dict]:
    """回傳 [{id, document, metadata}]。"""
    post = frontmatter.load(path)
    rel = str(path.relative_to(vault)).replace("\\", "/")
    meta_base = {
        "path": rel,
        "title": str(post.get("title", path.stem)),
        "tags": ",".join(post.get("tags", []) or []),
        "source": str(post.get("source", "")),
    }
    out = []
    for i, chunk in enumerate(_split_text(post.content, CHUNK_SIZE, CHUNK_OVERLAP)):
        cid = hashlib.sha1(f"{rel}:{i}".encode("utf-8")).hexdigest()
        out.append({"id": cid, "document": chunk, "metadata": {**meta_base, "chunk": i}})
    return out
