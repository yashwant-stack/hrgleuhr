import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { withCloudStore } from '../cloud-store.js';
import { createApp } from '../server.js';
import { Readable } from 'node:stream';
import { letterPdf } from '../letter-pdf.js';

const enabled = !!process.env.DATABASE_URL_UNPOOLED;
test('cloud persistence, login, grading, rollback and concurrent writes', {skip:!enabled}, async()=>{
 const key='verification-'+randomUUID();
 const uploadedIds=[];
 const db=new pg.Client({connectionString:process.env.DATABASE_URL_UNPOOLED});await db.connect();
 const seed={schema:1,users:[],trainees:[],records:[],outbox:[],audit:[],customQuestions:[],resources:[],customDesignations:{}};
 await db.query('INSERT INTO gleuhr_state(id,data) VALUES ($1,$2)',[key,JSON.stringify(seed)]);
 const run=fn=>withCloudStore(fn,{key});
 let cookie='';
 async function call(path,data){
  return run(async(store,runtime)=>{
   const app=createApp({store,runtime,hosted:true,scheduler:false,mailer:{configured:false,from:'verify@example.test',send:async()=>{throw Error('Email disabled in cloud verification');}}});
   const req=Readable.from(data?[JSON.stringify(data)]:[]);
   req.method=data?'POST':'GET';req.url=path;req.headers={host:'test.example',origin:'https://test.example','content-type':'application/json',cookie};req.socket={remoteAddress:'127.0.0.1'};
   const out={headers:{},setHeader(k,v){this.headers[k]=v},writeHead(code,h){this.status=code;Object.assign(this.headers,h)},end(body){this.body=JSON.parse(body)}};
   await app.handler(req,out);
   if(out.headers['Set-Cookie'])cookie=out.headers['Set-Cookie'].split(';')[0];
   return out;
  });
 }
 try {
  const setup=await call('/api/setup',{name:'Verification',email:'verify@example.test',password:'Temporary-test-password-2026'});assert.equal(setup.status,200);assert.match(setup.headers['Set-Cookie'],/Secure/);
  assert.equal((await call('/api/session')).body.user.email,'verify@example.test');
  const owner=(await call('/api/session')).body.user.id;
  const act=async(action,payload={})=>{const result=await call('/api/action',{action,payload});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
  const designation='Verification '+randomUUID();
  await act('createDesignation',{name:designation,baseDesignation:'All'});
  const first=await act('createTrainee',{name:'First '+key,email:'first@example.test',designation,ownerId:owner,branch:'Test clinic',department:'Training'});
  const bytes=await letterPdf({subject:'Synthetic training guide',body:'No employee data. Verification document only.',name:'Test team',designation});
  const module=await act('uploadMaterial',{title:'Synthetic module',designation,phase:'Induction',filename:'module.pdf',base64:bytes.toString('base64')});uploadedIds.push(module.id);
  await act('communicationSave',{traineeId:first.id,kind:'welcome',to:'first@example.test',subject:'First personal welcome',body:'Only for the first learner.',attachments:[{filename:'welcome-guide.pdf',base64:bytes.toString('base64')}]});
  const firstState=await act('state');
  const shared=firstState.trainees.find(t=>t.id===first.id).welcomeDocuments[0];uploadedIds.push(shared.id);
  const next=await act('createTrainee',{name:'Next '+key,email:'next@example.test',designation,ownerId:owner,branch:'Test clinic',department:'Training'});
  const nextState=(await act('state')).trainees.find(t=>t.id===next.id);
  assert.ok(nextState.materialIds.includes(module.id));assert.equal(nextState.welcomeDocuments[0].id,shared.id);assert.equal(nextState.communications.welcome,null);
  const downloaded=await act('communicationAttachment',{traineeId:next.id,kind:'welcome',attachmentId:shared.id});assert.deepEqual(Buffer.from(downloaded.base64,'base64'),bytes);
  await act('communicationSave',{traineeId:next.id,kind:'welcome',to:'next@example.test',subject:'Next personal welcome',body:'Only for the next learner.',attachments:[{id:shared.id}]});
  const nextDraft=(await act('state')).trainees.find(t=>t.id===next.id).communications.welcome;
  assert.equal(nextDraft.attachments[0].id,shared.id);assert.equal(nextDraft.to,'next@example.test');assert.equal(nextDraft.approved,false);
  const welcomePreview=await act('communicationPreview',{traineeId:next.id,kind:'welcome'});
  assert.match(welcomePreview.html,/PEOPLE &amp; CULTURE/);assert.equal(Buffer.from(welcomePreview.file.base64,'base64').subarray(0,5).toString(),'%PDF-');
  const learner=await act('createTrainee',{name:'Curriculum '+key,email:'curriculum@example.test',designation:'Regional Head',ownerId:owner,branch:'Test clinic',department:'Training',purpose:'Reskilling',trainingPhase:'Operations Training'});
  const curriculumLearner=(await act('state')).trainees.find(t=>t.id===learner.id);
  assert.equal(curriculumLearner.curriculum.duration,18);assert.ok(curriculumLearner.activeTraining.checklist.some(r=>r.curriculumId==='rh-m5-6'));
  const curriculumFile=await act('curriculumDownload',{traineeId:learner.id});assert.equal(Buffer.from(curriculumFile.base64,'base64').subarray(0,5).toString(),'%PDF-');
  await run(async store=>store.transaction(db=>{const t=db.trainees.find(t=>t.id===learner.id);t.flowEnabled=false;t.lifecycleRequired=false;t.mentor={userId:owner,phase:t.stage,tasks:[]};}));
  const task=curriculumLearner.activeTraining.checklist.find(r=>r.curriculumId==='rh-m5-6');
  await act('mentorTask',{traineeId:learner.id,taskId:task.id,complete:true,evidence:'Synthetic reception audit; score compared with trainer.'});
  const persisted=(await act('state')).trainees.find(t=>t.id===learner.id);assert.match(persisted.practicalMentor.tasks.find(r=>r.id===task.id).evidence,/Synthetic reception audit/);
  // Simulate a saved row from the previous release, then exercise cold-start migration.
  let foundationId,brandQuestionId,versionBefore;
  await run(async store=>store.transaction(db=>{
   const t=db.trainees.find(t=>t.id===learner.id),row=t.checklist.find(r=>r.curriculumId==='rh-day-2');
   foundationId=row.id;versionBefore=t.version;delete t.curriculumPlacementVersion;
   row.phase='Induction';row.covered=true;row.remarks='Saved foundation evidence before correction';row.assessor='verify@example.test';row.coveredAt='2026-11-17T08:00:00Z';
   const question=t.assessments.find(r=>r.question==='Describe Gleuhr: its clinics network and its skincare product line.');
   brandQuestionId=question.id;question.department='HR';question.phase='Induction';question.score=8;question.answer='Saved answer before relocation';
  }));
  const corrected=(await act('state')).trainees.find(t=>t.id===learner.id);
  const foundation=corrected.activeTraining.checklist.find(r=>r.id===foundationId);
  assert.equal(foundation.phase,'Operations Training');assert.equal(foundation.covered,true);assert.match(foundation.remarks,/before correction/);
  await run(async store=>{
   const t=store.data.trainees.find(t=>t.id===learner.id);
   assert.equal(t.checklist.find(r=>r.id===foundationId).phase,'Operations Training');
   const question=t.assessments.find(r=>r.id===brandQuestionId);assert.equal(question.department,'Operations');assert.equal(question.score,8);assert.equal(question.answer,'Saved answer before relocation');
   assert.equal(t.curriculumPhaseCorrections.length,1);assert.equal(t.version,versionBefore+1);
  });
  await act('state');
  await run(async store=>{const t=store.data.trainees.find(t=>t.id===learner.id);assert.equal(t.curriculumPhaseCorrections.length,1);assert.equal(t.version,versionBefore+1);});
  await run(async store=>store.transaction(db=>{
   const t=db.trainees.find(t=>t.id===learner.id);t.stage='Induction';
   const row=t.assessments.find(r=>r.id===brandQuestionId);
   t.assessments.push({id:'old-deployment-copy',department:'HR',question:row.question,score:null,answer:''});
  }));
  const hrAfterRollout=(await act('state')).trainees.find(t=>t.id===learner.id);
  assert.ok(hrAfterRollout.activeTraining.assessments.every(r=>r.id!==brandQuestionId&&r.id!=='old-deployment-copy'));
  await run(async store=>store.transaction(db=>{
   const t=db.trainees.find(t=>t.id===learner.id);t.certificate=null;
   t.phaseHistory=[{phase:'Operations Training',certificate:{id:'historical-cloud-certificate',phase:'Operations Training',score:8.5,by:'verify@example.test',at:new Date().toISOString()}}];
  }));
  const historical=await act('prepareCertificateShare',{traineeId:learner.id,certificateId:'historical-cloud-certificate',recipient:'trainee',channel:'email'});
  const historicalState=(await act('state')).trainees.find(t=>t.id===learner.id),draft=historicalState.communications[historical.kind];
  assert.equal(historicalState.certificate,null);assert.equal(historicalState.issuedCertificates[0].id,'historical-cloud-certificate');
  uploadedIds.push(draft.attachments[0].id);
  const historicalPdf=await act('communicationAttachment',{traineeId:learner.id,kind:historical.kind,attachmentId:draft.attachments[0].id});
  assert.equal(Buffer.from(historicalPdf.base64,'base64').subarray(0,5).toString(),'%PDF-');
  const crm=await act('createTrainee',{name:'CRM verification '+key,email:'crm@example.test',designation:'Counsellor',ownerId:owner,branch:'Test clinic',department:'Training',purpose:'Reskilling',trainingPhase:'CRM & Tech Training'});
  await run(async store=>store.transaction(db=>{
   const t=db.trainees.find(t=>t.id===crm.id);t.flowEnabled=true;
   t.trainingFlow={'CRM & Tech Training':{steps:Object.fromEntries(['Educate','Content','TheoryEvaluation','Mentor','Practical'].map(k=>[k,{complete:true,ref:'cloud-theory'}])),evaluations:{PracticalEvaluation:{score:null,ratings:[]}}}};
   t.lifecycle??={acknowledgements:[],events:[]};t.lifecycle.acknowledgements.push({kind:'flow-evaluation',ref:'cloud-theory'});
  }));
  const crmState=(await act('state')).trainees.find(t=>t.id===crm.id),criteria=crmState.flowCriteria.PracticalEvaluation;
  assert.ok(criteria.length>0);
  await act('flowEvaluation',{traineeId:crm.id,version:crmState.version,step:'PracticalEvaluation',ratings:criteria.map(c=>({id:c.id,score:8}))});
  const crmSaved=(await act('state')).trainees.find(t=>t.id===crm.id);
  assert.equal(crmSaved.flowRecord.evaluations.PracticalEvaluation.score,8);
  await act('flowComplete',{traineeId:crm.id,version:crmSaved.version,step:'PracticalEvaluation'});
  const crmNext=(await act('state')).trainees.find(t=>t.id===crm.id);
  assert.equal(crmNext.trainingFlowStatus.find(s=>s.key==='PracticalEvaluation').complete,true);
  assert.equal(crmNext.trainingFlowStatus.find(s=>s.key==='Handover').blockedBy,'PracticalAcknowledgement');
  assert.equal((await call('/api/setup',{name:'x',email:'other@example.test',password:'Temporary-password'})).status,409);
  await run(async store=>{store.transaction(db=>{db.verificationCount=0});await store.flush();});
  await Promise.all(Array.from({length:5},()=>run(async store=>{const n=store.data.verificationCount;await new Promise(r=>setTimeout(r,30));store.transaction(db=>{db.verificationCount=n+1});})));
  await run(async(store,runtime)=>{assert.equal(store.data.verificationCount,5);assert.throws(()=>store.transaction(db=>{db.verificationCount=99;throw Error('rollback')}));assert.equal(store.data.verificationCount,5);runtime.tests.set('test',{until:Date.now()+60000,uid:'u',questions:[{correctIndex:2}]});store.transaction(db=>db.outbox.push({id:'interrupted',status:'Sending'}));await store.flush();});
  await run(async(store,runtime)=>{assert.equal(runtime.tests.get('test').questions[0].correctIndex,2);createApp({store,runtime,scheduler:false});assert.equal(store.data.outbox.find(x=>x.id==='interrupted').status,'Delivery uncertain');});
  assert.equal((await call('/api/logout',{})).status,200);
  assert.equal((await call('/api/session')).body.user,null);
  assert.equal((await call('/api/login',{email:'verify@example.test',password:'Temporary-test-password-2026'})).status,200);
 } finally {if(uploadedIds.length)await db.query('DELETE FROM gleuhr_material_files WHERE id=ANY($1::text[])',[uploadedIds]);await db.query('DELETE FROM gleuhr_state WHERE id=$1',[key]);await db.end();}
});
