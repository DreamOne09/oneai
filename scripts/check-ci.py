import subprocess, json

import os
GH_TOKEN = os.environ.get('GH_TOKEN', '')  # 請用環境變數注入，不要硬編碼
REPO     = 'DreamOne09/oneai'
GH_API   = 'https://api.github.com'

def curl(url, accept='application/vnd.github.v3+json'):
    r = subprocess.run(['curl.exe', '-sk',
        '-H', f'Authorization: Bearer {GH_TOKEN}',
        '-H', f'Accept: {accept}',
        url], capture_output=True, text=True, timeout=15)
    try: return json.loads(r.stdout)
    except: return {'raw': r.stdout[:200]}

# Get all runs
runs = curl(f'{GH_API}/repos/{REPO}/actions/runs?per_page=3').get('workflow_runs', [])
print('Latest CI/CD runs:')
for run in runs:
    conc = run.get('conclusion') or run.get('status', '?')
    print(f"  [{conc:12}] {run.get('name')} | {run.get('head_sha','')[:8]} | {run.get('updated_at','')}")

# Show jobs for latest run
if runs:
    run_id = runs[0]['id']
    jobs = curl(f'{GH_API}/repos/{REPO}/actions/runs/{run_id}/jobs').get('jobs', [])
    print(f'\nJobs for run {run_id}:')
    for job in jobs:
        conc = job.get('conclusion') or job.get('status', '?')
        print(f'  [{conc:12}] {job.get("name")}')
