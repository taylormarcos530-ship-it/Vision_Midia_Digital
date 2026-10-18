// Public, browser-safe publishable credential. Never store service_role/secret keys here.
(function(){
 const hostname=location.hostname;
 const official=hostname==='vision-midia-digital.vercel.app';
 const preview=/^vision-midia-digital-[a-z0-9]+-vision-5529\.vercel\.app$/.test(hostname);
 const local=hostname==='localhost'||hostname==='127.0.0.1';
 window.VISION_COMMERCIAL_CONFIG=Object.freeze({
  environment:'production',
  enabled:official||preview||local,
  supabaseUrl:'https://fpadgedrgcxrrqflzhjt.supabase.co',
  supabasePublishableKey:"sb_publishable_pSGsns390QFjOY4JHs-Xqw_bGrX_kCN"
 });
})();