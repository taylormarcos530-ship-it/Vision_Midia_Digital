const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');const start=src.indexOf('  async function openMedia('),fn=src.slice(start,src.indexOf('\n  }',start)+4);
test('uploaded media opens tab before asynchronous signed URL resolves',async()=>{
 let resolve,opened=false,replaced=null;const page={opener:{},location:{replace:u=>replaced=u},close(){}};
 const c=vm.createContext({state:{media:[{id:'m',media_type:'image',storage_path:'x'}]},window:{open(){opened=true;return page}},getSignedMediaUrl:()=>new Promise(r=>resolve=r),toast(){}});vm.runInContext(fn,c);const pending=c.openMedia('m');assert.equal(opened,true);resolve('https://example.com/image');await pending;assert.equal(replaced,'https://example.com/image');assert.equal(page.opener,null);
});
