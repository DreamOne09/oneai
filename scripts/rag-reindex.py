#!/usr/bin/env python3
"""RAG 全量 reindex — 補 kind metadata、修正 doc_count。

用法:
  python scripts/rag-reindex.py          # 本機 brain/rag
  python scripts/rag-reindex.py --remote   # 提示 Zeabur rag-svc 需 SSH/手動
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
RAG_DIR = ROOT / 'brain' / 'rag'


def main():
    if '--remote' in sys.argv:
        print('雲端 rag-svc 請在 Zeabur 執行 index 或 redeploy 後進容器跑:')
        print('  python index_vault.py')
        print('或: python scripts/zeabur-cli.py redeploy --service-id rag')
        return 0

    if not (RAG_DIR / 'index_vault.py').exists():
        print(f'[ERROR] 找不到 {RAG_DIR / "index_vault.py"}')
        return 1

    print(f'=== RAG 全量 reindex → {RAG_DIR} ===')
    r = subprocess.run(
        [sys.executable, 'index_vault.py'],
        cwd=str(RAG_DIR),
        check=False,
    )
    return r.returncode


if __name__ == '__main__':
    sys.exit(main())
