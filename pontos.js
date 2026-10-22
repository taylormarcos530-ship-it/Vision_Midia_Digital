(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={points:[],plans:[],addons:[],whatsapp:'',ready:false,openedPoint:null};
const fake=new URLSearchParams(location.search).get('demo')==='1';
const demoPoints=[{id:'demo-life',slug:'academia-life-exemplo',name:'Academia Life — exemplo',category:'Academia',
  city:'Anápolis',neighborhood:'A cadastrar',address:'',hours:'A cadastrar',tv_count:2,
  tvs:[{size_inches:null,orientation:'portrait',placement:''},{size_inches:null,orientation:'landscape',placement:''}],
  estimated_daily_visitors:null,photos:[]}];
const demoPlans=[
 {slot:1,name:'Plano 1 — exemplo',description:'Oferta demonstrativa. Valores não publicados.',price_cents:3500},
 {slot:2,name:'Plano 2 — exemplo',description:'Oferta demonstrativa. Valores não publicados.',price_cents:6000},
 {slot:3,name:'Plano 3 — exemplo',description:'Oferta demonstrativa. Valores não publicados.',price_cents:10000}
];
function setStatus(message,error=false){const el=$('#state');el.textContent=message;el.className='notice'+(error?' error':'');el.hidden=false;}
const formatBRL=centavos=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(centavos)/100);
function planDays(plan){
 // Plans in the existing Master already store "Duração: N dias" in their
 // descriptions. Never guess a duration from a price or a marketing name.
 const match=String(plan?.description||'').match(/Dura(?:ç|c)[ãa]o:\s*(\d{1,3})\s*dias?/i);
 return match&&Number(match[1])>0?Number(match[1]):null;
}
function sumOrder(plan,addons){
 const price=Number(plan?.price_cents);
 if(!Number.isSafeInteger(price)||price<0)throw Error('Valor do plano inválido.');
 return (addons||[]).reduce((sum,a)=>{
  const cents=Number(a.price_cents);
  if(!Number.isSafeInteger(cents)||cents<0||sum+cents>100000000)throw Error('Valor adicional inválido.');
  return sum+cents;
 },price);
}
function formatWhatsApp(number,point,plan=null,addons=[]){
 let digits=String(number||'').replace(/\D/g,'');
 if(digits.length===11||digits.length===10)digits='55'+digits;
 if(!/^55\d{10,11}$/.test(digits))return '';
 let text;
 if(!plan)text='Olá! Gostaria de saber como anunciar minha empresa no ponto '+point.name+' da Rede Vision.';
 else {
  const duration=planDays(plan);
  const parts=[
   'Olá! Quero anunciar minha empresa pela Vision Mídia Digital.',
   '📍 Estabelecimento: '+point.name+' ('+[point.neighborhood,point.city].filter(Boolean).join(' / ')+')',
   '📺 Plano: '+plan.name,
   '📅 Duração: '+(duration?duration+' dias':'A confirmar com a Vision'),
   '💰 Valor do plano: '+formatBRL(plan.price_cents)
  ];
  (addons||[]).forEach(a=>parts.push('🎬 '+a.name+': '+formatBRL(a.price_cents)));
  parts.push('💵 Total: '+formatBRL(sumOrder(plan,addons)));
  parts.push('Gostaria de finalizar minha contratação.');
  text=parts.join('\n\n');
 }
 return 'https://wa.me/'+digits+'?text='+encodeURIComponent(text);
}
function eligibleAddons(plan){
 return state.addons.filter(a=>a&&Array.isArray(a.eligible_plan_slots)&&
  a.eligible_plan_slots.includes(Number(plan.slot))&&
  Number.isInteger(a.price_cents)&&a.price_cents>=0);
}
function renderOrder(){
 const point=state.openedPoint;
 const radio=$('#point-dialog input[name="offer_slot"]:checked');
 const plan=state.plans.find(p=>String(p.slot)===radio?.value);
 const section=$('#upsell-section'),summary=$('#order-summary'),button=$('#request-plan');
 if(!point||!plan||!summary)return;
 const picked=eligibleAddons(plan);
 const checks=[...$('#point-dialog').querySelectorAll('input[name="addon_id"]:checked')];
 const addOns=picked.filter(a=>checks.some(box=>box.value===a.id));
 const days=planDays(plan);
 const lines=[
  '<div><span>Estabelecimento</span><strong>'+esc(point.name)+'</strong></div>',
  '<div><span>Plano</span><strong>'+esc(plan.name)+'</strong></div>',
  '<div><span>Duração</span><strong>'+esc(days?days+' dias':'A confirmar')+'</strong></div>',
  '<div><span>Valor do plano</span><strong>'+esc(formatBRL(plan.price_cents))+'</strong></div>'
 ];
 addOns.forEach(a=>lines.push('<div><span>'+esc(a.name)+'</span><strong>'+esc(formatBRL(a.price_cents))+'</strong></div>'));
 const total=sumOrder(plan,addOns);
 lines.push('<div class="order-total"><span>Total</span><strong>'+esc(formatBRL(total))+'</strong></div>');
 summary.innerHTML=lines.join('');
 summary.hidden=false;
 if(section)section.hidden=!picked.length;
 if(button){
  const url=formatWhatsApp(state.whatsapp,point,plan,addOns);
  if(url){button.href=url;button.target='_blank';button.rel='noopener noreferrer';button.classList.remove('is-disabled');button.removeAttribute('aria-disabled');button.removeAttribute('tabindex');button.textContent='FINALIZAR PELO WHATSAPP';}
  else{button.removeAttribute('href');button.textContent='WhatsApp comercial indisponível';button.classList.add('is-disabled');button.setAttribute('aria-disabled','true');button.setAttribute('tabindex','-1');}
 }
}
function showUpsellsForPlan(plan){
 const section=$('#upsell-section'),root=$('#addon-choices');
 if(!section||!root)return;
 const addons=eligibleAddons(plan).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order));
 // Re-create checkboxes on every plan change: never carry implicit consent.
 root.innerHTML=addons.map(a=>'<label class="addon-choice">'+
  '<input type="checkbox" name="addon_id" value="'+esc(a.id)+'">'+
  '<span><strong>'+esc(a.name)+'</strong><small>'+esc(a.description||'').replace(/\n/g,'<br>')+'</small></span>'+
  '<b>+'+esc(formatBRL(a.price_cents))+'</b></label>').join('');
 section.hidden=!addons.length;
 renderOrder();
}
function selectFilters(){
 for(const [id,key] of [['city','city'],['category','category']]){
  const items=[...new Set(state.points.map(p=>p[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  $('#'+id).replaceChildren(new Option(id==='city'?'Todas as cidades':'Todas as categorias',''),...items.map(v=>new Option(v,v)));
 }
}
function filtered(){
 const needle=$('#search').value.trim().toLocaleLowerCase('pt-BR');
 return state.points.filter(p=>(!$('#city').value||p.city===$('#city').value)&&
  (!$('#category').value||p.category===$('#category').value)&&
  (!needle||[p.name,p.neighborhood,p.category,p.city].some(v=>String(v||'').toLocaleLowerCase('pt-BR').includes(needle))));
}
function render(){
 const points=filtered();const grid=$('#point-grid');
 grid.innerHTML=points.map(p=>'<article class="point">'+
   '<div class="photo'+(p.photos?.[0]?'':' placeholder')+'">'+
   (p.photos?.[0]?'<img alt="Foto do estabelecimento '+esc(p.name)+'" src="'+esc(p.photos[0])+'" loading="lazy">':'▣')+'</div>'+
   '<div class="inner"><span class="chip">'+esc(p.category)+'</span><h2>'+esc(p.name)+'</h2>'+
   '<div class="mini muted">📍 '+esc([p.neighborhood,p.city].filter(Boolean).join(' · '))+'</div>'+
   '<div class="facts"><span>📺 '+esc(p.tv_count)+' TV'+(p.tv_count===1?'':'s')+'</span>'+
   (p.estimated_daily_visitors!=null?'<span>👥 ~'+Number(p.estimated_daily_visitors).toLocaleString('pt-BR')+'/dia</span>':'')+'</div>'+
   '<button class="button secondary" data-open="'+esc(p.slug)+'" type="button">Ver informações do ponto →</button></div></article>').join('');
 if(!points.length){setStatus(state.points.length?'Nenhum ponto corresponde aos filtros.':'Ainda não há pontos públicos cadastrados. Volte para conferir as próximas novidades.');}
 else{$('#state').hidden=true;}
}
function openPoint(slug){
 const p=state.points.find(p=>p.slug===slug);if(!p)return;
 state.openedPoint=p;
 $('#detail-title').textContent=p.name;
 const gallery=(p.photos||[]).length?'<div class="gallery">'+p.photos.map((src,i)=>'<img src="'+esc(src)+'" alt="Foto '+(i+1)+' do ponto '+esc(p.name)+'" loading="lazy">').join('')+'</div>':'';
 const tvs=(p.tvs||[]).map((t,i)=>'<li>TV '+(i+1)+' — '+(t.size_inches?esc(t.size_inches)+' polegadas':'tamanho a confirmar')+
   (t.placement?' · '+esc(t.placement):'')+
   (t.orientation&&t.orientation!=='auto'?' · '+esc(t.orientation==='portrait'?'vertical':'horizontal'):'')+'</li>').join('');
 const whatsapp=formatWhatsApp(state.whatsapp,p);
 const plans=state.plans.filter(plan=>Number.isInteger(plan.price_cents)&&plan.price_cents>=0);
 const offerSelection=plans.length?'<section class="offers-public" aria-label="Escolha seu plano">'+
  '<h3>Escolha seu plano para anunciar</h3><p class="muted mini">Selecione uma opção. Você irá ao WhatsApp com o ponto, o plano e o valor já preenchidos para confirmar a contratação.</p>'+
  '<div class="offer-choices">'+plans.map(plan=>'<label class="offer-choice"><input type="radio" name="offer_slot" value="'+plan.slot+'">'+
    '<span class="offer-text"><strong>'+esc(plan.name)+'</strong><small>'+esc(plan.description)+'</small></span>'+
    '<b>'+esc(formatBRL(plan.price_cents))+'</b></label>').join('')+'</div>'+
  '<section id="upsell-section" class="upsell-public" hidden><h3>Destaque sua empresa com um vídeo profissional!</h3>'+
  '<p class="muted">Não tem um vídeo pronto? A Vision cria seu anúncio com inteligência artificial para você!</p>'+
  '<p class="small-note">Serviços adicionais opcionais. Nenhum serviço é incluído automaticamente.</p>'+
  '<div id="addon-choices" class="addon-choices"></div></section>'+
  '<section class="order-summary-section"><h3>Resumo da contratação</h3><div id="order-summary" class="order-summary" hidden></div></section>'+
  (whatsapp?'<a id="request-plan" class="button good is-disabled" aria-disabled="true" tabindex="-1">Selecione um plano</a>':
  '<p class="notice">WhatsApp comercial indisponível no momento.</p>')+
  '<p class="small-note">Pedido pelo WhatsApp. A disponibilidade e o pagamento são confirmados pela Vision.</p>'+
  '</section>':'';
 $('#detail-content').innerHTML='<span class="chip">'+esc(p.category)+'</span>'+gallery+
  '<table class="details-table"><tbody>'+
  '<tr><td>Localização</td><td>'+esc([p.neighborhood,p.city].filter(Boolean).join(' · '))+(p.address?'<div>'+esc(p.address)+'</div>':'')+'</td></tr>'+
  '<tr><td>Funcionamento</td><td><div class="hours-public">'+esc(p.hours||'Consulte a Vision')+'</div></td></tr>'+
  '<tr><td>Quantidade de TVs</td><td>'+esc(p.tv_count)+'</td></tr>'+
  '<tr><td>Telas</td><td><ul>'+tvs+'</ul></td></tr>'+
  '<tr><td>Fluxo diário estimado</td><td>'+(p.estimated_daily_visitors!=null?'Aproximadamente '+Number(p.estimated_daily_visitors).toLocaleString('pt-BR')+' pessoas':'Não informado')+'</td></tr>'+
  '</tbody></table>'+
  '<p class="small-note">Estimativas não representam audiência garantida nem medição certificada.</p>'+
  (plans.length?offerSelection:
    (whatsapp?'<a class="button good" href="'+esc(whatsapp)+'" rel="noopener noreferrer" target="_blank">Consultar planos neste ponto ↗</a>':
  '<div class="notice">Contato comercial ainda não configurado. Consulte a Vision Mídia Digital.</div>'));
 $('#point-dialog').showModal();
 history.replaceState(null,'',new URL(location.href).pathname+'?ponto='+encodeURIComponent(p.slug)+(fake?'&demo=1':''));
}
async function load(){
 if(fake){state.points=demoPoints;state.plans=demoPlans;state.addons=[];state.whatsapp='';state.ready=true;selectFilters();render();$('#demo-note').textContent='Demonstração ilustrativa: preços fictícios, sem solicitações.';return;}
 try{
  const cfg=window.VISION_CONFIG||{};
  if(!cfg.supabaseUrl||!cfg.supabasePublishableKey)throw Error('Configuração pública indisponível');
  const response=await fetch(cfg.supabaseUrl+'/functions/v1/vision-network-points',{method:'POST',
   headers:{apikey:cfg.supabasePublishableKey,'Content-Type':'application/json'},
   body:JSON.stringify({action:'public_list'}),cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Catálogo indisponível');
  state.points=Array.isArray(data.points)?data.points:[];
  state.plans=Array.isArray(data.plans)?data.plans.filter(p=>Number.isInteger(p.price_cents)&&p.price_cents>=0):[];
  state.addons=Array.isArray(data.addons)?data.addons.filter(a=>a&&typeof a.id==='string'&&
   Array.isArray(a.eligible_plan_slots)&&Number.isInteger(a.price_cents)&&a.price_cents>=0):[];
  state.whatsapp=String(data.whatsapp||'');state.ready=true;selectFilters();render();
  const selected=new URLSearchParams(location.search).get('ponto');
  if(selected)openPoint(selected);
 }catch(e){setStatus('O catálogo está temporariamente indisponível. Nenhuma informação privada será exibida.',true);}
}
$('#search').addEventListener('input',render);
$('#city').addEventListener('change',render);
$('#category').addEventListener('change',render);
$('#point-grid').addEventListener('click',e=>{
 const button=e.target.closest('[data-open]');if(button)openPoint(button.dataset.open);
});
$('#point-dialog').addEventListener('change',event=>{
 const radio=event.target.closest('input[name="offer_slot"]');
 if(radio){
  const plan=state.plans.find(p=>String(p.slot)===radio.value);
  if(plan)showUpsellsForPlan(plan);
  return;
 }
 if(event.target.matches('input[name="addon_id"]'))renderOrder();
});
$('#close-dialog').addEventListener('click',()=>$('#point-dialog').close());
$('#point-dialog').addEventListener('click',event=>{if(event.target===$('#point-dialog'))$('#point-dialog').close()});
load();
})();