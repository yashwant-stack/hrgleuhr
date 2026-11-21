import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server.js';import {switchTrainingPhase} from '../phase-training.js';
test('assigned mentor alone completes phase practical tasks; certificates share as PDFs to trainee and next trainer',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mentor-certificate-')),sent=[],app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,send:async m=>{sent.push(m);return {messageId:'fake'};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 let admin;const call=async(route,body,cookie=admin)=>{const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const act=(action,payload={},cookie=admin)=>call('/api/action',{action,payload},cookie);
 admin=(await call('/api/setup',{name:'HR',email:'hr@example.test',password:'test-password-long'})).cookie;
 const mentor=(await act('createUser',{name:'Mentor',email:'mentor@example.test',password:'test-password-long',role:'trainer'})).data;
 const mc=(await call('/api/login',{email:mentor.email,password:'test-password-long'})).cookie;
 const t=(await act('createTrainee',{name:'employee',designation:'Branch Manager',email:'employee@example.test',phone:'919999999999',branch:'Delhi',department:'Clinic',ownerId:app.store.data.users[0].id})).data,p={traineeId:t.id};
 assert.equal(t.name,'Employee');assert.equal(t.trainerName,'HR');
 await act('journeyStep',{...p,step:'Start',complete:true});
 const stored=app.store.data.trainees.find(x=>x.id===t.id);stored.checklist.forEach(r=>r.covered=true);stored.phaseSaves={checklist:{}};
 assert.equal((await act('journeyStep',{...p,step:'Learn',complete:true})).status,409);
 assert.equal((await act('certificate',p)).status,409);
 assert.equal((await act('prepareCertificateShare',{...p,recipient:'trainee',channel:'email'})).status,400);
 assert.equal((await act('assignMentor',{...p,mentorId:mentor.id,focus:'Observe and guide all practical tasks.'})).status,200);
 assert.match(sent[0].body,/My mentor tasks/);assert.match(sent[0].html,/Open my practical tasks/);assert.match(sent[0].html,/view=mentoring/);
 let ms=(await act('state',{},mc)).data;assert.equal(ms.trainees.length,0);assert.equal(ms.mentorAssignments.length,1);
 const tasks=ms.mentorAssignments[0].progress.tasks;assert.ok(tasks.length>0);
 assert.equal((await act('mentorTask',{...p,taskId:tasks[0].id,complete:true})).status,403);
 assert.equal((await act('mentorTask',{...p,taskId:'invalid',complete:true},mc)).status,400);
 for(const task of tasks)assert.equal((await act('mentorTask',{...p,taskId:task.id,complete:true},mc)).status,200);
 let state=(await act('state')).data.trainees[0];assert.equal(state.practicalMentor.complete,tasks.length);assert.equal(state.journey.Learn.complete,true);
 assert.equal((await act('mentorTask',{...p,taskId:tasks[0].id,complete:false},mc)).status,409);
 // Certificate issuance is tested by phase-flow; seed an issued immutable record here for transport testing.
 stored.certificate={id:'issued',phase:stored.stage,score:8.5,nextTraining:'Sales Training',by:'hr@example.test',at:new Date().toISOString()};
 for(const recipient of ['trainee','next']){
  const prepared=await act('prepareCertificateShare',{...p,recipient,userId:mentor.id,channel:'whatsapp',phone:'918888888888'});assert.equal(prepared.status,200);
  const kind=prepared.data.kind,share=await act('communicationShare',{...p,kind});assert.equal(share.status,200);assert.equal(share.data.phone,'918888888888');assert.equal(share.data.recipientName,recipient==='next'?'Mentor':'Employee');assert.equal(Buffer.from(share.data.letter.base64,'base64').subarray(0,4).toString(),'%PDF');
  assert.equal((await act('communicationSend',{...p,kind})).status,200);assert.equal(sent.at(-1).to,recipient==='next'?mentor.email:t.email);assert.equal(sent.at(-1).attachments[0].filename,'Training-certificate.pdf');
  const count=sent.length;await act('communicationSend',{...p,kind});assert.equal(sent.length,count);
 }
 assert.equal((await act('prepareCertificateShare',{...p,recipient:'next',userId:mentor.id,channel:'whatsapp'})).status,400);
 assert.equal((await act('prepareCertificateShare',{...p,recipient:'trainee',channel:'email'},mc)).status,403);
 switchTrainingPhase(stored,'Sales Training');state=(await act('state')).data.trainees[0];assert.equal(state.practicalMentor.assigned,false);assert.equal((await act('state',{},mc)).data.mentorAssignments.length,0);
 assert.equal((await act('mentorTask',{...p,taskId:tasks[0].id,complete:true},mc)).status,403);
 // A phase handover must not strand the certificate or pretend that a repeat send happened.
 assert.equal(stored.certificate,null);assert.equal(state.issuedCertificates[0].id,'issued');
 const oldKind='certificate:issued:trainee',oldCommunication=structuredClone(stored.communications[oldKind]),before=sent.length;
 assert.ok(state.communications[oldKind].sentAt);
 const oldAttachment=await act('communicationAttachment',{...p,kind:oldKind,attachmentId:oldCommunication.attachments[0].id});
 assert.equal(oldAttachment.status,200);assert.equal(Buffer.from(oldAttachment.data.base64,'base64').subarray(0,5).toString(),'%PDF-');
 const preparedAgain=await act('prepareCertificateShare',{...p,certificateId:'issued',recipient:'trainee',channel:'email'});
 assert.equal(preparedAgain.status,200);assert.equal(preparedAgain.data.alreadySent,true);
 assert.deepEqual(stored.communications[oldKind],oldCommunication,'Preparing an already sent certificate does not overwrite its reviewed recipients or PDF');
 assert.equal((await act('communicationSend',{...p,kind:oldKind})).data.alreadySent,true);assert.equal(sent.length,before);
 assert.equal((await act('communicationResend',{...p,kind:oldKind,communicationId:oldCommunication.id})).status,409);
 assert.equal((await act('communicationResend',{...p,kind:oldKind,communicationId:oldCommunication.id,confirm:true})).status,200);
 assert.equal(sent.length,before+1);assert.equal(sent.at(-1).to,t.email);assert.equal(sent.at(-1).attachments[0].filename,'Training-certificate.pdf');
 assert.equal(stored.certificate,null);assert.equal(stored.stage,'Sales Training');assert.equal(stored.phaseHistory[0].certificate.id,'issued');
 assert.equal((await act('prepareCertificateShare',{...p,certificateId:'missing',recipient:'trainee',channel:'email'})).status,404);
 assert.equal((await act('prepareCertificateShare',{...p,certificateId:'issued',recipient:'trainee',channel:'email'},mc)).status,403);
 // Jerry's case: issued, then handed over before the first certificate email.
 stored.phaseHistory.push({phase:'Operations Training',certificate:{id:'never-sent',phase:'Operations Training',score:8,at:new Date().toISOString(),by:'hr@example.test'}});
 const firstHistoryShare=await act('prepareCertificateShare',{...p,certificateId:'never-sent',recipient:'trainee',channel:'email'});assert.equal(firstHistoryShare.status,200);
 assert.equal((await act('communicationSend',{...p,kind:firstHistoryShare.data.kind})).status,200);
 assert.match(sent.at(-1).subject,/Operations Training/);assert.equal(sent.at(-1).attachments[0].content.subarray(0,5).toString(),'%PDF-');
 stored.archivedEntries=[{kind:'certificate',entry:stored.phaseHistory.at(-1).certificate}];
 assert.equal((await act('prepareCertificateShare',{...p,certificateId:'never-sent',recipient:'trainee',channel:'email'})).status,404);
});
