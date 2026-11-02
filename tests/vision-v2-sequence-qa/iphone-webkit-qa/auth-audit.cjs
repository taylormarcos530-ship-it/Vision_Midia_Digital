'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {webkit,devices}=require('playwright');
const BASE='http://127.0.0.1:8876',results=[],screens=[],external=[];
function check(ok,msg){assert.ok(ok,msg)}
async function record(name,fn){
 try{const detail=await fn();results.push({name,result:'PASS',detail:detail||null});}
 catch(e){results.push({name,result:'FAIL',reason:String(e.stack||e)});}
}
async function waitShown(page,id,t=9000){await page.locator(id).waitFor({state:'visible',timeout:t})}
async function setup(browser,name,route){
 const c=await browser.newContext({...devices[name],serviceWorkers:'block',acceptDownloads:false,
 permissions:[],locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
 await c.route('**/*',async r=>{
  const url=r.request().url();
  if(url.startsWith(BASE+'/')||url.startsWith('data:')||url.startsWith('blob:')||url==='about:blank')return r.continue();
  external.push({url,method:r.request().method()});
  await r.abort('blockedbyclient');
 });
 const page=await c.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e.message)));
 await page.goto(BASE+route,{waitUntil:'domcontentloaded',timeout:25000});
 return {page,c,errors};
}
async function clientLogin(page){
 await waitShown(page,'#login-form');
 await page.locator('#login-email').fill('cliente-qa@example.invalid');
 await page.locator('#login-password').fill('qa-password');
 await page.locator('#login-submit').click();
 await waitShown(page,'#app-shell',10000);
 check(!(await page.locator('#app-shell').evaluate(el=>el.classList.contains('hidden'))),
       'login did not expose app shell');
}
async function masterLogin(page){
 await waitShown(page,'#master-login-form');
 await page.locator('#master-login-email').fill('master-qa@example.invalid');
 await page.locator('#master-login-password').fill('qa-password');
 await page.locator('#master-login-submit').click();
 await waitShown(page,'#master-shell',10000);
}
async function appNav(page,view){
 const btn=page.locator('.nav-item[data-view="'+view+'"]');
 // WebKit mobile sidebar may hide buttons until hamburger opens.
 if(!(await btn.isVisible()))await page.locator('#menu-button').click();
 await btn.click({timeout:7000});
 await waitShown(page,'#view-'+view);
 check((await page.locator('#view-title').innerText()).length>0,'view title empty');
}
async function masterNav(page,view){
 const btn=page.locator('[data-master-view="'+view+'"]');
 await btn.click({timeout:7000});
 await waitShown(page,'#master-view-'+view);
 check((await page.locator('#master-title').innerText()).length>0,'Master title empty');
}
async function main(){
 let browser;
 try{
  browser=await webkit.launch({headless:true});
  for(const model of ['iPhone SE','iPhone 13']){
   const tag=model.replace(/[^A-Za-z0-9]/g,'-');
   const {page,c,errors}=await setup(browser,model,'/index.html');
   await record(model+' actual client login with synthetic HTTP token',async()=>{
    await clientLogin(page);
    check((await page.locator('#sidebar-company-name').innerText()).includes('Empresa QA'),'wrong synthetic tenant');
    return 'Actual app.js login and 15 synthetic REST table requests';
   });
   for(const [view,selector,expected] of [
    ['dashboard','#metric-devices','1'],['devices','#devices-grid [data-device-card]','TV Sintética'],
    ['media','#media-grid [data-media-card]','Imagem QA'],
    ['playlists','#playlists-grid','Playlist QA'],['reports','#report-content','3'],
    ['inbox','#inbox-list','Aviso de teste']]){
    await record(model+' client '+view+' rendered synthetic module',async()=>{
     await appNav(page,view);
     if(view==='reports'){
       await waitShown(page,'#report-content',8000);
       check((await page.locator('#report-started').innerText()).includes(expected),'wrong report count');
     }else{
       const e=page.locator(selector).first();
       await waitShown(page,selector,8000);
       if(view==='devices'||view==='media'||view==='playlists'||view==='inbox'){
        let text=await e.innerText();
        check(text.includes(expected),'data missing: '+view+' '+text.slice(0,180));
       }else check((await e.innerText()).includes(expected),'dashboard metric missing');
     }
     return {view,synthetic:true};
    });
   }
   await record(model+' iPhone playlist search control',async()=>{
     await appNav(page,'playlists');
     const search=page.locator('#playlist-search');
     await search.fill('inexistente-qa');
     await page.waitForTimeout(180);
     check((await page.locator('#playlists-grid').innerText()).includes('Playlist QA')===false,
       'playlist filter not applied');
     await search.fill('Playlist QA');
     await page.waitForTimeout(180);
     check((await page.locator('#playlists-grid').innerText()).includes('Playlist QA'),
       'playlist search did not restore');
   });
   await record(model+' client inbox read mutation through synthetic backend',async()=>{
     await appNav(page,'inbox');
     await waitShown(page,'#inbox-list [data-inbox-read]');
     const initial=await page.locator('#inbox-list').innerText();
     const btn=page.locator('#inbox-list [data-inbox-read]').first();
     if(initial.includes('Não lida'))await btn.click();
     await page.waitForTimeout(250);
     check((await page.locator('#inbox-list').innerText()).includes('Lida'),'message did not mark read');
     return 'Mutation recorded exclusively by synthetic backend';
   });
   await record(model+' upload input accepts synthetic image locally',async()=>{
     await appNav(page,'media');
     const upload=page.locator('#media-file-input');
     await upload.setInputFiles({name:'qa-image.png',mimeType:'image/png',
       buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOwBIcYAAAAASUVORK5CYII=','base64')});
     let count=await upload.evaluate(e=>e.files.length);
     check(count===1,'iOS file picker selection not reflected');
     return {selectedFile:'qa-image.png',uploadedToRealCloud:false};
   });
   await record(model+' client offline flag and local dashboard retained',async()=>{
     await appNav(page,'dashboard');
     await c.setOffline(true);
     await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
     await page.waitForTimeout(120);
     check((await page.locator('#connection-status').innerText()).includes('Sem internet'),
       'offline status absent');
     check(await page.locator('#app-shell').isVisible(),'shell disappears offline');
     await c.setOffline(false);
     await page.evaluate(()=>window.dispatchEvent(new Event('online')));
     await page.waitForTimeout(250);
     check((await page.locator('#connection-status').innerText()).includes('Conectado'),
       'online recovery absent');
     return 'UI state only; true data recovery from remote outage not simulated';
   });
   await record(model+' client app nav logout and session clear',async()=>{
     let logout=page.locator('#logout-button');
     if(!(await logout.isVisible()))await page.locator('#menu-button').click();
     await logout.click();
     await waitShown(page,'#auth-screen');
     check((await page.evaluate(()=>localStorage.getItem('vision_midia_session_v1')))===null,
       'session remains after logout');
   });
   await record(model+' client no uncaught exception',async()=>{
     check(errors.length===0,JSON.stringify(errors.slice(0,7)));return errors.length;
   });
   fs.mkdirSync('qa-iphone-auth-screens',{recursive:true});
   await page.screenshot({path:'qa-iphone-auth-screens/'+tag+'-logout.png'});
   screens.push({model,page:'client logout'});
   await c.close();

   const {page:master,c:mc,errors:me}=await setup(browser,model,'/master.html');
   await record(model+' actual Master login and role verification',async()=>{
     await masterLogin(master);
     check((await master.locator('#master-role-label').innerText()).includes('Master'),
       'Master role not verified');
     return 'whoami super_admin + dashboard mock';
   });
   for(const view of ['dashboard','clients','plans','audit']){
    await record(model+' Master '+view+' navigation',async()=>{
     await masterNav(master,view);
     const target=master.locator('#master-view-'+view);
     if(view==='clients')check((await target.innerText()).includes('Empresa QA'),'client missing');
     if(view==='plans')check((await target.innerText()).includes('Plano Sintético'),'plan missing');
     return {view,synthetic:true};
    });
   }
   await record(model+' Master client search and reset',async()=>{
    await masterNav(master,'clients');
    await master.locator('#master-client-search').fill('impossivel-qa');
    check((await master.locator('#master-clients-list').innerText()).includes('Empresa QA')===false,
       'Master search did not exclude');
    await master.locator('#master-client-search').fill('Empresa QA');
    check((await master.locator('#master-clients-list').innerText()).includes('Empresa QA'),
       'Master search did not restore');
   });
   await record(model+' Master notification synthetic no device subscribed',async()=>{
    await masterNav(master,'dashboard');
    await master.locator('#mn-message').fill('Mensagem QA sem envio real');
    await master.locator('#mn-send').click({timeout:7000});
    await master.waitForTimeout(260);
    check((await master.locator('#mn-status').innerText()).includes('não ativou notificações'),
      'expected no-subscriptions not shown');
    return 'No push delivery; synthetic no_subscriptions response enforced';
   });
   await record(model+' Master offline/online connection recovery',async()=>{
    await mc.setOffline(true);
    await master.evaluate(()=>window.dispatchEvent(new Event('offline')));
    await master.waitForTimeout(200);
    check((await master.locator('#master-connection').innerText()).includes('Sem internet'),
      'Master offline indicator missing');
    await mc.setOffline(false);
    await master.evaluate(()=>window.dispatchEvent(new Event('online')));
    await master.waitForTimeout(200);
    check((await master.locator('#master-connection').innerText()).includes('Conectado'),
      'Master online indicator missing');
   });
   await record(model+' Master no uncaught exception',async()=>{
    check(me.length===0,JSON.stringify(me.slice(0,6)));return me.length;
   });
   await master.screenshot({path:'qa-iphone-auth-screens/'+tag+'-master.png'});
   screens.push({model,page:'master'});
   await mc.close();
  }
  await record('strict backend isolation, no external URLs',async()=>{
   check(external.length===0,JSON.stringify(external.slice(0,12)));
   return 'Only localhost:8876 and in-memory synthetic fixtures';
  });
  const entries=(await (await fetch(BASE+'/__qa_events')).json()).events;
  await record('synthetic backend request evidence',async()=>{
   const count=(prefix)=>entries.filter(x=>x.path.includes(prefix)).length;
   check(count('/auth/v1/token')>=4,'token endpoint not exercised');
   check(count('/rest/v1/')>=20,'REST tables not exercised');
   check(count('/functions/v1/master-admin')>=4,'master-admin not exercised');
   check(count('/functions/v1/notification-inbox')>=2,'notification inbox not exercised');
   return {total:entries.length,auth:count('/auth/v1/token'),rest:count('/rest/v1/'),
     master:count('/functions/v1/master-admin'),inbox:count('/functions/v1/notification-inbox')};
  });
 }finally{if(browser)await browser.close()}
 const untested=[
  'Actual iOS Safari device, install PWA to home screen, push delivery, permission prompts',
  'Real Supabase Auth/RLS/session refresh, Master actions and production SQL',
  'Real TV Box/APK player, physical playback/rotation/streaming',
  'Real remote network outage synchronization and offline media cache',
  'Real payment, PIX, email sending, WhatsApp, and file uploads to storage',
  'Real authenticated customer data: examples were synthetic only'
 ].map(name=>({name,result:'NOT_TESTED'}));
 const full=[...results,...untested];
 const sum={total:full.length,pass:full.filter(x=>x.result==='PASS').length,
 fail:full.filter(x=>x.result==='FAIL').length,not_tested:untested.length,
 attempted:results.length,profiles:['iPhone SE','iPhone 13'],localhostOnly:true,
 screenshots:screens,external,security_TOCTOU_status:'FAIL_NO_GO',
 deployment:false,details:full};
 fs.writeFileSync('qa-iphone-auth-webkit.json',JSON.stringify(sum,null,2));
 console.log('QA_IPHONE_AUTH_SUMMARY_JSON='+JSON.stringify({total:sum.total,pass:sum.pass,fail:sum.fail,
 not_tested:sum.not_tested,failures:results.filter(x=>x.result==='FAIL').map(x=>({name:x.name,reason:x.reason?.slice(0,450)})),
 external:external.length}));
 if(sum.fail)process.exitCode=1;
}
main().catch(e=>{console.error(e.stack);process.exitCode=2});
