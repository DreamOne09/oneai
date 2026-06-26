#!/usr/bin/env python3
"""OneAI 版本演進管線 — 2.0→10.0 每版完整週期。

每個版本週期：
  1. 診斷（health / version / staff / env）
  2. GTX-100 自動情境（100 loop 子集，可測即跑）
  3. 使用者端到端模擬（10 + 5 loop）
  4. 子 Agent 議會辯論（version-council-debate.js）
  5. 文件自動更新（cycle report + evolution log）

用法:
  python scripts/version-evolution-pipeline.py --version 2.0
  python scripts/version-evolution-pipeline.py --from 2.0 --to 3.0
  python scripts/version-evolution-pipeline.py --from 2.0 --to 10.0 --plan-only

輸出:
  docs/evolution/{version}-cycle-report.md
  docs/evolution/council-{version}.md
  scripts/evolution/{version}-cycle.json
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVOLUTION_DIR = ROOT / 'docs' / 'evolution'
ARTIFACT_DIR = ROOT / 'scripts' / 'evolution'


def load_dotenv() -> None:
    p = ROOT / '.env'
    if not p.exists():
        return
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()
BASE = os.environ.get('APPROVAL_BASE_URL', '').rstrip('/')
CHAT = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')


def load_roadmap() -> dict:
    return json.loads((ROOT / 'config' / 'oneai.version-roadmap.json').read_text(encoding='utf-8'))


def req(method: str, path: str, body=None, timeout=30):
    url = f'{BASE}{path}'
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Content-Type': 'application/json'}
    if CHAT:
        headers['Authorization'] = f'Bearer {CHAT}'
    t0 = time.time()
    try:
        r = urllib.request.Request(url, data=data, method=method, headers=headers)
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            parsed = json.loads(raw) if raw else {}
            return {'ok': True, 'status': resp.status, 'elapsed': round(time.time() - t0, 2), 'data': parsed}
    except urllib.error.HTTPError as e:
        try:
            parsed = json.loads(e.read())
        except Exception:
            parsed = {'error': str(e)}
        return {'ok': False, 'status': e.code, 'elapsed': round(time.time() - t0, 2), 'data': parsed}
    except Exception as e:
        return {'ok': False, 'status': 0, 'elapsed': round(time.time() - t0, 2), 'data': {'error': str(e)}}


def diagnose(version: str, roadmap: dict) -> dict:
    vcfg = roadmap['versions'].get(version, {})
    ga = vcfg.get('ga_criteria', {})
    out = {
        'version': version,
        'ts': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'base': BASE or '(unset)',
        'checks': {},
        'blockers': list(vcfg.get('next_blockers', [])),
    }

    if not BASE:
        out['checks']['env'] = {'ok': False, 'detail': 'APPROVAL_BASE_URL unset'}
        return out

    h = req('GET', '/health')
    ver = h['data'].get('version', '?')
    expected = ga.get('health_version')
    version_match = True
    if expected:
        version_match = str(ver).startswith(str(expected).split('.')[0]) or ver == expected
    out['checks']['health'] = {
        'ok': h['ok'] and h['data'].get('ok'),
        'version': ver,
        'expected': expected,
        'version_match': version_match,
    }
    if expected and not version_match:
        out['blockers'].append(f'cloud version {ver} != expected {expected}')

    v = req('GET', '/oneai/version')
    out['checks']['oneai_version'] = {'ok': v['ok'], 'codename': v['data'].get('codename')}

    if CHAT:
        staff = req('GET', '/agents/staff')
        count = staff['data'].get('count') if staff['ok'] else None
        if count is None and isinstance(staff['data'], list):
            count = len(staff['data'])
        elif count is None and isinstance(staff['data'].get('staff'), list):
            count = len(staff['data']['staff'])
        out['checks']['staff'] = {'ok': staff['ok'], 'count': count}

        agents = req('GET', '/agents/status')
        online = [a for a in (agents['data'] if isinstance(agents['data'], list) else []) if a.get('online')]
        out['checks']['workers'] = {'ok': agents['ok'], 'online': len(online), 'names': [a.get('name') for a in online[:5]]}
    else:
        out['checks']['staff'] = {'ok': False, 'detail': 'no CHAT token'}
        out['blockers'].append('ONEAI_CHAT_TOKEN missing')

    key_ok = bool(os.environ.get('OPENAI_API_KEY'))
    out['checks']['openrouter'] = {'configured_local_env': key_ok}
    if not key_ok:
        out['blockers'].append('OPENAI_API_KEY (Zeabur) — orchestrate 502')

    return out


def run_subprocess(cmd: list[str], label: str) -> dict:
    print(f'\n=== {label} ===', flush=True)
    env = {**os.environ, 'PYTHONUNBUFFERED': '1'}
    try:
        proc = subprocess.run(
            cmd, cwd=str(ROOT), capture_output=True, text=True,
            timeout=900, encoding='utf-8', errors='replace', env=env,
        )
        print(proc.stdout[-2000:] if len(proc.stdout) > 2000 else proc.stdout)
        if proc.stderr:
            print(proc.stderr[-500:], file=sys.stderr)
        return {'ok': proc.returncode == 0, 'returncode': proc.returncode, 'stdout_tail': proc.stdout[-1500:]}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'error': 'timeout'}
    except Exception as e:
        return {'ok': False, 'error': str(e)}


def load_gtx_results() -> dict:
    p = ROOT / 'scripts' / 'oneai-gtx-100-results.json'
    if not p.exists():
        return {'results': [], 'summary': {}}
    data = json.loads(p.read_text(encoding='utf-8'))
    if isinstance(data, list):
        results = data
    else:
        results = data.get('results', data.get('items', []))
    auto = [r for r in results if r.get('mode') == 'auto' and not r.get('skipped')]
    passed = [r for r in auto if r.get('passed')]
    failed = [r for r in auto if r.get('passed') is False]
    return {
        'results': results,
        'auto_total': len(auto),
        'auto_pass': len(passed),
        'auto_fail': len(failed),
        'failures': [{'id': r.get('id'), 'title': r.get('title'), 'detail': r.get('detail')} for r in failed],
    }


def load_user_sim_results() -> dict:
    merged = []

    p1 = ROOT / 'scripts' / 'user-scenario-results.json'
    if p1.exists():
        data = json.loads(p1.read_text(encoding='utf-8'))
        if isinstance(data, dict) and isinstance(data.get('scenarios'), list):
            for s in data['scenarios']:
                merged.append({
                    'name': s.get('title') or f"scenario-{s.get('id')}",
                    'intent': s.get('user_goal', ''),
                    'ok': bool(s.get('solved')),
                })
        elif isinstance(data, list):
            merged.extend(data)

    p2 = ROOT / 'scripts' / 'human-loop-results.json'
    if p2.exists():
        data = json.loads(p2.read_text(encoding='utf-8'))
        items = data if isinstance(data, list) else data.get('results', [])
        for s in items:
            merged.append({
                'name': s.get('scenario') or s.get('name') or f"loop-{s.get('loop')}",
                'intent': s.get('intent', ''),
                'ok': bool(s.get('ok')),
            })

    passed = sum(1 for r in merged if r.get('ok'))
    failed = [{'name': r.get('name'), 'intent': r.get('intent')} for r in merged if not r.get('ok')]
    return {'total': len(merged), 'pass': passed, 'failures': failed}


def run_council(version: str, diagnostic: dict, gtx: dict, user_sim: dict) -> dict:
    payload = {
        'version': version,
        'gtx_pass': gtx.get('auto_pass', 0),
        'gtx_total': gtx.get('auto_total', 0),
        'gtx_auto_total': gtx.get('auto_total', 22),
        'gtx_failures': gtx.get('failures', []),
        'user_sim_pass': user_sim.get('pass', 0),
        'user_sim_total': user_sim.get('total', 0),
        'user_sim_failures': user_sim.get('failures', []),
        'blockers': diagnostic.get('blockers', []),
        'health_version_ok': diagnostic.get('checks', {}).get('health', {}).get('version_match', True),
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    in_path = ARTIFACT_DIR / f'{version}-council-input.json'
    in_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')

    script = ROOT / 'scripts' / 'version-council-debate.js'
    proc = subprocess.run(
        ['node', str(script), str(in_path), str(EVOLUTION_DIR)],
        cwd=str(ROOT), capture_output=True, text=True, encoding='utf-8', errors='replace',
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return {'ok': False, 'error': proc.stderr}
    try:
        return {'ok': True, **json.loads(proc.stdout.strip().splitlines()[-1])}
    except Exception:
        return {'ok': True, 'raw': proc.stdout}


def write_cycle_report(
    version: str,
    roadmap: dict,
    diagnostic: dict,
    gtx: dict,
    user_sim: dict,
    council: dict,
    steps: dict,
) -> Path:
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    vcfg = roadmap['versions'].get(version, {})
    keys = sorted(roadmap['versions'].keys(), key=lambda x: float(x))
    idx = keys.index(version) if version in keys else -1
    next_ver = keys[idx + 1] if idx >= 0 and idx + 1 < len(keys) else None

    council_path = EVOLUTION_DIR / f'council-{version}.md'
    council_md = council_path.read_text(encoding='utf-8') if council_path.exists() else '(議會紀錄未產生)'

    gate = council.get('gate_passed') if isinstance(council.get('gate_passed'), bool) else None
    if gate is None:
        cjson = EVOLUTION_DIR / f'council-{version}.json'
        if cjson.exists():
            gate = json.loads(cjson.read_text(encoding='utf-8')).get('council', {}).get('gate_passed')

    md = f"""# OneAI {version} 版本週期報告

> **產生時間**：{diagnostic.get('ts', '—')}  
> **管線**：version-evolution-pipeline.py  
> **代號**：{vcfg.get('codename', '—')}

---

## 1. 診斷摘要

| 檢查 | 結果 |
|------|------|
| Health 版本 | {diagnostic.get('checks', {}).get('health', {}).get('version', '?')} |
| 預期版本 | {diagnostic.get('checks', {}).get('health', {}).get('expected', '?')} |
| Staff | {diagnostic.get('checks', {}).get('staff', {})} |
| Workers 在線 | {diagnostic.get('checks', {}).get('workers', {})} |

**阻塞項**：{'; '.join(diagnostic.get('blockers', [])) or '無'}

---

## 2. GTX-100 自動 loop（{gtx.get('auto_pass', 0)}/{gtx.get('auto_total', 0)}）

"""
    for f in gtx.get('failures', [])[:15]:
        md += f"- ❌ #{f.get('id')} {f.get('title')}: {f.get('detail', '')}\n"
    if not gtx.get('failures'):
        md += '- （無自動失敗項）\n'

    md += f"""
---

## 3. 使用者端到端模擬（{user_sim.get('pass', 0)}/{user_sim.get('total', 0)}）

"""
    for f in user_sim.get('failures', []):
        md += f"- ❌ {f.get('name')}: {f.get('intent', '')}\n"
    if not user_sim.get('failures'):
        md += '- （全部通過或尚未執行）\n'

    md += f"""
---

## 4. 子 Agent 議會辯論

**GA 門檻判定**：{'✅ 通過' if gate else '⚠️ 未通過 — 續跑優化 loop'}

<details>
<summary>展開議事錄</summary>

{council_md}

</details>

---

## 5. 本版交付（{version}）

"""
    for item in vcfg.get('wave_deliverables', []):
        md += f"- {item}\n"

    md += f"""
---

## 6. 下一版

"""
    if next_ver:
        ncfg = roadmap['versions'][next_ver]
        md += f"**→ {next_ver}（{ncfg.get('codename')}）**：{ncfg.get('north_star', '')}\n\n"
        for item in ncfg.get('wave_deliverables', [])[:5]:
            md += f"- [ ] {item}\n"
    else:
        md += '已達路線圖終點。\n'

    md += """
---

## 7. 管線步驟紀錄

"""
    for k, v in steps.items():
        md += f"- **{k}**: {'OK' if v.get('ok') else 'FAIL'}\n"

    out = EVOLUTION_DIR / f'{version}-cycle-report.md'
    out.write_text(md, encoding='utf-8')
    return out


def update_evolution_log(reports: list[str]) -> None:
    log_path = EVOLUTION_DIR / '00-evolution-log.md'
    EVOLUTION_DIR.mkdir(parents=True, exist_ok=True)
    existing = set(reports)
    for p in EVOLUTION_DIR.glob('*-cycle-report.md'):
        ver = p.name.replace('-cycle-report.md', '')
        existing.add(ver)
    ordered = sorted(existing, key=lambda x: float(x))
    lines = [
        '# OneAI 版本演進日誌',
        '',
        f'> 最後更新：{datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}',
        '',
        '| 版本 | 報告 | 議會 | GA |',
        '|------|------|------|-----|',
    ]
    for ver in ordered:
        cjson = EVOLUTION_DIR / f'council-{ver}.json'
        ga = '—'
        if cjson.exists():
            gate = json.loads(cjson.read_text(encoding='utf-8')).get('council', {}).get('gate_passed')
            ga = '✅' if gate else '⚠️'
        lines.append(
            f'| {ver} | [{ver}-cycle-report]({ver}-cycle-report.md) | [council-{ver}](council-{ver}.md) | {ga} |'
        )
    log_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')


def run_version_cycle(version: str, roadmap: dict, *, skip_gtx: bool = False, skip_sim: bool = False) -> dict:
    print(f'\n{"=" * 60}\n  OneAI {version} 版本週期\n{"=" * 60}')
    steps = {}

    diagnostic = diagnose(version, roadmap)
    steps['diagnose'] = {'ok': bool(BASE)}
    print(json.dumps(diagnostic, ensure_ascii=False, indent=2))

    if not skip_gtx:
        steps['gtx100'] = run_subprocess([sys.executable, 'scripts/oneai-gtx-100.py'], 'GTX-100')
    else:
        steps['gtx100'] = {'ok': True, 'skipped': True}

    if not skip_sim:
        steps['user_scenario'] = run_subprocess([sys.executable, 'scripts/user-scenario-sim.py'], 'User Scenario Sim (10)')
        steps['human_loop'] = run_subprocess([sys.executable, 'scripts/human-loop-sim.py'], 'Human Loop Sim (5)')
    else:
        steps['user_scenario'] = {'ok': True, 'skipped': True}
        steps['human_loop'] = {'ok': True, 'skipped': True}

    gtx = load_gtx_results()
    user_sim = load_user_sim_results()

    council = run_council(version, diagnostic, gtx, user_sim)
    steps['council'] = council

    report_path = write_cycle_report(version, roadmap, diagnostic, gtx, user_sim, council, steps)

    artifact = {
        'version': version,
        'diagnostic': diagnostic,
        'gtx': gtx,
        'user_sim': user_sim,
        'council': council,
        'steps': steps,
        'report': str(report_path.relative_to(ROOT)),
    }
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    art_path = ARTIFACT_DIR / f'{version}-cycle.json'
    art_path.write_text(json.dumps(artifact, ensure_ascii=False, indent=2), encoding='utf-8')

    print(f'\n[OK] Cycle report: {report_path}')
    return artifact


def version_keys(from_v: str, to_v: str, roadmap: dict) -> list[str]:
    keys = sorted(roadmap['versions'].keys(), key=lambda x: float(x))
    fi = keys.index(from_v)
    ti = keys.index(to_v)
    if fi > ti:
        fi, ti = ti, fi
    return keys[fi : ti + 1]


def main():
    ap = argparse.ArgumentParser(description='OneAI version evolution pipeline')
    ap.add_argument('--version', default='2.0', help='Single version cycle')
    ap.add_argument('--from', dest='from_v', default=None, help='Range start e.g. 2.0')
    ap.add_argument('--to', dest='to_v', default=None, help='Range end e.g. 10.0')
    ap.add_argument('--plan-only', action='store_true', help='Council + docs only, skip GTX/sim')
    ap.add_argument('--skip-gtx', action='store_true')
    ap.add_argument('--skip-sim', action='store_true')
    args = ap.parse_args()

    roadmap = load_roadmap()
    if args.from_v and args.to_v:
        versions = version_keys(args.from_v, args.to_v, roadmap)
    else:
        versions = [args.version]

    skip_gtx = args.skip_gtx or args.plan_only
    skip_sim = args.skip_sim or args.plan_only

    all_artifacts = []
    for ver in versions:
        art = run_version_cycle(ver, roadmap, skip_gtx=skip_gtx, skip_sim=skip_sim)
        all_artifacts.append(ver)

    update_evolution_log(all_artifacts)

    # 更新 docs/README 索引提示
    print(f'\n完成 {len(versions)} 個版本週期: {", ".join(versions)}')
    print(f'Evolution log: docs/evolution/00-evolution-log.md')


if __name__ == '__main__':
    main()
