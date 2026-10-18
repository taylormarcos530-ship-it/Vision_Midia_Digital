"""Local-only Chromium test. Bundle independent lab ES modules inline to avoid blocked localhost."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
BASE = Path(__file__).resolve().parents[1]

def bundle():
    files=['fixtures/products.mjs','menu-template.mjs','menu-data.mjs',
           'fixtures/publish-lab.mjs','publish-contract.mjs','publish-lab.js']
    parts=[]
    for f in files:
        src=(BASE/f).read_text(encoding='utf-8')
        src=re.sub(r"import\s*\{[\s\S]*?\}\s*from\s*['\"][^'\"]+['\"];\s*",'',src)
        src=re.sub(r'\bexport\s+(?=(const|let|function|class)\b)','',src)
        parts.append(src)
    return '\n'.join(parts)

def build(page):
    html=(BASE/'publish-lab.html').read_text()
    html=re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
    html=re.sub(r'<script type="module"[^>]*></script>', '', html)
    css=(BASE/'publish-lab.css').read_text()
    page.set_content(html.replace('</head>',f'<style>{css}</style></head>'))
    page.evaluate("""() => {let db={}; Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem(k){return db[k]??null},setItem(k,v){db[k]=String(v)},removeItem(k){delete db[k]}}});}""")
    page.add_script_tag(content=bundle())
    page.wait_for_selector('#device option',state='attached',timeout=3000)

checks=[]
def check(name,result):
    if not result:raise AssertionError(name)
    checks.append(name)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    pg=b.new_page(viewport={'width':1280,'height':800})
    outside=[]
    pg.on('request',lambda r:outside.append(r.url))
    build(pg)
    check('carregou a interface',pg.title()=='Vision Menu — Simulador de publicação isolada')
    check('botão inicial bloqueado',pg.locator('#publish').is_disabled())
    check('TVs exclusivas da empresa A',pg.locator('#device option').count()==3 and 'tv-bakery-free' not in pg.locator('#device').inner_html())
    pg.locator('#save').click()
    check('salva o rascunho fictício','revisão 1' in pg.locator('#publish-result').inner_text())
    pg.locator('#device').select_option('tv-butcher-playlist');pg.locator('#preflight').click()
    check('não sobrepõe playlist','playlist_protected' in pg.locator('#check-result').inner_text())
    pg.locator('#device').select_option('tv-butcher-ads');pg.locator('#preflight').click()
    check('não sobrepõe anúncios','commercial_protected' in pg.locator('#check-result').inner_text())
    pg.locator('#device').select_option('tv-butcher-free');pg.locator('#preflight').click()
    check('preflight TV livre','Aprovado somente no laboratório' in pg.locator('#check-result').inner_text())
    check('confirmação explícita requerida',pg.locator('#publish').is_disabled())
    pg.locator('#confirm').check()
    pg.locator('#publish').click()
    check('publicação apenas simulada','Publicação fictícia registrada' in pg.locator('#publish-result').inner_text())
    check('snapshot habilitado na memória','"enabled": true' in pg.locator('#device-status').inner_text())
    check('auditoria gravou a simulação','simulate_publish' in pg.locator('#audit-status').inner_text())
    pg.locator('#disable').click()
    check('desativação retorna ao estado anterior','"enabled": false' in pg.locator('#device-status').inner_text())
    check('nenhuma requisição a servidor',outside==[])
    pg.screenshot(path='/mnt/data/vision-menu-publish-lab-desktop.png',full_page=True)
    mob=b.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    build(mob)
    check('mobile sem scroll horizontal',mob.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'))
    mob.screenshot(path='/mnt/data/vision-menu-publish-lab-mobile.png',full_page=True)
    b.close()
print(f'Chromium inline isolado: {len(checks)}/{len(checks)} PASS')
for x in checks:print('PASS',x)
