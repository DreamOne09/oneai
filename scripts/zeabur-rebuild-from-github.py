"""
Phase 2: domain 遷移 — 把舊域名切到新的 GitHub-linked 服務
並刪除舊服務。
執行前請確認 approval-svc-v2 和 oneai-pwa-v2 已成功 build 且能正常回應。
"""
import subprocess, json, tempfile, os, time
import urllib.request

TOKEN      = 'sk-3t3tfpbfvv622lbvq7nem3g2dnqvy'
GQL        = 'https://api.zeabur.com/graphql'
PROJECT_ID = '6a36ad9046477d6038840b9d'
ENV_ID     = '6a36ad9079260dbd878433e5'

# 服務對應
OLD_APPROVAL = '6a36afff9f5fe35a4aa6041b'  # approval-svc (old zip)
OLD_PWA      = '6a36c3e86d107f2b42713b84'  # oneai-pwa (old zip)

def gql(query):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump({'query': query}, f)
        tmp = f.name
    r = subprocess.run(
        ['curl.exe', '-sk', '-X', 'POST', GQL,
         '-H', 'Content-Type: application/json',
         '-H', 'Authorization: Bearer ' + TOKEN,
         '--data-binary', '@' + tmp],
        capture_output=True, text=True, timeout=30)
    os.unlink(tmp)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {}

def ps(cmd, timeout=30):
    r = subprocess.run(
        ['powershell', '-NoProfile', '-Command', cmd],
        capture_output=True, text=True, timeout=timeout)
    return (r.stdout + r.stderr).strip(), r.returncode

# ── 取得服務列表 ──────────────────────────────────────────────────────────────
def list_services():
    r = gql('query { project(_id: "' + PROJECT_ID + '") { services { _id name } } }')
    return (r.get('data') or {}).get('project', {}).get('services', [])

# ── 取得服務的 domains ────────────────────────────────────────────────────────
def get_domains(svc_id):
    r = gql('query { service(_id: "' + svc_id + '") { domains { domain _id } } }')
    return (r.get('data') or {}).get('service', {}).get('domains', [])

# ── 快速 health check ─────────────────────────────────────────────────────────
def health_check(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla'})
        with urllib.request.urlopen(req, timeout=8) as r:
            return r.getcode()
    except Exception as e:
        return str(e)[:40]

# ── 主流程 ────────────────────────────────────────────────────────────────────
print('=' * 64)
print('Zeabur Domain Migration: old zip services → new GitHub services')
print('=' * 64)

svcs = list_services()
svc_map = {s['name']: s['_id'] for s in svcs}

new_approval_id = svc_map.get('approval-svc-v2', '')
new_pwa_id      = svc_map.get('oneai-pwa-v2', '')

print(f'\nService IDs:')
print(f'  old approval-svc: {OLD_APPROVAL}')
print(f'  new approval-svc-v2: {new_approval_id or "NOT FOUND"}')
print(f'  old oneai-pwa: {OLD_PWA}')
print(f'  new oneai-pwa-v2: {new_pwa_id or "NOT FOUND"}')

if not new_approval_id or not new_pwa_id:
    print('\n[ERROR] New services not found. Run Step 1 script first.')
    exit(1)

# ── 取得新服務目前的 domain（auto-assigned）──────────────────────────────────
new_approval_domains = get_domains(new_approval_id)
new_pwa_domains      = get_domains(new_pwa_id)

new_approval_url = ('https://' + new_approval_domains[0]['domain']) if new_approval_domains else None
new_pwa_url      = ('https://' + new_pwa_domains[0]['domain']) if new_pwa_domains else None

print(f'\nNew service domains:')
print(f'  approval-svc-v2: {new_approval_url or "(no domain yet)"}')
print(f'  oneai-pwa-v2:    {new_pwa_url or "(no domain yet)"}')

# ── Health check ──────────────────────────────────────────────────────────────
print('\nHealth checking new services...')
if new_approval_url:
    code = health_check(new_approval_url + '/health')
    print(f'  approval-svc-v2 /health: {code}')
    if str(code) != '200':
        print('  [WARN] Not ready yet. Wait for build to complete before domain migration.')
        print('  Continuing to show next steps...')
else:
    print('  [INFO] approval-svc-v2 has no domain yet - will assign after check')
    
if new_pwa_url:
    code = health_check(new_pwa_url)
    print(f'  oneai-pwa-v2: {code}')

# ── Domain 遷移（用 zeabur domain delete / create）──────────────────────────
print('\n' + '=' * 64)
print('Domain Migration Commands (run after build is confirmed):')
print('=' * 64)

# Old domains
old_approval_doms = get_domains(OLD_APPROVAL)
old_pwa_doms      = get_domains(OLD_PWA)
old_approval_dom  = old_approval_doms[0]['domain'] if old_approval_doms else 'oneai-approval.zeabur.app'
old_pwa_dom       = old_pwa_doms[0]['domain'] if old_pwa_doms else 'oneai-mengyi.zeabur.app'

print(f'\nOld domains:  {old_approval_dom}  |  {old_pwa_dom}')

# Ask if ready to migrate
print('\nAttempting domain migration...')

# Delete domains from old services
print('\n[1] Removing domains from old services...')
out, rc = ps(f'zeabur domain delete --service-name approval-svc --domain {old_approval_dom} -y -i=false')
print(f'  approval-svc domain delete: {out[:100]} (rc={rc})')

out, rc = ps(f'zeabur domain delete --service-name oneai-pwa --domain {old_pwa_dom} -y -i=false')
print(f'  oneai-pwa domain delete: {out[:100]} (rc={rc})')

time.sleep(2)

# Add domains to new services
print('\n[2] Adding domains to new services...')
out, rc = ps(f'zeabur domain create --name approval-svc-v2 --domain {old_approval_dom} -y -i=false')
print(f'  approval-svc-v2 domain create: {out[:100]} (rc={rc})')

out, rc = ps(f'zeabur domain create --name oneai-pwa-v2 --domain {old_pwa_dom} -y -i=false')
print(f'  oneai-pwa-v2 domain create: {out[:100]} (rc={rc})')

time.sleep(3)

# ── 最終 health check ────────────────────────────────────────────────────────
print('\n[3] Final health check on migrated domains...')
code_a = health_check(f'https://{old_approval_dom}/health')
code_p = health_check(f'https://{old_pwa_dom}')
print(f'  {old_approval_dom}/health: {code_a}')
print(f'  {old_pwa_dom}: {code_p}')

# ── 刪除舊服務 ────────────────────────────────────────────────────────────────
print('\n' + '=' * 64)
approval_ready = str(code_a) == '200'
pwa_ready      = str(code_p) in ('200', '304')

if approval_ready and pwa_ready:
    print('Both services healthy! Deleting old zip-based services...')
    r_del_a = gql('mutation { deleteService(_id: "' + OLD_APPROVAL + '") }')
    r_del_p = gql('mutation { deleteService(_id: "' + OLD_PWA + '") }')
    print(f'  Delete approval-svc: {r_del_a}')
    print(f'  Delete oneai-pwa:    {r_del_p}')
    print('\n[SUCCESS] Migration complete!')
    print('  From now on: git push master → Zeabur auto-redeploys')
else:
    print(f'Services not fully healthy yet (approval={code_a}, pwa={code_p})')
    print('  - Wait for Zeabur build to finish (check Dashboard)')  
    print('  - Then re-run this script to complete migration')

print('=' * 64)
