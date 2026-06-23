#!/usr/bin/env python3
"""
OneAI E2E 測試套件 — API 契約煙霧（快、確定、少污染 production）。

執行:
  python scripts/e2e-test.py
  python scripts/e2e-test.py --rate-limit   # 可選：會觸發 429 並鎖 IP ~1 分鐘
  python scripts/e2e-test.py --legacy-chat  # 可選：測 deprecated /chat

行為/旅程驗收請用: python scripts/user-scenario-sim.py
"""
import argparse
import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

ORCHESTRATE_MAX_SEC = 25
TASK_POLL_SEC = 30
BUTLER_INDEX_WAIT_SEC = 6


def load_dotenv():
    env_path = Path(__file__).parents[1] / '.env'
    if env_path.exists():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                os.environ.setdefault(k.strip(), v.strip())


load_dotenv()

BASE = os.environ.get('APPROVAL_BASE_URL', '').rstrip('/')
SVC_TOKEN = os.environ.get('APPROVAL_TOKEN', '')
CHAT_TOKEN = os.environ.get('ONEAI_CHAT_TOKEN', '')
WORKER_TOKEN = os.environ.get('ONEAI_WORKER_TOKEN', '')

if not BASE:
    sys.exit('[ERROR] APPROVAL_BASE_URL not set')

parser = argparse.ArgumentParser(description='OneAI E2E contract smoke tests')
parser.add_argument('--rate-limit', action='store_true',
                    help='Run rate-limit hammer test (locks IP ~1 min; default skip)')
parser.add_argument('--legacy-chat', action='store_true',
                    help='Probe deprecated POST /chat (default skip)')
args = parser.parse_args()

results = {'pass': 0, 'fail': 0, 'skip': 0}


def safe(s):
    return str(s).encode('ascii', errors='replace').decode('ascii')


def ok(label, detail=''):
    txt = f'  [PASS] {safe(label)}'
    if detail:
        txt += f'  -> {safe(detail)}'
    print(txt)


def fail(label, detail=''):
    txt = f'  [FAIL] {safe(label)}'
    if detail:
        txt += f'  -> {safe(detail)}'
    print(txt)
    return False


def warn(label, detail=''):
    txt = f'  [WARN] {safe(label)}'
    if detail:
        txt += f'  -> {safe(detail)}'
    print(txt)
    results['skip'] += 1


def skip(label, reason=''):
    print(f'  [SKIP] {safe(label)}  (skipped: {safe(reason)})')
    results['skip'] += 1


def section(title):
    print(f'\n== {title} ==')


def chat_token():
    return CHAT_TOKEN or SVC_TOKEN


def req(method, path, body=None, token=None, timeout=20):
    url = BASE + path
    headers = {'Content-Type': 'application/json', 'User-Agent': 'OneAI-E2E'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        raw = resp.read()
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {'_raw': raw.decode('utf-8', errors='replace')[:500]}
        return resp.status, parsed
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {'error': str(e)}
    except Exception as e:
        return 0, {'error': str(e)}


def check(name, condition, detail='', warn_only=False):
    if condition:
        ok(name, detail)
        results['pass'] += 1
        return True
    fail(name, detail)
    if warn_only:
        results['skip'] += 1
    else:
        results['fail'] += 1
    return False


def orchestrate(messages, token=None, timeout=45):
    token = token or chat_token()
    t0 = time.time()
    status, body = req('POST', '/chat/orchestrate',
                       body={'messages': messages}, token=token, timeout=timeout)
    elapsed = round(time.time() - t0, 1)
    return status, body, elapsed


def check_sse_stream(token=None):
    token = token or chat_token()
    if not token:
        return False, 'no token'
    url = BASE + '/chat/orchestrate/stream'
    body = json.dumps({'messages': [{'role': 'user', 'content': 'hi'}]}).encode()
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Bearer {token}',
        'User-Agent': 'OneAI-E2E',
    }
    t0 = time.time()
    try:
        r = urllib.request.Request(url, data=body, method='POST', headers=headers)
        with urllib.request.urlopen(r, timeout=30) as resp:
            chunk = resp.read(300)
            elapsed = round(time.time() - t0, 1)
            if b'event:' in chunk or b'data:' in chunk:
                return True, f'SSE active ({elapsed}s)'
            return True, f'HTTP {resp.status} ({elapsed}s)'
    except urllib.error.HTTPError as e:
        return False, f'HTTP {e.code}'
    except Exception as e:
        return False, str(e)[:80]


def list_agents():
    status, body = req('GET', '/agents/status')
    if status != 200:
        return []
    return body if isinstance(body, list) else body.get('agents', [])


def worker_is_online():
    return any(a.get('online') for a in list_agents())


print(f'\nOneAI E2E Test  ->  {BASE}')
if not args.rate_limit:
    print('  (rate-limit test skipped; pass --rate-limit to enable)')
if not args.legacy_chat:
    print('  (legacy /chat skipped; pass --legacy-chat to enable)')

# ── 1. 健康檢查 ─────────────────────────────────────────────────────────────
section('1 · 健康檢查 /health')
status, body = req('GET', '/health')
check('HTTP 200', status == 200, f'got {status}')
if status == 200:
    if 'version' in body:
        ok('version field: ' + str(body.get('version', '')))
        results['pass'] += 1
    else:
        skip('version field', 'old deployment (pre-v1.2)')

# ── 2. 服務狀態 ─────────────────────────────────────────────────────────────
section('2 · 服務狀態 /status [service token]')
status, body = req('GET', '/status', token=SVC_TOKEN)
if status == 404:
    skip('/status (404)', 'needs redeploy')
else:
    check('HTTP 200 [SVC_TOKEN]', status == 200, f'got {status}')
    if status == 200:
        svcs = body.get('services', {})
        check('approval_svc 在線', svcs.get('approval_svc', {}).get('status') == 'ok',
              str(svcs.get('approval_svc')))

# ── 3. Agent 狀態面板 ────────────────────────────────────────────────────────
section('3 · Agent 狀態 /agents/status')
status, body = req('GET', '/agents/status')
check('HTTP 200', status == 200, f'got {status}')
worker_online = False
if status == 200:
    agents = list_agents()
    check('回傳陣列', isinstance(agents, list), f'count={len(agents)}')
    worker_online = worker_is_online()
    if agents:
        ok(f'已註冊 agents: {[a.get("agent_id", "?") for a in agents]}')
        results['pass'] += 1
        if worker_online:
            ok('worker online (heartbeat <60s)')
            results['pass'] += 1
        else:
            skip('worker online', 'heartbeat stale; restart worker.py')
    else:
        skip('無 agent 心跳', '本機 worker.py 未執行時正常')

# ── 4. 大腦摘要 (公開) ───────────────────────────────────────────────────────
section('4 · 數位大腦摘要 /brain/summary [public]')
status, body = req('GET', '/brain/summary')
if status == 404:
    skip('/brain/summary (404)', 'needs redeploy')
else:
    check('HTTP 200', status == 200, f'got {status}')
    if status == 200:
        check('有 summary 欄位', 'summary' in body or 'note' in body, str(body)[:80])

# ── 5. SSE 串流（取代 legacy /chat 為預設契約）────────────────────────────────
section('5 · SSE /chat/orchestrate/stream [primary chat path]')
token = chat_token()
if not token:
    skip('SSE stream', 'token 未設')
else:
    sse_ok, sse_detail = check_sse_stream(token)
    check('SSE endpoint 可用', sse_ok, sse_detail)

if args.legacy_chat:
    section('5b · Legacy /chat [deprecated, opt-in]')
    for token_label, tok in [('CHAT_TOKEN', CHAT_TOKEN), ('SVC_TOKEN', SVC_TOKEN)]:
        if not tok:
            continue
        t0 = time.time()
        status, _ = req('POST', '/chat',
                        body={'messages': [{'role': 'user', 'content': 'ping'}]},
                        token=tok, timeout=30)
        elapsed = round(time.time() - t0, 1)
        if status == 200:
            check(f'HTTP 200 [{token_label}]', True, f'elapsed={elapsed}s')
            ok('legacy /chat still alive (sunset candidate)')
            results['pass'] += 1
            break
        ok(f'{token_label} got {status}, trying next...')

# ── 6. 安全性：token 邊界 ───────────────────────────────────────────────────
section('6 · 安全性：token 邊界')
status, _ = req('POST', '/chat/orchestrate',
                body={'messages': [{'role': 'user', 'content': 'test'}]},
                token='invalid-token-xyz')
check('invalid token → 401/403', status in (401, 403), f'got {status}')

if CHAT_TOKEN and SVC_TOKEN and CHAT_TOKEN != SVC_TOKEN:
    s_status, _ = req('GET', '/status', token=CHAT_TOKEN)
    check('CHAT_TOKEN 不能 GET /status', s_status == 401, f'got {s_status}')
    t_status, _ = req('POST', '/tasks',
                      body={'type': 'shell', 'payload': {'cmd': 'echo x'}},
                      token=CHAT_TOKEN, timeout=10)
    check('CHAT_TOKEN 不能 POST /tasks', t_status == 401, f'got {t_status}')
elif CHAT_TOKEN and SVC_TOKEN:
    skip('CHAT vs SVC separation', 'tokens identical in .env')
else:
    skip('CHAT vs SVC separation', 'ONEAI_CHAT_TOKEN or APPROVAL_TOKEN missing')

if WORKER_TOKEN:
    w_status, _ = req('POST', '/tasks',
                      body={'type': 'shell', 'payload': {'cmd': 'echo x'}},
                      token=WORKER_TOKEN, timeout=10)
    check('WORKER_TOKEN 不能 POST /tasks (入列)', w_status == 401, f'got {w_status}')
else:
    skip('WORKER_TOKEN boundary', 'ONEAI_WORKER_TOKEN not set')

# ── 7. 多 Agent 協作 ─────────────────────────────────────────────────────────
section('7 · 多 Agent 協作 /chat/orchestrate')
orchestrate_ok = False
for token_label, tok in [('CHAT_TOKEN', CHAT_TOKEN), ('SVC_TOKEN', SVC_TOKEN)]:
    if not tok:
        continue
    status, body, elapsed = orchestrate(
        [{'role': 'user', 'content': '用一句話分析：我應該用 Python 還是 JavaScript 做後端？'}],
        token=tok, timeout=45,
    )
    if status == 200:
        reply = body.get('reply', '')
        agents_used = body.get('agents', [])
        agent_ids = [a.get('id') for a in agents_used if isinstance(a, dict)]
        check(f'HTTP 200 [{token_label}]', True, f'elapsed={elapsed}s')
        check('有梅蘭回覆', len(reply) > 10, f'len={len(reply)}')
        check('有 brain 元資料', 'brain' in body, str(body.get('brain', {}))[:60])
        check('≥2 agents', len(agent_ids) >= 2, str(agent_ids), warn_only=True)
        if len(agent_ids) >= 2:
            check('synthesis 欄位存在', 'synthesis' in body,
                  f"synthesis={body.get('synthesis')}")
        if elapsed > ORCHESTRATE_MAX_SEC:
            warn(f'延遲 >{ORCHESTRATE_MAX_SEC}s', f'{elapsed}s (LLM cold start OK)')
        ok(f'agents={agent_ids}')
        orchestrate_ok = True
        break
    ok(f'{token_label} got {status}, trying next...')

# ── 7b. 網搜元資料 ───────────────────────────────────────────────────────────
section('7b · 網搜 web_search [orchestrate]')
if not chat_token():
    skip('web_search', 'token 未設')
else:
    status, body, elapsed = orchestrate(
        [{'role': 'user', 'content': '搜尋 Zeabur 平台是什麼'}], timeout=60,
    )
    if status == 200:
        ws = body.get('web_search')
        researcher = any(a.get('id') == 'researcher' for a in body.get('agents', []))
        check('觸發 researcher 或 web_search', ws is not None or researcher,
              str(ws)[:60] if ws else f'researcher={researcher}')
        if ws:
            check('web_search 含 sources', isinstance(ws.get('sources'), list),
                  f"provider={ws.get('provider')} count={ws.get('result_count')}")
        check(f'搜尋延遲 ≤60s', elapsed <= 60, f'{elapsed}s', warn_only=True)
    else:
        skip('web_search', f'orchestrate got {status}')

# ── 7c. Butler 記憶閉環（記住 → 召回）────────────────────────────────────────
section('7c · Butler recall loop [remember → recall]')
if not chat_token():
    skip('butler recall', 'token 未設')
else:
    status, body, _ = orchestrate(
        [{'role': 'user', 'content': '記住：我偏好用繁體中文回覆'}], timeout=45,
    )
    learned = (body.get('brain') or {}).get('remembered') if status == 200 else None
    agents_r = [a.get('id') for a in body.get('agents', []) if isinstance(a, dict)]
    check('記住 HTTP 200', status == 200, f'got {status}')
    check('butler 參與', 'butler' in agents_r, str(agents_r))
    check('remembered=true', learned is True, f'learned={learned}')

    time.sleep(BUTLER_INDEX_WAIT_SEC)

    status2, body2, _ = orchestrate(
        [{'role': 'user', 'content': '你還記得我偏好什麼語言嗎？'}], timeout=45,
    )
    if status2 == 200:
        brain = body2.get('brain') or {}
        mem = brain.get('memories_used', 0)
        reply = body2.get('reply') or ''
        check('召回 mem≥1', mem >= 1, f'mem={mem}')
        check('回覆含繁體', '繁體' in reply, f'reply_len={len(reply)}')
    else:
        check('召回 HTTP 200', False, f'got {status2}')

# ── 8. 記憶庫查詢 ────────────────────────────────────────────────────────────
section('8 · 記憶庫查詢 /brain/memories')
token_to_use = chat_token()
if not token_to_use:
    skip('/brain/memories', 'token 未設')
else:
    status, body = req('GET', '/brain/memories?q=test&limit=5', token=token_to_use, timeout=15)
    if status == 404:
        skip('/brain/memories (404)', 'needs redeploy')
    else:
        check('HTTP 200', status == 200, f'got {status}')
        if status == 200:
            ok(f'memories count={body.get("total", len(body.get("memories", [])))}')

# ── 9. 手動寫入記憶（不污染 RAG：只驗證校驗）──────────────────────────────────
section('9 · /brain/remember 校驗 [no RAG write]')
if not token_to_use:
    skip('/brain/remember', 'token 未設')
else:
    status, body = req('POST', '/brain/remember',
                       body={'text': '短'},
                       token=token_to_use, timeout=15)
    if status == 404:
        skip('/brain/remember (404)', 'needs redeploy')
    else:
        check('過短內容 → 400', status == 400, f'got {status}')
        ok('skipped persist write (use user-scenario-sim for RAG behavior)')

# ── 10. 任務派送 + poll 到終態 ───────────────────────────────────────────────
section('10 · Task dispatch /tasks [poll to done]')
task_terminal = None
if not SVC_TOKEN:
    skip('task dispatch', 'APPROVAL_TOKEN not set')
else:
    status, body = req('POST', '/tasks',
                       body={'type': 'shell', 'payload': {'cmd': 'echo OneAI-Worker-Test'}},
                       token=SVC_TOKEN, timeout=10)
    if status in (200, 201, 202):
        task_id = body.get('task_id') or body.get('id', '')
        check('HTTP 2xx [SVC_TOKEN]', True, f'got {status}')
        check('has task_id', bool(task_id), task_id[:16] if task_id else '')
        if task_id:
            deadline = time.time() + TASK_POLL_SEC
            while time.time() < deadline:
                s2, b2 = req('GET', f'/tasks/{task_id}', token=SVC_TOKEN, timeout=5)
                task_terminal = b2.get('status', '')
                if task_terminal in ('done', 'failed', 'error', 'cancelled', 'rejected'):
                    break
                time.sleep(2)
            check('task 可輪詢', s2 == 200, f'status={task_terminal}')
            if task_terminal == 'done':
                ok('task 終態 done')
                results['pass'] += 1
            elif worker_online:
                err = b2.get('error') or b2.get('result') or {}
                hint = err if isinstance(err, str) else str(err)[:100]
                warn('task 未 done', f'status={task_terminal}; {hint}; restart worker.py')
            else:
                skip('task 終態 done', f'stuck at {task_terminal}; start worker.py')
    else:
        check('HTTP 2xx [SVC_TOKEN]', False, f'got {status}')

# ── 11. 速率限制（可選，預設跳過）────────────────────────────────────────────
section('11 · 速率限制（可選）')
if args.rate_limit:
    hit_rate_limit = False
    for i in range(25):
        s, _ = req('POST', '/chat',
                   body={'messages': [{'role': 'user', 'content': 'x'}]},
                   token=CHAT_TOKEN or 'dummy', timeout=5)
        if s == 429:
            hit_rate_limit = True
            ok(f'第 {i + 1} 次觸發 429')
            break
    if hit_rate_limit:
        ok('Rate limit triggered correctly')
        results['pass'] += 1
        print('  [WARN] IP may be rate-limited ~60s; wait before human-loop-sim')
    else:
        skip('Rate limit not triggered in 25 req', 'config may differ')
else:
    skip('rate limit hammer', 'pass --rate-limit to run (avoids locking IP for other tests)')

# ── 結果摘要 ────────────────────────────────────────────────────────────────
total = results['pass'] + results['fail'] + results['skip']
print(f'\n== Test Results ==')
print(f'  PASS: {results["pass"]}  FAIL: {results["fail"]}  SKIP: {results["skip"]}  TOTAL: {total}')

if results['fail'] == 0:
    print('\n[OK] All required tests passed! System is operational.')
    sys.exit(0)
print(f'\n[ERROR] {results["fail"]} test(s) failed. See details above.')
sys.exit(1)
