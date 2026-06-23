#!/usr/bin/env python3
"""5-loop human behavior simulation against OneAI cloud."""
import json, os, time, urllib.request, urllib.error
from pathlib import Path

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
TOKEN = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')

SCENARIOS = [
    {
        'name': 'Loop 1 · 開場寒暄',
        'msg': '嗨梅蘭，今天狀態如何？',
        'intent': 'warmup',
    },
    {
        'name': 'Loop 2 · 寫入可記憶的事實',
        'msg': '記住：我下週三要去曼谷出差，住 Sukhumvit 附近。',
        'intent': 'remember',
    },
    {
        'name': 'Loop 3 · 調取記憶',
        'msg': '你還記得我下週的行程嗎？',
        'intent': 'recall',
    },
    {
        'name': 'Loop 4 · 網路搜尋',
        'msg': '搜尋 2026 年曼谷 Sukhumvit 附近新開的 co-working space',
        'intent': 'search',
    },
    {
        'name': 'Loop 5 · 多 Agent 決策',
        'msg': '分析：我應該先優化手機 PWA 體驗，還是先讓桌機 worker 穩定？給我 3 個行動建議。',
        'intent': 'multi_agent',
    },
]

history = []
results = []


def orchestrate(msg):
    body = json.dumps({'messages': history + [{'role': 'user', 'content': msg}]}).encode()
    req = urllib.request.Request(
        f'{BASE}/chat/orchestrate',
        data=body,
        method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {TOKEN}', 'User-Agent': 'OneAI-HumanSim'},
    )
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=90)
        data = json.loads(resp.read())
        return {'ok': True, 'status': resp.status, 'elapsed': round(time.time() - t0, 1), 'data': data}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read())
        except Exception:
            err = {'error': str(e)}
        return {'ok': False, 'status': e.code, 'elapsed': round(time.time() - t0, 1), 'data': err}


def safe(s, n=120):
    return (s or '').encode('ascii', 'replace').decode('ascii')[:n]


print(f'\n=== OneAI Human Simulation (5 loops) -> {BASE} ===\n')

for i, sc in enumerate(SCENARIOS, 1):
    print(f'--- {sc["name"]} ---')
    print(f'User: {sc["msg"]}')
    time.sleep(1.2)  # human typing pause

    r = orchestrate(sc['msg'])
    d = r.get('data') or {}
    reply = d.get('reply', d.get('error', ''))
    agents = d.get('agents') or []
    brain = d.get('brain') or {}
    ws = d.get('web_search')

    agent_ids = [a.get('id') for a in agents]
    print(f'Latency: {r["elapsed"]}s  Status: {r.get("status")}')
    print(f'Agents: {agent_ids}')
    print(f'Brain: used={brain.get("memories_used", d.get("memories_used", 0))} remembered={brain.get("remembered")} preview={safe(str(brain.get("memory_preview", "")))}')
    if ws:
        print(f'Search: provider={ws.get("provider")} results={ws.get("result_count")} sources={len(ws.get("sources") or [])}')
    print(f'Reply: {safe(reply, 200)}')
    print()

    results.append({
        'loop': i,
        'scenario': sc['name'],
        'intent': sc['intent'],
        'msg': sc['msg'],
        'ok': r['ok'],
        'elapsed': r['elapsed'],
        'status': r.get('status'),
        'agent_ids': agent_ids,
        'agent_count': len(agents),
        'reply_len': len(reply or ''),
        'memories_used': brain.get('memories_used', d.get('memories_used', 0)),
        'remembered': brain.get('remembered'),
        'memory_preview_ok': not any('[object Object]' in str(x) for x in (brain.get('memory_preview') or [])),
        'web_search': ws,
        'can_execute': d.get('can_execute'),
        'model': d.get('model'),
    })

    if r['ok'] and reply:
        history.append({'role': 'user', 'content': sc['msg']})
        history.append({'role': 'assistant', 'content': reply})
        history = history[-12:]

out = Path(__file__).parent / 'human-loop-results.json'
out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Saved: {out}')
print(f'Total time: {sum(r["elapsed"] for r in results)}s')
