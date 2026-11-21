import vm from 'node:vm';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {materials,materialForPhase,materialPhases} from '../training-materials.js';
import {createApp} from '../server.js';import {matchesDesignation,defaults} from '../training-workflow.js';import {phaseQuestions,activeTraining,switchTrainingPhase,phaseScore} from '../phase-training.js';
test('designation isolation and phase-specific question pools',()=>{
 const db={trainingTemplates:structuredClone(defaults),customDesignations:{Custom:'Receptionist'}};
 assert.equal(matchesDesignation('Doctor','Unknown',db),false);assert.equal(matchesDesignation('Doctor','Other',db),false);assert.equal(matchesDesignation('All','Unknown',db),true);assert.equal(matchesDesignation('Receptionist','Custom',db),true);
 const t={designation:'Branch Manager',stage:'Induction',assessments:[{department:'HR',question:'Custom HR',score:8}],checklist:[],scores:[]};
 const hr=phaseQuestions(t,db,{questions:[],modules:[]});assert.ok(hr.length);assert.ok(hr.every(q=>q.moduleId==='phase-HR'));
 switchTrainingPhase(t,'Sales Training');assert.equal(t.assessments[0].score,null);assert.equal(t.phaseHistory[0].assessments[0].score,8);assert.equal(activeTraining(t,db).assessments.length,0);
 assert.ok(phaseQuestions(t,db,{questions:[],modules:[]}).every(q=>q.moduleId==='phase-Sales'));
});
test('real journey saves atomically, blocks skipped steps, grades only current phase and preserves history',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-phase-flow-'));const app=createApp({dataDir:dir,scheduler:false,mailer:{configured:false}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 let cookie;const call=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});cookie??=r.headers.get('set-cookie')?.split(';')[0];return {status:r.status,data:await r.json()};};
 const act=(action,payload={})=>call('/api/action',{action,payload});await call('/api/setup',{name:'Test HR',email:'hr@example.test',password:'long-test-password'});
 assert.equal((await act('createTrainee',{name:'Missing required',designation:'Branch Manager'})).status,400);
 const created=await act('createTrainee',{name:'Phase trainee',email:'phase@example.test',designation:'Branch Manager',branch:'Test clinic',department:'Sales',purpose:'Reskilling',ownerId:app.store.data.users[0].id});assert.equal(created.status,200);app.store.data.trainees.find(t=>t.id===created.data.id).lifecycleRequired=false; // Legacy phase engine fixture; new lifecycle gates tested separately.
 const id=created.data.id,state=async()=>(await act('state')).data.trainees.find(t=>t.id===id),run=(action,p={})=>act(action,{traineeId:id,...p});let t=await state();
 assert.equal(t.department,'Sales');assert.equal(t.purpose,'Reskilling');assert.ok(t.testModules.every(m=>m.id==='phase-HR'));
 assert.equal((await run('startTest')).status,409);
 await run('journeyStep',{step:'Start',complete:true});t=await state();
 let rows=t.activeTraining.checklist.map(r=>({id:r.id,covered:true,contentShared:true}));assert.ok(rows.length);
 assert.equal((await run('saveTrainingRows',{version:t.version,kind:'checklist',rows:rows.map((r,i)=>({...r,covered:i!==0}))})).status,400);
 assert.ok(!(await state()).activeTraining.checklist.some(r=>r.covered));
 assert.equal((await run('saveTrainingRows',{version:t.version-1,kind:'checklist',rows})).status,409);
 assert.equal((await run('saveTrainingRows',{version:t.version,kind:'checklist',rows})).status,200);
 t=await state();assert.equal(t.journey.Learn.complete,false);
 assert.equal((await run('assignMentor',{mentorId:app.store.data.users[0].id,focus:'Complete phase practical tasks'})).status,200);
 for(const task of (await state()).practicalMentor.tasks)assert.equal((await run('mentorTask',{taskId:task.id,complete:true})).status,200);
 t=await state();assert.equal(t.journey.Learn.complete,true);assert.ok(t.activeTraining.checklist.every(r=>r.contentShared));
 assert.equal((await run('saveTrainingRows',{version:t.version,kind:'checklist',rows})).status,409);
 for(const row of t.activeTraining.assessments)assert.equal((await run('assessment',{itemId:row.id,rating:'Good'})).status,200);
 t=await state();assert.ok(t.activeTraining.assessments.every(r=>r.rating==='Good'&&r.score===7));
 assert.ok(JSON.parse(fs.readFileSync(path.join(dir,'database.json'),'utf8')).trainees.find(x=>x.id===id).assessments.filter(r=>r.department==='HR').every(r=>r.rating==='Good'&&r.score===7));
 assert.equal((await run('record',{kind:'evaluation',title:'Induction review',notes:'Trainer reviewed all induction topics.',status:'Completed',score:80})).status,200);
 t=await state();assert.equal(t.journey.Practice,undefined);assert.equal(t.journey.Test.blockedBy,null);
 assert.equal((await run('startTest',{moduleId:1})).status,400);
 const attempt=await run('startTest',{moduleId:'phase-HR'});assert.equal(attempt.status,200);assert.ok(attempt.data.questions.every(q=>q.correctIndex===undefined&&q.moduleId==='phase-HR'));
 const result=await run('submitTest',{testId:attempt.data.id,answers:attempt.data.questions.map(()=>0)});assert.equal(result.status,200);assert.equal(result.data.phase,'Induction');
 t=await state();assert.equal(t.journey.Test.complete,false);
 assert.equal((await run('saveTrainingRows',{version:t.version,kind:'scores',rows:t.activeTraining.scores.map(r=>({id:r.id,score:8}))})).status,200);
 t=await state();assert.equal(t.journey.Test.complete,true);assert.equal(typeof t.phaseScore,'number');
 assert.equal((await run('certificate',{note:'Reviewed',nextTraining:'Sales Training'})).status,200);
 t=await state();assert.equal(t.certificate.phase,'Induction');assert.equal(t.journey.Finish.ready,true);assert.equal(t.journey.Finish.complete,false);
 assert.equal((await run('journeyStep',{step:'Finish',complete:true})).status,200);
 assert.equal((await run('draftHandover',{stage:'Sales Training',email:'hr@example.test'})).status,400);
 const draft=await run('draftHandover',{stage:'Sales Training',email:'hr@example.test',ownerName:'Test HR',note:'Induction reviewed. Continue Sales.'});assert.equal(draft.status,200);
 assert.equal((await run('activateHandover',{handoverId:draft.data.handoverId})).status,200);
 t=await state();assert.equal(t.stage,'Sales Training');assert.equal(t.journey.Start.complete,true);assert.equal(t.journey.Learn.complete,false);assert.equal(t.certificate,null);assert.equal(t.phaseHistory[0].certificate.phase,'Induction');assert.equal(t.phaseScore,null);
 assert.ok(t.testModules.some(m=>m.id==='phase-Sales'));assert.ok(!t.testModules.some(m=>m.id==='phase-HR'));
 assert.equal((await run('checklist',{itemId:rows[0].id,covered:false})).status,400);
 assert.equal((await run('communicationSave',{kind:'handover:'+draft.data.handoverId,to:'hr@example.test',subject:'Training handover',body:'Induction completed.',attachments:[]})).status,200);
});
test('correction requests require reason and admin approval; mentor can be assigned before practical completion',async ctx=>{
 const sent=[];let mailFailure=false;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-corrections-')),app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,send:async m=>{if(mailFailure)throw Error('SMTP timeout');sent.push(m);return {messageId:'test-message'};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 let cookie;const call=async(route,body,c=cookie)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(c?{Cookie:c}:{})},body:JSON.stringify(body)});cookie??=r.headers.get('set-cookie')?.split(';')[0];return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const act=(action,payload={},c=cookie)=>call('/api/action',{action,payload},c);await call('/api/setup',{name:'Admin',email:'admin@example.test',password:'long-test-password'});
 const owner=(await act('createUser',{name:'Trainer',email:'trainer@example.test',password:'long-test-password',role:'trainer'})).data;
 const trainer=(await call('/api/login',{email:owner.email,password:'long-test-password'})).cookie;
 const t=(await act('createTrainee',{name:'Correction trainee',designation:'Branch Manager',branch:'Delhi',department:'Operations',ownerId:owner.id})).data;
 app.store.data.trainees.find(x=>x.id===t.id).lifecycleRequired=false;
 const p={traineeId:t.id};await act('journeyStep',{...p,step:'Start',complete:true});
 assert.equal((await act('requestUnlock',{...p,step:'Start',reason:''},trainer)).status,400);
 assert.equal((await act('journeyStep',{...p,step:'Start',complete:false},trainer)).status,403);
 assert.equal((await act('requestUnlock',{...p,step:'Start',reason:'Correct welcome designation'},trainer)).status,200);
 let state=(await act('state')).data,request=state.unlockRequests[0];assert.equal(request.status,'Pending');assert.equal(state.trainees[0].journey.Start.complete,true);
 assert.equal((await act('reviewUnlock',{...p,requestId:request.id,decision:'Approved'},trainer)).status,403);
 assert.equal((await act('reviewUnlock',{...p,requestId:request.id,decision:'Approved'})).status,200);
 state=(await act('state')).data;assert.equal(state.trainees[0].journey.Start.complete,false);assert.equal(state.trainees[0].journey.Handover.blockedBy,'Start');assert.equal(state.unlockRequests[0].reviewedBy,'admin@example.test');
 assert.equal(sent.length,1);assert.equal(sent[0].to,'admin@example.test');assert.match(sent[0].subject,/Correction approval requested/);assert.match(sent[0].html,/Review correction request/);sent.length=0;
 assert.equal((await act('state')).data.trainees[0].practicalMentor.assigned,false);
 const stored=app.store.data.trainees[0];stored.status='Completed';
 assert.equal((await act('assignMentor',{...p,mentorId:owner.id,focus:''})).status,400);
 assert.equal((await act('assignMentor',{...p,mentorId:owner.id,focus:'Guide practical CRM and first-week desk tasks.'})).status,200);
 state=(await act('state')).data;assert.equal(state.trainees[0].mentor.userId,owner.id);assert.ok(state.clinics.includes('Delhi West'));assert.ok(state.departments.includes('Chat Support'));
 assert.equal(sent.length,1);assert.equal(sent[0].to,owner.email);assert.match(sent[0].body,/Guide practical CRM/);assert.match(sent[0].body,/Designation: Branch Manager/);assert.match(sent[0].body,/Clinic: Delhi/);
 const mentor=state.trainees[0].mentor,kind='mentor:'+mentor.id;
 assert.equal(state.trainees[0].communications[kind].status,'Sent');
 assert.equal((await act('assignMentor',{...p,mentorId:owner.id,startDate:mentor.startDate,focus:mentor.focus})).data.emailSent,true);assert.equal(sent.length,1);
 assert.equal((await act('communicationSend',{...p,kind})).status,200);assert.equal(sent.length,1);
 mailFailure=true;const failed=await act('assignMentor',{...p,mentorId:owner.id,focus:'Updated practical guidance'});assert.equal(failed.data.emailSent,false);assert.match(failed.data.emailError,/not confirmed/);
 state=(await act('state')).data;const failedKind='mentor:'+state.trainees[0].mentor.id;assert.equal(state.trainees[0].communications[failedKind].status,'Delivery uncertain');
 assert.equal((await act('communicationSend',{...p,kind:failedKind})).status,409);
 const message=state.outbox.find(m=>m.kind===failedKind);
 assert.equal((await act('communicationResolve',{...p,kind:failedKind,messageId:message.id,result:'not-sent',note:'Verified fake mailbox'},trainer)).status,403);
 assert.equal((await act('communicationResolve',{...p,kind:failedKind,messageId:message.id,result:'not-sent',note:'Verified fake mailbox'})).status,200);
 mailFailure=false;assert.equal((await act('communicationSend',{...p,kind:failedKind})).status,200);assert.equal(sent.length,2);

});

test('materials require both designation and current phase',()=>{const db={customDesignations:{}};const t={designation:'Branch Manager',stage:'Induction'};const visible=materials.filter(m=>materialForPhase(m,t,db));assert.ok(visible.some(m=>m.group==='HR'));assert.ok(!visible.some(m=>/CRM|CrossSell/.test(m.title)));assert.ok(!visible.some(m=>/Counsellor KRA/.test(m.title)));t.stage='CRM & Tech Training';assert.ok(materials.filter(m=>materialForPhase(m,t,db)).every(m=>m.group==='Clinic Crm Training'));assert.deepEqual(materialPhases({title:'Custom',group:'Uploaded',phases:['Sales Training']}),['Sales Training']);});

test('phase test selector sends the selected module unchanged',async()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const handler=source.slice(source.indexOf('if (action === "startTest"'),source.indexOf('if (action === "cancelTest"'));
 for(const moduleId of ['phase-HR','phase-Sales','phase-Tech','3','']){
  let sent;const context=vm.createContext({action:'startTest',selected:'trainee',view:'trainees',section:'Tests',test:null,$:()=>({value:moduleId}),api:async(action,payload)=>{sent=payload;return {id:'attempt'};},render(){},window:{scrollTo(){}}});
  await vm.runInContext('(async()=>{'+handler+'})()',context);assert.equal(sent.moduleId,moduleId||null);assert.equal(sent.traineeId,'trainee');
 }
});

test('live phase score uses saved assessment ratings when the phase has no score criteria',()=>{const t={stage:'Induction',designation:'Branch Manager',checklist:[],scores:[],assessments:[{department:'HR',score:7},{department:'HR',score:10}]};assert.equal(phaseScore(t,[],{}),8.5);});
test('Induction and Onboarding share the same active records without resetting progress',()=>{
 const t={stage:'Induction',designation:'Branch Manager',checklist:[{id:'a',phase:'Induction'},{id:'b',phase:'Onboarding'},{id:'c',phase:'Sales Training'}],scores:[{id:'s',phase:'Onboarding',score:8}],assessments:[]};
 assert.deepEqual(activeTraining(t,{}).checklist.map(r=>r.id),['a','b']);assert.equal(activeTraining(t,{}).scores.length,1);switchTrainingPhase(t,'Onboarding');assert.equal(t.scores[0].score,8);assert.equal(t.phaseHistory,undefined);
});
