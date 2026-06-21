import subprocess, json, base64
from nacl import encoding, public

import os
GH_TOKEN = os.environ.get('GH_PAT', '')  # export GH_PAT=gho_xxx before running
REPO     = 'DreamOne09/oneai'
GH_API   = 'https://api.github.com'

SECRETS = {
    'ZEABUR_TOKEN':       'sk-3t3tfpbfvv622lbvq7nem3g2dnqvy',
    'ZEABUR_PROJECT_ID':  '6a36ad9046477d6038840b9d',
    'ZEABUR_ENV_ID':      '6a36ad9079260dbd878433e5',
    'APPROVAL_SERVICE_ID':'6a382be25c2ba18dabde9509',
    'PWA_SERVICE_ID':     '6a382c27742d93fa52abe64f',
}

def curl(*args, data=None):
    cmd = ['curl.exe', '-sk', '-H', f'Authorization: Bearer {GH_TOKEN}',
           '-H', 'Accept: application/vnd.github.v3+json'] + list(args)
    if data:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    try: return json.loads(r.stdout)
    except: return {'raw': r.stdout[:200]}

# 1. Get repo public key
print('Getting repo public key...')
pk_data = curl(f'{GH_API}/repos/{REPO}/actions/secrets/public-key')
key_id  = pk_data.get('key_id')
key_b64 = pk_data.get('key')
print(f'  key_id: {key_id}, key: {key_b64[:20] if key_b64 else None}...')

if not key_id or not key_b64:
    print('FAILED to get public key. Response:', pk_data)
    exit(1)

# 2. Set each secret
pub_key = public.PublicKey(key_b64.encode('ascii'), encoding.Base64Encoder())

def encrypt_secret(value: str) -> str:
    box = public.SealedBox(pub_key)
    encrypted = box.encrypt(value.encode('utf-8'))
    return base64.b64encode(encrypted).decode('utf-8')

for name, value in SECRETS.items():
    encrypted = encrypt_secret(value)
    res = curl('-X', 'PUT', f'{GH_API}/repos/{REPO}/actions/secrets/{name}',
               data={'encrypted_value': encrypted, 'key_id': key_id})
    status = res.get('status') or ('OK' if not res.get('message') else res.get('message'))
    print(f'  Set {name}: {status or "201 Created"}')

print('\nAll secrets set!')
