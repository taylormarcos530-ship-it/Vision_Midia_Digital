const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

async function browserHarness(){
 const {createAutoBench,autoBenchView,advanceAutoBench}=await import('../commercial-tv-auto-state.mjs');
 const widgets=new Map(),timers=new Map(),events=new Map();
 let timerId=0;
 function widget(id){
  if(!widgets.has(id))widgets.set(id,{
   id,hidden:false,disabled:false,textContent:'',className:'',dataset:{},listeners:{},children:[],
   addEventListener(type,callback){this.listeners[type]=callback},
   replaceChildren(){this.children=[]},
   append(...values){this.children.push(...values)}
  });
  return widgets.get(id);
 }
 const inputs={
  baseCount:{value:'6'},adCount:{value:'5'},
  shuffle:{checked:false},single:{checked:false},
  scheduled:{checked:false},enabled:{checked:true}
 };
 const form=widget('auto-bench-form');
 form.elements={namedItem:name=>inputs[name]};
 const document={
  hidden:false,
  getElementById:widget,
  createElement:tag=>({
   tag,children:[],textContent:'',className:'',
   append(...parts){this.children.push(...parts)}
  }),
  addEventListener:(type,callback)=>events.set(type,callback)
 };
 const code=fs.readFileSync('commercial-tv-auto-ui.mjs','utf8').replace(/^import[^\n]+\n/gm,'');
 vm.runInNewContext(code,{
  document,createAutoBench,autoBenchView,advanceAutoBench,
  setTimeout(fn,delay){assert.ok([1600,2000,3000].includes(delay));const id=++timerId;timers.set(id,{callback:fn,delay});return id},
  clearTimeout(id){timers.delete(id)}
 });
 return {
  widget,inputs,document,timers,events,
  click(id){const handler=widget(id).listeners.click;assert.equal(typeof handler,'function');handler()},
  tick(delay){const [id,entry]=[...timers.entries()].find(([_,t])=>delay===undefined||t.delay===delay)||[];assert.ok(entry,'expected a pending simulated completion'+(delay?' at '+delay+' ms':''));timers.delete(id);entry.callback()},
  campaignNames(){return widget('auto-sequence').children.filter(row=>row.className.includes('auto-ad')).map(row=>row.children[2].textContent)}
 };
}

test('auto laboratory offers real controls but no network, player or storage',()=>{
 const html=fs.readFileSync('commercial-tv-auto-bench.html','utf8');
 const js=fs.readFileSync('commercial-tv-auto-ui.mjs','utf8');
 for(const id of ['auto-mode','auto-complete','auto-refresh','auto-disconnect','auto-reconnect','auto-restart','auto-compatible','auto-sequence'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/commercial-tv-auto-ui\.mjs/);
 assert.match(html,/TESTE 100% OFFLINE/);
 assert.match(html,/persistência real, desligamento da TV e contagem de exibições ainda não foram testados/);
 assert.match(js,/advanceAutoBench/);
 assert.match(js,/type:'complete',token:expected/);
 assert.match(js,/visibilitychange/);
 assert.doesNotMatch(js,/fetch\(|createClient\(|new CommercialAPI|\.rpc\(|localStorage|sessionStorage|\.supabase\.co|sb_secret_/);
 assert.doesNotMatch(html,/src=".*(?:player\.js|commercial-staging-config\.js|commercial-config\.js)"/);
});
test('clicking auto starts timed mock media completions and switches advertisers after full cycle',async()=>{
 const h=await browserHarness();
 assert.deepEqual(h.campaignNames(),['Loja do João','Empresa B']);
 assert.equal(h.timers.size,0,'default state never auto-runs');
 h.click('auto-mode');
 assert.equal(h.timers.size,1);
 assert.match(h.widget('auto-mode').textContent,/Pausar/);
 h.tick();
 assert.match(h.widget('auto-round').textContent,/item 2 de 8/);
 for(let i=1;i<8;i++)h.tick();
 assert.match(h.widget('auto-round').textContent,/Rodada 2/);
 assert.deepEqual(h.campaignNames(),['Publicidade C','Publicidade D']);
 assert.match(h.widget('auto-metrics').textContent,/Rodadas concluídas: 1/);
 h.click('auto-mode');
 assert.equal(h.timers.size,0);
});
test('disconnect stops timer, reconnect preserves progress, refresh and reboot do not advance',async()=>{
 const h=await browserHarness();
 h.click('auto-mode');h.tick();h.tick();
 const before=h.widget('auto-round').textContent;
 h.click('auto-disconnect');
 assert.equal(h.timers.size,1,'the only remaining timer simulates reconnection');
 assert.equal([...h.timers.values()][0].delay,3000);
 assert.match(h.widget('auto-health').textContent,/interrompida/);
 assert.match(h.widget('auto-feedback').textContent,/reconexão|retorno automático|SEM CONEXÃO/i);
 assert.equal(h.widget('auto-complete').disabled,true);
 h.click('auto-reconnect');
 assert.equal(h.timers.size,1,'auto resumes from the preserved item');
 assert.equal([...h.timers.values()][0].delay,1600);
 assert.equal(h.widget('auto-round').textContent,before);
 h.click('auto-refresh');
 assert.equal(h.widget('auto-round').textContent,before);
 h.click('auto-restart');
 assert.match(h.widget('auto-feedback').textContent,/REINICIANDO/);
 assert.equal(h.widget('auto-restart').disabled,true);
 assert.equal(h.widget('auto-round').textContent,before);
 h.tick(2000);
 assert.match(h.widget('auto-message').textContent,/Reinício simulado concluído/);
 assert.equal(h.widget('auto-round').textContent,before);
 h.click('auto-complete');
 assert.match(h.widget('auto-round').textContent,/item 4 de 8/);
});
test('no playlist and protected options never advance commercials through auto playback',async()=>{
 const h=await browserHarness();
 h.inputs.baseCount.value='0';
 h.widget('auto-bench-form').listeners.change();
 assert.equal(h.widget('auto-mode').disabled,true);
 h.click('auto-mode');
 assert.equal(h.timers.size,0);
 assert.match(h.widget('auto-status').textContent,/Aguardando playlist/);
 h.inputs.baseCount.value='6';h.inputs.shuffle.checked=true;
 h.widget('auto-bench-form').listeners.change();
 assert.deepEqual(h.campaignNames(),[]);
 h.click('auto-compatible');
 assert.equal(h.inputs.shuffle.checked,false);
 assert.deepEqual(h.campaignNames(),['Loja do João','Empresa B']);
});
test('backgrounding tab stops simulated clock instead of allowing silent playback progression',async()=>{
 const h=await browserHarness();
 h.click('auto-mode');
 assert.equal(h.timers.size,1);
 h.document.hidden=true;
 h.events.get('visibilitychange')();
 assert.equal(h.timers.size,0);
 assert.match(h.widget('auto-mode').textContent,/Iniciar/);
 assert.match(h.widget('auto-round').textContent,/Rodada 1/);
});

test('offline pause reconnects automatically after 3s and resumes exactly the same step',async()=>{
 const h=await browserHarness();
 h.click('auto-mode');
 h.tick(1600);h.tick(1600);
 const checkpoint=h.widget('auto-round').textContent;
 h.click('auto-disconnect');
 assert.equal(h.timers.size,1);
 assert.equal([...h.timers.values()][0].delay,3000);
 assert.equal(h.widget('auto-complete').disabled,true);
 assert.match(h.widget('auto-feedback').textContent,/SEM CONEXÃO/);
 assert.equal(h.widget('auto-round').textContent,checkpoint);
 h.tick(3000);
 assert.equal(h.widget('auto-round').textContent,checkpoint);
 assert.match(h.widget('auto-health').textContent,/ativa/);
 assert.match(h.widget('auto-mode').textContent,/Pausar/);
 assert.equal([...h.timers.values()][0].delay,1600);
 h.tick(1600);
 assert.match(h.widget('auto-round').textContent,/item 4 de 8/);
});

test('reboot while disconnected shows 2s progress, returns online without skipping the current media',async()=>{
 const h=await browserHarness();
 h.click('auto-mode');h.tick(1600);h.tick(1600);
 const checkpoint=h.widget('auto-round').textContent;
 h.click('auto-disconnect');
 assert.equal([...h.timers.values()][0].delay,3000);
 h.click('auto-restart');
 assert.equal(h.timers.size,1,'reboot replaces reconnect timer');
 assert.equal([...h.timers.values()][0].delay,2000);
 assert.match(h.widget('auto-status').textContent,/Reiniciando/);
 assert.match(h.widget('auto-feedback').textContent,/REINICIANDO/);
 assert.match(h.widget('auto-current').textContent,/Recuperando checkpoint/);
 assert.equal(h.widget('auto-complete').disabled,true);
 h.tick(2000);
 assert.equal(h.widget('auto-round').textContent,checkpoint);
 assert.match(h.widget('auto-health').textContent,/ativa/);
 assert.match(h.widget('auto-message').textContent,/Reinício simulado concluído/);
 assert.equal([...h.timers.values()][0].delay,1600);
 h.tick(1600);
 assert.match(h.widget('auto-round').textContent,/item 4 de 8/);
});

test('manual reconnection cancels delayed automatic reconnection and keeps paused mode paused',async()=>{
 const h=await browserHarness();
 h.click('auto-disconnect');
 assert.equal([...h.timers.values()][0].delay,3000);
 h.click('auto-reconnect');
 assert.equal(h.timers.size,0);
 assert.match(h.widget('auto-health').textContent,/ativa/);
 assert.match(h.widget('auto-mode').textContent,/Iniciar/);
 assert.match(h.widget('auto-round').textContent,/Rodada 1 · item 1 de 8/);
});

test('new recovery notices stay beside the buttons and are not real player operations',()=>{
 const html=fs.readFileSync('commercial-tv-auto-bench.html','utf8');
 const js=fs.readFileSync('commercial-tv-auto-ui.mjs','utf8');
 assert.match(html,/id="auto-feedback"/);
 assert.match(html,/role="status" aria-live="polite"/);
 assert.match(html,/reconecta automaticamente após cerca de 3 segundos/);
 assert.match(js,/reconnectTimer=setTimeout/);
 assert.match(js,/rebootTimer=setTimeout/);
 assert.match(js,/resumeAfterRecovery/);
 assert.doesNotMatch(js,/fetch\(|createClient\(|localStorage|sessionStorage|\.supabase\.co|service_role/);
});
