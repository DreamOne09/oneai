#!/usr/bin/env python3
"""Quick smoke for brain-intel behaviors via cloud orchestrate."""
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

CASES = [
    ('寒暄', '嗨'),
    ('記住', '記住：我偏好用繁體中文'),
    ('搜尋', '搜尋 Tavily API 用途'),
]

for name, msg in CASES:
    body = json.dumps({'messages': [{'role': 'user', 'content': msg}]}).encode()
    req = urllib.request.Request(
        f'{BASE}/chat/orchestrate', data=body, method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {TOK}'},
    )
    t0 = time.time()
    d = json.loads(urllib.request.urlopen(req, timeout=90).read())
    brain = d.get('brain') or {}
    print(f'{name}: {time.time()-t0:.1f}s mem={brain.get("memories_used",0)} learned={brain.get("remembered")} synth={d.get("synthesis")} agents={[a["id"] for a in d.get("agents",[])]}')
