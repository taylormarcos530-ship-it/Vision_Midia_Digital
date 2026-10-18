/** Fictional actors, tenants, TVs and library items. Never use real customer identifiers. */
export const companies = Object.freeze([
  {id:'demo-butcher',name:'Açougue Demonstrativo',active:true},
  {id:'demo-bakery',name:'Padaria Demonstrativa',active:true},
]);
export const members = Object.freeze([
  {actorId:'owner-butcher',companyId:'demo-butcher',role:'owner',active:true},
  {actorId:'viewer-butcher',companyId:'demo-butcher',role:'viewer',active:true},
  {actorId:'owner-bakery',companyId:'demo-bakery',role:'owner',active:true},
]);
export const devices = Object.freeze([
  {id:'tv-butcher-free',companyId:'demo-butcher',name:'TV Teste — sem programação',active:true},
  {id:'tv-butcher-playlist',companyId:'demo-butcher',name:'TV Teste — com playlist protegida',active:true,basePlaylistId:'playlist-protected'},
  {id:'tv-butcher-ads',companyId:'demo-butcher',name:'TV Teste — com anúncios protegidos',active:true,commercialActive:true},
  {id:'tv-bakery-free',companyId:'demo-bakery',name:'TV de outra empresa (isolada)',active:true},
]);
export const mediaAssets = Object.freeze([
  {id:'video-butcher-demo',companyId:'demo-butcher',type:'video',name:'Vídeo fictício do açougue'},
  {id:'video-bakery-demo',companyId:'demo-bakery',type:'video',name:'Vídeo fictício da padaria'},
]);
