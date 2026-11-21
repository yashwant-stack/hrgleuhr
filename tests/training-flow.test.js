import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server.js';import {flowStatus,flowRecord,flowCriteria,resetFlow,flowAction} from '../training-flow.js';import {materials} from '../training-materials.js';
test('nine-stage flow gates evaluation, trainee acknowledgements, mentor tasks and correction; confirmations go to trainee',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flow-nine-')),sent=[],app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,send:async m=>{sent.push(m);return {messageId:'fake'};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});let cookie;
 const call=async(route,body,c=cookie)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(c?{cookie:c}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const act=(action,payload={},c=cookie)=>call('/api/action',{action,payload},c);
 cookie=(await call('/api/setup',{name:'HR',email:'hr@example.test',password:'test-password-long'})).cookie;
 const mentor=(await act('createUser',{name:'Mentor',email:'mentor@example.test',password:'test-password-long',role:'trainer'})).data;
 const mc=(await call('/api/login',{email:mentor.email,password:'test-password-long'})).cookie;
 const result=await act('createTrainee',{name:'Person',designation:'Branch Manager',email:'person@example.test',branch:'Delhi',department:'Clinic',ownerId:app.store.data.users[0].id});assert.equal(result.status,200);
 const t=app.store.data.trainees.find(t=>t.id===result.data.id),p={traineeId:t.id};
 t.checklist=[{id:'theory',topic:'Company introduction',type:'Theory',phase:'Induction',covered:false},{id:'practical',topic:'Clinic tour',type:'Practical',phase:'Induction',covered:false}];t.assessments=[{id:'q',department:'HR',question:'Explain company values',score:null}];t.scores=[{id:'score',criterion:'Observed practice',phase:'Induction',score:null}];app.store.data.archivedMaterialIds=materials.map(m=>m.id);
 assert.equal((await act('enableTrainingFlow',p)).status,200);
 const finish=step=>act('flowComplete',{...p,step});
 assert.equal((await finish('Content')).status,409);assert.equal((await finish('Educate')).status,409);
 assert.equal((await act('flowChecklist',{...p,step:'Educate',rows:[{id:'theory',complete:true}]})).status,409);
 assert.equal((await finish('Start')).status,200);assert.equal((await finish('Start')).status,409);
 assert.equal((await act('flowChecklist',{...p,step:'Educate',rows:[{id:'theory',complete:true}]})).status,200);assert.ok(sent.some(m=>m.to==='person@example.test'&&m.body.includes('Company introduction')));
 const count=sent.length;await act('flowChecklist',{...p,step:'Educate',rows:[{id:'theory',complete:true}]});assert.equal(sent.length,count);
 assert.equal((await finish('Educate')).status,200);assert.equal((await act('flowChecklist',{...p,step:'Educate',rows:[{id:'theory',complete:false}]})).status,409);
 assert.equal((await finish('Content')).status,200);
 assert.equal((await act('flowEvaluation',{...p,step:'TheoryEvaluation',ratings:[{id:'q',score:11}]})).status,400);
 assert.equal((await act('flowEvaluation',{...p,step:'TheoryEvaluation',ratings:[{id:'q',score:5}]})).status,200);
 assert.equal((await finish('TheoryEvaluation')).status,409);
 assert.equal((await act('flowRetest',{...p,step:'TheoryEvaluation'})).status,200);
 assert.equal(flowRecord(app.store.data.trainees.find(x=>x.id===t.id)).evaluationHistory.TheoryEvaluation[0].score,5);
 assert.equal((await act('flowEvaluation',{...p,step:'TheoryEvaluation',ratings:[{id:'q',score:8}]})).status,200);assert.equal((await finish('TheoryEvaluation')).status,200);
 assert.equal((await act('assignMentor',{...p,mentorId:mentor.id,focus:'Guide clinic tour'})).status,409);
 const token=sent.at(-1).body.match(/ack.html#([a-f0-9]{64})/)[1];assert.equal((await call('/api/ack',{token,submit:true,confirm:true,name:'Person'})).status,200);
 assert.equal((await act('assignMentor',{...p,mentorId:mentor.id,focus:'Guide clinic tour'})).status,200);assert.equal((await finish('Mentor')).status,409);
 assert.equal((await act('mentorTask',{...p,taskId:'practical',complete:true})).status,403);
 const pendingMentor=(await act('state',{},mc)).data.mentorAssignments.find(x=>x.id===t.id);assert.equal(pendingMentor.trainingFlowStatus.find(s=>s.key==='Practical').blockedBy,'Mentor');
 assert.equal((await finish('Practical')).status,409);
 assert.equal((await act('mentorTask',{...p,taskId:'practical',complete:true},mc)).status,200);
 assert.equal((await finish('Mentor')).status,200);assert.equal((await act('mentorTask',{...p,taskId:'practical',complete:true})).status,403);
 assert.equal((await act('mentorTask',{...p,taskId:'practical',complete:true},mc)).status,200);
 assert.equal(app.store.data.trainees.find(x=>x.id===p.traineeId).checklist.find(r=>r.id==='practical').covered,true);assert.equal((await finish('Practical')).status,200);
 assert.equal((await act('flowEvaluation',{...p,step:'PracticalEvaluation',ratings:[{id:'score',score:9}]})).status,200);assert.equal((await finish('PracticalEvaluation')).status,200);
 assert.equal((await act('certificate',p)).status,409);
 const practicalRef=flowRecord(app.store.data.trainees.find(x=>x.id===p.traineeId)).steps.PracticalEvaluation.ref;
 const practicalAck=app.store.data.ackTokens.find(a=>a.ref===practicalRef);
 const practicalMail=app.store.data.lifecycleNotifications.find(n=>n.key==='ack:'+practicalAck.hash);
 practicalMail.status='In-app only';practicalMail.error='Previously filtered';
 app.store.data.lifecycleSettings={managementEmails:'person@example.test'};
 const beforeRetry=sent.length;
 assert.equal((await act('flowResendAcknowledgement',{...p,step:'PracticalAcknowledgement'})).status,200);
 assert.equal(sent.length,beforeRetry+1);
 assert.equal(sent.at(-1).to,'person@example.test');assert.equal(sent.at(-1).cc,'');
 assert.equal(practicalMail.status,'Sent');
 assert.equal(flowStatus(app.store.data.trainees.find(x=>x.id===p.traineeId),app.store.data).find(s=>s.key==='PracticalAcknowledgement').emailDelivery.status,'Sent');
 const practicalToken=sent.at(-1).body.match(/ack.html#([a-f0-9]{64})/)[1];await call('/api/ack',{token:practicalToken,submit:true,confirm:true,name:'Person'});
 assert.equal((await act('certificate',p)).status,200);assert.equal(flowStatus(app.store.data.trainees.find(x=>x.id===p.traineeId),app.store.data).at(-1).blockedBy,null);
 assert.equal((await act('requestUnlock',{...p,step:'Flow:TheoryEvaluation',reason:'Correct score'})).status,200);
 const correction=app.store.data.trainees.find(x=>x.id===p.traineeId).unlockRequests.at(-1);
 const notification=app.store.data.lifecycleNotifications.find(n=>n.key==='correction:'+correction.id);
 assert.ok(notification.portalUrl.endsWith('/?correction='+correction.id));
 assert.ok((await act('notifications')).data.some(r=>r.id===correction.id&&r.status==='Pending'));
 assert.equal((await act('reviewUnlock',{...p,requestId:correction.id,decision:'Approved'},mc)).status,403);
 assert.equal((await act('reviewUnlock',{...p,requestId:app.store.data.trainees.find(x=>x.id===p.traineeId).unlockRequests.at(-1).id,decision:'Approved'})).status,200);
 assert.equal(flowStatus(app.store.data.trainees.find(x=>x.id===p.traineeId),app.store.data).find(s=>s.key==='Mentor').blockedBy,'TheoryEvaluation');assert.equal((await call('/api/ack',{token})).status,410);
 assert.equal(app.store.data.trainees.find(x=>x.id===p.traineeId).certificate,null);assert.ok(flowRecord(app.store.data.trainees.find(x=>x.id===p.traineeId)).evaluations.TheoryEvaluation);
});
test('content shares are per trainee, approval and theory/practical stage',()=>{
 const m={id:'flow-material',title:'Theory handbook',group:'HR',roles:['All'],phases:['Induction']};
 const db={uploadedMaterials:[m],archivedMaterialIds:materials.map(m=>m.id),customDesignations:{}};
 const t={stage:'Induction',designation:'Branch Manager',checklist:[{type:'Practical',covered:true}],approvedMaterials:[{id:m.id,at:'approval'}],materialShares:[],mentor:{phase:'Induction',tasks:[]}};
 assert.equal(flowStatus(t,db).find(s=>s.key==='Content').ready,false);
 t.materialShares.push({materialId:m.id,approvalAt:'approval',status:'confirmed',flowStep:'Content'});
 assert.equal(flowStatus(t,db).find(s=>s.key==='Content').ready,true);
 assert.equal(flowStatus({...t,materialShares:[]},db).find(s=>s.key==='Content').ready,false);
 t.approvedMaterials[0].at='new-approval';assert.equal(flowStatus(t,db).find(s=>s.key==='Content').ready,false);
});

test('practical accepts already shared theory documents with the same approval; mentor confirmation is the single practical completion source',()=>{
 const m={id:'same-doc',title:'Sales handbook',group:'HR',roles:['All'],phases:['Induction']};
 const db={uploadedMaterials:[m],archivedMaterialIds:materials.map(m=>m.id),customDesignations:{}};
 const t={stage:'Induction',designation:'Branch Manager',checklist:[{id:'p',topic:'Tour',phase:'Induction',type:'Practical',covered:true}],approvedMaterials:[{id:m.id,at:'approval'}],materialShares:[{materialId:m.id,approvalAt:'approval',status:'confirmed',flowStep:'Content'}],mentor:{phase:'Induction',tasks:[{topicId:'p',complete:true}]}};
 const practical=()=>flowStatus(t,db).find(s=>s.key==='Practical');
 assert.equal(practical().ready,true);assert.deepEqual(practical().missing,[]);
 t.mentor.tasks[0].complete=false;assert.equal(practical().ready,false);assert.match(practical().missing[0],/Mentor/);
 t.mentor.tasks[0].complete=true;t.checklist[0].covered=false;assert.equal(practical().ready,true);
 delete t.materialShares[0].flowStep;assert.equal(practical().ready,true);
 t.materialShares.push({...t.materialShares[0],status:'pending'});assert.equal(practical().ready,false);t.materialShares.pop();
 t.checklist[0].covered=true;t.approvedMaterials[0].at='new-approval';assert.equal(practical().ready,false);assert.match(practical().missing[0],/Share/);
});
test('Reskilling skips Start automatically; New Joiner still requires it',()=>{
 const db={customDesignations:{},archivedMaterialIds:[],uploadedMaterials:[]};
 const t={purpose:'Reskilling',stage:'Induction',designation:'Branch Manager',checklist:[],scores:[],assessments:[],handovers:[],flowEnabled:true};
 let states=flowStatus(t,db);
 assert.equal(states[0].notRequired,true);assert.equal(states[0].complete,true);
 assert.equal(states.find(s=>s.key==='Educate').blockedBy,null);
 assert.equal(states.find(s=>s.key==='TheoryEvaluation').blockedBy,'Educate');
 t.purpose='New Joiner';states=flowStatus(t,db);
 assert.equal(states[0].complete,false);assert.equal(states.find(s=>s.key==='Educate').blockedBy,'Start');
});
test('acknowledgement status exposes trainee identity and time only for the current evaluation reference',()=>{
 const t={stage:'Induction',designation:'Branch Manager',checklist:[],scores:[],assessments:[],trainingFlow:{Induction:{steps:{Start:{complete:true},Educate:{complete:true},Content:{complete:true},TheoryEvaluation:{complete:true,ref:'current'}}}},lifecycle:{acknowledgements:[{kind:'flow-evaluation',ref:'old',name:'Old acknowledgement',at:'2026-11-01'}]}};
 const state=()=>flowStatus(t,{}).find(s=>s.key==='TheoryAcknowledgement');
 assert.equal(state().complete,false);assert.equal(state().acknowledgement,null);
 t.lifecycle.acknowledgements.push({kind:'flow-evaluation',ref:'current',name:'Demo trainee',by:'demo@example.test',at:'2026-11-05T10:00:00.000Z'});
 assert.equal(state().complete,true);assert.equal(state().acknowledgement.name,'Demo trainee');assert.equal(state().acknowledgement.at,'2026-11-05T10:00:00.000Z');
 assert.equal(flowStatus(t,{}).find(s=>s.key==='Mentor').blockedBy,null);
});
test('Revaluation starts with evaluation, skips refresher only on passing score, and correction relocks downstream steps',()=>{
 const t={purpose:'Revaluation',stage:'Sales Training',designation:'Branch Manager',checklist:[],scores:[],assessments:[],flowEnabled:true,trainingFlow:{'Sales Training':{steps:{},evaluations:{}}}};
 const f=t.trainingFlow['Sales Training'];
 assert.equal(flowStatus(t,{}).find(s=>!s.complete).key,'TheoryEvaluation');
 f.evaluations.TheoryEvaluation={score:7,ratings:[]};f.steps.TheoryEvaluation={complete:true,ref:'test'};
 t.lifecycle={acknowledgements:[{kind:'flow-evaluation',ref:'test',name:'Dummy'}]};
 assert.equal(flowStatus(t,{}).find(s=>!s.complete).key,'TheoryEvaluation');
 f.evaluations.TheoryEvaluation.score=8;
 assert.equal(flowStatus(t,{}).find(s=>s.key==='Educate').notRequired,true);
 assert.equal(flowStatus(t,{}).find(s=>!s.complete).key,'Mentor');
 f.steps.Mentor={complete:true};resetFlow(t,'TheoryEvaluation');
 assert.equal(f.steps.Mentor,undefined);assert.equal(flowStatus(t,{}).find(s=>!s.complete).key,'TheoryEvaluation');
});

test('confirmed document remains shared across stages and repeat downloads; reset and new approval still block',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'share-progression-'));
 const app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,send:async()=>({messageId:'dummy'})}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 let cookie;const call=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});const data=await r.json();if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];assert.equal(r.status,200,JSON.stringify(data));return data;};
 const act=(action,payload={})=>call('/api/action',{action,payload});
 await call('/api/setup',{name:'HR',email:'hr@example.test',password:'test-password-long'});
 const created=await act('createTrainee',{name:'Dummy sharing',designation:'Branch Manager',email:'dummy@example.test',branch:'Delhi',department:'Clinic',ownerId:app.store.data.users[0].id});
 const m=materials.find(m=>m.group==='HR'),p={traineeId:created.id,materialId:m.id};
 const t=app.store.data.trainees.find(t=>t.id===created.id);
 t.flowEnabled=true;t.checklist=[];t.trainingFlow={Induction:{steps:{Start:{complete:true},Educate:{complete:true}},evaluations:{}}};
 await act('approveMaterial',{...p,approved:true});
 await act('materialShareStatus',{...p,status:'confirmed',confirmed:true});
 const approval=t.approvedMaterials.find(a=>a.id===m.id).at;
 await act('approveMaterial',{...p,approved:true});assert.equal(t.approvedMaterials.find(a=>a.id===m.id).at,approval);
 await act('flowComplete',{traineeId:t.id,step:'Content'});
 // Isolate the transition regression after prior evaluation/acknowledgement gates.
 t.trainingFlow.Induction.steps.TheoryEvaluation={complete:true,ref:'theory'};
 t.lifecycle??={};t.lifecycle.acknowledgements=[{kind:'flow-evaluation',ref:'theory',at:new Date().toISOString()}];
 t.trainingFlow.Induction.steps.Mentor={complete:true};
 // Old versions wrote this after opening a share dialog in the next stage.
 t.materialShares.push({materialId:m.id,approvalAt:approval,status:'prepared',flowStep:'Practical'});
 await act('materialShareStatus',{...p,status:'prepared'});
 let state=(await act('state')).trainees.find(x=>x.id===t.id);
 assert.equal(state.materialSharingStates[m.id].status,'confirmed');
 assert.equal(state.trainingFlowStatus.find(s=>s.key==='Practical').ready,true);
 await act('materialShareStatus',{...p,status:'reset'});
 assert.equal((await act('state')).trainees.find(x=>x.id===t.id).materialSharingStates[m.id].status,'reset');
 await act('materialShareStatus',{...p,status:'confirmed',confirmed:true});
 await act('flowComplete',{traineeId:t.id,step:'Practical'});
 state=(await act('state')).trainees.find(x=>x.id===t.id);
 assert.equal(state.trainingFlowStatus.find(s=>s.key==='Practical').complete,true);
 assert.equal(state.trainingFlowStatus.find(s=>s.key==='PracticalEvaluation').blockedBy,null);
 t.approvedMaterials.find(a=>a.id===m.id).at='new-approval';
 assert.equal(flowStatus(t,app.store.data).find(s=>s.key==='Content').ready,false);
 assert.match(flowStatus(t,app.store.data).find(s=>s.key==='Content').missing.join(' '),/Confirm sharing/);
});


test('below-threshold retest preserves previous ratings and clears current scores; passing and locked evaluations cannot reset',()=>{
 const db={customDesignations:{},audit:[],uploadedMaterials:[],archivedMaterialIds:[]};
 const t={id:'dummy',name:'Dummy',email:'dummy@example.test',stage:'Sales Training',designation:'Branch Manager',version:1,checklist:[],scores:[],assessments:[{id:'q',department:'Sales',question:'Dummy',score:5}],trainingFlow:{'Sales Training':{steps:{Start:{complete:true},Educate:{complete:true},Content:{complete:true}},evaluations:{TheoryEvaluation:{score:5,ratings:[{id:'q',score:5}],by:'trainer@example.test',at:'2026-11-06'}}}},lifecycle:{plan:{phases:[{phase:'Sales Training',passScore:7}]}}};
 const u={name:'Trainer',email:'trainer@example.test'};
 const run=()=>flowAction(db,t,u,'flowRetest',{step:'TheoryEvaluation'},'http://localhost');
 run();const f=flowRecord(t);assert.equal(f.evaluationHistory.TheoryEvaluation[0].ratings[0].score,5);assert.equal(t.assessments[0].score,null);assert.equal(f.evaluations.TheoryEvaluation,undefined);assert.equal(flowStatus(t,db).find(s=>s.key==='TheoryEvaluation').ready,false);assert.throws(run,/saved score/);
 f.evaluations.TheoryEvaluation={score:7.5,ratings:[{id:'q',score:7.5}]};assert.throws(run,/below/);
 f.evaluations.TheoryEvaluation.score=8;f.steps.TheoryEvaluation={complete:true};assert.throws(run,/locked/);assert.equal(f.evaluationHistory.TheoryEvaluation.length,1);
});

 test('75 percent boundary gates theory and practical evaluation without rounding up',()=>{
 for(const step of ['TheoryEvaluation','PracticalEvaluation']){
 const t={stage:'Induction',designation:'Branch Manager',checklist:[],assessments:[{id:'q',department:'HR',question:'HR procedures'}],scores:[{id:'p',phase:'Induction',criterion:'Observed HR procedures'}],trainingFlow:{Induction:{steps:{},evaluations:{[step]:{score:7.49,ratings:[{id:step==='TheoryEvaluation'?'q':'p',score:7.49}]}}}}};
 assert.equal(flowStatus(t,{}).find(s=>s.key===step).ready,false);
 t.trainingFlow.Induction.evaluations[step].score=7.5;
 t.trainingFlow.Induction.evaluations[step].ratings[0].score=7.5;
 assert.equal(flowStatus(t,{}).find(s=>s.key===step).ready,true);
 }
 });
