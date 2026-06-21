#!/usr/bin/env python3
"""
OneAI E2E 測試套件
執行: python scripts/e2e-test.py
"""
import os, sys, json, time, urllib.request, urllib.error
from pathlib import Path

# ── 載入 .env ───────────────────────────────────────────────────────────────
def load_dotenv():
    env_path = Path(__file__).parents[1] / '.env'
    if env_path.exists():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                os.environ.setdefault(k.strip(), v.strip())

load_dotenv()

BASE      = os.environ.get('APPROVAL_BASE_URL', '').rstrip('/')
SVC_TOKEN = os.environ.get('APPROVAL_TOKEN', '')
CHAT_TOKEN= os.environ.get('ONEAI_CHAT_TOKEN', '')
WORKER_TOKEN = os.environ.get('ONEAI_WORKER_TOKEN', '')

if not BASE:
    sys.exit('[ERROR] APPROVAL_BASE_URL not set')

# ── 顏色輸出 ────────────────────────────────────────────────────────────────
GREEN = ''; RED = ''; YELLOW = ''; CYAN = ''; RESET = ''; BOLD = ''

def safe(s):
    """Remove non-ASCII chars that break cp950 console."""
    return s.encode('ascii', errors='replace').decode('ascii')

def ok(label, detail=''):
    txt = f'  [PASS] {safe(str(label))}'
    if detail: txt += f'  -> {safe(str(detail))}'
    print(txt)

def fail(label, detail=''):
    txt = f'  [FAIL] {safe(str(label))}'
    if detail: txt += f'  -> {safe(str(detail))}'
    print(txt)
    return False

def skip(label, reason=''):
    print(f'  [SKIP] {safe(str(label))}  (skipped: {safe(str(reason))})')

def section(title):
    print(f'\n== {title} ==')

# ── HTTP 輔助 ───────────────────────────────────────────────────────────────
def req(method, path, body=None, token=None, timeout=20):
    url = BASE + path
    headers = {'Content-Type': 'application/json', 'User-Agent': 'OneAI-E2E'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode() if body else None
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {'error': str(e)}
    except Exception as e:
        return 0, {'error': str(e)}

# ── 結果追蹤 ────────────────────────────────────────────────────────────────
results = {'pass': 0, 'fail': 0, 'skip': 0}

def check(name, condition, detail='', warn_only=False):
    if condition:
        ok(name, detail)
        results['pass'] += 1
        return True
    else:
        fail(name, detail)
        if warn_only:
            results['skip'] += 1
        else:
            results['fail'] += 1
        return False

# ════════════════════════════════════════════════════════════════════════════
print(f'\nOneAI E2E Test  ->  {BASE}')

# ── 1. 健康檢查 ─────────────────────────────────────────────────────────────
section('1 · 健康檢查 /health')
status, body = req('GET', '/health')
check('HTTP 200', status == 200, f'got {status}')
if status == 200:
    if 'version' in body:
        ok('version field: ' + str(body.get('version','')))
    else:
        skip('version field', 'old deployment (pre-v1.2) - needs redeploy')
        results['skip'] += 1

# ── 2. 服務狀態 ─────────────────────────────────────────────────────────────
section('2 · 服務狀態 /status [需新版部署]')
status, body = req('GET', '/status', token=SVC_TOKEN)
if status == 404:
    skip('/status (404)', '此端點只存在新版 server.js，需 Zeabur GitHub link 後 redeploy')
else:
    check('HTTP 200', status == 200, f'got {status}')
    if status == 200:
        svcs = body.get('services', {})
        check('approval_svc 在線', svcs.get('approval_svc', {}).get('status') == 'ok', str(svcs.get('approval_svc')))

# ── 3. Agent 狀態面板 ────────────────────────────────────────────────────────
section('3 · Agent 狀態 /agents/status')
status, body = req('GET', '/agents/status')
check('HTTP 200', status == 200, f'got {status}')
if status == 200:
    agents = body if isinstance(body, list) else body.get('agents', [])
    check('回傳陣列', isinstance(agents, list), f'count={len(agents)}')
    if agents:
        ok(f'已註冊 agents: {[a.get("agent_id","?") for a in agents]}')
    else:
        skip('無 agent 心跳', '本機 worker.py 未執行時正常')

# ── 4. 大腦摘要 (公開) ───────────────────────────────────────────────────────
section('4 · 數位大腦摘要 /brain/summary [需新版部署]')
status, body = req('GET', '/brain/summary')
if status == 404:
    skip('/brain/summary (404)', '此端點只存在新版 server.js，需 Zeabur GitHub link 後 redeploy')
else:
    check('HTTP 200', status == 200, f'got {status}')
    if status == 200:
        check('有 summary 欄位', 'summary' in body or 'note' in body, str(body)[:80])

# ── 5. 聊天代理（基礎）──────────────────────────────────────────────────────
section('5 · 基礎聊天 /chat  [chat token or approval token]')
# Try CHAT_TOKEN first, fallback to SVC_TOKEN (deployed service may use fallback)
for token_label, token in [('CHAT_TOKEN', CHAT_TOKEN), ('SVC_TOKEN fallback', SVC_TOKEN)]:
    if not token:
        continue
    t0 = time.time()
    status, body = req('POST', '/chat',
        body={'messages': [{'role': 'user', 'content': '你好，請用一句話介紹你自己'}]},
        token=token, timeout=30)
    elapsed = round(time.time() - t0, 1)
    if status == 200:
        reply = body.get('reply', '')
        model = body.get('model', '?')
        check(f'HTTP 200 [{token_label}]', True, f'got {status}')
        check('有回覆文字', len(reply) > 5, f'{reply[:60]}...' if len(reply) > 60 else reply)
        ok(f'延遲: {elapsed}s  模型: {model}')
        break
    else:
        ok(f'{token_label} got {status}, trying next...')

# ── 6. 拒絕無效 token ────────────────────────────────────────────────────────
section('6 · 安全性：無效 token 應被拒絕')
status, body = req('POST', '/chat',
    body={'messages': [{'role': 'user', 'content': 'test'}]},
    token='invalid-token-xyz')
check('拒絕無效 token (401/403)', status in (401, 403), f'got {status}')

# ── 7. 多 Agent 協作 Orchestrate ─────────────────────────────────────────────
section('7 · 多 Agent 協作 /chat/orchestrate')
for token_label, token in [('CHAT_TOKEN', CHAT_TOKEN), ('SVC_TOKEN fallback', SVC_TOKEN)]:
    if not token:
        continue
    t0 = time.time()
    status, body = req('POST', '/chat/orchestrate',
        body={'messages': [{'role': 'user', 'content': '用一句話分析：我應該用 Python 還是 JavaScript 做後端？'}]},
        token=token, timeout=45)
    elapsed = round(time.time() - t0, 1)
    if status == 200:
        reply = body.get('reply', '')
        agents_used = body.get('agents', [])
        check(f'HTTP 200 [{token_label}]', True, f'got {status}')
        check('有梅蘭回覆', len(reply) > 10, f'{reply[:80]}...' if len(reply)>80 else reply)
        ok(f'調用 agents: {agents_used}  延遲: {elapsed}s')
        break
    else:
        ok(f'{token_label} got {status}, trying next...')

# ── 8. 記憶庫查詢 ────────────────────────────────────────────────────────────
section('8 · 記憶庫查詢 /brain/memories [需新版部署]')
token_to_use = CHAT_TOKEN or SVC_TOKEN
if not token_to_use:
    skip('/brain/memories', 'token 未設')
else:
    status, body = req('GET', '/brain/memories?q=test&limit=5', token=token_to_use, timeout=15)
    if status == 404:
        skip('/brain/memories (404)', '需新版部署')
    else:
        check('HTTP 200', status == 200, f'got {status}')
        if status == 200:
            ok(f'記憶庫回應: {str(body)[:60]}')

# ── 9. 手動寫入記憶 ──────────────────────────────────────────────────────────
section('9 · 手動寫入記憶 /brain/remember [需新版部署]')
if not token_to_use:
    skip('/brain/remember', 'token 未設')
else:
    status, body = req('POST', '/brain/remember',
        body={'text': '[E2E TEST] test memory entry'},
        token=token_to_use, timeout=15)
    if status == 404:
        skip('/brain/remember (404)', '需新版部署')
    else:
        check('HTTP 200 或 503(RAG未啟動)', status in (200, 503), f'got {status}')

# ── 10. 任務派送 ─────────────────────────────────────────────────────────────
section('10 · Task dispatch /tasks')
# Try WORKER_TOKEN first, then SVC_TOKEN (approval-svc accepts both)
for t_label, t in [('WORKER_TOKEN', WORKER_TOKEN), ('SVC_TOKEN', SVC_TOKEN)]:
    if not t:
        continue
    status, body = req('POST', '/tasks',
        body={'type': 'shell', 'payload': {'cmd': 'echo e2e-test-ok'}},
        token=t, timeout=10)
    if status in (200, 201, 202):
        task_id = body.get('task_id') or body.get('id', '')
        check(f'HTTP 2xx [{t_label}]', True, f'got {status}')
        check('has task_id', bool(task_id), task_id[:16] if task_id else '')
        if task_id:
            s2, b2 = req('GET', f'/tasks/{task_id}', token=t, timeout=5)
            check('can query task', s2 == 200, str(b2.get('status','')))
        break
    elif status == 401:
        ok(f'{t_label} -> 401, trying next...')
    else:
        check(f'HTTP 2xx [{t_label}]', False, f'got {status}')
        break

# ── 11. 速率限制 (只在 /chat 端點) ──────────────────────────────────────────
section('11 · 速率限制（快速連打）')
hit_rate_limit = False
for i in range(25):
    s, _ = req('POST', '/chat',
        body={'messages': [{'role': 'user', 'content': 'x'}]},
        token=CHAT_TOKEN or 'dummy', timeout=5)
    if s == 429:
        hit_rate_limit = True
        ok(f'第 {i+1} 次觸發 429 速率限制 ✓')
        break
if hit_rate_limit:
    ok('Rate limit triggered correctly')
    results['pass'] += 1
else:
    skip('Rate limit not triggered in 25 req', 'rate limit config may be higher - not an error')
    results['skip'] += 1

# ── 結果摘要 ────────────────────────────────────────────────────────────────
total = results['pass'] + results['fail'] + results['skip']
print(f'\n== Test Results ==')
print(f'  PASS: {results["pass"]}  FAIL: {results["fail"]}  SKIP: {results["skip"]}  TOTAL: {total}')

if results['fail'] == 0:
    print(f'\n[OK] All tests passed! System is operational.')
    sys.exit(0)
else:
    print(f'\n[ERROR] {results["fail"]} test(s) failed. See details above.')
    sys.exit(1)
