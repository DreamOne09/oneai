#!/usr/bin/env python3
"""Test live weather / realtime query routing."""
import json
import os
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

BASE = os.environ.get('APPROVAL_BASE_URL', 'https://oneai-approval.zeabur.app').rstrip('/')
TOK = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')

QUERIES = [
    '明天曼谷天氣如何',
    '明天天氣如何',
    '查一下明天台北天氣',
]


def orchestrate(msg: str) -> dict:
    body = json.dumps({'message': msg, 'messages': [{'role': 'user', 'content': msg}]}).encode()
    req = urllib.request.Request(
        BASE + '/chat/orchestrate',
        data=body,
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def main() -> int:
    for msg in QUERIES:
        print('\n===', msg, '===')
        try:
            d = orchestrate(msg)
            agents = [a.get('id') for a in d.get('agents', [])]
            reply = (d.get('reply') or '')[:400]
            ws = d.get('web_search') or {}
            print('agents:', agents)
            print('provider:', ws.get('provider'), 'results:', ws.get('result_count'))
            print('reply:', reply)
        except Exception as e:
            print('FAIL', e)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
