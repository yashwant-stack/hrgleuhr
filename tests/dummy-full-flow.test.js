import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server.js';
import {activeTraining,currentMaterials} from '../phase-training.js';
import {flowCriteria,flowStatus} from '../training-flow.js';
for(const scenario of [{purpose:'New Joiner',score:8},{purpose:'Reskilling',score:8},{purpose:'Revaluation',score:8},{purpose:'Revaluation',score:6}])test('full workflow: '+scenario.purpose+' / score '+scenario.score,async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'full-training-')),sent=[];
 const app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,send:async m=>{sent.push(m);return {messageId:'dummy-'+sent.length};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 let cookie;const call=async(route,body,c=cookie)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(c?{cookie:c}:{})},body:JSON.stringify(body)});const data=await r.json();assert.equal(r.status,200,route+' '+JSON.stringify(body.action||'')+': '+JSON.stringify(data));return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const act=async(action,payload={},c=cookie)=>(await call('/api/action',{action,payload},c)).data;
 cookie=(await call('/api/setup',{name:'Dummy HR',email:'hr@example.test',password:'dummy-test-password'})).cookie;
 const mentor=await act('createUser',{name:'Dummy Mentor',email:'mentor@example.test',role:'trainer',password:'dummy-test-password'});
 const mc=(await call('/api/login',{email:mentor.email,password:'dummy-test-password'})).cookie;
 const created=await act('createTrainee',{name:'Dummy Trainee',email:'trainee@example.test',designation:'Branch Manager',branch:'Delhi',department:'Clinic',ownerId:app.store.data.users[0].id,flowEnabled:true,purpose:scenario.purpose});
 const p={traineeId:created.id},trainee=()=>app.store.data.trainees.find(t=>t.id===created.id);
 if(scenario.purpose==='New Joiner'){await act('communicationSave',{...p,kind:'welcome',phone:'919999999999',to:'trainee@example.test',subject:'Welcome dummy trainee',body:'Your training starts here.',attachments:[]});
 await act('communicationApprove',{...p,kind:'welcome',reviewed:true,revision:trainee().communications.welcome.revision});
 const share=await act('communicationShare',{...p,kind:'welcome'});assert.ok(share.body);
 await act('communicationSend',{...p,kind:'welcome'});assert.ok(sent.at(-1).attachments.length);}
 const finish=step=>act('flowComplete',{...p,step});
 const ackLatest=async()=>{const token=sent.at(-1).body.match(/ack.html#([a-f0-9]{64})/)[1];await call('/api/ack',{token,submit:true,confirm:true,name:'Dummy Trainee'});};
 const phases=['Induction','Sales Training','CRM & Tech Training','Operations Training'];
 for(const [phaseIndex,phase] of phases.entries()){
  assert.equal(trainee().stage,phase);
  const checks=activeTraining(trainee(),app.store.data).checklist;
  assert.ok(checks.length>0);
  if(scenario.purpose==='Revaluation'){
   await act('flowEvaluation',{...p,step:'TheoryEvaluation',ratings:flowCriteria(trainee(),app.store.data,'TheoryEvaluation').map(r=>({id:r.id,score:scenario.score}))});
   if(scenario.score<7.5){assert.equal(flowStatus(trainee(),app.store.data).find(s=>s.key==='TheoryEvaluation').ready,false);await act('flowRetest',{...p,step:'TheoryEvaluation'});await act('flowEvaluation',{...p,step:'TheoryEvaluation',ratings:flowCriteria(trainee(),app.store.data,'TheoryEvaluation').map(r=>({id:r.id,score:8}))});}
   await finish('TheoryEvaluation');await ackLatest();
  }
  if(scenario.purpose!=='Revaluation'){
  await act('flowChecklist',{...p,step:'Educate',rows:checks.filter(r=>r.type!=='Practical').map(r=>({id:r.id,complete:true}))});await ackLatest();const savedSnapshot=(await act('state')).trainees.find(t=>t.id===created.id);assert.ok(savedSnapshot.lifecycle.acknowledgements.some(a=>a.ref===savedSnapshot.flowRecord.checklistSaves.Educate.ref&&a.title.includes('checklist updated')));await finish('Educate');
  const docs=currentMaterials(trainee(),app.store.data);assert.ok(docs.length);
  for(const m of docs){await act('approveMaterial',{...p,materialId:m.id,approved:true});await act('sendLearningEmail',{...p,materialId:m.id});await act('completeMaterial',{...p,materialId:m.id,complete:true});}
  await finish('Content');}
  for(const step of scenario.purpose==='Revaluation'?['PracticalEvaluation']:['TheoryEvaluation','PracticalEvaluation']){
   if(step==='PracticalEvaluation'){
    await act('assignMentor',{...p,mentorId:mentor.id,focus:'Supervise '+phase+' practical tasks'});
    for(const r of checks.filter(r=>r.type==='Practical'))await act('mentorTask',{...p,taskId:r.id,complete:true,evidence:'Observed in synthetic training; verification requirements checked.'},mc);
    await finish('Mentor');
    await act('flowChecklist',{...p,step:'Practical',rows:checks.filter(r=>r.type==='Practical').map(r=>({id:r.id,complete:true}))});await ackLatest();await finish('Practical');
   }
   const ratings=flowCriteria(trainee(),app.store.data,step).map((r,i)=>({id:r.id,score:8+i%3}));
   await act('flowEvaluation',{...p,step,ratings});await finish(step);await ackLatest();
   const snapshot=(await act('state')).trainees.find(t=>t.id===created.id);assert.equal(snapshot.trainingFlowStatus.find(s=>s.key===step.replace('Evaluation','Acknowledgement')).complete,true);
  }
  await act('certificate',p);
  const cert=await act('prepareCertificateShare',{...p,recipient:'trainee',channel:'email'});await act('communicationSend',{...p,kind:cert.kind});assert.ok(sent.at(-1).attachments.some(a=>a.filename.endsWith('.pdf')));
  const h=await act('draftHandover',{...p,stage:phases[phaseIndex+1]||'Assessment',ownerId:mentor.id,note:'Dummy transition: reviewed all training.'});
  await act('communicationSave',{...p,kind:'handover:'+h.handoverId,to:mentor.email,subject:'Dummy handover',body:'Review training history.',attachments:[]});await act('communicationSend',{...p,kind:'handover:'+h.handoverId});assert.match(sent.at(-1).body,/TRAINING HISTORY/);
  await act('activateHandover',{...p,handoverId:h.handoverId});
  assert.equal(flowStatus(trainee(),app.store.data).find(s=>!s.complete).key,scenario.purpose==='Revaluation'?'TheoryEvaluation':'Educate');
 }
 for(const purpose of ['Reskilling','Revaluation']){
 const other=await act('createTrainee',{name:'Dummy '+purpose,email:'other@example.test',designation:'Branch Manager',branch:'Delhi',department:'Clinic',ownerId:mentor.id,flowEnabled:true,purpose,trainingPhase:'Operations Training'});
 const snap=(await act('state')).trainees.find(t=>t.id===other.id);
 assert.equal(snap.stage,'Operations Training');assert.equal(snap.trainingFlowStatus.find(s=>s.key==='Start').notRequired,true);
 assert.equal(snap.trainingFlowStatus.find(s=>!s.complete).key,purpose==='Revaluation'?'TheoryEvaluation':'Educate');
 assert.ok(snap.activeTraining.assessments.every(q=>q.department==='Operations'));
 }
 assert.ok(sent.every(m=>String(m.to).endsWith('@example.test')));
 ctx.diagnostic('Captured '+sent.length+' dummy emails, with real document/PDF generation; no external mail sent.');
});
