import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

function nodes(){
 const map=new Map();
 return name=>{
  if(!map.has(name))map.set(name,{
   value:'',textContent:'',style:{},href:'',listeners:{},replaceChildren(){},
   addEventListener(name,handler){this.listeners[name]=handler}
  });
  return map.get(name);
 };
}
function viewerSetup(search=''){
 const find=nodes();
 const js=read('json-feed.js').replace(/^import .*;\s*/m,'const fetchCachedJson=async()=>({value:null,source:"unavailable",stale:true,_meta:{}});\n');
 const ctx=vm.createContext({
   document:{getElementById:find,createElement:()=>({textContent:'',className:''})},
   location:{href:'https://preview.example/json-feed.html'+search,origin:'https://preview.example',search},
   URL,URLSearchParams,window:{addEventListener(){}},setInterval(){},console
 });
 vm.runInContext(js,ctx);
 const call=source=>vm.runInContext(source,ctx);
 return {call,find};
}
function configSetup(){
 const find=nodes();
 const ctx=vm.createContext({
   document:{getElementById:find},
   location:{href:'https://preview.example/configurar-fonte-json.html',origin:'https://preview.example'},
   URL,navigator:{clipboard:{writeText:async()=>{}}}
 });
 vm.runInContext(read('configurar-fonte-json.js'),ctx);
 return {find};
}
test('painel aceita somente itens textuais JSON limitados',()=>{
 const {call}=viewerSetup();
 assert.equal(call('validData({titulo:"Agenda",itens:["Visite o evento"]})'),true);
 assert.equal(call('validData({itens:[1,2]})'),false);
 assert.equal(call('validData({itens:[]})'),false);
 assert.equal(call('validData({itens:Array(13).fill("x")})'),false);
 assert.equal(call('validData({titulo:"x".repeat(121),itens:["x"]})'),false);
});
test('fonte HTTPS pública aceita e URLs privadas são rejeitadas',()=>{
 const {call}=viewerSetup();
 assert.equal(call('parseSource("https://dados.exemplo.org/feed.json")'),'https://dados.exemplo.org/feed.json');
 assert.equal(call('parseSource("./informativo-demo.json")'),'https://preview.example/informativo-demo.json');
 assert.equal(call('parseSource("http://dados.exemplo.org/feed.json")'),null);
 assert.equal(call('parseSource("https://localhost/x")'),null);
 assert.equal(call('parseSource("https://127.0.0.1/x")'),null);
 assert.equal(call('parseSource("https://site.com/?token=segredo")'),null);
 assert.equal(call('parseSource("https://user:pass@site.com/x")'),null);
});
test('configurador separa URL API e URL da página',()=>{
 const {find}=configSetup();
 const api=find('api-url'),form=find('source-form'),error=find('error');
 api.value='https://dados.exemplo.org/avisos.json';
 form.listeners.submit({preventDefault(){}});
 assert.equal(error.textContent,'');
 const url=new URL(find('viewer-url').value);
 assert.equal(url.pathname,'/json-feed.html');
 assert.equal(url.searchParams.get('source'),'https://dados.exemplo.org/avisos.json');
 assert.equal(find('output').style.display,'block');
});
test('configurador rejeita segredos e URL HTTP',()=>{
 const {find}=configSetup();
 const api=find('api-url'),form=find('source-form');
 api.value='http://dados.exemplo.org/avisos.json';
 form.listeners.submit({preventDefault(){}});
 assert.match(find('error').textContent,/HTTPS/);
 assert.equal(find('output').style.display,'none');
 api.value='https://dados.exemplo.org/avisos.json?api_key=privada';
 form.listeners.submit({preventDefault(){}});
 assert.match(find('error').textContent,/chaves privadas/);
});
test('menus de bancada não interferem no fluxo original da biblioteca',()=>{
 const menu=read('cache-bench-menu.js');
 const master=read('master.html');
 assert.match(menu,/Configurar fonte JSON pública/);
 assert.match(menu,/configurar-fonte-json\.html/);
 assert.match(master,/Fonte JSON \(bancada\)/);
 assert.match(menu,/existing\.click\(\)/);
});
test('viewer e configuração estão no repositório com CSP próprio',()=>{
 const viewer=read('json-feed.html');
 const cfg=read('configurar-fonte-json.html');
 const vercel=JSON.parse(read('vercel.json'));
 assert.match(viewer,/json-feed\.js/);
 assert.match(cfg,/configurar-fonte-json\.js/);
 const rule=vercel.headers.find(rule=>rule.source==='/json-feed.html');
 assert.ok(rule);
 assert.ok(rule.headers.some(h=>h.key==='Content-Security-Policy'&&h.value.includes("connect-src 'self' https:")));
 assert.ok(rule.headers.some(h=>h.key==='X-Frame-Options'&&h.value==='ALLOWALL'));
});
