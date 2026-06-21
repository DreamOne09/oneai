"""重新索引觸發器。

兩種接法:
1. obsidian-git 同步後 / 排程定時呼叫:`python reindex_hook.py`(全量)
2. 檔案監看(可選):傳入變動檔路徑做增量。

這支刻意極簡,只轉呼叫 index_vault,方便排程器/hook 直接掛。
"""
from __future__ import annotations
import sys
from index_vault import main as index_main

if __name__ == "__main__":
    raise SystemExit(index_main(sys.argv))
