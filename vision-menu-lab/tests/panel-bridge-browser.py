"""Browser checks for opt-in admin read-only bridge; no real network/device."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parents[1]
source=re.sub(r'\bexport\s+(?=(?:const|function)\b)','',(ROOT/'panel-bridge.mjs').read_text())
mock="""<!doctype html><html><head><meta charset='utf-8'><style>.hidden{display:none!important}</style></head><body>
<aside id='sidebar'><nav class='nav-list'><button class='nav-item' data-view='dashboard'>Dashboard</button><button class='nav-item' data-view='playlists'>Playlists</button></nav></aside>
<div id='view-title'>Dashboard</div><div id='view-kicker'>VISÃO GERAL</div>
<div class='content-area'><section class='view-section' id='view-dashboard'>Home</section></div></body></html>"""
checks=[]
def check(name, condition):
    assert condition, name
    checks.append(name)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page()
    page.set_content(mock)
    page.evaluate("window.VISION_MENU_PANEL_ENABLED=true")
    page.add_script_tag(content=source)
    page.evaluate("""window.testCtx={signedIn:true,company:{id:'a',name:'Loja A',status:'active'},role:'owner',devices:[{id:'tv-a',company_id:'a',name:'TV A'}],media:[{id:'v-a',name:'Vídeo A',company_id:'a',media_type:'video',processing_status:'ready',storage_path:'a/v-a.mp4'}],assignments:[],campaigns:[],campaignTargets:[]};window.bridge=mountVisionMenuPreview({doc:document,win:window,getContext:()=>window.testCtx})""")
    check('mounted',page.evaluate('window.bridge.mounted === true'))
    check('navigation visible',page.locator('#vision-menu-preview-nav').is_visible())
    page.locator('#vision-menu-preview-nav').click()
    check('preview opened',page.locator('#view-vision-menu').is_visible())
    check('only local company TV',page.locator('#view-vision-menu select').nth(0).locator('option').count()==2)
    check('only local company video',page.locator('#view-vision-menu select').nth(1).locator('option').count()==2)
    check('no publication controls',page.locator('#view-vision-menu button').count()==0)
    check('proper status', 'Loja A' in page.locator('#view-vision-menu [role=status]').inner_text())
    page.locator('[data-view="dashboard"]').click()
    check('normal navigation restored',not page.locator('#view-vision-menu').is_visible())
    page.evaluate("window.testCtx={...window.testCtx,signedIn:false};window.dispatchEvent(new Event('vision-session-changed'))")
    check('logout hides menu',not page.locator('#vision-menu-preview-nav').is_visible())
    page.evaluate("window.testCtx={...window.testCtx,signedIn:true,company:{id:'b',name:'Loja B',status:'active'},devices:[{id:'tv-b',company_id:'b',name:'TV B'}],media:[]};window.dispatchEvent(new Event('vision-menu-panel-updated'))")
    check('tenant switch restores only new company',page.locator('#vision-menu-preview-nav').is_visible())
    page.locator('#vision-menu-preview-nav').click()
    check('old TV not shown', 'TV A' not in page.locator('#view-vision-menu').inner_text())
    check('new TV shown', 'TV B' in page.locator('#view-vision-menu').inner_text())
    check('no hidden media revealed',page.locator('#view-vision-menu select').nth(1).locator('option').count()==1)
    browser.close()
print(f'Chromium panel bridge: {len(checks)}/{len(checks)} PASS')
for c in checks:print('PASS',c)
