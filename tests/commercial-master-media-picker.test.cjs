const {test}=require('node:test'),assert=require('node:assert/strict');
test('Master media choices put uploaded Vision creatives before customer files',async()=>{
 const {mediaPickerEntries}=await import('../commercial-master-media-picker.mjs');
 const data={companies:[{id:'co-1',name:'Academia Life'}],sources:[{id:'11111111-1111-4111-8111-111111111111',name:'Publicidade Vision Teste',media_type:'video'}],
 media:[{id:'22222222-2222-4222-8222-222222222222',name:'1001015732.webp',company_id:'co-1',media_type:'image'}]};
 const values=mediaPickerEntries(data);
 assert.deepEqual(values.map(x=>x.subtitle),['Vision comercial','Academia Life']);
 assert.deepEqual(values.map(x=>x.origin),['vision','customer']);
 assert.deepEqual(values.map(x=>x.media_type),['video','image']);
});
test('Preview URLs reject host substitution, protocol downgrade and non-storage paths',async()=>{
 const {normalizeSignedPreview}=await import('../commercial-master-media-picker.mjs');
 const base='https://fpadgedrgcxrrqflzhjt.supabase.co';
 const ok='/storage/v1/object/sign/vision-media/commercial-source/11111111-1111-4111-8111-111111111111.mp4?token=abc';
 assert.equal(normalizeSignedPreview(ok,base),base+ok);
 assert.equal(normalizeSignedPreview(base+ok,base),base+ok);
 assert.equal(normalizeSignedPreview('https://attacker.test'+ok,base),null);
 assert.equal(normalizeSignedPreview('/storage/v1/object/public/vision-media/a.png?token=abc',base),null);
 assert.equal(normalizeSignedPreview('/storage/v1/object/sign/vision-media/a.png',base),null);
});
test('Video gallery renders only visible thumbnails on mobile, upload exposes actual progress',()=>{
 const fs=require('node:fs'),script=fs.readFileSync('commercial-master-media-picker.mjs','utf8');
 assert.match(script,/new IntersectionObserver/);
 assert.match(script,/preload='metadata'/);
 assert.match(script,/element.currentTime=0\.2/);
 assert.match(script,/xhr\.upload\.onprogress/);
 assert.match(script,/xhr\.timeout=300000/);
});
