import {prepareJourneyFixture} from './journey-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../store.js';
import {createApp} from '../server.js';
import {materials,materialApplies,normalizePhone,materialContent,materialFile} from '../training-materials.js';
test('all imported materials contain readable content and byte-exact original downloads',()=>{
 assert.equal(materials.length,46);
 for(const m of materials){assert.ok(materialContent(m.id).blocks.length);assert.equal(materialFile(m).length,m.bytes);}
});
test('designation and phone mapping is explicit and validated',()=>{
 const bm=materials.find(m=>m.group==='BM');assert.equal(materialApplies(bm,{designation:'Doctor'},{}),false);assert.equal(materialApplies(bm,{designation:'Custom BM'},{customDesignations:{'Custom BM':'Branch Manager'}}),true);
 const fdm=materials.find(m=>m.group==='FDM');assert.equal(materialApplies(fdm,{designation:'FDM'},{}),true);
 assert.equal(normalizePhone('98765 43210'),'919876543210');assert.equal(normalizePhone('+44 7700 900123'),'447700900123');assert.equal(normalizePhone(''),'');assert.throws(()=>normalizePhone('abc9876543210'));
});
test('even HR material requires per-trainee approval; trainer scope, revocation and phone persistence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gleuhr-materials-')),app=createApp({dataDir:dir,scheduler:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
 async function call(route,body,cookie){const r=await fetch(url+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():await r.arrayBuffer(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 let admin;const act=(action,payload={},cookie=admin)=>{prepareJourneyFixture(app,action,payload);return call('/api/action',{action,payload},cookie);};
 try{
 admin=(await call('/api/setup',{name:'HR',email:'admin@example.test',password:'test-password-long'})).cookie;
 const owner=(await act('createUser',{name:'Trainer',email:'trainer@example.test',password:'test-password-long'})).data;const trainer=(await call('/api/login',{email:owner.email,password:'test-password-long'})).cookie;
 const t=(await act('createTrainee',{name:'Material trainee',designation:'Branch Manager',ownerId:owner.id,phone:'98765 43210'})).data;assert.equal(t.phone,'919876543210');
 const source=materials.find(m=>m.format==='DOCX'),original=materialFile(source);
 const upload={phase:'Induction',title:'Uploaded handbook',designation:'Branch Manager',filename:'new-handbook.docx',base64:original.toString('base64')};
 assert.equal((await call('/api/action',{action:'uploadMaterial',payload:upload})).status,401);
 assert.equal((await act('uploadMaterial',{...upload,filename:'test.exe'},trainer)).status,400);
 assert.equal((await act('uploadMaterial',{...upload,base64:Buffer.from('not a document').toString('base64')},trainer)).status,400);
 const added=await act('uploadMaterial',upload,trainer);assert.equal(added.status,200);
 const up={traineeId:t.id,materialId:added.data.id};
 assert.equal((await act('materialContent',up,trainer)).status,403);
 assert.equal((await act('materialContent',{...up,review:true},trainer)).status,200);
 const uploadUrl=`/api/material?id=${up.materialId}&traineeId=${t.id}`;
 assert.equal((await call(uploadUrl,null,trainer)).status,403);
 await act('approveMaterial',{...up,approved:true},trainer);
 assert.deepEqual(Buffer.from((await call(uploadUrl,null,trainer)).data),original);
 assert.deepEqual(await openStore(dir).getMaterial(up.materialId),original);
 const loaded=(await act('state')).data;assert.ok(loaded.materials.some(m=>m.id===up.materialId));assert.ok(loaded.trainees.find(x=>x.id===t.id).materialIds.includes(up.materialId));
 assert.equal((await call(uploadUrl)).status,401);
 const pdf=materials.find(m=>m.format==='PDF');assert.equal((await act('uploadMaterial',{...upload,filename:'handbook.pdf',base64:materialFile(pdf).toString('base64')})).status,200);
 const hr=materials.find(m=>m.group==='HR'),doctor=materials.find(m=>m.roles[0]==='Doctor');
 let p={traineeId:t.id,materialId:hr.id};assert.equal((await act('materialContent',p,trainer)).status,403);assert.equal((await act('materialContent',{...p,review:true},trainer)).status,200);
 assert.equal((await call(`/api/material?id=${hr.id}&traineeId=${t.id}`,null,trainer)).status,403);
 assert.equal((await act('completeMaterial',{...p,complete:true},trainer)).status,403);
 assert.equal((await act('materialShareStatus',{...p,status:'confirmed',confirmed:true},trainer)).status,403);
 assert.equal((await act('approveMaterial',{...p,approved:true},trainer)).status,200);
 assert.equal((await act('materialContent',p,trainer)).status,200);
 const downloaded=await call(`/api/material?id=${hr.id}&traineeId=${t.id}`,null,trainer);assert.equal(downloaded.status,200);assert.equal(downloaded.data.byteLength,hr.bytes);
 assert.equal((await act('completeMaterial',{...p,complete:true},trainer)).status,200);
 assert.equal((await act('materialShareStatus',{...p,status:'confirmed'},trainer)).status,400);
 assert.equal((await act('materialShareStatus',{...p,status:'prepared'},trainer)).status,200);
 assert.equal((await act('materialShareStatus',{...p,status:'confirmed',confirmed:true},trainer)).status,200);
 await act('materialShareStatus',{...p,status:'prepared'},trainer);
 let shares=(await act('state')).data.trainees.find(x=>x.id===t.id).materialShares;
 assert.equal(shares.at(-1).status,'confirmed');assert.equal(shares.length,2);
 assert.equal(openStore(dir).data.trainees.find(x=>x.id===t.id).materialShares.at(-1).status,'confirmed');
 await act('materialShareStatus',{...p,status:'reset'},trainer);
 assert.equal((await act('state')).data.trainees.find(x=>x.id===t.id).materialShares.at(-1).status,'reset');

 assert.equal((await act('materialContent',{...p,materialId:doctor.id,review:true},trainer)).status,403);
 const other=(await act('createTrainee',{name:'Other trainee',designation:'Branch Manager'})).data;
 assert.equal((await act('approveMaterial',{...p,traineeId:other.id,approved:true},trainer)).status,403);
 assert.equal((await act('materialShareStatus',{...p,traineeId:other.id,status:'confirmed',confirmed:true},trainer)).status,403);
 const resource={traineeId:t.id,resourceId:'branch-sop',confirmed:true};
 assert.equal((await act('resourceShare',{...resource,confirmed:false},trainer)).status,400);
 assert.equal((await act('resourceShare',{...resource,resourceId:'missing'},trainer)).status,404);
 assert.equal((await act('resourceShare',{...resource,traineeId:other.id},trainer)).status,403);
 assert.equal((await act('resourceShare',resource,trainer)).status,200);
 assert.equal(openStore(dir).data.trainees.find(x=>x.id===t.id).resourceShares[0].resourceId,'branch-sop');
 await act('approveMaterial',{...p,approved:false},trainer);assert.equal((await act('materialContent',p,trainer)).status,403);
 assert.equal((await act('editTrainee',{traineeId:t.id,name:t.name,phone:'+44 7700 900123'})).status,200);
 assert.equal((await act('state')).data.trainees.find(x=>x.id===t.id).phone,'447700900123');
 const readyTrainee=app.store.data.trainees.find(x=>x.id===t.id);readyTrainee.phaseSaves={checklist:{}};readyTrainee.checklist.forEach(r=>r.covered=true);readyTrainee.completedMaterials=readyTrainee.approvedMaterials.map(m=>({id:m.id}));
 await act('journeyStep',{traineeId:t.id,step:'Learn',complete:true},trainer);
 assert.equal((await act('checklist',{traineeId:t.id,itemId:t.checklist[0]?.id,covered:true},trainer)).status,409);
 assert.equal((await act('approveMaterial',{...p,approved:true},trainer)).status,409);
 assert.equal((await act('journeyStep',{traineeId:t.id,step:'Learn',complete:false},trainer)).status,403);
 assert.equal(openStore(dir).data.trainees.find(x=>x.id===t.id).journeySteps.Learn.complete,true);
 assert.equal((await act('journeyStep',{traineeId:other.id,step:'Learn',complete:true},trainer)).status,403);
 await act('requestUnlock',{traineeId:t.id,step:'Learn',reason:'Correct approval'});
 await act('reviewUnlock',{traineeId:t.id,requestId:app.store.data.trainees.find(x=>x.id===t.id).unlockRequests.at(-1).id,decision:'Approved'});
 assert.equal((await act('approveMaterial',{...p,approved:true},trainer)).status,200);
 assert.equal((await call('/materials/'+hr.filename)).status,404);
 }finally{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
