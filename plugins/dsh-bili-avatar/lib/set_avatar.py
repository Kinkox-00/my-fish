import json, sys
from pathlib import Path
from PIL import Image
import requests
from playwright.sync_api import sync_playwright

src = Path(sys.argv[1])
if not src.exists():
    raise SystemExit('image not found: ' + str(src))
cred = json.loads((Path.home() / '.bili-ai' / 'credentials.json').read_text(encoding='utf-8'))
tmp = Path.home() / '.dsh' / 'bili-avatar-upload.png'
im = Image.open(src).convert('RGB')
w, h = im.size
side = min(w, h)
im = im.crop(((w - side)//2, (h - side)//2, (w + side)//2, (h + side)//2)).resize((180, 180), Image.LANCZOS)
im.save(tmp)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context()
    context.add_cookies([
        {'name': 'SESSDATA', 'value': cred['sessdata'], 'domain': '.bilibili.com', 'path': '/'},
        {'name': 'bili_jct', 'value': cred['bili_jct'], 'domain': '.bilibili.com', 'path': '/'},
        {'name': 'buvid3', 'value': cred.get('buvid3', ''), 'domain': '.bilibili.com', 'path': '/'},
    ])
    page = context.new_page()
    page.goto('https://account.bilibili.com/account/face/upload', wait_until='networkidle', timeout=60000)
    page.locator('#file_input').set_input_files(str(tmp))
    page.wait_for_timeout(2500)
    btn = page.locator('input.btn-confirm')
    if btn.get_attribute('disabled') is not None:
        raise SystemExit('upload button stayed disabled')
    btn.click()
    page.wait_for_timeout(3500)
    browser.close()
cookies = {'SESSDATA': cred['sessdata'], 'bili_jct': cred['bili_jct'], 'buvid3': cred.get('buvid3', '')}
headers = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'}
j = requests.get('https://api.bilibili.com/x/web-interface/nav', cookies=cookies, headers=headers, timeout=30).json()
print('AVATAR_OK ' + str((j.get('data') or {}).get('face') or ''))