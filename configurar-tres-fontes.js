/* QA-only helper: generate a separate visual link from three unrelated public JSON sources. */
(() => {
  'use strict';
  const form=document.getElementById('three-source-form');
  if(!form)return;
  const fields=[1,2,3].map(i=>document.getElementById('three-api-'+i));
  const output=document.getElementById('three-output');
  const urlField=document.getElementById('three-viewer-url');
  const preview=document.getElementById('three-preview');
  const error=document.getElementById('three-error');
  const clipboardStatus=document.getElementById('three-copy-status');
  const localDefault=new URL('./informativo-demo.json',location.href).href;
  const blocked=/^(?:key|api_?key|token|access_?token|secret|password|authorization)$/i;
  const privateIp=/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

  function parsePublicUrl(raw){
    if(typeof raw!=='string'||!raw.trim()||raw.length>1500)throw new Error('Preencha as três URLs.');
    let url;
    try{url=new URL(raw.trim())}catch{throw new Error('URL inválida: use endereço completo HTTPS.')}
    if(url.username||url.password||url.hash)throw new Error('Não informe usuário, senha ou fragmento.');
    const sameOrigin=url.origin===location.origin;
    if(url.protocol!=='https:'&&!(sameOrigin&&url.protocol==='http:'))
      throw new Error('Somente endereços HTTPS públicos são aceitos.');
    if(!sameOrigin&&(url.hostname==='localhost'||url.hostname.endsWith('.local')||privateIp.test(url.hostname)))
      throw new Error('Use uma fonte pública, não uma rede privada.');
    for(const name of url.searchParams.keys())if(blocked.test(name))
      throw new Error('Não coloque tokens ou credenciais na URL.');
    return url.href;
  }
  function generate(){
    const sources=fields.map(x=>parsePublicUrl(x.value));
    const page=new URL('./json-trio.html',location.href);
    sources.forEach((source,i)=>page.searchParams.set('s'+(i+1),source));
    return page.href;
  }
  form.addEventListener('submit',event=>{
    event.preventDefault();
    error.textContent='';
    clipboardStatus.textContent='';
    try{
      const href=generate();
      urlField.value=href;
      preview.href=href;
      output.hidden=false;
    }catch(e){
      output.hidden=true;
      error.textContent=String(e?.message||e);
    }
  });
  document.getElementById('three-copy').addEventListener('click',async()=>{
    if(!urlField.value)return;
    try{
      await navigator.clipboard.writeText(urlField.value);
      clipboardStatus.textContent='URL copiada. Adicione como mídia online de teste.';
    }catch{
      urlField.focus();urlField.select();
      clipboardStatus.textContent='Selecione e copie a URL acima.';
    }
  });
  // Use only illustrative information; do not auto-query external endpoints.
  fields.forEach((field,i)=>{field.value=new URL('./exemplo-canal-'+(i+1)+'.json',location.href).href;});
})();
