#!/usr/bin/env python3
"""Zeabur GraphQL CLI — 單一入口，讀 ZEABUR_TOKEN env。

用法:
  python scripts/zeabur-cli.py audit [--service-id ID]
  python scripts/zeabur-cli.py redeploy --service-id ID [--env-id ID]
  python scripts/zeabur-cli.py services [--project-id ID]

環境變數:
  ZEABUR_TOKEN   必填
  ZEABUR_ENV_ID  預設 oneai production env
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

GQL = 'https://api.zeabur.com/graphql'
DEFAULT_ENV = '6a36ad9079260dbd878433e5'
DEFAULT_PROJECT = '6a36ad9046477d6038840b9d'
SERVICES = {
    'approval': '6a384ea9d12e4cadec4f4d04',
    'pwa': '6a382c27742d93fa52abe64f',
    'rag': '6a36aec746477d6038840bda',
    'backup': '6a36e0ac46477d603884113c',
}


def load_dotenv():
    p = Path(__file__).parents[1] / '.env'
    if not p.exists():
        return
    for line in p.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())


def token() -> str:
    load_dotenv()
    t = os.environ.get('ZEABUR_TOKEN', '').strip()
    if not t:
        sys.exit('[ERROR] 請設定 ZEABUR_TOKEN（.env 或環境變數）')
    return t


def gql(query: str, variables: dict | None = None) -> dict:
    payload: dict = {'query': query}
    if variables:
        payload['variables'] = variables
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=True)
        tmp = f.name
    try:
        r = subprocess.run(
            ['curl.exe', '-sk', '-X', 'POST', GQL,
             '-H', 'Content-Type: application/json',
             '-H', f'Authorization: Bearer {token()}',
             '--data-binary', f'@{tmp}'],
            capture_output=True, text=True, timeout=60,
        )
    finally:
        os.unlink(tmp)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {'raw': (r.stdout or r.stderr)[:500]}


def cmd_audit(args):
    sid = args.service_id or SERVICES['approval']
    env = args.env_id or DEFAULT_ENV
    q = f'''{{
      service(_id: "{sid}") {{
        _id name
        deployments(environmentID: "{env}") {{
          _id status createdAt
        }}
      }}
    }}'''
    data = gql(q)
    svc = (data.get('data') or {}).get('service') or {}
    print(f"Service: {svc.get('name')} ({svc.get('_id')})")
    for dep in (svc.get('deployments') or [])[:5]:
        print(f"  [{dep['status']:12}] {dep['createdAt'][:19]}  {dep['_id']}")
    if data.get('errors'):
        print(json.dumps(data['errors'], indent=2, ensure_ascii=False))
        sys.exit(1)


def cmd_redeploy(args):
    sid = args.service_id
    if sid in SERVICES:
        sid = SERVICES[sid]
    env = args.env_id or DEFAULT_ENV
    print(f'=== Redeploy {sid} ===')
    mutation = '''
    mutation RedeployService($serviceID: ObjectID!, $environmentID: ObjectID!) {
      redeployService(serviceID: $serviceID, environmentID: $environmentID)
    }
    '''
    result = gql(mutation, {'serviceID': sid, 'environmentID': env})
    print(json.dumps(result, indent=2, ensure_ascii=False))
    if result.get('errors'):
        sys.exit(1)


def cmd_services(args):
    pid = args.project_id or DEFAULT_PROJECT
    q = f'''{{
      project(_id: "{pid}") {{
        name
        services {{ _id name status suspendedAt }}
      }}
    }}'''
    data = gql(q)
    proj = (data.get('data') or {}).get('project') or {}
    print(f"Project: {proj.get('name')}")
    for s in proj.get('services') or []:
        flag = ' SUSPENDED' if s.get('suspendedAt') else ''
        print(f"  {s.get('_id')}  {s.get('name')}  [{s.get('status')}]{flag}")


def main():
    p = argparse.ArgumentParser(description='Zeabur CLI')
    sub = p.add_subparsers(dest='cmd', required=True)

    a = sub.add_parser('audit', help='查看服務部署狀態')
    a.add_argument('--service-id', default=SERVICES['approval'])
    a.add_argument('--env-id', default=DEFAULT_ENV)
    a.set_defaults(func=cmd_audit)

    r = sub.add_parser('redeploy', help='觸發 redeploy')
    r.add_argument('--service-id', required=True, help='service id 或別名 approval|pwa|rag|backup')
    r.add_argument('--env-id', default=DEFAULT_ENV)
    r.set_defaults(func=cmd_redeploy)

    s = sub.add_parser('services', help='列出 project 內所有服務')
    s.add_argument('--project-id', default=DEFAULT_PROJECT)
    s.set_defaults(func=cmd_services)

    args = p.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
