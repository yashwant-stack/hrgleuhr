import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server.js';
import {canonicalPhase,orderedPhases,phaseLabel} from '../training-phases.js';
import {initializeWorkflow} from '../training-workflow.js';
import {openStore} from '../store.js';

test('legacy final review merges without losing reviews, certificates or saved phase work; assets remain last',ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'merge-review-'));ctx.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=openStore(dir);
 const t={id:'t',stage:'Final Review & Confirmation',stageOrder:['Asset Allotment','Final Review & Confirmation','Induction','Final Feedback','Onboard Final Email'],designation:'Counsellor',handovers:[],checklist:[],scores:[],assessments:[],feedbackRows:[{id:'f',comments:'Prior review'}],phaseHistory:[{phase:'Final Feedback',certificate:{id:'keep'}}],trainingFlow:{'Final Review & Confirmation':{steps:{Start:{complete:true}}}}};
 store.data.trainees.push(t);initializeWorkflow(store.data);assert.equal(t.stage,'Final Feedback');assert.equal(phaseLabel(t.stage),'Final Feedback & Confirmation');assert.deepEqual(t.stageOrder,['Induction','Final Feedback','Onboard Final Email','Asset Allotment']);assert.equal(t.feedbackRows[0].id,'f');assert.equal(t.phaseHistory[0].certificate.id,'keep');assert.equal(t.trainingFlow['Final Review & Confirmation'].steps.Start.complete,true);
 assert.equal(canonicalPhase('Final Feedback & Confirmation'),'Final Feedback');assert.equal(orderedPhases(['Asset Allotment','Final Review & Confirmation','Final Feedback']).length,2);
});

test('HR assessment emails the trainee once; final confirmation email precedes acknowledged asset allotment',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-assets-api-')),sent=[];
 const app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,send:async m=>{sent.push(m);return {messageId:'mock-'+sent.length};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});let cookie;
 const base='http://127.0.0.1:'+app.server.address().port;
 const call=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const act=(action,payload={})=>call('/api/action',{action,payload,includeState:true});
 cookie=(await call('/api/setup',{name:'HR',email:'hr@example.test',password:'test-password-long'})).cookie;
 const owner=app.store.data.users[0];const created=(await act('createTrainee',{name:'Demo Learner',designation:'Counsellor',email:'learner@example.test',branch:'Demo',department:'Training',ownerId:owner.id})).data;
 const get=()=>app.store.data.trainees.find(t=>t.id===created.id);get().stage='Final Feedback';get().flowEnabled=true;
 const payload=p=>({traineeId:created.id,version:get().version,...p});
 const answers={departments:'Complete',discipline:'Satisfactory',feedback:'Yes',gaps:'None',documentation:'Yes'};
 let r=await act('saveTransitionAssessment',payload({kind:'hr',answers}));assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal(sent.length,1);assert.equal(sent[0].to,'learner@example.test');assert.match(sent[0].body,/Demo Learner/);assert.match(sent[0].html,/acknowledge/i);assert.match(sent[0].body,/Attendance and discipline/);
 const review=get().transitionAssessments[0];assert.equal(app.store.data.lifecycleNotifications[0].assessmentId,review.id);
 r=await act('emailTransitionAssessment',payload({assessmentId:review.id}));assert.equal(r.status,200);assert.equal(sent.length,1);
 const before=get().version;r=await act('saveTransitionAssessment',{traineeId:created.id,version:before-1,kind:'hr',answers});assert.equal(r.status,409);assert.equal(sent.length,1);
 r=await act('finalFeedback',payload({rating:'Good',completion:'Complete',strengths:'Communication',improve:'None',comments:'Ready for onboarding',decision:'continue',ownerId:owner.id}));assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(get().stage,'Onboard Final Email');assert.equal(r.data.state.trainees[0].trainingFlowStatus.length,0);
 assert.equal(r.data.state.stages.filter(s=>canonicalPhase(s)==='Final Feedback').length,1);assert.equal(r.data.state.stages.at(-1),'Asset Allotment');
 r=await act('lifecycleAssets',payload({assets:[],reason:'No assets needed'}));assert.equal(r.status,400);
 r=await act('communicationSave',payload({kind:'final',to:get().email,cc:'',phone:'',subject:'Onboarding confirmed',body:'Dear Demo Learner, your training is confirmed. Asset allotment is next.',attachments:[]}));assert.equal(r.status,200,JSON.stringify(r.data));
 r=await act('communicationApprove',payload({kind:'final',reviewed:true,revision:get().communications.final.revision}));assert.equal(r.status,200,JSON.stringify(r.data));
 r=await act('communicationSend',payload({kind:'final'}));assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(get().stage,'Asset Allotment');assert.equal(get().status,'Active');assert.ok(get().finalEmailSentAt);
 r=await act('lifecycleAssets',payload({assets:[{type:'Laptop',details:'DEMO-001',date:'2026-11-18'}]}));assert.equal(r.status,200,JSON.stringify(r.data));
 r=await act('completeAssetAllotment',payload({}));assert.equal(r.status,409);
 const assetEmail=sent.find(m=>m.subject==='Asset receipt: Laptop');assert.ok(assetEmail);assert.equal(assetEmail.to,'learner@example.test');const token=assetEmail.body.match(/#([a-f0-9]{64})/)[1];
 r=await call('/api/ack',{token,submit:true,confirm:true,name:'Demo Learner'});assert.equal(r.status,200);
 r=await act('completeAssetAllotment',payload({}));assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(get().status,'Completed');assert.equal(get().stage,'Asset Allotment');assert.ok(get().closedAt);assert.equal(r.data.state.trainees[0].journey.Finish.complete,true);
});
