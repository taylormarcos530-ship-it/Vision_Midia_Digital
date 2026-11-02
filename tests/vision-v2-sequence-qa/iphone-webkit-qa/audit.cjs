'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {webkit,devices}=require('playwright');
const BASE='http://127.0.0.1:8765';
const reports=[],screens=[],unexpectedExternal=[];
function fail(label,msg){reports.push({label,result:'FAIL',reason:String(msg)});}
async function run(label,fn){
  try{const detail=await fn();reports.push({label,result:'PASS',detail:detail||''})}
  catch(e){fail(label,e.stack||e.message)}
}
function unverified(label,reason){reports.push({label,result:'NOT_TESTED',reason})}
function visible(loc){return loc.isVisible()}
function ensure(b,s){assert.ok(b,s)}
async function pageFor(browser,device,route){
  const descriptor=devices[device];
  const ctx=await browser.newContext({...descriptor,serviceWorkers:'block',acceptDownloads:false,
    permissions:[],locale:'pt-BR',timezoneId:'America/Sao_Paulo'});
  await ctx.route('**/*',async r=>{
    const u=r.request().url();
    if(u.startsWith(BASE+'/') || u==='about:blank' || u.startsWith('data:') || u.startsWith('blob:')){
      return r.continue();
    }
    unexpectedExternal.push({url:u,method:r.request().method()});
    return r.abort('blockedbyclient');
  });
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(String(e.message)));
  let response=await page.goto(BASE+route,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(350);
  return {page,ctx,response,errors};
}
async function main(){
 let browser;
 try{
  browser=await webkit.launch({headless:true});
  for(const device of ['iPhone SE','iPhone 13','iPhone 13 Pro Max']){
    await run(device+' WebKit viewport and touch',async()=>{
      const {page,ctx,response}=await pageFor(browser,device,'/index.html');
      ensure(response.status()===200,'HTML did not load');
      let env=await page.evaluate(()=>({width:innerWidth,touch:'ontouchstart' in window,
          visual:document.documentElement.clientWidth,ua:navigator.userAgent}));
      ensure(env.width>0 && env.touch,'not a touch/mobile WebKit context');
      await ctx.close();return env;
    });
    for(const item of [
      {route:'/index.html',name:'Painel cliente'},
      {route:'/master.html',name:'Painel Master'},
      {route:'/pontos.html?demo=1',name:'Rede de Pontos demonstrativa'},
      {route:'/anunciante.html?demo=1',name:'Portal anunciante demonstrativo'},
      {route:'/downloads.html',name:'Downloads'},
      {route:'/player.html',name:'Player web'},
      {route:'/daily-content.html',name:'Conteúdo diário'},
      {route:'/news-feed.html',name:'Notícias'}]){
      await run(device+' '+item.name+' abertura',async()=>{
        const {page,ctx,response,errors}=await pageFor(browser,device,item.route);
        ensure(response.status()===200,'HTTP '+response.status());
        ensure(await page.locator('body').count()===1,'document body missing');
        const info=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
          height:innerHeight,title:document.title}));
        ensure(info.title.length>0,'document title missing');
        await ctx.close();
        screens.push({device,page:item.name,route:item.route,...info,jsErrors:errors});
        return info;
      });
    }
  }
  for(const device of ['iPhone SE','iPhone 13']){
    await run(device+' PWA install instruction iOS',async()=>{
      const {page,ctx}=await pageFor(browser,device,'/master.html');
      const inv=page.locator('.vision-install-invite');
      await inv.waitFor({state:'visible',timeout:4000});
      await inv.locator('[data-install]').click();
      const info=await inv.locator('[data-message]').innerText();
      ensure(info.includes('Compartilhar')&&info.includes('Tela de Início'),'missing iOS instruction');
      await inv.locator('[data-dismiss]').click();
      ensure(await inv.count()===0,'invite did not dismiss');
      await ctx.close();return info;
    });
    await run(device+' Master form browser email validation',async()=>{
      const {page,ctx}=await pageFor(browser,device,'/master.html');
      const email=page.locator('#master-login-email');
      ensure(await visible(email),'master email not visible');
      await email.fill('not-an-email');
      await page.locator('#master-login-password').fill('qa-irrelevant');
      const valid=await page.locator('#master-login-form').evaluate(el=>el.checkValidity());
      ensure(valid===false,'invalid email accepted by HTML form');
      await ctx.close();return 'invalid email blocked without submitting to backend';
    });
    await run(device+' Public points search, filters, detail',async()=>{
      const {page,ctx,errors}=await pageFor(browser,device,'/pontos.html?demo=1');
      await page.locator('[data-open]').first().waitFor({state:'visible',timeout:5000});
      ensure(await page.locator('[data-open]').count()===1,'demo point did not render');
      await page.locator('#search').fill('inexistente-qa');
      ensure(await page.locator('[data-open]').count()===0,'no-results filter failed');
      await page.locator('#search').fill('life');
      ensure(await page.locator('[data-open]').count()===1,'search filter did not restore point');
      await page.locator('#city').selectOption({label:'Anápolis'});
      await page.locator('#category').selectOption({label:'Academia'});
      await page.locator('[data-open]').first().click();
      ensure(await page.locator('#point-dialog').evaluate(el=>el.open),'detail modal did not open');
      ensure((await page.locator('#detail-title').innerText()).includes('Life'),'detail wrong');
      await page.locator('#close-dialog').click();
      ensure(!(await page.locator('#point-dialog').evaluate(el=>el.open)),'modal did not close');
      await ctx.close();return {demoOnly:true,errors};
    });
    await run(device+' Advertiser portal synthetic data and blocked account',async()=>{
      const {page,ctx,errors}=await pageFor(browser,device,'/anunciante.html?demo=1');
      await page.locator('#demo-banner').waitFor({state:'visible',timeout:4000});
      ensure(await visible(page.locator('#dashboard')),'advertiser demo dashboard hidden');
      await page.locator('#demo-advertiser').selectOption('bloqueado');
      await page.waitForTimeout(150);
      const status=await page.locator('#status').innerText();
      ensure(status.includes('suspenso'),'blocked advertiser not enforced');
      await page.locator('#demo-advertiser').selectOption('loja-a');
      await page.waitForTimeout(150);
      ensure(await visible(page.locator('#dashboard')),'switch to permitted demo advertiser failed');
      await ctx.close();return {status,errors};
    });
  }
  await run('Missing PWA manifest (known production artifact gap)',async()=>{
    const {page,ctx}=await pageFor(browser,'iPhone 13','/index.html');
    const r=await page.request.get(BASE+'/manifest.webmanifest');
    await ctx.close();
    ensure(r.status()===200,'index links manifest.webmanifest but repository responds '+r.status());
    return 'manifest available';
  });
  await run('No official network requests allowed (strict QA)',async()=>{
    ensure(unexpectedExternal.length===0,JSON.stringify(unexpectedExternal.slice(0,8)));
    return 'Every attempted URL stayed on loopback';
  });
  for(const [label,reason] of [
   ['Login real e renovação de sessão','Sem contas ou Supabase de homologação: impedido por isolamento NO-GO'],
   ['Master: TVs, mídias, playlists, planos e notificações','Módulos exigem autorização e backend; não testados como operações reais'],
   ['Envio de push no iPhone físico','WebKit em Linux não reproduz permissão push do iOS instalado'],
   ['Adicionar PWA à Tela de Início','Requires physical iOS/Safari and valid web manifest'],
   ['Player Android/TV Box em iPhone','APK Android não executa em iOS'],
   ['Player vídeo, som, autoplay, quiosque e giro físico','Exige vídeo real ou aparelho iOS/TV Box; não testado'],
   ['Pagamentos, PIX, WhatsApp externo, mídia/arquivos','Nenhuma transação ou serviço externo permitido nos testes isolados'],
   ['Câmera, upload real, notificações e localização','Dependem de permissões/dispositivo físico ou backend homologado']
  ])unverified(label,reason);
 }finally{if(browser)await browser.close();}
 const summary={engine:'Playwright WebKit on Ubuntu Linux (emulated iPhone viewport+UA+touch, NOT actual iOS)',
  total:reports.length,pass:reports.filter(x=>x.result==='PASS').length,
  fail:reports.filter(x=>x.result==='FAIL').length,
  not_tested:reports.filter(x=>x.result==='NOT_TESTED').length,
  pages:screens.length,external_attempts:unexpectedExternal,
  production_touched:false,ios_native_tested:false,
  reports,screens};
 fs.writeFileSync('qa-iphone-webkit-results.json',JSON.stringify(summary,null,2));
 console.log('QA_IPHONE_WEBKIT_SUMMARY_JSON='+JSON.stringify({total:summary.total,pass:summary.pass,
  fail:summary.fail,not_tested:summary.not_tested,pages:summary.pages,
  failing_checks:reports.filter(x=>x.result==='FAIL').map(x=>({label:x.label,reason:x.reason?.slice(0,300)})),
  external_attempts:unexpectedExternal.length}));
 // Missing manifest is a known reproducible product failure. Intentional
 // nonzero exit demonstrates honest product FAIL, not QA harness success.
 if(summary.fail)process.exitCode=1;
}
main().catch(e=>{console.error(e.stack);process.exitCode=2});
