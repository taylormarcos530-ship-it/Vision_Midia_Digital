// Vision QA — builds a URL for a generic HTML viewer without saving credentials.
(() => {
  'use strict';
  const form=document.getElementById('source-form');
  const api=document.getElementById('api-url');
  const output=document.getElementById('output');
  const viewer=document.getElementById('viewer-url');
  const preview=document.getElementById('preview-url');
  const error=document.getElementById('error');
  const copyStatus=document.getElementById('copy-status');

  function parsePublicSource(raw) {
    const value=String(raw||'').trim();
    if(value.length>1500)throw new Error('URL muito longa.');
    let parsed;
    try{parsed=new URL(value,location.href)}catch{throw new Error('Informe uma URL válida.')}
    const sameOrigin=parsed.origin===location.origin;
    if(parsed.protocol!=='https:'&&!(sameOrigin&&parsed.protocol==='http:'))
      throw new Error('Use uma URL HTTPS pública.');
    if(parsed.username||parsed.password||parsed.hash)
      throw new Error('Não utilize usuário, senha ou fragmentos na URL.');
    if(!sameOrigin && (parsed.hostname==='localhost'||parsed.hostname.endsWith('.local')||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)))
      throw new Error('A fonte deve estar publicada na internet.');
    for(const key of parsed.searchParams.keys()){
      if(/^(?:key|api_?key|token|access_?token|secret|password|authorization)$/i.test(key))
        throw new Error('Remova chaves privadas da URL.');
    }
    return parsed.href;
  }
  function buildPageUrl(source){
    const url=new URL('./json-feed.html',location.href);
    url.searchParams.set('source',source);
    return url.href;
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();error.textContent='';copyStatus.textContent='';
    try{
      const src=parsePublicSource(api.value);
      const url=buildPageUrl(src);
      viewer.value=url;preview.href=url;output.style.display='block';
    }catch(e){error.textContent=String(e?.message||e);output.style.display='none';}
  });
  document.getElementById('copy-url').addEventListener('click',async()=>{
    if(!viewer.value)return;
    try{
      await navigator.clipboard.writeText(viewer.value);
      copyStatus.textContent='URL copiada. Cole no campo URL em Adicionar ao vivo.';
    }catch{
      viewer.focus();viewer.select();
      copyStatus.textContent='Selecione e copie a URL acima.';
    }
  });
  api.value=new URL('./informativo-demo.json',location.href).href;
  // Explicit opt-in to avoid unexpectedly loading an external endpoint.
})();
