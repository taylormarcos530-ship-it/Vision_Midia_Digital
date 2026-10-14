// Only for the isolated Supabase staging project. This is a public publishable key, NOT a secret key.
// Never use service_role, an existing customer account, or production URLs in this test page.
(function(){
  const preview=/^vision-midia-digital-[a-z0-9]+-vision-5529[.]vercel[.]app$/.test(location.hostname);
  const local=location.hostname==='localhost'||location.hostname==='127.0.0.1';
  const enabled=preview||local;
  window.VISION_COMMERCIAL_CONFIG=Object.freeze({
    environment:'staging',
    enabled,
    supabaseUrl:'https://jmiuitrrhtaeyrpuyohk.supabase.co',
    supabasePublishableKey:"sb_publishable_66GLHS8ZuH_x4elT_NQUbQ_jAd-jScu"
  });
})();
