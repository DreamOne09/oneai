#!/usr/bin/env python3
"""Smoke test /brain/graph on cloud after deploy."""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env_path = ROOT / '.env'
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

BASE = os.environ.get('APPROVAL_BASE_URL', 'https://oneai-approval.zeabur.app').rstrip('/')
TOKEN = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')


def fetch(path, auth=False):
    headers = {}
    if auth and TOKEN:
        headers['Authorization'] = f'Bearer {TOKEN}'
    req = urllib.request.Request(f'{BASE}{path}', headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, json.loads(r.read())


def main():
    print(f'=== brain graph cloud test → {BASE} ===')
    ok = True

    try:
        s, d = fetch('/health')
        print(f'[OK] /health {s} ok={d.get("ok")}')
    except Exception as e:
        print(f'[FAIL] /health {e}')
        ok = False

    try:
        s, d = fetch('/brain/summary')
        print(f'[OK] /brain/summary total={d.get("total_memories")} status={d.get("status")}')
    except Exception as e:
        print(f'[FAIL] /brain/summary {e}')
        ok = False

    if not TOKEN:
        print('[SKIP] /brain/graph — no ONEAI_CHAT_TOKEN')
        return 0

    try:
        s, d = fetch('/brain/graph?limit=30', auth=True)
        nodes = d.get('nodes') or []
        links = d.get('links') or []
        print(f'[OK] /brain/graph nodes={len(nodes)} links={len(links)} total_in_db={d.get("total_in_db")}')
        kinds = {n.get('nodeType') for n in nodes}
        print(f'     nodeTypes={kinds}')
        if len(nodes) == 0:
            print('[WARN] graph empty — rag /catalog may need redeploy')
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        print(f'[FAIL] /brain/graph HTTP {e.code} {body}')
        ok = False
    except Exception as e:
        print(f'[FAIL] /brain/graph {e}')
        ok = False

    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
