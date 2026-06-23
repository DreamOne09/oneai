#!/usr/bin/env python3
"""將 OneAI 架構 SSOT 寫入 RAG（kind=system）。

用法:
  python scripts/seed-system-memory.py
  python scripts/seed-system-memory.py --dry-run

需 .env：APPROVAL_BASE_URL、ONEAI_CHAT_TOKEN（或 APPROVAL_TOKEN）
"""
from __future__ import annotations
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCH = ROOT / 'config' / 'oneai.system-architecture.json'


def load_dotenv() -> None:
    env = ROOT / '.env'
    if not env.exists():
        return
    for line in env.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, _, v = line.partition('=')
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def build_markdown(arch: dict) -> str:
    v = arch.get('_version', '?')
    date = arch.get('_updated', '')
    facts = '\n'.join(f'- {f}' for f in arch.get('critical_facts', []))
    deploy = '\n'.join(f'- {k}: {v}' for k, v in (arch.get('deploy_matrix') or {}).items())
    layers = arch.get('layers', {})
    return f"""---
title: OneAI 系統架構 SSOT
tags: [oneai, system, architecture, ssot]
source: seed-system-memory.py
kind: system
version: {v}
updated: {date}
---

# OneAI 系統架構 v{v}

{arch.get('one_liner', '')}

## 必知事實
{facts}

## 部署
{deploy}

## 分層
- 手機 PWA: {layers.get('phone', {}).get('url', '')}
- approval: {layers.get('cloud', {}).get('approval_svc', {}).get('url', '')}
- agy worker: {layers.get('local', {}).get('agy_worker', {}).get('file', '')}
- cursor worker: {layers.get('local', {}).get('cursor_worker', {}).get('file', '')}
"""


def main() -> int:
    load_dotenv()
    if not ARCH.exists():
        print(f'[ERROR] 找不到 {ARCH}')
        return 1
    arch = json.loads(ARCH.read_text(encoding='utf-8'))
    text = build_markdown(arch)
    if '--dry-run' in sys.argv:
        print(text[:800], '...')
        return 0

    base = os.environ.get('APPROVAL_BASE_URL', 'https://oneai-approval.zeabur.app').rstrip('/')
    token = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')
    if not token:
        print('[ERROR] 需 ONEAI_CHAT_TOKEN 或 APPROVAL_TOKEN')
        return 1

    body = json.dumps({'text': text[:2000], 'kind': 'system'}).encode()
    req = urllib.request.Request(
        f'{base}/brain/remember',
        data=body,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            out = json.loads(resp.read())
        print('[OK] system memory seeded:', out)
        return 0
    except urllib.error.HTTPError as e:
        print('[FAIL]', e.code, e.read().decode()[:200])
        return 1


if __name__ == '__main__':
    sys.exit(main())
