#!/usr/bin/env python3
"""
10 種使用者視角情境模擬 — 驗證「問題是否真的被解決」。
執行: python scripts/user-scenario-sim.py
輸出: scripts/user-scenario-results.json
"""
import json, os, sys, time, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import quote

def load_dotenv():
    p = Path(__file__).parents[1] / '.env'
    if p.exists():
        for line in p.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                os.environ.setdefault(k.strip(), v.strip())

load_dotenv()
BASE = os.environ.get('APPROVAL_BASE_URL', '').rstrip('/')
CHAT = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')
SVC = os.environ.get('APPROVAL_TOKEN', '')
WORKER = os.environ.get('ONEAI_WORKER_TOKEN', '')

if not BASE:
    sys.exit('[ERROR] APPROVAL_BASE_URL not set')

HDR_CHAT = {'Content-Type': 'application/json', 'Authorization': f'Bearer {CHAT}', 'User-Agent': 'OneAI-UserSim'}
HDR_SVC = {'Content-Type': 'application/json', 'Authorization': f'Bearer {SVC}'} if SVC else {}
HDR_WORKER = {'Content-Type': 'application/json', 'Authorization': f'Bearer {WORKER}'} if WORKER else {}


def safe(s):
    return (s or '').encode('ascii', errors='replace').decode('ascii')


def req(method, path, body=None, headers=None, timeout=90):
    url = f'{BASE}{path}'
    data = json.dumps(body).encode() if body is not None else None
    h = headers or {}
    t0 = time.time()
    try:
        r = urllib.request.Request(url, data=data, method=method, headers=h)
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


def check_stream():
    url = f'{BASE}/chat/orchestrate/stream'
    body = json.dumps({'messages': [{'role': 'user', 'content': 'hi'}]}).encode()
    t0 = time.time()
    try:
        req = urllib.request.Request(url, data=body, method='POST', headers=HDR_CHAT)
        with urllib.request.urlopen(req, timeout=30) as resp:
            chunk = resp.read(200)
            elapsed = round(time.time() - t0, 2)
            if b'event:' in chunk or b'data:' in chunk:
                return {'ok': True, 'reason': 'SSE stream active', 'elapsed': elapsed}
            return {'ok': True, 'reason': 'endpoint 200', 'elapsed': elapsed}
    except urllib.error.HTTPError as e:
        elapsed = round(time.time() - t0, 2)
        if e.code == 404:
            return {'ok': False, 'reason': 'SSE endpoint 404 (harness v2 not deployed)', 'elapsed': elapsed}
        return {'ok': False, 'reason': f'HTTP {e.code}', 'elapsed': elapsed}


SCENARIOS = []


def scenario(num, title, user_goal, fn):
    print(f'\n{"="*60}\nS{num}: {safe(title)}\nGoal: {safe(user_goal)}\n{"-"*60}')
    try:
        result = fn()
    except Exception as e:
        result = {'solved': False, 'user_sees': f'錯誤：{e}', 'blocker': str(e), 'checklist_ids': []}
    result['id'] = num
    result['title'] = title
    result['user_goal'] = user_goal
    SCENARIOS.append(result)
    icon = '[PASS]' if result.get('solved') else '[FAIL]'
    print(f'{icon} solved={result.get("solved")}  |  user_sees={safe(result.get("user_sees", ""))[:120]}')
    if result.get('blocker'):
        print(f'   blocker: {safe(str(result["blocker"])[:160])}')
    if result.get('checklist_ids'):
        print(f'   對應清單：{", ".join(result["checklist_ids"])}')
    return result


# ── S1 寒暄 ─────────────────────────────────────────────────────────────────
def s1():
    r = orchestrate('嗨')
    d = r['data']
    brain = d.get('brain') or {}
    mem = brain.get('memories_used', 0)
    learned = brain.get('remembered', False)
    solved = r['ok'] and mem <= 1 and not learned and len(d.get('reply', '')) > 5
    return {
        'solved': solved,
        'user_sees': f'梅蘭回「{d.get("reply","")[:40]}…」' if r['ok'] else '送不出訊息',
        'blocker': None if solved else f'mem={mem} learned={learned}（應 mem≤1 learned=False）',
        'checklist_ids': ['A-01', 'DEP-01'] if not solved else [],
        'metrics': {'mem': mem, 'learned': learned, 'elapsed': r['elapsed']},
    }

# ── S2 記住 ─────────────────────────────────────────────────────────────────
def s2():
    r = orchestrate('記住：我偏好用繁體中文回覆')
    d = r['data']
    agents = [a.get('id') for a in (d.get('agents') or [])]
    learned = (d.get('brain') or {}).get('remembered')
    solved = r['ok'] and 'butler' in agents and learned is True
    return {
        'solved': solved,
        'user_sees': '管家確認已記住' if solved else f'agents={agents} learned={learned}',
        'blocker': None if solved else '記住未走 butler 或未寫入記憶',
        'checklist_ids': ['A-02', 'A-03', 'DEP-01'],
        'metrics': {'agents': agents, 'learned': learned},
    }

# ── S3 調記憶 ───────────────────────────────────────────────────────────────
def s3():
    r = orchestrate('你還記得我偏好什麼語言嗎？')
    d = r['data']
    agents = [a.get('id') for a in (d.get('agents') or [])]
    mem = (d.get('brain') or {}).get('memories_used', 0)
    solved = r['ok'] and mem >= 1 and '繁體' in (d.get('reply') or '')
    return {
        'solved': solved,
        'user_sees': '能提到繁體中文' if solved else f'回覆未命中偏好 agents={agents} mem={mem}',
        'blocker': None if solved else 'RAG 無相關記憶或 butler 未召回',
        'checklist_ids': ['A-01', 'M-01', 'DEP-02'],
        'metrics': {'agents': agents, 'mem': mem, 'reply_len': len(d.get('reply') or '')},
    }

# ── S4 搜尋 ─────────────────────────────────────────────────────────────────
def s4():
    r = orchestrate('搜尋 Tavily API 主要用途')
    d = r['data']
    reply = d.get('reply') or ''
    ws = d.get('web_search') or {}
    sources = len(ws.get('sources') or [])
    solved = r['ok'] and len(reply) >= 150 and sources >= 3
    return {
        'solved': solved,
        'user_sees': f'搜尋回覆 {len(reply)} 字、{sources} 來源' if r['ok'] else '搜尋失敗',
        'blocker': None if solved else f'reply={len(reply)} sources={sources}（應 ≥150字 ≥3來源）',
        'checklist_ids': ['A-04', 'A-05', 'ENV-01'],
        'metrics': {'reply_len': len(reply), 'sources': sources, 'provider': ws.get('provider')},
    }

# ── S5 多 Agent 合成 ─────────────────────────────────────────────────────────
def s5():
    r = orchestrate('分析：先優化 PWA 還是先穩定 worker？給 3 個行動建議。')
    d = r['data']
    agents = d.get('agents') or []
    synth = d.get('synthesis', len(agents) > 1)
    reply = d.get('reply') or ''
    solved = r['ok'] and len(agents) >= 2 and len(reply) >= 200
    return {
        'solved': solved,
        'user_sees': f'{len(agents)} 位專家、合成={synth}、{len(reply)}字' if r['ok'] else '失敗',
        'blocker': None if solved else '多 Agent 未觸發或回覆過短',
        'checklist_ids': ['F-01', 'DEP-01'],
        'metrics': {'agent_count': len(agents), 'synthesis': synth, 'reply_len': len(reply)},
    }

# ── S6 手機看連線 / 大腦在線 ─────────────────────────────────────────────────
def s6():
    health = req('GET', '/health')
    summary = req('GET', '/brain/summary')
    agents = req('GET', '/agents/status')
    h_ok = health['ok'] and (health['data'].get('ok') or health['status'] == 200)
    s_ok = summary['ok'] and summary['data'].get('status') == 'ok'
    worker_online = len(agents['data']) > 0 if agents['ok'] else False
    # 連線指示：health 即可；worker 另計
    solved = h_ok and s_ok
    return {
        'solved': solved,
        'user_sees': f'Header 🫀 {summary["data"].get("total_memories",0)} 條；worker {"在線" if worker_online else "離線"}',
        'blocker': None if solved else 'health 或 brain/summary 異常',
        'checklist_ids': ['CLN-01', 'WRK-01'] if not worker_online else ['CLN-01'],
        'metrics': {'health': h_ok, 'brain_ok': s_ok, 'workers': len(agents['data']) if agents['ok'] else 0},
    }

# ── S7 桌機 Shell（AgyPanel）──────────────────────────────────────────────────
def s7():
    if not SVC:
        return {'solved': False, 'user_sees': '未設定 APPROVAL_TOKEN 無法測 task', 'blocker': '缺 token', 'checklist_ids': ['WRK-01']}
    dispatch = req('POST', '/tasks', {'type': 'shell', 'payload': {'cmd': 'echo OneAI-Worker-Test'}}, HDR_SVC)
    tid = dispatch['data'].get('task_id') or dispatch['data'].get('id')
    if not tid:
        return {'solved': False, 'user_sees': '無法派送任務', 'blocker': str(dispatch['data']), 'checklist_ids': ['WRK-01']}
    deadline = time.time() + 45
    status = 'queued'
    while time.time() < deadline:
        time.sleep(2)
        poll = req('GET', f'/tasks/{tid}', headers=HDR_SVC, timeout=15)
        status = poll['data'].get('status', '')
        if status in ('done', 'error', 'rejected'):
            break
    solved = status == 'done'
    out = (poll['data'].get('result') or {}).get('stdout_tail', '') if status == 'done' else ''
    return {
        'solved': solved,
        'user_sees': f'任務 {status}；輸出={out[:60]}' if solved else f'任務卡在 {status}（worker 未跑）',
        'blocker': None if solved else '本機 worker.py 未啟動或 token 不符',
        'checklist_ids': ['WRK-01', 'WRK-02'],
        'metrics': {'task_id': tid, 'status': status},
    }

# ── S8 記憶 Tab 瀏覽 ───────────────────────────────────────────────────────────
def s8():
    summary = req('GET', '/brain/summary')
    mems = req('GET', f'/brain/memories?q={quote("孟一")}&limit=5', headers=HDR_CHAT)
    total = summary['data'].get('total_memories', 0)
    count = len(mems['data'].get('memories') or [])
    solved = summary['ok'] and mems['ok'] and summary['data'].get('status') == 'ok'
    return {
        'solved': solved,
        'user_sees': f'記憶庫 {total} 條；搜尋命中 {count} 筆',
        'blocker': None if solved else 'RAG 離線或 /brain/* 代理失敗',
        'checklist_ids': ['I-01', 'DEP-02', 'H-01'],
        'metrics': {'total': total, 'query_hits': count},
    }

# ── S9 SSE 真實進度 ───────────────────────────────────────────────────────────
def s9():
    st = check_stream()
    solved = st['ok']
    return {
        'solved': solved,
        'user_sees': '思考條顯示真實階段' if solved else '仍用假輪播或 404',
        'blocker': st.get('reason'),
        'checklist_ids': ['G-01', 'DEP-01'],
        'metrics': {'elapsed': st.get('elapsed')},
    }

# ── S10 程式碼 → Cursor ───────────────────────────────────────────────────────
def s10():
    r = orchestrate('幫我寫一個 Python hello world 函式，只要程式碼')
    d = r['data']
    can_exec = d.get('can_execute', False)
    code = d.get('execute_code') or ''
    if not can_exec or not code:
        return {
            'solved': False,
            'user_sees': '沒出現「在 Cursor 執行」按鈕',
            'blocker': 'engineer 未回程式或未觸發 can_execute',
            'checklist_ids': ['DEP-01'],
            'metrics': {'can_execute': can_exec},
        }
    if not SVC:
        return {'solved': False, 'user_sees': '有程式但無法測派送', 'blocker': '缺 APPROVAL_TOKEN', 'checklist_ids': ['WRK-03']}
    dispatch = req('POST', '/tasks', {'type': 'cursor_agent', 'payload': {'prompt': code[:200], 'cwd': '.'}}, HDR_SVC)
    tid = dispatch['data'].get('task_id') or dispatch['data'].get('id')
    solved = bool(tid)
    return {
        'solved': solved,
        'user_sees': f'可派送 Cursor 任務 {str(tid)[:8]}' if solved else '派送失敗',
        'blocker': None if solved else 'cursor 任務入列失敗；執行需 cursor_worker',
        'checklist_ids': ['WRK-03'] if not solved else ['WRK-03', 'DEP-01'],
        'metrics': {'can_execute': True, 'code_len': len(code), 'task_id': tid},
    }


def main():
    print(f'\n=== OneAI 10 情境使用者模擬 → {BASE} ===')
    scenario(1, '開場寒暄', '像跟助理打招呼，不要一堆記憶和「已學習」', s1)
    scenario(2, '明確記住', '說「記住」後，管家確認並寫入', s2)
    scenario(3, '調出記憶', '問偏好，能從記憶庫召回', s3)
    scenario(4, '網路搜尋', '搜尋後有來源、回覆夠長', s4)
    scenario(5, '多專家分析', '複雜問題多位 Agent + 梅蘭合成', s5)
    scenario(6, '看系統在線', 'Header 綠點、🫀 記憶數、worker 狀態', s6)
    scenario(7, '手機控桌機 Shell', 'AgyPanel 派 echo 命令有回應', s7)
    scenario(8, '記憶 Tab', '看記憶庫總數、能搜尋', s8)
    scenario(9, '真實思考進度', 'SSE 階段推送（非假輪播）', s9)
    scenario(10, '寫程式跑 Cursor', '工程師給 code + 可派送 Cursor', s10)

    passed = sum(1 for s in SCENARIOS if s.get('solved'))
    out = Path(__file__).parent / 'user-scenario-results.json'
    out.write_text(json.dumps({'base': BASE, 'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ'), 'passed': passed, 'total': 10, 'scenarios': SCENARIOS}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n{"="*60}\n結果：{passed}/10 通過 → {out}\n')
    return 0 if passed >= 7 else 1


if __name__ == '__main__':
    sys.exit(main())
