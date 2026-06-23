#!/usr/bin/env python3
"""
Agent 自我進化 / Skill 驗收 — 驗證「叫裝 skill、叫進化，大腦能自己寫回並召回」。

邊界（誠實）：
  ✅ 雲端大腦：記住 preference/sop → RAG → 下次召回（結構化記憶進化）
  ❌ 尚未做：自動寫入 ~/.agents/skills/ 或 Cursor skill 目錄（需本機 worker/Hermes Phase C）

執行: python scripts/agent-evolve-sim.py
輸出: scripts/agent-evolve-results.json
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from urllib.parse import quote

MARKER = 'OneAI-EvolveSkill-2026'


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

if not BASE or not CHAT:
    sys.exit('[ERROR] APPROVAL_BASE_URL and chat token required')

HDR = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {CHAT}',
    'User-Agent': 'OneAI-EvolveSim',
}

SCENARIOS = []


def safe(s, n=140):
    return (s or '').encode('ascii', errors='replace').decode('ascii')[:n]


def req(method, path, body=None, timeout=90):
    url = f'{BASE}{path}'
    data = json.dumps(body).encode() if body is not None else None
    t0 = time.time()
    try:
        r = urllib.request.Request(url, data=data, method=method, headers=HDR)
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            elapsed = round(time.time() - t0, 2)
            raw = resp.read()
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
    return req('POST', '/chat/orchestrate', {'messages': messages})


def scenario(num, title, goal, fn):
    print(f'\n{"=" * 60}\nE{num}: {safe(title)}\nGoal: {safe(goal)}\n{"-" * 60}')
    try:
        result = fn()
    except Exception as e:
        result = {'solved': False, 'user_sees': f'錯誤：{e}', 'blocker': str(e)}
    result['id'] = num
    result['title'] = title
    result['goal'] = goal
    SCENARIOS.append(result)
    icon = '[PASS]' if result.get('solved') else '[FAIL]'
    print(f'{icon} solved={result.get("solved")}  |  {safe(result.get("user_sees", ""))}')
    if result.get('blocker'):
        print(f'   blocker: {safe(str(result["blocker"]))}')
    return result


# ── E1 顯式「裝 skill」（記住 SOP）──────────────────────────────────────────
def e1():
    msg = (
        f'記住這個 skill（{MARKER}）：當我說「進化驗收」時，'
        '回覆必須先列三點 bullet summary，再用繁體中文細說。'
    )
    r = orchestrate(msg)
    d = r['data']
    agents = [a.get('id') for a in (d.get('agents') or [])]
    learned = (d.get('brain') or {}).get('remembered')
    solved = r['ok'] and 'butler' in agents and learned is True
    return {
        'solved': solved,
        'user_sees': '管家已寫入 skill' if solved else f'agents={agents} learned={learned}',
        'blocker': None if solved else 'butler 未記住 skill',
        'metrics': {'agents': agents, 'learned': learned, 'elapsed': r['elapsed']},
    }


# ── E2 召回已裝 skill ───────────────────────────────────────────────────────
def e2():
    time.sleep(6)
    r = orchestrate(f'用 {MARKER} 教你的格式，簡短回答：什麼是自我進化？')
    d = r['data']
    brain = d.get('brain') or {}
    mem = brain.get('memories_used', 0)
    reply = d.get('reply') or ''
    has_bullets = reply.count('\n-') >= 2 or reply.count('\n•') >= 2 or reply.count('1.') >= 1
    has_marker = MARKER in reply or '三點' in reply or 'bullet' in reply.lower()
    solved = r['ok'] and mem >= 1 and (has_bullets or has_marker)
    return {
        'solved': solved,
        'user_sees': f'mem={mem} bullets={has_bullets}' if r['ok'] else 'HTTP fail',
        'blocker': None if solved else 'RAG 未召回 sop 或回覆未依 skill 格式',
        'metrics': {'mem': mem, 'reply_len': len(reply), 'has_bullets': has_bullets},
    }


# ── E3 進化（更新 skill）────────────────────────────────────────────────────
def e3():
    r = orchestrate(
        f'進化 {MARKER}：改成先列「五點」摘要再細說，並記住這個新版本。'
    )
    d = r['data']
    learned = (d.get('brain') or {}).get('remembered')
    agents = [a.get('id') for a in (d.get('agents') or [])]
    solved = r['ok'] and learned is True and ('butler' in agents or 'coach' in agents)
    return {
        'solved': solved,
        'user_sees': '已進化寫回' if solved else f'learned={learned} agents={agents}',
        'blocker': None if solved else '進化請求未寫入記憶',
        'metrics': {'learned': learned, 'agents': agents},
    }


# ── E4 驗證進化後召回 ───────────────────────────────────────────────────────
def e4():
    time.sleep(8)
    r = orchestrate(
        f'查 {MARKER} 記憶庫最新版：摘要要列「幾點」？只答數字，用繁體。'
    )
    d = r['data']
    reply = d.get('reply') or ''
    mem = (d.get('brain') or {}).get('memories_used', 0)
    preview = ' '.join((d.get('brain') or {}).get('memory_preview') or [])
    combined = reply + preview
    has_five = '五' in combined or '5點' in combined or '5 點' in combined
    has_three_only = ('三' in combined or '3點' in combined) and not has_five
    # 進化成功：召回 mem≥1 且命中五點；若仍舊版三點 → 部分進化（RAG 多版本）
    solved = r['ok'] and mem >= 1 and has_five
    partial = r['ok'] and mem >= 1 and has_three_only
    return {
        'solved': solved,
        'partial': partial,
        'user_sees': f'五點 mem={mem}' if solved else (
            f'仍三點 mem={mem}（多版本 RAG）' if partial else f'reply={safe(reply, 80)} mem={mem}'
        ),
        'blocker': None if solved else (
            '進化已寫入但召回舊版；建議 rag Volume + reindex' if partial else '進化後內容未召回'
        ),
        'metrics': {'mem': mem, 'has_five': has_five, 'has_three_only': has_three_only},
    }


# ── E5 工程師自動生成 sop skill（含 code block）────────────────────────────
def e5():
    r = orchestrate(
        '工程師：寫一個 Python 函式 hello_oneai_skill() 印出 Hello Skill，'
        '回覆必須含完整 ```python code block。'
    )
    d = r['data']
    agents = [a.get('id') for a in (d.get('agents') or [])]
    reply = d.get('reply') or ''
    agent_text = ' '.join(
        (a.get('reply') or '') for a in (d.get('agents') or []) if isinstance(a, dict)
    )
    has_code = '```' in reply or '```' in agent_text or 'def hello' in (reply + agent_text).lower()
    has_engineer = 'engineer' in agents
    can_exec = d.get('can_execute') is True or bool(d.get('execute_code'))
    solved = r['ok'] and has_engineer and has_code
    return {
        'solved': solved,
        'user_sees': f'engineer={has_engineer} code={has_code} can_execute={can_exec}',
        'blocker': None if solved else '未觸發 engineer 或無 code block（skill_saved 不會觸發）',
        'metrics': {'agents': agents, 'has_code': has_code, 'can_execute': can_exec},
    }


# ── E6 RAG 內可查 sop / skill 片段 ──────────────────────────────────────────
def e6():
    time.sleep(4)
    r = req('GET', f'/brain/memories?q={quote(MARKER)}&limit=8')
    d = r['data']
    mems = d.get('memories') or []
    hits = [m for m in mems if MARKER in (m.get('text') or '') or 'skill' in (m.get('text') or '').lower()]
    solved = r['ok'] and len(hits) >= 1
    return {
        'solved': solved,
        'user_sees': f'RAG 命中 {len(hits)} 筆 skill/sop',
        'blocker': None if solved else '記憶庫查不到已裝/進化的 skill',
        'metrics': {'total': len(mems), 'skill_hits': len(hits)},
    }


def main():
    print(f'\n=== OneAI Agent Evolve / Skill Sim → {BASE} ===')
    scenario(1, '裝 skill（記住 SOP）', '說記住 → butler 寫入', e1)
    scenario(2, '召回 skill', '依 skill 格式回覆 + mem≥1', e2)
    scenario(3, '進化 skill', '說進化 → 寫入新版本', e3)
    scenario(4, '進化後召回', '答出五點摘要', e4)
    scenario(5, '工程師 auto-sop', 'engineer + code → skill_saved 路徑', e5)
    scenario(6, 'RAG 可查 sop', f'/brain/memories 命中 {MARKER}', e6)

    passed = sum(1 for s in SCENARIOS if s.get('solved'))
    partial = sum(1 for s in SCENARIOS if s.get('partial'))
    total = len(SCENARIOS)
    out = {
        'base': BASE,
        'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'marker': MARKER,
        'passed': passed,
        'partial': partial,
        'total': total,
        'boundary_note': 'RAG memory evolve OK; filesystem skill install NOT in scope',
        'scenarios': SCENARIOS,
    }
    out_path = Path(__file__).parent / 'agent-evolve-results.json'
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n{"=" * 60}\n結果：{passed}/{total} 通過' +
          (f'（{partial} 部分）' if partial else '') + f' → {out_path}')
    print('\n邊界：雲端「記憶進化」= RAG 寫回；本機 ~/.agents/skills 自動安裝 = Phase C')
    return 0 if passed >= 5 or (passed >= 4 and partial >= 1) else 1


if __name__ == '__main__':
    sys.exit(main())
