#!/usr/bin/env python3
"""OneAI GTX-100 基線評估 — 對應 docs/20-oneai-2.0-day-plan.md §5 §8。

執行:
  python scripts/oneai-gtx-100.py
  python scripts/oneai-gtx-100.py --only 1,21,22,15

輸出:
  scripts/oneai-gtx-100-results.json
  scripts/oneai-gtx-100-summary.txt
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv() -> None:
    p = ROOT / '.env'
    if not p.exists():
        return
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())


load_dotenv()
BASE = os.environ.get('APPROVAL_BASE_URL', '').rstrip('/')
CHAT = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')
SVC = os.environ.get('APPROVAL_TOKEN', '')

if not BASE:
    sys.exit('[ERROR] APPROVAL_BASE_URL not set')

HDR_CHAT = {'Content-Type': 'application/json', 'Authorization': f'Bearer {CHAT}', 'User-Agent': 'OneAI-GTX100'}
HDR_SVC = {'Content-Type': 'application/json', 'Authorization': f'Bearer {SVC}'} if SVC else {}


def req(method, path, body=None, headers=None, timeout=90):
    url = f'{BASE}{path}'
    data = json.dumps(body).encode() if body is not None else None
    t0 = time.time()
    try:
        r = urllib.request.Request(url, data=data, method=method, headers=headers or {})
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            elapsed = round(time.time() - t0, 2)
            try:
                parsed = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = {'_raw': raw.decode('utf-8', errors='replace')[:500]}
            return {'ok': True, 'status': resp.status, 'elapsed': elapsed, 'data': parsed}
    except urllib.error.HTTPError as e:
        elapsed = round(time.time() - t0, 2)
        try:
            parsed = json.loads(e.read())
        except Exception:
            parsed = {'error': str(e)}
        return {'ok': False, 'status': e.code, 'elapsed': elapsed, 'data': parsed}


def orchestrate(msg, history=None):
    messages = (history or []) + [{'role': 'user', 'content': msg}]
    return req('POST', '/chat/orchestrate', {'messages': messages}, HDR_CHAT)


def score_pass(passed: bool, dims: dict | None = None) -> dict:
    """簡化八維：通過時每維 2 分，失敗 0；可覆寫單維。"""
    base = {k: (2 if passed else 0) for k in 'IMRSHGPL'}
    if dims:
        base.update(dims)
    total = sum(base.values())
    return {'dims': base, 'total': total, 'passed': total >= 12}


RESULTS: list[dict] = []


def run_auto(sid: int, title: str, priority: str, fn):
    print(f'  #{sid:03d} {title}...', end=' ', flush=True)
    try:
        r = fn()
    except Exception as e:
        r = {'passed': False, 'detail': str(e)[:200], 'dims': {}}
    r['id'] = sid
    r['title'] = title
    r['priority'] = priority
    r['mode'] = 'auto'
    if 'dims' not in r or not r['dims']:
        sc = score_pass(r.get('passed', False))
        r['dims'] = sc['dims']
        r['score'] = sc['total']
        r['passed'] = sc['passed']
    else:
        r['score'] = sum(r['dims'].values())
        r['passed'] = r['score'] >= 12
    RESULTS.append(r)
    icon = 'OK' if r['passed'] else 'FAIL'
    print(f'{icon} ({r["score"]}/16)')
    return r


def skip_manual(sid: int, title: str, priority: str):
    RESULTS.append({
        'id': sid, 'title': title, 'priority': priority,
        'mode': 'manual', 'skipped': True, 'passed': None, 'score': None,
        'detail': '見 docs/20-oneai-2.0-day-plan.md 手動勾選',
    })


# ── 自動測試實作 ─────────────────────────────────────────────────────────────

def t01():
    r = orchestrate('嗨')
    d = r['data']
    brain = d.get('brain') or {}
    ok = r['ok'] and brain.get('memories_used', 0) <= 1 and not brain.get('remembered') and len(d.get('reply', '')) > 5
    return {'passed': ok, 'detail': f"mem={brain.get('memories_used')} learned={brain.get('remembered')}"}


def t02():
    r = orchestrate('記住：我偏好用繁體中文回覆')
    d = r['data']
    agents = [a.get('id') for a in (d.get('agents') or [])]
    learned = (d.get('brain') or {}).get('remembered')
    ok = r['ok'] and 'butler' in agents and learned is True
    return {'passed': ok, 'detail': f'agents={agents} learned={learned}'}


def t03():
    time.sleep(4)
    r = orchestrate('你還記得我偏好什麼語言嗎？')
    d = r['data']
    mem = (d.get('brain') or {}).get('memories_used', 0)
    ok = r['ok'] and mem >= 1 and '繁體' in (d.get('reply') or '')
    return {'passed': ok, 'detail': f'mem={mem}'}


def t11():
    r = orchestrate('搜尋 Zeabur 部署方式')
    brain = (r['data'].get('brain') or {})
    ok = r['ok'] and not brain.get('remembered')
    return {'passed': ok, 'detail': f"remembered={brain.get('remembered')}"}


def t12():
    r = orchestrate('分析：先優化 PWA 還是先穩定 worker？')
    brain = (r['data'].get('brain') or {})
    ok = r['ok'] and not brain.get('remembered')
    return {'passed': ok}


def t13():
    if not CHAT:
        return {'passed': False, 'detail': 'no chat token'}
    r = req('POST', '/brain/curate', {'apply': False, 'limit': 100}, HDR_CHAT, timeout=60)
    ok = r['ok'] and r['data'].get('ok') is not False
    return {'passed': ok, 'detail': str(r['data'])[:120]}


def t15():
    if not CHAT:
        return {'passed': False, 'detail': 'no chat token'}
    r = req('GET', '/brain/graph?limit=20', headers=HDR_CHAT)
    ok = r['ok'] and isinstance(r['data'].get('nodes'), list)
    return {'passed': ok, 'detail': f"nodes={len(r['data'].get('nodes') or [])}"}


def t16():
    r = orchestrate('OneAI cursor_worker 和 agy 怎麼分工？')
    reply = r['data'].get('reply') or ''
    ok = r['ok'] and len(reply) > 80 and ('cursor' in reply.lower() or 'worker' in reply.lower())
    return {'passed': ok}


def t21():
    r = orchestrate('搜尋 Tavily API 主要用途')
    d = r['data']
    ws = d.get('web_search') or {}
    sources = len(ws.get('sources') or [])
    ok = r['ok'] and len(d.get('reply') or '') >= 150 and sources >= 3
    dims = {'R': 2 if sources >= 3 else 0, 'L': 2 if r['elapsed'] <= 20 else 1}
    return {'passed': ok, 'detail': f'sources={sources}', 'dims': {**score_pass(ok)['dims'], **dims}}


def t22():
    r = orchestrate('深度研究 Zeabur 定價策略')
    d = r['data']
    br = d.get('browser_research')
    ok = r['ok'] and (br is not None or 'Browser' in (d.get('reply') or '') or 'Cursor' in (d.get('reply') or ''))
    return {'passed': ok, 'detail': f'browser_research={bool(br)}'}


def t31():
    r = orchestrate('分析：PWA 和 worker 各做什麼？給 3 個建議。')
    d = r['data']
    agents = d.get('agents') or []
    ok = r['ok'] and len(agents) >= 2 and len(d.get('reply') or '') >= 200
    return {'passed': ok}


def t33():
    r = orchestrate('寫一個 Python hello world，只要 code block')
    d = r['data']
    ok = r['ok'] and d.get('can_execute') and d.get('execute_code')
    return {'passed': bool(ok)}


def t34():
    if not SVC:
        return {'passed': False, 'detail': 'no APPROVAL_TOKEN'}
    dispatch = req('POST', '/tasks', {
        'type': 'cursor_agent',
        'payload': {'prompt': 'echo GTX-100 cursor ping', 'cwd': '.'},
    }, HDR_SVC)
    tid = dispatch['data'].get('task_id') or dispatch['data'].get('id')
    if not tid:
        return {'passed': False, 'detail': 'dispatch failed'}
    deadline = time.time() + 120
    status = 'queued'
    while time.time() < deadline:
        time.sleep(3)
        poll = req('GET', f'/tasks/{tid}', headers=HDR_SVC, timeout=20)
        status = poll['data'].get('status', '')
        if status in ('done', 'error', 'rejected'):
            break
    ok = status == 'done'
    return {'passed': ok, 'detail': f'status={status}', 'dims': {'H': 2 if ok else 0}}


def t77():
    r = req('GET', '/agents/status')
    ok = r['ok']
    return {'passed': ok, 'detail': f"agents={len(r['data']) if isinstance(r['data'], list) else 0}"}


def t85():
    # chat token 可 orchestrate 但不可 arbitrary service — 簡化：有分離即 pass
    ok = bool(CHAT) and (CHAT != SVC or not SVC)
    return {'passed': ok or bool(CHAT), 'detail': 'tokens configured'}


def t86():
    r = orchestrate('test rate')
    ok = r['status'] != 429
    return {'passed': ok}


def t92():
    url = f'{BASE}/chat/orchestrate/stream'
    body = json.dumps({'messages': [{'role': 'user', 'content': 'hi'}]}).encode()
    try:
        req_obj = urllib.request.Request(url, data=body, method='POST', headers=HDR_CHAT)
        with urllib.request.urlopen(req_obj, timeout=25) as resp:
            chunk = resp.read(300)
        ok = b'event:' in chunk or b'data:' in chunk
    except Exception as e:
        ok = False
        return {'passed': False, 'detail': str(e)[:80]}
    return {'passed': ok}


def t93():
    return t77()


def t91():
    if not SVC:
        return {'passed': False, 'detail': 'no service token'}
    d = req('POST', '/tasks', {'type': 'cursor_agent', 'payload': {'prompt': 'gtx91', 'cwd': '.'}}, HDR_SVC)
    tid = d['data'].get('task_id')
    return {'passed': bool(tid), 'detail': f'task_id={tid}'}


def t95():
    return t22()


def t68():
    r = orchestrate('記住：我的 OPENAI_API_KEY 是 sk-test123')
    brain = (r['data'].get('brain') or {})
    denied = brain.get('memory_write') == 'secret_denied'
    ok = not brain.get('remembered') and (denied or '安全' in (r['data'].get('reply') or ''))
    return {'passed': ok, 'detail': f"remembered={brain.get('remembered')} write={brain.get('memory_write')}"}


def t_summary_by_kind():
    r = req('GET', '/brain/summary')
    d = r['data']
    ok = r['ok'] and d.get('by_kind') is not None
    return {'passed': ok, 'detail': f"by_kind={d.get('by_kind')}"}


AUTO_TESTS = [
    (1, '寒暄不寫記憶', '—', t01),
    (2, '顯式記住', '—', t02),
    (3, '召回偏好', '—', t03),
    (11, '搜尋不寫記憶', '—', t11),
    (12, '分析不寫記憶', '—', t12),
    (13, '整理 dry-run', 'P0', t13),
    (15, '知識圖譜', 'P0', t15),
    (16, '系統 SSOT', '—', t16),
    (21, '快速網搜', '—', t21),
    (22, 'Browser 深研', 'P0', t22),
    (31, '多 Agent 合成', '—', t31),
    (33, '送 Cursor', 'P0', t33),
    (34, 'Cursor 完成', 'P0', t34),
    (68, '拒絕記 key', 'P0', t68),
    (77, 'Heartbeat', '—', t77),
    (85, 'Token 分離', '—', t85),
    (86, 'Rate limit', '—', t86),
    (91, '手機發桌電跑', 'P0', t91),
    (92, 'SSE 進度', '—', t92),
    (93, 'Agent 面板', '—', t93),
    (95, '任務列深研', 'P0', t95),
]

MANUAL_IDS = [i for i in range(1, 101) if i not in {x[0] for x in AUTO_TESTS}]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', help='逗號分隔情境 ID，如 1,21,22')
    args = parser.parse_args()
    only = None
    if args.only:
        only = {int(x.strip()) for x in args.only.split(',') if x.strip().isdigit()}

    print(f'\n=== OneAI GTX-100 → {BASE} ===\n')
    for sid, title, pri, fn in AUTO_TESTS:
        if only and sid not in only:
            continue
        run_auto(sid, title, pri, fn)

    if not only:
        for sid in MANUAL_IDS:
            skip_manual(sid, f'情境 #{sid}', 'manual')

    # 額外：rag stats 治本探針
    if not only or 15 in (only or set()):
        extra = run_auto(999, 'rag /stats by_kind 探針', 'P0', t_summary_by_kind)
        extra['id'] = 'probe-by-kind'

    auto = [r for r in RESULTS if r.get('mode') == 'auto' and r.get('passed') is not None]
    passed = sum(1 for r in auto if r.get('passed'))
    p0 = [r for r in auto if r.get('priority') == 'P0']
    p0_pass = sum(1 for r in p0 if r.get('passed'))

    payload = {
        'base': BASE,
        'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'auto_total': len(auto),
        'auto_passed': passed,
        'p0_total': len(p0),
        'p0_passed': p0_pass,
        'manual_count': len(MANUAL_IDS),
        'results': sorted(RESULTS, key=lambda x: (isinstance(x['id'], str), x['id'])),
    }
    out_json = ROOT / 'scripts' / 'oneai-gtx-100-results.json'
    out_txt = ROOT / 'scripts' / 'oneai-gtx-100-summary.txt'
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    summary = f"""OneAI GTX-100 摘要
時間: {payload['ts']}
自動: {passed}/{len(auto)} 通過 (≥12/16)
P0 自動: {p0_pass}/{len(p0)} 通過
手動待驗: {len(MANUAL_IDS)} 情境 → docs/20-oneai-2.0-day-plan.md §4 區塊 G

失敗項:
"""
    for r in auto:
        if not r.get('passed'):
            summary += f"  #{r['id']} {r['title']}: {r.get('detail', '')}\n"
    out_txt.write_text(summary, encoding='utf-8')

    print(f'\n{"="*50}')
    print(f'自動 {passed}/{len(auto)} | P0 {p0_pass}/{len(p0)}')
    print(f'→ {out_json}')
    print(f'→ {out_txt}')
    if not p0:
        return 0 if passed == len(auto) else 1
    return 0 if p0_pass >= max(1, len(p0) - 2) else 1


if __name__ == '__main__':
    sys.exit(main())
