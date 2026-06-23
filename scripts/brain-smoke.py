#!/usr/bin/env python3
"""Smoke test for brain-intel + SSE orchestrate."""
import json, os, time, urllib.request
from pathlib import Path

def load():
    for line in Path('.env').read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.strip().startswith('#'):
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

load()
BASE = os.environ['APPROVAL_BASE_URL'].rstrip('/')
TOK = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ['APPROVAL_TOKEN']
HDR = {'Content-Type': 'application/json', 'Authorization': f'Bearer {TOK}'}

def orchestrate(msg):
    body = json.dumps({'messages': [{'role': 'user', 'content': msg}]}).encode()
    req = urllib.request.Request(f'{BASE}/chat/orchestrate', data=body, method='POST', headers=HDR)
    t0 = time.time()
    d = json.loads(urllib.request.urlopen(req, timeout=90).read())
    return d, time.time() - t0

def orchestrate_stream(msg):
    body = json.dumps({'messages': [{'role': 'user', 'content': msg}]}).encode()
    req = urllib.request.Request(f'{BASE}/chat/orchestrate/stream', data=body, method='POST', headers=HDR)
    t0 = time.time()
    phases = []
    with urllib.request.urlopen(req, timeout=90) as resp:
        buf = ''
        for chunk in iter(lambda: resp.read(4096), b''):
            buf += chunk.decode('utf-8', errors='replace')
            while '\n\n' in buf:
                part, buf = buf.split('\n\n', 1)
                event = 'message'
                data = None
                for line in part.split('\n'):
                    if line.startswith('event:'):
                        event = line[6:].strip()
                    if line.startswith('data:'):
                        data = json.loads(line[5:].strip())
                if event == 'phase' and data:
                    phases.append(data.get('phase'))
                if event == 'complete' and data:
                    return data, phases, time.time() - t0
    raise RuntimeError('stream ended without complete')

CASES = [
    ('寒暄', '嗨'),
    ('記住', '記住：我偏好用繁體中文'),
    ('搜尋', '搜尋 Tavily API 用途'),
]

ok = True
for name, msg in CASES:
    d, elapsed = orchestrate(msg)
    brain = d.get('brain') or {}
    agents = [a['id'] for a in d.get('agents', [])]
    reply_len = len(d.get('reply') or '')
    print(f'{name}: {elapsed:.1f}s mem={brain.get("memories_used",0)} learned={brain.get("remembered")} synth={d.get("synthesis")} agents={agents} reply={reply_len}字')
    if name == '寒暄' and brain.get('memories_used', 0) > 1:
        print('  WARN: 寒暄注入過多記憶')
        ok = False
    if name == '記住' and 'butler' not in agents:
        print('  WARN: 記住未走 butler')
        ok = False
    if name == '搜尋' and reply_len < 150:
        print('  WARN: 搜尋回覆過短')
        ok = False

try:
    _, phases, _ = orchestrate_stream('分析 React 與 Vue')
    print(f'SSE phases: {phases}')
    if not any(p in phases for p in ('rag_done', 'route_done')):
        print('  WARN: SSE 缺少關鍵階段')
        ok = False
except urllib.error.HTTPError as e:
    if e.code == 404:
        print('SSE: endpoint 尚未部署 (404)，略過')
    else:
        raise

try:
    summary = json.loads(urllib.request.urlopen(f'{BASE}/brain/summary', timeout=10).read())
    print(f'summary: total={summary.get("total_memories")} status={summary.get("status")}')
except Exception as e:
    print(f'summary error: {e}')

print('SMOKE OK' if ok else 'SMOKE WARNINGS')
raise SystemExit(0 if ok else 1)
