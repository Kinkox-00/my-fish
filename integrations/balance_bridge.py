# -*- coding: utf-8 -*-
"""Local DeepSeek Platform balance bridge for dsh-pet-indesktop.

Reads the DSH account-platform token from ~/.dsh/.credentials.yaml and exposes
GET /user/balance in the shape the pet's balance client expects. Local only.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import pathlib
import urllib.request

HOME = pathlib.Path.home()
CRED = HOME / '.dsh' / '.credentials.yaml'
HOST = '127.0.0.1'
PORT = 8765

def _token():
    import yaml
    data = yaml.safe_load(CRED.read_text(encoding='utf-8'))
    return data['records']['deepseek-account-platform/default']['payload']['token']

def _money(value):
    try:
        return float(str(value or '0'))
    except Exception:
        return 0.0

def _fmt(value):
    return f'{value:.6f}'

def fetch_balance():
    token = _token()
    req = urllib.request.Request(
        'https://platform.deepseek.com/api/v0/users/get_user_summary',
        headers={
            'x-dsh-auth-token': token,
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode('utf-8'))
    data = (payload.get('data') or {}).get('biz_data') or {}
    normal = sum(_money(w.get('balance')) for w in (data.get('normal_wallets') or []))
    bonus = sum(_money(w.get('balance')) for w in (data.get('bonus_wallets') or []))
    total = normal + bonus
    return {
        'is_available': True,
        'balance_infos': [{
            'currency': 'CNY',
            'total_balance': _fmt(total),
            'granted_balance': _fmt(bonus),
            'topped_up_balance': _fmt(normal),
        }],
    }

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/health'):
            self._send(200, {'ok': True})
            return
        if self.path.startswith('/user/balance'):
            try:
                self._send(200, fetch_balance())
            except Exception as exc:
                self._send(503, {'error': str(exc)})
            return
        self._send(404, {'error': 'not found'})

    def do_POST(self):
        # The pet chat module is intentionally inactive; keep a clear local error
        # instead of silently hanging if it is ever enabled.
        self._send(503, {'error': 'local balance bridge only'})

    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()