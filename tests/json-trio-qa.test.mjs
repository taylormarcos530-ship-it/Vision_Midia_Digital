import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sample=n=>JSON.parse(read('exemplo-canal-'+n+'.json'));
function setupViewer(){
 const doc={querySelectorAll:()=>[],createElement:()=>({})};
 const ctx=vm.createContext({
  document:doc,location:{href:'https://preview.example/json-trio.html',origin:'https://preview.example',search:''},
  URL,URLSearchParams,console,window:{addEventListener(){}},setInterval(){}
 });
 const script=read('json-trio.js').replace(/^import .*;\s*/m,'const fetchCachedJson=async()=>({value:null});\n');
 const noInit=script.replace(/\binit\(\);\s*$/,'globalThis.__qa={validFeed,parsePublicUrl,render};');
 assert.match(noInit,/globalThis\.__qa/);
 vm.runInContext(noInit,ctx);
 return {ctx,api:ctx.__qa};
}
function setupConfig(){
 const elements=new Map();
 const el=name=>{
   if(!elements.has(name))elements.set(name,{
     value:'',href:'',hidden:true,textContent:'',listeners:{},
     addEventListener(type,cb){this.listeners[type]=cb;},
     focus(){},select(){}
   });
   return elements.get(name);
 };
 const ctx=vm.createContext({
   document:{getElementById:el},
   location:{href:'https://preview.example/configurar-fonte-json.html',origin:'https://preview.example'},
   URL,navigator:{clipboard:{writeText:async()=>{}}}
 });
 vm.runInContext(read('configurar-tres-fontes.js'),ctx);
 return {el,ctx};
}
test('três feeds demonstrativos têm contrato JSON válido',()=>{
 const {api}=setupViewer();
 for(let n=1;n<=3;n++)assert.equal(api.validFeed(sample(n)),true);
});
test('rejeita payload inválido, excessivo ou não textual',()=>{
 const {api}=setupViewer();
 assert.equal(api.validFeed({titulo:'',itens:['A']}),false);
 assert.equal(api.validFeed({titulo:'Avisos',itens:[]}),false);
 assert.equal(api.validFeed({titulo:'Avisos',itens:[1,2]}),false);
 assert.equal(api.validFeed({titulo:'Avisos',itens:Array(9).fill('A')}),false);
 assert.equal(api.validFeed({titulo:'Avisos',itens:['A'.repeat(161)]}),false);
 assert.equal(api.validFeed({titulo:'A'.repeat(91),itens:['B']}),false);
 assert.equal(api.validFeed({titulo:'C',itens:['Alerta']}),true);
});
test('URL genérica pública aceita; hosts privados, tokens e HTTP externos rejeitados',()=>{
 const {api}=setupViewer();
 assert.equal(api.parsePublicUrl('https://dados.example.org/feed.json'),'https://dados.example.org/feed.json');
 assert.equal(api.parsePublicUrl('./exemplo-canal-1.json'),'https://preview.example/exemplo-canal-1.json');
 assert.equal(api.parsePublicUrl('http://dados.example.org/feed.json'),null);
 assert.equal(api.parsePublicUrl('https://127.0.0.1/resource'),null);
 assert.equal(api.parsePublicUrl('https://localhost/private'),null);
 assert.equal(api.parsePublicUrl('https://dados.example.org/?token=abc'),null);
 assert.equal(api.parsePublicUrl('https://u:p@dados.example.org/'),null);
});
test('renderiza cada cartão isoladamente e exibe último conteúdo cacheado',()=>{
 const {api}=setupViewer();
 const elements=new Map();
 const get=key=>{
   if(!elements.has(key))elements.set(key,{textContent:'',classList:{values:new Set(),
     add(x){this.values.add(x);},toggle(x,v){if(v)this.values.add(x);else this.values.delete(x);}},
     children:[],replaceChildren(...arr){this.children=arr;},append(x){this.children.push(x);}});
   return elements.get(key);
 };
 const panel={querySelector:get};
 api.render(panel,{value:sample(1),source:'cache',stale:true,_meta:{}});
 assert.equal(get('[data-title]').textContent,'Avisos');
 assert.equal(get('[data-items]').children.length,2);
 assert.match(get('[data-status]').textContent,/Últimos dados válidos/);
 assert.equal(get('[data-status]').classList.values.has('stale'),true);
});
test('gerador combina três URLs em única página de exibição',()=>{
 const {el}=setupConfig();
 el('three-api-1').value='https://a.example.org/a.json';
 el('three-api-2').value='https://b.example.org/b.json';
 el('three-api-3').value='https://c.example.org/c.json';
 el('three-source-form').listeners.submit({preventDefault(){}});
 assert.equal(el('three-error').textContent,'');
 assert.equal(el('three-output').hidden,false);
 const url=new URL(el('three-viewer-url').value);
 assert.equal(url.pathname,'/json-trio.html');
 assert.deepEqual(['s1','s2','s3'].map(k=>url.searchParams.get(k)),[
  'https://a.example.org/a.json','https://b.example.org/b.json','https://c.example.org/c.json'
 ]);
});
test('gerador bloqueia token na URL de qualquer cartão',()=>{
 const {el}=setupConfig();
 el('three-api-3').value='https://c.example.org/feed?api_key=private';
 el('three-source-form').listeners.submit({preventDefault(){}});
 assert.match(el('three-error').textContent,/tokens ou credenciais/);
 assert.equal(el('three-output').hidden,true);
});
test('Vercel aplica CSP somente na página de três cartões',()=>{
 const rules=JSON.parse(read('vercel.json')).headers;
 const selected=rules.find(x=>x.source==='/json-trio.html');
 assert.ok(selected);
 assert.ok(selected.headers.some(h=>h.key==='Content-Security-Policy'&&h.value.includes("connect-src 'self' https:")));
 const html=read('json-trio.html');
 assert.match(html,/data-panel="1"/);
 assert.match(html,/data-panel="2"/);
 assert.match(html,/data-panel="3"/);
 assert.match(read('configurar-fonte-json.html'),/three-source-form/);
});
