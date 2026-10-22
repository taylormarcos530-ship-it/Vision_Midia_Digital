(()=>{
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={points:[],whatsapp:'',ready:false,plans:[]};
const fake=new URLSearchParams(location.search).get('demo')==='1';
const demoPoints=[{id:'demo-life',slug:'academia-life-exemplo',name:'Academia Life — exemplo',category:'Academia',
  city:'Anápolis',neighborhood:'A cadastrar',address:'',hours:'A cadastrar',tv_count:2,
  tvs:[{size_inches:null,orientation:'portrait',placement:''},{size_inches:null,orientation:'landscape',placement:''}],
  estimated_daily_visitors:null,photos:[]}];
function setStatus(message,error=false){const el=$('#state');el.textContent=message;el.className='notice'+(error?' error':'');el.hidden=false;}
function priceString(cents){
 return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100);
}
function formatWhatsApp(number,point,plan=null){
 let digits=String(number||'').replace(/\D/g,'');
 if(digits.length===11||digits.length===10)digits='55'+digits;
 if(!/^55\d{10,11}$/.test(digits))return '';
 const text=plan
  ?'Olá, Vision Mídia Digital! Quero anunciar minha empresa.\n\nPonto escolhido: '+point.name+
   '\nLocal: '+[point.neighborhood,point.city].filter(Boolean).join(' - ')+
   '\nPlano escolhido: '+plan.title+
   '\nValor informado: '+priceString(plan.price_cents)+
   (plan.description?'\nDetalhes: '+plan.description:'')+
   '\n\nGostaria de confirmar a disponibilidade e receber as instruções para pagamento.'
  :'Olá! Gostaria de saber como anunciar minha empresa no ponto '+point.name+' da Rede Vision.';
 return 'https://wa.me/'+digits+'?text='+encodeURIComponent(text);
}
function selectFilters(){
 for(const [id,key] of [['city','city'],['category','category']]){
  const items=[...new Set(state.points.map(p=>p[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  $(id).replaceChildren(new Option(id==='city'?'Todas as cidades':'Todas as categorias',''),...items.map(v=>new Option(v,v)));
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
   (state.plans.length?'<div class="starting-price">Planos a partir de <strong>'+priceString(Math.min(...state.plans.map(x=>x.price_cents)))+'</strong></div>':'')+
   '<div class="facts"><span>📺 '+esc(p.tv_count)+' TV'+(p.tv_count===1?'':'s')+'</span>'+
   (p.estimated_daily_visitors!=null?'<span>👥 ~'+Number(p.estimated_daily_visitors).toLocaleString('pt-BR')+'/dia</span>':'')+'</div>'+
   '<button class="button secondary" data-open="'+esc(p.slug)+'" type="button">Ver informações do ponto →</button></div></article>').join('');
 if(!points.length){setStatus(state.points.length?'Nenhum ponto corresponde aos filtros.':'Ainda não há pontos públicos cadastrados. Volte para conferir as próximas novidades.');}
 else{$('#state').hidden=true;}
}
function openPoint(slug){
 const p=state.points.find(p=>p.slug===slug);if(!p)return;
 $('#detail-title').textContent=p.name;
 const gallery=(p.photos||[]).length?'<div class="gallery">'+p.photos.map((src,i)=>'<img src="'+esc(src)+'" alt="Foto '+(i+1)+' do ponto '+esc(p.name)+'" loading="lazy">').join('')+'</div>':'';
 const tvs=(p.tvs||[]).map((t,i)=>'<li>TV '+(i+1)+' — '+(t.size_inches?esc(t.size_inches)+' polegadas':'tamanho a confirmar')+
   (t.placement?' · '+esc(t.placement):'')+
   (t.orientation&&t.orientation!=='auto'?' · '+esc(t.orientation==='portrait'?'vertical':'horizontal'):'')+'</li>').join('');
 const whatsapp=formatWhatsApp(state.whatsapp,p);
 const validPlans=state.plans.filter(plan=>Number.isInteger(plan.slot)&&Number.isInteger(plan.price_cents)&&plan.price_cents>0);
 const plansMarkup=validPlans.length?
  '<section class="pick-plan"><h3>Escolha seu plano para anunciar</h3><p class="muted mini">Selecione uma opção. Você será encaminhado ao WhatsApp para confirmar a contratação e o pagamento.</p>'+
  '<div class="pick-plan-options">'+validPlans.map(plan=>
    '<label class="pick-plan-card"><input type="radio" name="chosen-plan" value="'+plan.slot+'">'+
    '<span class="pick-plan-details"><strong>'+esc(plan.title)+'</strong>'+
    (plan.description?'<small>'+esc(plan.description)+'</small>':'')+'</span>'+
    '<b>'+esc(priceString(plan.price_cents))+'</b></label>').join('')+'</div>'+
  '<p id="plan-choice-status" class="small-note" role="status">Selecione um plano para continuar.</p></section>':'';
 const contactMarkup=validPlans.length
  ?(state.whatsapp?'<a id="chosen-plan-whatsapp" class="button good is-disabled" aria-disabled="true" tabindex="-1" href="#" rel="noopener noreferrer" target="_blank">Selecione um plano para continuar ↗</a>':
      '<div class="notice">WhatsApp comercial não configurado no momento.</div>')
  :(whatsapp?'<a class="button good" href="'+esc(whatsapp)+'" rel="noopener noreferrer" target="_blank">Quero anunciar neste ponto ↗</a>':
      '<div class="notice">Contato comercial ainda não configurado. Consulte a Vision Mídia Digital.</div>');

 $('#detail-content').innerHTML='<span class="chip">'+esc(p.category)+'</span>'+gallery+
  '<table class="details-table"><tbody>'+
  '<tr><td>Localização</td><td>'+esc([p.neighborhood,p.city].filter(Boolean).join(' · '))+(p.address?'<div>'+esc(p.address)+'</div>':'')+'</td></tr>'+
  '<tr><td>Funcionamento</td><td><div class="hours-public">'+esc(p.hours||'Consulte a Vision')+'</div></td></tr>'+
  '<tr><td>Quantidade de TVs</td><td>'+esc(p.tv_count)+'</td></tr>'+
  '<tr><td>Telas</td><td><ul>'+tvs+'</ul></td></tr>'+
  '<tr><td>Fluxo diário estimado</td><td>'+(p.estimated_daily_visitors!=null?'Aproximadamente '+Number(p.estimated_daily_visitors).toLocaleString('pt-BR')+' pessoas':'Não informado')+'</td></tr>'+
  '</tbody></table>'+
  '<p class="small-note">Estimativas não representam audiência garantida nem medição certificada.</p>'+
  plansMarkup+contactMarkup;
 const selection=$('#detail-content');
 selection.querySelectorAll('input[name="chosen-plan"]').forEach(input=>input.addEventListener('change',()=>{
  const plan=validPlans.find(v=>v.slot===Number(input.value));
  const target=selection.querySelector('#chosen-plan-whatsapp');
  if(!plan||!target)return;
  const url=formatWhatsApp(state.whatsapp,p,plan);
  if(!url)return;
  target.href=url;target.textContent='Solicitar '+plan.title+' pelo WhatsApp ↗';
  target.classList.remove('is-disabled');target.removeAttribute('aria-disabled');target.removeAttribute('tabindex');
  const status=selection.querySelector('#plan-choice-status');if(status)status.textContent='Selecionado: '+plan.title+' · '+priceString(plan.price_cents);
 }));
 const a=selection.querySelector('#chosen-plan-whatsapp');
 if(a)a.addEventListener('click',event=>{if(a.getAttribute('aria-disabled')==='true')event.preventDefault()});
 $('#point-dialog').showModal();
 history.replaceState(null,'',new URL(location.href).pathname+'?ponto='+encodeURIComponent(p.slug)+(fake?'&demo=1':''));
}
async function load(){
 if(fake){state.points=demoPoints;state.whatsapp='';state.plans=[
 {slot:1,title:'7 dias — exemplo',description:'Divulgação durante 7 dias (valor ilustrativo)',price_cents:3500},
 {slot:2,title:'15 dias — exemplo',description:'Divulgação durante 15 dias (valor ilustrativo)',price_cents:6000},
 {slot:3,title:'30 dias — exemplo',description:'Divulgação durante 30 dias (valor ilustrativo)',price_cents:10000}
 ];state.ready=true;selectFilters();render();$('#demo-note').textContent='Demonstração: valores ilustrativos. Não há solicitação nem pagamento.';return;}
 try{
  const cfg=window.VISION_CONFIG||{};
  if(!cfg.supabaseUrl||!cfg.supabasePublishableKey)throw Error('Configuração pública indisponível');
  const response=await fetch(cfg.supabaseUrl+'/functions/v1/vision-network-points',{method:'POST',
   headers:{apikey:cfg.supabasePublishableKey,'Content-Type':'application/json'},
   body:JSON.stringify({action:'public_list'}),cache:'no-store'});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||'Catálogo indisponível');
  state.points=Array.isArray(data.points)?data.points:[];
  state.whatsapp=String(data.whatsapp||'');
  state.plans=(Array.isArray(data.plans)?data.plans:[]).map(plan=>({...plan,slot:Number(plan.slot),price_cents:Number(plan.price_cents)}))
   .filter(plan=>Number.isInteger(plan.slot)&&plan.slot>=1&&plan.slot<=3&&Number.isInteger(plan.price_cents)&&plan.price_cents>0);
  state.ready=true;selectFilters();render();
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
$('#close-dialog').addEventListener('click',()=>$('#point-dialog').close());
$('#point-dialog').addEventListener('click',event=>{if(event.target===$('#point-dialog'))$('#point-dialog').close()});
load();
})();