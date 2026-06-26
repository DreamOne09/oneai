#!/usr/bin/env python3
"""驗收雲端 agent 編制 + workers。"""
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

BASE = os.environ.get('APPROVAL_BASE_URL', 'https://oneai-approval.zeabur.app').rstrip('/')
TOK = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')
H = {'Authorization': f'Bearer {TOK}'}
EXPECTED_CORE = [
    'engineer', 'pm', 'coach', 'analyst', 'researcher',
    'butler', 'code_reviewer', 'security_auditor',
]


def get(path: str):
    req = urllib.request.Request(BASE + path, headers=H)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def post(path: str, body: dict):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={**H, 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main():
    ok = True
    print(f'BASE={BASE}\n')

    print('=== HEALTH ===')
    try:
        with urllib.request.urlopen(BASE + '/health', timeout=15) as r:
            print(r.read().decode()[:300])
    except Exception as e:
        ok = False
        print(f'FAIL: {e}')

    print('\n=== STAFF ROSTER (GET /agents/staff) ===')
    try:
        staff = get('/agents/staff')
    except urllib.error.HTTPError as e:
        ok = False
        print(f'FAIL HTTP {e.code}: {e.read().decode()[:200]}')
        staff = {'staff': []}
    ids = [s['id'] for s in staff.get('staff', [])]
    print(f'count={len(ids)}/36')
    for s in staff.get('staff', []):
        tag = ' [custom]' if s.get('custom') else ''
        print(f"  {s.get('icon', '?')} {s['id']:22} {s['display']}{tag}")
    if staff.get('disabled'):
        print('disabled:', staff['disabled'])

    missing = [x for x in EXPECTED_CORE if x not in ids]
    if missing:
        ok = False
        print(f'\n❌ MISSING CORE: {missing}')
    else:
        print(f'\n✅ 常駐 {len(EXPECTED_CORE)} 位核心議員都在')

    print('\n=== WORKERS (GET /agents/status) ===')
    try:
        workers = json.loads(urllib.request.urlopen(BASE + '/agents/status', timeout=15).read())
        print(f'heartbeat agents: {len(workers)}')
        for a in workers:
            print(f"  {a.get('agent_id'):28} online={a.get('online')} status={a.get('status')}")
        if not workers:
            print('  (無本機 worker 心跳 — 桌機 Cursor/Agy 離線時正常)')
    except Exception as e:
        print(f'WARN: {e}')

    print('\n=== ORCHESTRATE 列出編制 ===')
    try:
        r = post('/chat/orchestrate', {'messages': [{'role': 'user', 'content': '列出編制'}]})
        print('model:', r.get('model'))
        print((r.get('reply') or '')[:400])
        if r.get('staff'):
            print('staff payload: ok')
    except urllib.error.HTTPError as e:
        ok = False
        print(f'FAIL HTTP {e.code}: {e.read().decode()[:300]}')

    print('\n=== ORCHESTRATE 議會 smoke ===')
    try:
        r2 = post('/chat/orchestrate', {
            'messages': [{'role': 'user', 'content': '工程師和 PM 辯論一下要不要先上 Cloud-First'}],
        })
        council = r2.get('council')
        print('council:', council)
        print('participants:', [a.get('id') for a in r2.get('agents', [])])
        print('transcript rounds:', len(r2.get('council_transcript') or []))
        if not council:
            ok = False
            print('❌ 預期 council 模式但未回 council 欄位')
        else:
            print('✅ 議會模式正常')
    except urllib.error.HTTPError as e:
        ok = False
        print(f'FAIL HTTP {e.code}: {e.read().decode()[:300]}')

    print('\n=== RESULT ===', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
