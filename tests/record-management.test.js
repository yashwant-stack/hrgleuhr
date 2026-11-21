import {orderedPhases} from '../training-phases.js';
import {prepareJourneyFixture} from './journey-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server.js';
import {openStore} from '../store.js';

test('trainee editing supports durable custom topics, reversible removal, scoped phase order and module removal',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gleuhr-management-'));const app=createApp({dataDir:dir,scheduler:false});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.server.address().port;
 async function call(route,body,cookie){const r=await fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 let admin;const act=(action,payload={},cookie=admin)=>{prepareJourneyFixture(app,action,payload);return call('/api/action',{action,payload},cookie);};
 try {
 admin=(await call('/api/setup',{name:'Admin',email:'admin@example.test',password:'example-test-password'})).cookie;
 const owner=(await act('createUser',{name:'Trainer',email:'trainer@example.test',password:'example-test-password',role:'trainer'})).data;
 const trainer=(await call('/api/login',{email:owner.email,password:'example-test-password'})).cookie;
 const t=(await act('createTrainee',{name:'Managed trainee',designation:'Branch Manager',ownerId:owner.id})).data;
 const other=(await act('createTrainee',{name:'Unassigned trainee',designation:'Doctor'})).data;
 const state=async()=> (await act('state')).data; const trainee=async()=> (await state()).trainees.find(x=>x.id===t.id);
 let stages=(await state()).stages,order=[...stages].reverse();
 assert.equal((await act('reorderStages',{traineeId:other.id,order},trainer)).status,403);
 assert.equal((await act('reorderStages',{traineeId:t.id,order:[stages[0],stages[0]]})).status,400);
 assert.equal((await act('reorderStages',{traineeId:t.id,order},trainer)).status,200);
 assert.deepEqual((await trainee()).stageOrder,orderedPhases(order));assert.equal((await trainee()).stage,'Induction');
 assert.equal((await act('reorderStages',{traineeId:t.id,order,version:-1})).status,409);
 const topic={traineeId:t.id,topic:'Custom safety practice',module:'Custom training',phase:'Induction',type:'Practical'};
 assert.equal((await act('addChecklist',topic,trainer)).status,200);
 assert.equal((await act('addChecklist',topic,trainer)).status,400);
 let x=await trainee(),row=x.checklist.find(r=>r.topic===topic.topic);
 await act('checklist',{traineeId:t.id,itemId:row.id,removed:true},trainer);
 assert.ok((await trainee()).checklist.find(r=>r.id===row.id).removed);
 await act('checklist',{traineeId:t.id,itemId:row.id,removed:false},trainer);
 app.store.data.trainees.find(x=>x.id===t.id).stage="Onboarding";
 const score=(await trainee()).activeTraining.scores[0];
 await act('score',{traineeId:t.id,itemId:score.id,score:8},trainer);
 assert.equal((await act('archiveEntry',{traineeId:other.id,kind:'scores',entryId:score.id},trainer)).status,403);
 assert.equal((await act('archiveEntry',{traineeId:t.id,kind:'scores',entryId:score.id},trainer)).status,200);
 await act('sync',{});x=await trainee();assert.ok(!x.scores.some(r=>r.id===score.id));assert.ok(!x.scores.some(r=>r.criterion===score.criterion&&r.category===score.category));
 let archived=x.archivedEntries.find(a=>a.entry.id===score.id);
 assert.equal((await act('restoreEntry',{traineeId:t.id,entryId:archived.id},trainer)).status,200);assert.equal((await trainee()).scores.find(r=>r.id===score.id).score,8);
 await act('record',{traineeId:t.id,kind:'eod',title:'Daily practice',notes:'Test notes'},trainer);
 let record=(await state()).records.find(r=>r.traineeId===t.id);
 await act('archiveEntry',{traineeId:t.id,kind:'records',entryId:record.id},trainer);assert.ok(!(await state()).records.some(r=>r.id===record.id));
 archived=(await trainee()).archivedEntries.find(a=>a.entry.id===record.id);await act('restoreEntry',{traineeId:t.id,entryId:archived.id},trainer);assert.ok((await state()).records.some(r=>r.id===record.id));
 const draft=(await act('draftHandover',{traineeId:t.id,stage:'Operations Training',ownerId:owner.id})).data;
 await act('activateHandover',{traineeId:t.id,handoverId:draft.handoverId});
 await act('archiveEntry',{traineeId:t.id,kind:'handovers',entryId:draft.handoverId});
 archived=(await trainee()).archivedEntries.find(a=>a.kind==='handovers');await act('restoreEntry',{traineeId:t.id,entryId:archived.id});
 assert.equal((await trainee()).handovers.find(r=>r.id===draft.handoverId).status,'Draft');assert.equal((await trainee()).stage,'Operations Training');assert.equal((await state()).outbox.length,0);
 app.store.data.trainees.find(x=>x.id===t.id).stage='Induction';
 const material=(await state()).materials.find(m=>m.group==='HR'),p={traineeId:t.id,materialId:material.id};
 await act('approveMaterial',{...p,approved:true},trainer);await act('completeMaterial',{...p,complete:true},trainer);
 await act('approveMaterial',{...p,approved:false},trainer);assert.ok(!(await trainee()).completedMaterials.some(r=>r.id===material.id));
 assert.equal((await act('archiveMaterial',{materialId:material.id,removed:true},trainer)).status,400);
 await act('approveMaterial',{...p,approved:true});
 assert.equal((await act('archiveMaterial',{...p,removed:true},trainer)).status,200);
 assert.ok((await state()).materials.some(m=>m.id===material.id));
 assert.ok(!(await trainee()).materialIds.includes(material.id));
 assert.equal((await act('materialContent',{...p,review:true})).status,403);
 assert.ok((await state()).trainees.find(x=>x.id===other.id).materialIds.includes(material.id));
 const fresh=(await act('createTrainee',{name:'New defaults',designation:'Branch Manager',ownerId:owner.id})).data;
 assert.ok((await state()).trainees.find(x=>x.id===fresh.id).materialIds.includes(material.id));
 assert.equal((await act('archiveMaterial',{traineeId:other.id,materialId:material.id,removed:true},trainer)).status,403);
 await act('archiveMaterial',{...p,removed:false},trainer);
 assert.ok((await trainee()).materialIds.includes(material.id));assert.equal((await act('materialContent',p)).status,403);
 assert.deepEqual(openStore(dir).data.trainees.find(x=>x.id===t.id).stageOrder,orderedPhases(order));
 }finally{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('legacy global removals are restored once without granting trainee approval',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gleuhr-library-restore-'));
 try{
  const store=openStore(dir);store.transaction(db=>{db.archivedMaterialIds=['legacy-module'];delete db.traineeMaterialRemovalMigration;});
  createApp({store,scheduler:false});
  assert.deepEqual(store.data.archivedMaterialIds,[]);
  assert.deepEqual(store.data.restoredLibraryMaterialIds,['legacy-module']);
  assert.ok(store.data.traineeMaterialRemovalMigration);
  const stamp=store.data.traineeMaterialRemovalMigration;
  createApp({store,scheduler:false});assert.equal(store.data.traineeMaterialRemovalMigration,stamp);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
