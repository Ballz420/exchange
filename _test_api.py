import urllib.request, json

d = json.dumps({'username':'superadmin','password':'admin123'}).encode()
r = urllib.request.Request('http://localhost:8000/api/auth/login', data=d, headers={'Content-Type':'application/json'}, method='POST')
t = json.loads(urllib.request.urlopen(r).read().decode())['token']
B = 'http://localhost:8000'

tests = [
    ('GET',  f'{B}/api/health', None),
    ('GET',  f'{B}/api/admin/dashboard/stats?token={t}', None),
    ('GET',  f'{B}/api/admin/users?token={t}', None),
    ('GET',  f'{B}/api/admin/users/search?token={t}&q=super', None),
    ('GET',  f'{B}/api/admin/orders?token={t}', None),
    ('GET',  f'{B}/api/admin/holdings?token={t}', None),
    ('GET',  f'{B}/api/admin/transactions?token={t}', None),
    ('GET',  f'{B}/api/reconcile?token={t}', None),
    ('GET',  f'{B}/api/db/tables?token={t}', None),
    ('POST', f'{B}/api/admin/cash/credit', json.dumps({'token':t,'user_id':4,'amount':100}).encode()),
    ('PUT',  f'{B}/api/admin/users/4/role?token={t}&role=admin', None),
    ('PUT',  f'{B}/api/admin/users/4/status?token={t}&status=active', None),
]

all_ok = True
for method, url, body in tests:
    try:
        req = urllib.request.Request(url, data=body, method=method, headers={'Content-Type':'application/json'})
        resp = urllib.request.urlopen(req, timeout=5)
        data = json.loads(resp.read().decode())
        name = url.split('?')[0].split('/api')[-1]
        if isinstance(data, list):
            print(f'  OK  GET  /api{name:40s}  [{len(data)} items]')
        else:
            msg = str(data)[:60]
            print(f'  OK  {method:4}  /api{name:40s}  {msg}')
    except Exception as e:
        print(f'  FAIL {method:4}  /api{name:40s}  {str(e)[:80]}')
        all_ok = False

print(f'\nAll tests passed: {all_ok}')
