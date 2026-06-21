import subprocess, json, tempfile, os

TOKEN = 'sk-3t3tfpbfvv622lbvq7nem3g2dnqvy'
GQL = 'https://api.zeabur.com/graphql'
APPROVAL_SVC_ID = '6a36afff9f5fe35a4aa6041b'
ENV_ID = '6a36ad9079260dbd878433e5'
PROJECT_ID = '6a36ad9046477d6038840b9d'
UPLOAD_ID = '6a38237a3060edc30ac0e69a'

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
         '-H', 'Authorization: Bearer ' + TOKEN,
         '--data-binary', '@' + tmp],
        capture_output=True, text=True, timeout=30)
    os.unlink(tmp)
    return json.loads(r.stdout)

# Get all mutation names that contain 'deploy' or 'upload'
# Use search approach since introspection is blocked
deploy_muts = [
    'deployService', 'redeployServiceFromUpload', 'deployFromUpload',
    'uploadDeployment', 'createServiceDeployment',
    'deployZipToService', 'activateServiceUpload',
    'updateServiceSourceCode', 'updateServiceFromUpload',
]
print('Testing deploy-related mutations...')
for mname in deploy_muts:
    q = 'mutation { ' + mname + ' }'
    r = gql(q)
    if 'errors' in r:
        msg = r['errors'][0]['message']
        if 'Cannot query field' not in msg and 'does not exist' not in msg:
            # The mutation EXISTS but with wrong/missing args
            print(f'EXISTS: {mname} -> {msg[:100]}')
        else:
            print(f'no: {mname}')
    else:
        print(f'SUCCESS: {mname} -> {json.dumps(r)[:80]}')
