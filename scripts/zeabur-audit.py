import subprocess, json, tempfile, os

TOKEN  = 'sk-3t3tfpbfvv622lbvq7nem3g2dnqvy'
GQL    = 'https://api.zeabur.com/graphql'
ENV_ID = '6a36ad9079260dbd878433e5'
APPROVAL_V2 = '6a382be25c2ba18dabde9509'
PWA_V2      = '6a382c27742d93fa52abe64f'

def gql_raw(query):
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

# Check all domains for approval-svc-v2
print('approval-svc-v2 all domains:')
q = 'query { service(_id: "' + APPROVAL_V2 + '") { domains { domain _id } } }'
r = gql_raw(q)
doms = (r.get('data') or {}).get('service', {}).get('domains', [])
for d in doms:
    print(f"  {d['domain']} ({d['_id']})")

# Remove the extra -v2 domain, keep oneai-approval.zeabur.app
for d in doms:
    if d['domain'] == 'oneai-approval-v2.zeabur.app':
        print(f"\nRemoving extra domain: {d['domain']}")
        del_q = 'mutation { removeDomain(domainID: "' + d['_id'] + '") }'
        r2 = gql_raw(del_q)
        print(f"  result: {json.dumps(r2)[:200]}")

# Check all domains for oneai-pwa-v2
print('\noneai-pwa-v2 all domains:')
q2 = 'query { service(_id: "' + PWA_V2 + '") { domains { domain _id } } }'
r2 = gql_raw(q2)
doms2 = (r2.get('data') or {}).get('service', {}).get('domains', [])
for d in doms2:
    print(f"  {d['domain']} ({d['_id']})")

print('\n' + '=' * 60)
print('Summary:')
print(f'  approval-svc-v2 target: oneai-approval.zeabur.app')
print(f'  oneai-pwa-v2 target: oneai-mengyi.zeabur.app')
print()
print('NEXT STEP: Push code to GitHub to trigger auto-build.')
print('  Option A: Cursor Source Control sidebar → Push')
print('  Option B: Open Windows PowerShell and run:')
print('     cd "C:\\Users\\b1993\\.cursor\\projects\\empty-window"')
print('     git push')
print()
print('After push, Zeabur will auto-deploy with ZBPACK_APP_DIR settings.')
