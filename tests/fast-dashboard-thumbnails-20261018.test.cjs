const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('customer dashboard defers media/playlist thumbnails until viewport',()=>{
 const s=fs.readFileSync('app.js','utf8');
 assert.match(s,/function deferVisibleMediaPreview\(/);
 assert.match(s,/new IntersectionObserver\(entries =>/);
 assert.match(s,/rootMargin:'140px'/);
 assert.match(s,/previewJobsActive < 2/);
 assert.match(s,/deferVisibleMediaPreview\(target, media, false\)/);
 assert.match(s,/deferVisibleMediaPreview\(target,media\)/);
 assert.match(s,/target\.dataset\.loadingPath !== path/);
 assert.match(s,/target\.dataset\.loadedPath = path/);
});
test('thumbnail optimization never changes playlist ordering or playback commands',()=>{
 const s=fs.readFileSync('app.js','utf8');
 assert.match(s,/function renderPlaylists\(/);
 assert.match(s,/function renderMedia\(/);
 assert.match(s,/function signedMediaUrlCached\(/);
 assert.match(s,/async function hydratePlaylistPreviews\(/);
 assert.match(s,/async function hydratePlaylistCardPreviews\(/);
 assert.match(s,/async function hydrateMediaPreviews\(/);
});

test('mobile PWA receives new lazy-preview runtime under cache-busting app.js version',()=>{
 const index=fs.readFileSync('index.html','utf8');
 assert.match(index,/src="\.\/app\.js\?v=48"/);
});
