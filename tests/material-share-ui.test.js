import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('async function shareMaterial(id,channel)'),source.indexOf('async function openMaterial'));
function harness({native=false,ok=true,phone='919876543210'}={}) {
 const result={nodes:{modalFields:{insertAdjacentHTML(){}},shareMaterialFile:{},fileShareStatus:{}}};
 const context={mutate:async(action,payload)=>{result.tracking={action,payload};},File,URL,location:{origin:'https://example.test'},S:{materials:[{id:'m',title:'HR handbook',format:'PDF',originalName:'handbook.pdf'}]},current:()=>({id:'t',name:'Test trainee',phone}),materialDownload:()=>'/api/material?id=m&traineeId=t',esc:x=>String(x),fetch:async url=>{result.fetch=url;return {ok,blob:async()=>new Blob(['original'])};},navigator:native?{canShare:()=>true,share:async value=>{result.shared=value;}}:{},modal:(title,html)=>{result.html=html;},$:id=>result.nodes[id]};
 vm.createContext(context);vm.runInContext(fn,context);return {result,run:()=>context.shareMaterial('m','whatsapp')};
}
test('file sharing uses authenticated original and requires an explicit second click',async()=>{
 const {result,run}=harness({native:true});await run();assert.match(result.fetch,/^\/api\/material\?/);assert.equal(result.shared,undefined);assert.equal(result.tracking.action,'materialShareStatus');assert.equal(result.tracking.payload.status,'prepared');assert.match(result.html,/Share document/);
 await result.nodes.shareMaterialFile.onclick();assert.equal(result.shared.files[0].name,'handbook.pdf');assert.equal(await result.shared.files[0].text(),'original');assert.equal(result.shared.files[0].type,'application/pdf');
});
test('unsupported browsers offer download plus the correct trainee WhatsApp chat',async()=>{
 const {result,run}=harness();await run();assert.match(result.html,/cannot attach files directly/);assert.match(result.html,/https:\/\/wa.me\/919876543210\?text=/);assert.match(result.html,/Download document/);assert.doesNotMatch(result.html,/material-share/);
});
test('missing phone or revoked access does not prepare a share',async()=>{
 const missing=harness({phone:''});await assert.rejects(missing.run,/WhatsApp number/);assert.equal(missing.result.fetch,undefined);
 const revoked=harness({ok:false});await assert.rejects(revoked.run,/Check trainer approval/);assert.equal(revoked.result.html,undefined);
});
test('WhatsApp action opens the document sharing flow instead of a chat-only link',()=>{
 const c=vm.createContext({button:(label,action,attrs)=>`<button data-action="${action}" ${attrs}>${label}</button>`});vm.runInContext(source.slice(source.indexOf('function moduleWhatsAppLinks'),source.indexOf('async function shareMaterial')),c);
 const html=c.moduleWhatsAppLinks({id:'m',title:'HR handbook'},{name:'Demo',phone:'919876543210'});
 assert.match(html,/data-action="shareMaterial"/);assert.match(html,/data-id="m"/);assert.doesNotMatch(html,/href=/);
});
test('library search review can explicitly approve an eligible selected trainee',async()=>{
 let save,label,selection,mutation;
 const c=vm.createContext({current:()=>null,S:{trainees:[{id:'allowed',name:'Demo',designation:'BM',materialIds:['m']},{id:'excluded',materialIds:[]}]},api:async()=>({id:'m',title:'Module',format:'PDF',blocks:[]}),field:(key,title,value,type,opts)=>{selection=opts;return '';},esc:x=>x,materialDownload:()=>'',modal:(title,html,callback,button)=>{save=callback;label=button;},mutate:async(a,p)=>{mutation={a,p};}});
 vm.runInContext(source.slice(source.indexOf('async function openMaterial'),source.indexOf('function academyView')),c);
 await c.openMaterial('m',true);assert.equal(label,'Approve for selected trainee');assert.equal(selection.length,1);assert.equal(selection[0][0],'allowed');assert.equal(mutation,undefined);
 await save({approvalTrainee:'allowed'});assert.equal(mutation.a,'approveMaterial');assert.equal(mutation.p.traineeId,'allowed');assert.equal(mutation.p.approved,true);
});
