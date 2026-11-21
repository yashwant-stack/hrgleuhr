import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {curricula,curriculumFor,curriculumRows,curriculumText} from '../designation-curricula.js';
import {defaults,syncTrainee} from '../training-workflow.js';
import {activeTraining,practicalMentorProgress} from '../phase-training.js';
import {flowCriteria} from '../training-flow.js';
import {createApp} from '../server.js';

const db=()=>({trainingTemplates:structuredClone(defaults),customDesignations:{}});
const trainee=(designation,stage='Sales Training')=>({designation,stage,status:'Active',handovers:[],checklist:[],scores:[],assessments:[]});

test('all six workbooks supply full day plans and clean practical competencies',()=>{
 const expected=[['Counsellor',15,71,18,47],['Branch Manager',17,105,18,83],['Regional Head',18,35,56,54]];
 for(const [designation,duration,days,questions,tasks] of expected){
  const c=curriculumFor(designation);assert.equal(c.duration,duration);assert.equal(c.days.length,days);assert.equal(c.questions.length,questions);assert.equal(c.practical.flatMap(m=>m.tasks).length,tasks);
  assert.equal(c.sources.length,2);assert.ok(c.days.every(r=>r.source.row&&r.content&&r.day>=1&&r.day<=duration));
  const rows=curriculumRows(c).Checklist_Template;assert.equal(new Set(rows.map(r=>r.curriculumId)).size,rows.length);
  assert.ok(c.practical.every(m=>m.tasks.every(t=>!Object.hasOwn(t,'score')&&!Object.hasOwn(t,'date')&&!Object.hasOwn(t,'complete'))));
  assert.doesNotMatch(JSON.stringify(c),/Ms Meet Kaur|30th July 2026|23\/7\/26|Trainer signature: Dr Kimi/);
 }
 assert.equal(curriculumFor('RH').designation,'Regional Head');assert.equal(curriculumFor('BM').designation,'Branch Manager');assert.equal(curriculumFor('Counselor').designation,'Counsellor');
 assert.equal(curriculumFor('Custom BM',{customDesignations:{'Custom BM':'Branch Manager'}}).designation,'Branch Manager');
 assert.equal(curriculumFor('Receptionist'),null);
 assert.equal(curriculumFor('Loop',{customDesignations:{Loop:'Loop'}}),null);
 const c=curriculumFor('Counsellor');assert.match(c.practical.find(m=>m.id==='counsellor-m5').tasks[0].title,/at least 8/);
 assert.equal(c.practical.flatMap(m=>m.tasks).filter(r=>r.optional).length,1);
 assert.match(curriculumText(c),/Day 15/);assert.doesNotMatch(curriculumText(c),/Expected answer \/ evidence:/);
});

test('new and subsequent trainees get designation-specific phase content with independent progress',()=>{
 for(const designation of ['Counsellor','Branch Manager','Regional Head','BM']){
  const data=db(),one=trainee(designation),two=trainee(designation);syncTrainee(one,data);syncTrainee(two,data);
  const a=activeTraining(one,data),b=activeTraining(two,data);assert.ok(a.checklist.some(r=>r.curriculumId));assert.ok(a.checklist.some(r=>r.type==='Practical'));assert.ok(a.assessments.length);
  assert.equal(a.checklist.length,b.checklist.length);assert.notEqual(a.checklist[0].id,b.checklist[0].id);
  a.checklist[0].covered=true;assert.ok(b.checklist.every(r=>!r.covered));assert.ok(b.assessments.every(r=>r.score===null));
  const before=JSON.stringify(two);syncTrainee(two,data);assert.equal(JSON.stringify(two),before,'Sync is idempotent');
  assert.ok(two.checklist.some(r=>r.module==='Company Policy'),'Common HR induction retained');
  const key=curriculumFor(designation).key;assert.ok(b.checklist.filter(r=>r.curriculumId).every(r=>r.curriculumId.startsWith(key+'-')));
 }
 const t=trainee('Counsellor'),data=db();syncTrainee(t,data);t.mentor={phase:t.stage,tasks:activeTraining(t,data).checklist.filter(r=>r.type==='Practical'&&!r.optional).map(r=>({topicId:r.id,complete:true,evidence:'Observed'}))};
 assert.equal(practicalMentorProgress(t,data).ready,true);assert.ok(!flowCriteria(t,data,'PracticalEvaluation').some(r=>r.title.includes('Conversion #6')));
});

test('saved legacy phase work is preserved; the next phase adopts the supplied curriculum',()=>{
 const data=db(),t=trainee('Branch Manager','Induction');
 t.curriculumVersion='old';t.curriculumLegacyPhases=['Induction'];syncTrainee(t,data);delete t.curriculumVersion;delete t.curriculumLegacyPhases;
 t.checklist[0].covered=true;t.checklist[0].remarks='Existing evidence';t.trainingFlow={Induction:{steps:{Educate:{complete:true}},evaluations:{}}};
 const old=structuredClone(t.checklist);syncTrainee(t,data);assert.deepEqual(t.checklist,old);assert.deepEqual(t.curriculumLegacyPhases,['Induction']);
 t.stage='Operations Training';syncTrainee(t,data);assert.ok(activeTraining(t,data).checklist.some(r=>r.curriculumId==='bm-m1-6'));assert.equal(t.checklist.find(r=>r.id===old[0].id).remarks,'Existing evidence');
});

test('designation foundations belong to role training and never to HR Induction',()=>{
 for(const [designation,destination] of [['Counsellor','Sales Training'],['Branch Manager','Operations Training'],['Regional Head','Operations Training']]){
  const data=db(),t=trainee(designation,'Induction'),c=curriculumFor(designation);
  assert.ok(c.days.filter(r=>r.day===1).every(r=>r.phase===destination));
  assert.ok(curriculumRows(c).Checklist_Template.every(r=>r.Phase!=='Induction'));
  syncTrainee(t,data);
  const induction=activeTraining(t,data).checklist;
  assert.ok(induction.length);assert.ok(induction.every(r=>!r.curriculumId));
  assert.ok(induction.some(r=>r.module==='Company Policy'));
  t.stage=destination;syncTrainee(t,data);
  assert.ok(activeTraining(t,data).checklist.some(r=>r.curriculumId===c.key+'-day-2'));
  assert.ok(activeTraining(t,data).checklist.some(r=>r.curriculumId===c.key+'-overview-0'));
  assert.match(curriculumText(c),/separately from HR Induction/);
 }
});

test('common brand content is excluded from HR onboarding for every designation',()=>{
 const topics=['Company introduction & history','Vision, mission & core values','Clinics network & skincare product line overview'];
 const brandQuestion='Describe Gleuhr: its clinics network and its skincare product line.';
 for(const designation of ['Counsellor','Branch Manager','Regional Head','Receptionist','Therapist','Doctor','Accounts','Other']){
  const data=db(),t=trainee(designation,'Induction');syncTrainee(t,data);
  const hr=activeTraining(t,data).checklist;
  assert.ok(hr.every(r=>!topics.includes(r.topic)));
  assert.ok(activeTraining(t,data).assessments.every(r=>r.question!==brandQuestion));
  for(const topic of ['Organisation structure & key contacts','HRMS login & attendance process','Meet the team','Code of conduct'])assert.ok(hr.some(r=>r.topic===topic));
  // Existing saved common content is moved as well; no reset and no duplicate.
  delete t.curriculumPlacementVersion;t.version=4;
  t.checklist.push({id:'saved-brand',phase:'Induction',module:'Induction',topic:topics[0],covered:true,remarks:'Existing brand training evidence',type:'Theory'});
  t.assessments.push({id:'saved-brand-question',department:'HR',question:brandQuestion,score:9,rating:'Excellent',answer:'Saved brand answer',assessor:'trainer@example.test',at:'2026-11-17T08:00:00Z'});
  syncTrainee(t,data);assert.equal(t.version,5);
  t.stage=designation==='Counsellor'?'Sales Training':'Operations Training';syncTrainee(t,data);
  const saved=activeTraining(t,data).checklist.find(r=>r.id==='saved-brand');
  assert.equal(saved.phase,t.stage);assert.equal(saved.covered,true);assert.equal(saved.remarks,'Existing brand training evidence');
  assert.equal(t.checklist.filter(r=>r.topic===topics[0]).length,1);
  const assessment=activeTraining(t,data).assessments.find(r=>r.id==='saved-brand-question');
  assert.equal(assessment.score,9);assert.equal(assessment.answer,'Saved brand answer');assert.equal(assessment.assessor,'trainer@example.test');assert.equal(assessment.at,'2026-11-17T08:00:00Z');
  assert.equal(assessment.phase,t.stage);assert.equal(t.assessments.filter(r=>r.question===brandQuestion).length,1);
  // A request finishing on the previous deployment can re-add a blank HR copy.
  // Eligibility must respect the department of the corrected template.
  t.assessments.push({id:'stale-hr-copy',department:'HR',question:brandQuestion,score:null,answer:''});
  t.stage='Induction';syncTrainee(t,data);
  assert.ok(activeTraining(t,data).assessments.every(r=>r.question!==brandQuestion));
  t.stage=designation==='Counsellor'?'Sales Training':'Operations Training';
  assert.equal(activeTraining(t,data).assessments.filter(r=>r.question===brandQuestion).length,1);
 }
});

test('existing foundation rows move once with their saved work and historical decisions intact',()=>{
 for(const [designation,destination] of [['Counsellor','Sales Training'],['Branch Manager','Operations Training'],['Regional Head','Operations Training']]){
  const data=db(),t=trainee(designation,'Induction'),c=curriculumFor(designation);
  t.curriculumVersion=curricula.version;t.curriculumLegacyPhases=['Induction',destination];t.version=12;
  t.trainingFlow={Induction:{steps:{Educate:{complete:true}},evaluations:{TheoryEvaluation:{score:9,at:'2026-11-17'}}}};
  t.phaseHistory=[{phase:'Induction',journeySteps:{Learn:{complete:true}}}];
  t.checklist=[
   {id:'saved-foundation',curriculumId:c.key+'-day-2',phase:'Induction',type:'Theory',module:'Existing source module',topic:'Existing source topic',covered:true,removed:false,remarks:'Trainer verified with evidence',coveredAt:'2026-11-17T08:00:00Z',assessor:'trainer@example.test',at:'2026-11-17T08:00:00Z'},
   {id:'removed-foundation',curriculumId:c.key+'-overview-0',phase:'Induction',type:'Theory',module:'Existing overview',topic:'Existing overview topic',covered:false,removed:true,removedBy:'hr@example.test',remarks:'Previously removed'},
   {id:'custom-hr',custom:true,phase:'Induction',module:'Local HR process',topic:'Joining documents',covered:true,remarks:'Already received'}
  ];
  const originals=structuredClone(t.checklist),history=JSON.stringify([t.trainingFlow,t.phaseHistory]);
  syncTrainee(t,data);
  for(const before of originals.slice(0,2))assert.deepEqual(t.checklist.find(r=>r.id===before.id),{...before,phase:destination,curriculumPreviousPhase:'Induction'});
  assert.deepEqual(t.checklist.find(r=>r.id==='custom-hr'),originals[2]);
  assert.equal(JSON.stringify([t.trainingFlow,t.phaseHistory]),history);
  assert.equal(t.version,13);assert.equal(t.curriculumPhaseCorrections.length,1);assert.equal(t.curriculumPhaseCorrections[0].rows.length,2);
  assert.ok(activeTraining(t,data).checklist.every(r=>!r.curriculumId));
  const snapshot=JSON.stringify(t);syncTrainee(t,data);assert.equal(JSON.stringify(t),snapshot);
  // A destination already using legacy requirements still exposes the moved saved rows.
  t.stage=destination;syncTrainee(t,data);
  const imported=activeTraining(t,data).checklist.filter(r=>r.curriculumId);
  assert.deepEqual(imported.map(r=>r.id).sort(),['removed-foundation','saved-foundation']);
  assert.equal(imported.find(r=>r.id==='saved-foundation').remarks,originals[0].remarks);
  assert.equal(t.version,13);
 }
});

test('HTTP curriculum access, evidence validation, restart persistence and next learner isolation',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-curriculum-'));ctx.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let app=createApp({dataDir:dir,scheduler:false,mailer:{configured:false,send:async()=>{throw Error('No external email');}}}),cookie='';
 const call=async(url,data,auth=cookie)=>{const req=Readable.from(data?[JSON.stringify(data)]:[]);req.url=url;req.method=data?'POST':'GET';req.headers={host:'localhost',origin:'http://localhost','content-type':'application/json',cookie:auth};req.socket={remoteAddress:'127.0.0.1'};const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);},end(body){this.body=JSON.parse(body);}};await app.handler(req,res);if(res.headers['Set-Cookie'])cookie=res.headers['Set-Cookie'].split(';')[0];return res;};
 const act=(action,payload={},auth=cookie)=>call('/api/action',{action,payload},auth),ok=async p=>{const r=await p;assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 await ok(call('/api/setup',{name:'Synthetic HR',email:'hr@example.test',password:'Synthetic-test-password'}));
 const user=(await ok(call('/api/session'))).user;
 const first=await ok(act('createTrainee',{name:'First demo',designation:'Counsellor',ownerId:user.id,branch:'Demo clinic',department:'Training',purpose:'Reskilling',trainingPhase:'Sales Training'}));
 let t=app.store.data.trainees.find(t=>t.id===first.id);app.store.transaction(()=>{t.flowEnabled=false;t.lifecycleRequired=false;t.mentor={userId:user.id,phase:t.stage,tasks:[]};});
 const task=practicalMentorProgress(t,app.store.data).tasks.find(r=>r.evidenceRequired);
 assert.equal((await act('mentorTask',{traineeId:t.id,taskId:task.id,complete:true})).status,400);
 await ok(act('mentorTask',{traineeId:t.id,taskId:task.id,complete:true,evidence:'Observed role-play; evidence recorded in training log.'}));
 const pdf=await ok(act('curriculumDownload',{traineeId:t.id}));assert.equal(Buffer.from(pdf.base64,'base64').subarray(0,5).toString(),'%PDF-');assert.ok(Buffer.from(pdf.base64,'base64').length<2*1024*1024);
 assert.equal((await act('curriculumDownload',{traineeId:t.id},'')).status,401);
 app=createApp({dataDir:dir,scheduler:false,mailer:{configured:false}});await ok(call('/api/login',{email:'hr@example.test',password:'Synthetic-test-password'}));
 const second=await ok(act('createTrainee',{name:'Second demo',designation:'Counsellor',ownerId:user.id,branch:'Demo clinic',department:'Training',purpose:'Reskilling',trainingPhase:'Sales Training'}));
 const state=await ok(act('state')),prior=state.trainees.find(r=>r.id===first.id),next=state.trainees.find(r=>r.id===second.id);
 assert.match(prior.practicalMentor.tasks.find(r=>r.id===task.id).evidence,/Observed role-play/);assert.equal(next.curriculum.duration,15);assert.ok(next.activeTraining.checklist.every(r=>!r.covered));assert.equal(next.practicalMentor.complete,0);
 assert.equal(state.outbox.length,0);
});
