"""Standalone Chromium checks; requires pip package playwright and system Chromium."""
import os,sys,time,subprocess,contextlib
from pathlib import Path
from playwright.sync_api import sync_playwright
BASE=Path(__file__).resolve().parents[2]
LOCAL_URL=(BASE/'vision-menu-lab'/'index.html').as_uri()
checks=[]
def check(label,action):
    try:action();checks.append((label,'PASS'))
    except Exception as e:checks.append((label,'FAIL '+str(e)[:280]))

def eq(a,b):
    assert a==b,(a,b)

def prepare(page, first=True):
    import base64,re
    index=(BASE/'vision-menu-lab'/'index.html').read_text()
    css=(BASE/'vision-menu-lab'/'menu.css').read_text()
    index=re.sub(r'<link rel="stylesheet"[^>]+>', '', index)
    index=re.sub(r'<script type="module"[^>]+></script>', '', index)
    page.set_content(index.replace('</head>',f'<style>{css}</style></head>'),wait_until='load')
    page.evaluate("""() => {const values = new Map();Object.defineProperty(window, 'localStorage', {configurable:true, value:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)}})}""")
    fx=(BASE/'vision-menu-lab'/'fixtures'/'products.mjs').read_text().replace('export const ','const ')
    tpl=(BASE/'vision-menu-lab'/'menu-template.mjs').read_text().replace('export const ','const ').replace('export function ','function ')
    data=(BASE/'vision-menu-lab'/'menu-data.mjs').read_text().replace("import { SAMPLE_PRODUCTS } from './fixtures/products.mjs';",'').replace('export const ','const ').replace('export function ','function ')
    js=(BASE/'vision-menu-lab'/'menu.js').read_text()
    js=re.sub(r"import \{.*?\} from './menu-data.mjs';",'',js,flags=re.S)
    js=re.sub(r"import \{.*?\} from './menu-template.mjs';",'',js,flags=re.S)
    vid=base64.b64encode((BASE/'vision-menu-lab'/'fixtures'/'demo.webm').read_bytes()).decode()
    js=js.replace("'./fixtures/demo.webm'", "'data:video/webm;base64,"+vid+"'")
    page.evaluate(fx+'\n'+tpl+'\n'+data+'\n'+js)

try:
  with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    context=browser.new_context(viewport={'width':1440,'height':900})
    page=context.new_page()
    prepare(page)
    page.screenshot(path='/mnt/data/vision-menu-desktop.png',full_page=True)
    check('visual inicial 16:9',lambda: eq(round(page.locator('#tv-canvas').bounding_box()['width']/page.locator('#tv-canvas').bounding_box()['height'],3),round(16/9,3)))
    check('oito linhas visíveis',lambda: eq(page.locator('.tv-product-row:not(.empty)').count(),8))
    check('sem indicador de página no painel da TV',lambda: eq(page.locator('#tv-canvas').inner_text().count('Página'),0))
    check('vídeo de teste local carrega',lambda: (page.locator('#demo-video').click(),page.wait_for_function("document.querySelector('#menu-video').readyState>=2",timeout=8000)))
    before=page.evaluate("""() => {window.__testVideo=document.querySelector('#menu-video');return {src:window.__testVideo.getAttribute('src'),time:window.__testVideo.currentTime,changes:window.__VISION_MENU_LAB__.inspect().sourceChanges};}""")
    time.sleep(.5)
    check('troca de grupo preserva elemento e source',lambda: (page.locator('#next-group').click(),eq(page.evaluate("document.querySelector('#menu-video') === window.__testVideo"),True),eq(page.evaluate("document.querySelector('#menu-video').getAttribute('src')"),before['src']),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().sourceChanges'),before['changes'])))
    check('troca de preço preserva elemento e source',lambda: (page.locator('.product-edit-row input[data-field="price"]').first.fill('88,30'),page.locator('.product-edit-row input[data-field="price"]').first.press('Tab'),eq(page.evaluate("document.querySelector('#menu-video') === window.__testVideo"),True),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().sourceChanges'),before['changes'])))
    check('edita preço de TV',lambda: eq(page.locator('.tv-amount').first.inner_text(),'88,30'))
    check('alteração de intervalo para 5',lambda: (page.locator('#interval-select').select_option('5'),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().intervalSeconds'),5)))
    check('vídeo continua tocando depois de trocas',lambda: (time.sleep(.3),eq(page.evaluate("document.querySelector('#menu-video').paused"),False)))
    old_page=page.evaluate('window.__VISION_MENU_LAB__.inspect().pageTransitions')
    time.sleep(5.3)
    check('troca automática real a cada 5 segundos',lambda:eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().pageTransitions') > old_page,True))
    check('timer automático não troca source de vídeo',lambda:eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().sourceChanges'),before['changes']))
    check('adicionar produto',lambda: (page.locator('#new-name').fill('Teste'),page.locator('#new-price').fill('24,50'),page.locator('.add-product-form button').click(),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().products.length'),19)))
    check('ativar/desativar produto',lambda: (page.locator('.product-edit-row button[data-action="toggle"]').first.click(),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().products[0].enabled'),False)))
    check('ordenar produto',lambda: (page.locator('.product-edit-row button[data-action="down"]').first.click(),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().products[0].id'),'sample-02')))
    check('excluir produto',lambda: (page.locator('.product-edit-row button[data-action="delete"]').first.click(),eq(page.evaluate('window.__VISION_MENU_LAB__.inspect().products.length'),18)))
    check('substituição de logo',lambda: (page.locator('#logo-upload').set_input_files({'name':'teste.png','mimeType':'image/png','buffer':__import__('base64').b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==')}),eq(page.locator('#logo-image').is_visible(),True)))
    check('salvar rascunho local',lambda: (page.locator('#save-draft').click(),eq(page.evaluate('JSON.parse(localStorage.getItem("vision-menu-lab-demo-v1")).products.length'),18)))
    check('nenhuma URL remota',lambda: eq(page.evaluate('performance.getEntriesByType("resource").length'),0))
    check('continua sem conectividade (não usa rede)',lambda: (page.locator('#next-group').click(),eq(page.locator('.tv-product-row:not(.empty)').count(),8)))
    mctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
    mobile=mctx.new_page();prepare(mobile);mobile.screenshot(path='/mnt/data/vision-menu-mobile.png',full_page=True)
    check('mobile sem rolagem horizontal',lambda:eq(mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'),True))
    check('mobile produtos editáveis',lambda:eq(mobile.locator('.product-edit-row').count(),18))
    browser.close()
finally:
  pass

for name,result in checks:print(('PASS' if result=='PASS' else 'FAIL')+' '+name+(' — '+result if result!='PASS' else ''))
print('Total:',len(checks),'PASS:',sum(r=='PASS' for _,r in checks),'FAIL:',sum(r!='PASS' for _,r in checks))
if any(r!='PASS' for _,r in checks):sys.exit(1)
