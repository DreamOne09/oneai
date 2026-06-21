import subprocess, json, tempfile, os

import os
TOKEN = os.environ.get('ZEABUR_TOKEN', '')
if not TOKEN:
    raise SystemExit('[ERROR] 請先設定環境變數 ZEABUR_TOKEN')
GQL   = 'https://api.zeabur.com/graphql'
PROJECT_ID = '6a36ad9046477d6038840b9d'
ENV_ID     = '6a36ad9079260dbd878433e5'
NEW_SVC_ID = '6a384ea9d12e4cadec4f4d04'

def gql(query):
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False, encoding='utf-8') as f:
        json.dump({'query': query}, f, ensure_ascii=True)
        tmp = f.name
    r = subprocess.run(['curl.exe', '-sk', '-X', 'POST', GQL,
        '-H', 'Content-Type: application/json',
        '-H', 'Authorization: Bearer ' + TOKEN,
        '--data-binary', '@' + tmp],
        capture_output=True, text=True, timeout=30)
    os.unlink(tmp)
    try: return json.loads(r.stdout)
    except: return {'raw': r.stdout[:300]}

# Get deployment details with available fields
q = '''
{
  service(_id: "''' + NEW_SVC_ID + '''") {
    _id name
    deployments(environmentID: "''' + ENV_ID + '''") {
      _id status createdAt
    }
  }
}
'''
d = gql(q)
print(json.dumps(d, indent=2))
