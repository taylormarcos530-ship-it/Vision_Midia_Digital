const C={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers':'content-type',
}
const UPSTREAM='https://raw.githubusercontent.com/taylormarcos530-ship-it/Vision_Midia_Digital/fix/saas-media-playlist-device-controls/downloads/Vision-Player-preview.apk'
const EXPECTED_SHA256='a76f88bbc9b9bff03cba7e04dac1a00bdc41fc358d4cc30fe6ad55882c17877d'

function hex(bytes:ArrayBuffer){
  return Array.from(new Uint8Array(bytes)).map(v=>v.toString(16).padStart(2,'0')).join('')
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:C})
  if(!['GET','HEAD'].includes(req.method))return new Response('method_not_allowed',{status:405,headers:C})
  try{
    const upstream=await fetch(UPSTREAM,{headers:{'Cache-Control':'no-cache'}})
    if(!upstream.ok)throw new Error(`upstream_${upstream.status}`)
    const bytes=await upstream.arrayBuffer()
    const digest=hex(await crypto.subtle.digest('SHA-256',bytes))
    if(digest!==EXPECTED_SHA256)throw new Error('apk_sha256_mismatch')
    const headers={
      ...C,
      'Content-Type':'application/vnd.android.package-archive',
      'Content-Disposition':'attachment; filename="Vision-Player-TVBox-preview.apk"',
      'Content-Length':String(bytes.byteLength),
      'Cache-Control':'no-store, max-age=0',
      'X-Vision-APK-SHA256':EXPECTED_SHA256,
      'X-Content-Type-Options':'nosniff',
    }
    if(req.method==='HEAD')return new Response(null,{status:200,headers})
    return new Response(bytes,{status:200,headers})
  }catch(error){
    console.error('player-apk-download',error)
    return new Response(JSON.stringify({error:String(error?.message||'download_failed')}),{
      status:502,
      headers:{...C,'Content-Type':'application/json','Cache-Control':'no-store'},
    })
  }
})
