// Offline bench TV: this module imports the actual *isolated* interleaving helper.
// It never creates a Supabase client, invokes the device gateway, or records playback.
import {commercialEligibility,interleave} from './supabase/functions/_shared/commercial.mjs';

export const benchDefaults=Object.freeze({baseCount:6,adCount:2,cycle:0,shuffle:false,single:false,scheduled:false,enabled:true});
const baseNames=['Troca de óleo','Suspensão','Escapamento','Freios','Motor','Revisão'];
const adNames=['Loja do João','Empresa B','Publicidade C','Publicidade D','Publicidade E'];

export function makeBenchPrimary(options={}){
 const o={...benchDefaults,...options};
 if(o.baseCount===0)return null; // TV has no assigned playlist. Remains "Aguardando playlist".
 const n=Math.max(1,Math.min(baseNames.length,Number(o.baseCount)||1));
 return {
  playlist:{id:'bench-playlist',name:'Auto Center — playlist fictícia',shuffle:!!o.shuffle,repeat_mode:o.single?'single':'all'},
  items:Array.from({length:n},(_,i)=>({
   id:'base-'+(i+1),
   media:{id:'base-media-'+(i+1),name:baseNames[i],type:'image'},
   schedule:{enabled:!!o.scheduled}
  }))
 };
}

export function makeBenchAds(count=2){
 const n=Math.max(0,Math.min(adNames.length,Number(count)||0));
 return Array.from({length:n},(_,i)=>({
  id:'commercial-'+(i+1),
  media:{id:'bench-ad-media-'+(i+1),name:adNames[i],type:'image'},
  schedule:{enabled:true},
  commercial:true
 }));
}

export function simulateBench(options={}){
 const o={...benchDefaults,...options};
 const original=makeBenchPrimary(o);
 const adverts=makeBenchAds(o.adCount);
 const reason=!o.enabled?'disabled':commercialEligibility(original);
 const cycle=Number.isSafeInteger(o.cycle)&&o.cycle>=0?o.cycle:0;
 const manifest=o.enabled?interleave(original,adverts,3,cycle):original;
 const items=manifest?.items||[];
 const included=items.filter(x=>x.commercial).length;
 const baseIDs=original?.items.map(x=>x.id)||[];
 const outputBaseIDs=items.filter(x=>!x.commercial).map(x=>x.id);
 if(JSON.stringify(baseIDs)!==JSON.stringify(outputBaseIDs))
  throw new Error('bench_base_playlist_modified');
 return {
  original,
  ads:adverts,
  items,
  cycle,
  selectedNames:items.filter(x=>x.commercial).map(x=>x.media.name),
  waitingNames:adverts.filter(ad=>!items.some(item=>item.id===ad.id)).map(x=>x.media.name),
  reason,
  status:!original?'Aguardando playlist':reason&&reason!=='disabled'?'Playlist original preservada':reason==='disabled'?'Camada comercial desligada':'Programação simulada',
  included,
  ignored:adverts.length-included,
  preserved:outputBaseIDs.length===baseIDs.length
 };
}

if(typeof document!=='undefined'&&document.getElementById('bench-form')){
 const form=document.getElementById('bench-form');
 const sequence=document.getElementById('bench-sequence');
 const status=document.getElementById('bench-status');
 const detail=document.getElementById('bench-details');
 const round=document.getElementById('bench-round');
 const waiting=document.getElementById('bench-waiting');
 const previous=document.getElementById('bench-prev-round');
 const next=document.getElementById('bench-next-round');
 const compatible=document.getElementById('bench-compatible');
 let cycle=0;
 const explanations={
  no_base_playlist:'TV sem playlist: nenhum anúncio pode iniciar sozinho.',
  shuffle_preserved:'Modo aleatório preservado; nenhum comercial foi inserido.',
  single_preserved:'Modo mídia única preservado; nenhum comercial foi inserido.',
  scheduled_base_preserved:'Agenda da mídia do estabelecimento preservada; nenhum comercial foi inserido.',
  disabled:'Camada comercial desligada; playlist original permanece.'
 };
 const render=()=>{
  const val=name=>form.elements.namedItem(name);
  const result=simulateBench({
   baseCount:Number(val('baseCount').value),adCount:Number(val('adCount').value),
   shuffle:val('shuffle').checked,single:val('single').checked,
   scheduled:val('scheduled').checked,enabled:val('enabled').checked,cycle
  });
  status.textContent=result.status;
  round.textContent='Rodada '+(result.cycle+1)+' — sequência simulada';
  previous.disabled=cycle===0;
  waiting.textContent=result.reason? 'Rodízio suspenso enquanto esta proteção estiver ativa.' :
   (result.waitingNames.length?'Aguardando próximas rodadas: '+result.waitingNames.join(', ')+'.':'Todos os anúncios elegíveis foram incluídos nesta rodada.');
  detail.textContent=(explanations[result.reason]||(
   'Mídias do estabelecimento: '+(result.original?.items.length||0)+
   ' · Comerciais incluídos: '+result.included+
   ' · Comerciais não incluídos neste ciclo: '+result.ignored+
   '. Nenhuma playlist é alterada.'
  ));
  sequence.replaceChildren();
  if(!result.items.length){
   const empty=document.createElement('p');
   empty.textContent='Aguardando playlist — nenhum comercial é exibido.';
   empty.className='bench-empty';
   sequence.append(empty);
   return;
  }
  result.items.forEach((item,index)=>{
   const card=document.createElement('div');
   card.className='bench-item'+(item.commercial?' commercial':'');
   const order=document.createElement('span');
   order.className='bench-order';order.textContent=String(index+1).padStart(2,'0');
   const type=document.createElement('small');
   type.textContent=item.commercial?'ANÚNCIO COMERCIAL — MASTER':'MÍDIA DO ESTABELECIMENTO';
   const name=document.createElement('strong');
   name.textContent=item.media.name;
   card.append(order,type,name);
   sequence.append(card);
  });
 };
 form.addEventListener('change',()=>{cycle=0;render()});
 previous.addEventListener('click',()=>{cycle=Math.max(0,cycle-1);render()});
 next.addEventListener('click',()=>{cycle=Math.min(100,cycle+1);render()});
 compatible.addEventListener('click',()=>{
  for(const name of ['shuffle','single','scheduled'])form.elements.namedItem(name).checked=false;
  form.elements.namedItem('enabled').checked=true;
  cycle=0;
  render();
 });
 render();
}
