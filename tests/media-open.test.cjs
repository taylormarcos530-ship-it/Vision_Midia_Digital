const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');const start=src.indexOf('  async function openMedia('),fn=src.slice(start,src.indexOf('\n  }',start)+4);
for(const type of ['image','video'])test(type+' preview opens inside panel before URL resolves',async()=>{
 let resolve,opened=false,created;const dialog={dataset:{},open:false},content={replaceChildren(e){this.child=e}},status={},title={};
 const c=vm.createContext({state:{media:[{id:'m',name:'Media',media_type:type,storage_path:'x'}]},$:id=>({'#media-preview-dialog':dialog,'#media-preview-content':content,'#media-preview-status':status,'#media-preview-title':title}[id]),openDialog(){opened=true;dialog.open=true},document:{createElement(tag){created={tag,addEventListener(){}};return created}},getSignedMediaUrl:()=>new Promise(r=>resolve=r)});vm.runInContext(fn,c);
 const p=c.openMedia('m');assert.equal(opened,true);resolve('https://example.com/media');await p;assert.equal(content.child.src,'https://example.com/media');assert.equal(created.tag,type==='image'?'img':'video');if(type==='video'){assert.equal(created.controls,true);assert.equal(created.playsInline,true);}
});
