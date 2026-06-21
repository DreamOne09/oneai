import os, subprocess, json, base64
from nacl import encoding, public

GH_TOKEN = os.environ.get('GH_PAT', '')
REPO     = 'DreamOne09/oneai'
GH_API   = 'https://api.github.com'

if not GH_TOKEN:
    print('ERROR: set GH_PAT env var before running')
    exit(1)

SECRETS = {
    'ZEABUR_TOKEN':       'sk-3t3tfpbfvv622lbvq7nem3g2dnqvy',
    'ZEABUR_PROJECT_ID':  '6a36ad9046477d6038840b9d',
    'ZEABUR_ENV_ID':      '6a36ad9079260dbd878433e5',
    'APPROVAL_SERVICE_ID':'6a382be25c2ba18dabde9509',
    'PWA_SERVICE_ID':     '6a382c27742d93fa52abe64f',
    # Vite build-time variables for oneai-pwa
    'VITE_CHAT_TOKEN':    'cd3f189ef84f71e4385da3dd744bc8177b60bac14daa20cd',
    'VITE_APPROVAL_TOKEN':'a94ba02759ff5e7ccd1bbc6a47cf59dc5ea0025bc61c0890049f74fe1afdc136',
    'VITE_VAPID_PUBLIC_KEY':'BNSRzv-j6EL0DN6VPa9X5sgA-Sa6poFMuOgY8rd1zDIoctOceua04ZME919VwK8zwYvx7ATFZG1emE9u0QBTOdY',
}

def curl(*args, data=None):
    cmd = ['curl.exe', '-sk', '-H', f'Authorization: Bearer {GH_TOKEN}',
           '-H', 'Accept: application/vnd.github.v3+json'] + list(args)
    if data:
        cmd += ['-H', 'Content-Type: application/json', '-d', json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    try: return json.loads(r.stdout)
    except: return {'raw': r.stdout[:200]}

pk_data = curl(f'{GH_API}/repos/{REPO}/actions/secrets/public-key')
key_id  = pk_data.get('key_id')
key_b64 = pk_data.get('key')
print(f'key_id: {key_id}')

pub_key = public.PublicKey(key_b64.encode('ascii'), encoding.Base64Encoder())

def encrypt_secret(value):
    box = public.SealedBox(pub_key)
    encrypted = box.encrypt(value.encode('utf-8'))
    return base64.b64encode(encrypted).decode('utf-8')

for name, value in SECRETS.items():
    res = curl('-X', 'PUT', f'{GH_API}/repos/{REPO}/actions/secrets/{name}',
               data={'encrypted_value': encrypt_secret(value), 'key_id': key_id})
    ok = 'OK' if not res.get('message') else res.get('message')
    print(f'  Set {name}: {ok}')

print('\nAll secrets updated!')
