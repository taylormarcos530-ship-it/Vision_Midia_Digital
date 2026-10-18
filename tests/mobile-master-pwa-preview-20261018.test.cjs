const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('mobile Master bars scroll without covering Plans heading',()=>{
 const css=fs.readFileSync('master.css','utf8');
 const html=fs.readFileSync('master.html','utf8');
 assert.match(css,/@media\(max-width:720px\)\s*\{\s*body:not\(\.master-embedded\) \.master-sidebar\{position:static;top:auto/);
 assert.match(css,/body:not\(\.master-embedded\) \.master-topbar\{position:static;top:auto;z-index:auto\}/);
 assert.match(html,/master\.css\?v=47/);
});
test('web PWA coalesces signed requests and preloads visible media carefully',()=>{
 const app=fs.readFileSync('app.js','utf8');
 const html=fs.readFileSync('index.html','utf8');
 assert.match(app,/const pendingMediaPreviewUrls = new Map\(\)/);
 assert.match(app,/if \(inflight\) return inflight/);
 assert.match(app,/pendingMediaPreviewUrls\.delete\(key\)/);
 assert.match(app,/previewJobsActive < 3/);
 assert.match(app,/rootMargin:'200px'/);
 assert.match(html,/app\.js\?v=51/);
 assert.match(html,/rel="preconnect" href="https:\/\/fpadgedrgcxrrqflzhjt\.supabase\.co"/);
});
test('web patch preserves other playback and offline entrypoints',()=>{
 const app=fs.readFileSync('app.js','utf8');
 assert.match(app,/function renderMedia\(/);
 assert.match(app,/function renderPlaylists\(/);
});
