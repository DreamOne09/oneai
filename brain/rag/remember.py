"""寫回記憶 — 自我進化的核心原語。

把一則「學到的東西/孟一的偏好/反思」沉澱成 vault 內的 markdown 筆記,
寫進 agent 專屬命名空間 (insights/agent/,避免與人工筆記 git 衝突),
並立即索引,使其下次可被檢索。

這就是「不會忘 + 會進化」的機械保證:
    互動 → distill → remember() → markdown(可讀/可攜/git 版本) → 索引 → 下次 RAG 取回

用法:
    python remember.py "孟一偏好提案開頭用痛點直球,不要寒暄"
    python remember.py --title "客戶王先生" --tags preference,client "他只看數字,簡報省略願景頁"
"""
from __future__ import annotations
import sys
import argparse
import datetime
from pathlib import Path

from config import VAULT_PATH
from index_vault import get_collection, index_file

AGENT_MEM_DIR = VAULT_PATH / "insights" / "agent"
_ILLEGAL = '\\/:*?"<>|'


def _safe_slug(s: str, limit: int = 32) -> str:
    s = s.strip().splitlines()[0] if s.strip() else "memory"
    s = "".join("-" if c in _ILLEGAL or c.isspace() else c for c in s)
    return s[:limit] or "memory"


def remember(text: str, title: str | None = None, tags: list[str] | None = None,
             kind: str = "memory") -> Path:
    """寫一則記憶並索引,回傳檔案路徑。"""
    if not text.strip():
        raise ValueError("記憶內容不可為空")
    AGENT_MEM_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.datetime.now()
    title = title or text.strip().splitlines()[0][:40]
    fname = f"{now:%Y-%m-%d-%H%M%S}-{_safe_slug(title)}.md"
    path = AGENT_MEM_DIR / fname

    tag_list = ["agent-memory", kind] + (tags or [])
    front = (
        "---\n"
        f"title: {title}\n"
        f"tags: [{', '.join(tag_list)}]\n"
        "source: agent-memory\n"
        f"kind: {kind}\n"
        f"updated: {now:%Y-%m-%d}\n"
        "---\n\n"
    )
    path.write_text(front + text.strip() + "\n", encoding="utf-8")

    # 立即索引這一檔
    col = get_collection()
    n = index_file(col, path, VAULT_PATH)
    print(f"[remember] 已記住 → {path.relative_to(VAULT_PATH)} ({n} chunks)")
    return path


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="寫回一則記憶到 vault 並索引")
    p.add_argument("text", help="記憶內容")
    p.add_argument("--title", default=None)
    p.add_argument("--tags", default="", help="逗號分隔")
    p.add_argument("--kind", default="memory", choices=["memory", "preference", "reflection", "sop"])
    args = p.parse_args(argv[1:])
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]
    remember(args.text, title=args.title, tags=tags, kind=args.kind)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
