#!/usr/bin/env python3
"""RAG 一鍵 redeploy + 驗收 + seed + 記憶整理。

用法:
  python scripts/deploy-rag-and-verify.py              # dry-run curate
  python scripts/deploy-rag-and-verify.py --apply-curate
  python scripts/deploy-rag-and-verify.py --skip-deploy  # 只驗收（已 deploy 後）

需 .env：ZEABUR_TOKEN、APPROVAL_BASE_URL、ONEAI_CHAT_TOKEN
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv() -> None:
    p = ROOT / '.env'
    if not p.exists():
        return
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def diagnose_rag_via_approval(approval: str) -> dict:
    """透過 approval 公開端點判斷 rag 是否為新映像（含 /stats /catalog）。"""
    out = {'new_rag': False, 'summary_ok': False, 'by_kind': None, 'total': None, 'hint': ''}
    try:
        st, d = fetch_json(f'{approval}/brain/summary', timeout=12)
        out['summary_ok'] = st == 200 and d.get('status') == 'ok'
        out['total'] = d.get('total_memories')
        out['by_kind'] = d.get('by_kind')
        if out['by_kind'] is not None:
            out['new_rag'] = True
            return out
    except Exception as ex:
        out['hint'] = str(ex)[:120]
        return out
    out['hint'] = (
        'rag-svc 仍是舊映像（無 /stats）→ /brain/graph、/brain/curate 會 502。'
        ' approval 已更新，但 rag 需手動 redeploy（DEP-04）。'
    )
    return out


def print_deploy_blockers() -> None:
    if os.environ.get('ZEABUR_TOKEN'):
        return
    print('\n[BLOCKER] .env 缺少 ZEABUR_TOKEN')
    print('  1. 開 https://dash.zeabur.com/account/general → API → Create token')
    print('  2. 在 .env 加一行：ZEABUR_TOKEN=你的token')
    print('  3. 再跑：python scripts\\deploy-rag-and-verify.py')
    print('  或 Dashboard → oneai → rag-svc → Redeploy（不需 CLI token）')


def fetch_json(url: str, *, method='GET', body=None, token=None, timeout=20):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read())


def wait_rag_ready(base: str, max_sec: int = 300) -> bool:
    deadline = time.time() + max_sec
    while time.time() < deadline:
        try:
            req = urllib.request.Request(f'{base}/health')
            with urllib.request.urlopen(req, timeout=8) as r:
                d = json.loads(r.read())
            if d.get('ok'):
                # catalog 端點就緒才算新映像
                try:
                    req2 = urllib.request.Request(f'{base.replace(":8080", ":8080")}/catalog?limit=1')
                    # RAG internal - approval proxies catalog; probe stats directly if reachable
                    stats_url = base + '/stats'
                    req2 = urllib.request.Request(stats_url)
                    with urllib.request.urlopen(req2, timeout=8) as r2:
                        if r2.status == 200:
                            print('[OK] RAG /stats ready')
                            return True
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        print('[WAIT] /stats 404 — 舊映像，繼續等…')
                    else:
                        print(f'[WAIT] stats HTTP {e.code}')
                except Exception as ex:
                    print(f'[WAIT] {ex}')
        except Exception as ex:
            print(f'[WAIT] health: {ex}')
        time.sleep(15)
    return False


def main() -> int:
    load_dotenv()
    parser = argparse.ArgumentParser(description='Deploy rag-svc and verify')
    parser.add_argument('--skip-deploy', action='store_true')
    parser.add_argument('--apply-curate', action='store_true')
    parser.add_argument('--wait-sec', type=int, default=300)
    args = parser.parse_args()

    approval = os.environ.get('APPROVAL_BASE_URL', 'https://oneai-approval.zeabur.app').rstrip('/')
    token = os.environ.get('ONEAI_CHAT_TOKEN') or os.environ.get('APPROVAL_TOKEN', '')

    if not os.environ.get('ZEABUR_TOKEN') and not args.skip_deploy:
        print('[ERROR] 缺少 ZEABUR_TOKEN — 無法 redeploy rag-svc')
        print_deploy_blockers()
        diag = diagnose_rag_via_approval(approval)
        if not diag['new_rag']:
            print(f"\n[DIAG] summary total={diag['total']} by_kind={diag['by_kind']}")
            print(f"       {diag['hint']}")
        return 1

    if not args.skip_deploy:
        print('=== 1/5 Zeabur redeploy rag-svc ===')
        r = subprocess.run(
            [sys.executable, str(ROOT / 'scripts' / 'zeabur-cli.py'), 'redeploy', '--service-id', 'rag'],
            cwd=str(ROOT),
        )
        if r.returncode != 0:
            print('[FAIL] redeploy')
            return 1
        print(f'=== 2/5 等待 RAG 就緒（最多 {args.wait_sec}s）===')
        # 內網 rag — 透過 approval /brain/summary 間接驗
        deadline = time.time() + args.wait_sec
        ready = False
        while time.time() < deadline:
            try:
                st, d = fetch_json(f'{approval}/brain/summary', timeout=10)
                if st == 200 and d.get('status') == 'ok' and d.get('by_kind') is not None:
                    print(f'[OK] summary total={d.get("total_memories")} by_kind={d.get("by_kind")}')
                    ready = True
                    break
            except Exception as ex:
                print(f'[WAIT] {ex}')
            time.sleep(20)
        if not ready:
            print('[WARN] 未確認新 /stats — 可能 approval 尚未 deploy 或 rag 仍在 build')
    else:
        print('=== skip deploy ===')
        diag = diagnose_rag_via_approval(approval)
        print(f"[DIAG] summary total={diag['total']} by_kind={diag['by_kind']}")
        if not diag['new_rag']:
            print(f"[DIAG] {diag['hint']}")
            print_deploy_blockers()

    print('=== 3/5 brain-smoke ===')
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'brain-smoke.py')], cwd=str(ROOT))

    print('=== 4/5 graph + seed ===')
    graph_ok = subprocess.run(
        [sys.executable, str(ROOT / 'scripts' / 'test-brain-graph-cloud.py')],
        cwd=str(ROOT),
    ).returncode == 0
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'seed-system-memory.py')], cwd=str(ROOT))

    print('=== 5/5 memory curate ===')
    if token:
        try:
            st, d = fetch_json(
                f'{approval}/brain/curate',
                method='POST',
                body={'apply': args.apply_curate, 'limit': 500},
                token=token,
                timeout=60,
            )
            print(f'curate HTTP {st}: junk_chunks={d.get("junk_chunks")} dry_run={d.get("dry_run")}')
        except Exception as ex:
            print(f'[WARN] curate via approval: {ex}')
    else:
        print('[SKIP] curate — no token')

    print('\n[DONE] deploy-rag-and-verify 完成')
    print('提醒：Zeabur Dashboard 請確認 rag-svc 已掛 Volume 到 Chroma 目錄（DEP-04）')

    diag = diagnose_rag_via_approval(approval)
    if not diag['new_rag'] or not graph_ok:
        print('\n[FAIL] rag-svc 尚未升級到新映像 — graph/curate 不可用')
        if not diag['new_rag']:
            print_deploy_blockers()
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
