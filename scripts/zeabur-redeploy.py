#!/usr/bin/env python3
"""
Zeabur GraphQL: 設定環境變數 + 觸發 redeploy
"""
import subprocess, json, tempfile, os, sys
from pathlib import Path

TOKEN      = 'sk-3t3tfpbfvv622lbvq7nem3g2dnqvy'
PROJECT_ID = '6a36ad9046477d6038840b9d'
GQL        = 'https://api.zeabur.com/graphql'

# Load local .env for the correct token values
env_vals = {}
env_path = Path(__file__).parents[1] / '.env'
if env_path.exists():
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            env_vals[k.strip()] = v.strip()

def gql(query, variables=None):
    payload = {'query': query}
    if variables:
        payload['variables'] = variables
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump(payload, f)
        tmp = f.name
    r = subprocess.run(
        ['curl.exe', '-sk', '-X', 'POST', GQL,
         '-H', 'Content-Type: application/json',
         '-H', f'Authorization: Bearer {TOKEN}',
         '--data-binary', f'@{tmp}'],
        capture_output=True, text=True, timeout=30)
    os.unlink(tmp)
    if r.returncode != 0:
        raise RuntimeError(f'curl error: {r.stderr[:100]}')
    d = json.loads(r.stdout)
    if 'errors' in d:
        raise RuntimeError(f'GraphQL errors: {d["errors"]}')
    return d['data']

def ok(msg):  print(f'[OK]   {msg}')
def info(msg): print(f'[INFO] {msg}')
def err(msg):  print(f'[ERR]  {msg}')

# ── 1. 取得所有服務 ──────────────────────────────────────────────────────────
print('\n== Step 1: Get services ==')
data = gql('''
query GetProject($id: ID!) {
  project(id: $id) {
    services {
      edges {
        node {
          id
          name
        }
      }
    }
    environments {
      edges {
        node {
          id
          name
        }
      }
    }
  }
}
''', {'id': PROJECT_ID})

services = {n['node']['name']: n['node']['id'] for n in data['project']['services']['edges']}
envs     = {n['node']['name']: n['node']['id'] for n in data['project']['environments']['edges']}

info(f'Services: {services}')
info(f'Environments: {envs}')

APPROVAL_SVC_ID = services.get('approval-svc', '6a36afff9f5fe35a4aa6041b')
PWA_SVC_ID      = services.get('oneai-pwa', '')
ENV_ID          = list(envs.values())[0] if envs else '6a36ad9079260dbd878433e5'

ok(f'approval-svc ID: {APPROVAL_SVC_ID}')
ok(f'oneai-pwa ID: {PWA_SVC_ID}')
ok(f'Environment ID: {ENV_ID}')

# ── 2. 設定環境變數 ──────────────────────────────────────────────────────────
print('\n== Step 2: Sync env vars ==')

vars_to_set = {
    'ONEAI_CHAT_TOKEN':   env_vals.get('ONEAI_CHAT_TOKEN', ''),
    'ONEAI_WORKER_TOKEN': env_vals.get('ONEAI_WORKER_TOKEN', ''),
    'OPENAI_API_KEY':     env_vals.get('OPENAI_API_KEY', ''),
    'APPROVAL_TOKEN':     env_vals.get('APPROVAL_TOKEN', ''),
}

for var_name, var_value in vars_to_set.items():
    if not var_value:
        info(f'Skipping {var_name} (empty)')
        continue
    try:
        result = gql('''
mutation AddEnvVar($projectID: ID!, $serviceID: ID!, $envID: ID!, $key: String!, $value: String!) {
  addServiceVariable(
    projectID: $projectID
    serviceID: $serviceID
    envID: $envID
    key: $key
    value: $value
  )
}
''', {
            'projectID': PROJECT_ID,
            'serviceID': APPROVAL_SVC_ID,
            'envID':     ENV_ID,
            'key':       var_name,
            'value':     var_value,
        })
        ok(f'Set {var_name}')
    except Exception as e:
        err(f'Failed to set {var_name}: {str(e)[:100]}')

# ── 3. 觸發 redeploy ─────────────────────────────────────────────────────────
print('\n== Step 3: Trigger redeploy ==')
for svc_name, svc_id in [('approval-svc', APPROVAL_SVC_ID), ('oneai-pwa', PWA_SVC_ID)]:
    if not svc_id:
        info(f'Skipping {svc_name} (no ID)')
        continue
    try:
        result = gql('''
mutation Redeploy($envID: ID!, $serviceID: ID!) {
  redeployService(envID: $envID, serviceID: $serviceID)
}
''', {'envID': ENV_ID, 'serviceID': svc_id})
        ok(f'Redeploy triggered for {svc_name}')
    except Exception as e:
        # Try alternative mutation name
        try:
            result = gql('''
mutation RestartService($envID: ID!, $serviceID: ID!) {
  restartService(envID: $envID, serviceID: $serviceID)
}
''', {'envID': ENV_ID, 'serviceID': svc_id})
            ok(f'Restart triggered for {svc_name}')
        except Exception as e2:
            err(f'Redeploy failed for {svc_name}: {str(e)[:80]} | {str(e2)[:80]}')

print('\n== Done! Waiting 30s for service to restart... ==')
