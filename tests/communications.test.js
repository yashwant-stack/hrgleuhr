import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../store.js';
import {communicationService} from '../communications.js';
const admin={id:'a',email:'hr@example.test',role:'admin'},trainer={id:'b',email:'trainer@example.test',role:'trainer'};
function fixture(ctx,send){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-communications-'));ctx.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=openStore(dir),sent=[];
 store.transaction(db=>db.trainees.push({id:'t',name:'Trainee',email:'trainee@example.test',phone:'919999999999',designation:'Therapist',branch:'Clinic',joiningDate:'2026-10-01',ownerId:'b',stage:'Induction',status:'Active',version:1,checklist:[],scores:[],assessments:[],handovers:[],feedbackRows:[]}));
 const service=communicationService({store,mailer:{configured:true,send:send|| (async m=>{sent.push(m);return {messageId:'mock'};})},trainee:(u,p)=>{const t=store.data.trainees.find(t=>t.id===p.traineeId);if(!t||u.role!=='admin'&&t.ownerId!==u.id)throw Object.assign(Error('Forbidden'),{status:403});return t;},audit:(db,u,action,traineeId,detail)=>db.audit.push({action,traineeId,detail})});
 const run=(name,p={},u=admin)=>service.run(u,name,{traineeId:'t',kind:'welcome',...p});
 const save=(p={})=>run('communicationSave',{to:'trainee@example.test',cc:'',phone:'919999999999',subject:'Welcome',body:'Welcome to the team',attachments:[],...p});
 const approve=(kind='welcome')=>run('communicationApprove',{kind,reviewed:true,revision:store.data.trainees[0].communications[kind].revision});
 return {store,sent,service,run,save,approve,t:()=>store.data.trainees[0]};
}
test('Welcome requires exact HR approval, optional attachments and explicit send',async ctx=>{
 const f=fixture(ctx);await f.save();assert.equal(f.sent.length,0);
 for(const name of ['communicationShare','communicationSend'])await assert.rejects(f.run(name),/approve/);
 await assert.rejects(f.run('communicationApprove',{reviewed:true,revision:1},trainer),/HR/);
 await assert.rejects(f.run('communicationApprove',{revision:1}),/Review/);
 await assert.rejects(f.run('communicationApprove',{reviewed:true,revision:0}),/Review/);
 await f.approve();assert.equal(f.sent.length,0);
 assert.equal((await f.run('communicationShare',{},trainer)).body,'Welcome to the team');
 await f.run('communicationSend');assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,'trainee@example.test');assert.equal(f.t().communications.welcome.sentBy,admin.email);
 assert.equal((await f.run('communicationSend')).alreadySent,true);assert.equal(f.sent.length,1);
 await assert.rejects(f.save(),/already been sent/);
});
test('Content and profile edits invalidate approval; other trainee is forbidden',async ctx=>{
 const f=fixture(ctx);await f.save();await f.approve();await f.save({to:'new@example.test'});assert.equal(f.service.view(f.t()).welcome.approved,false);await assert.rejects(f.run('communicationSend'),/approve/);
 await f.approve();f.store.transaction(()=>f.t().phone='918888888888');assert.equal(f.service.view(f.t()).welcome.status,'Approval expired');await assert.rejects(f.run('communicationShare'),/approve/);
 await assert.rejects(f.run('communicationSend',{}, {...trainer,id:'other'}),/Forbidden/);
});
test('Attachments stay private until approval and are delivered as actual files',async ctx=>{
 const f=fixture(ctx);const base64=Buffer.from('%PDF-1.4\nmock test bytes').toString('base64');await f.save({attachments:[{filename:'Welcome.pdf',base64}]});const attachmentId=f.t().communications.welcome.attachments[0].id;
 await assert.rejects(f.run('communicationAttachment',{attachmentId},trainer),/approve/);
 assert.equal((await f.run('communicationAttachment',{attachmentId})).base64,base64);
 await f.approve();assert.equal((await f.run('communicationShare',{},trainer)).attachments[0].base64,base64);
 await f.run('communicationSend');assert.equal(f.sent[0].attachments.find(a=>a.filename==='Welcome.pdf').content.toString(),Buffer.from(base64,'base64').toString());
 const g=fixture(ctx);await assert.rejects(g.save({attachments:[{filename:'fake.pdf',base64:Buffer.from('bad').toString('base64')}]}),/Invalid/);
 await assert.rejects(g.save({attachments:[{id:attachmentId}]}),/Invalid/);
});
test('Final approval requires final stage, satisfactory feedback and Confirm; edits expire it',async ctx=>{
 const f=fixture(ctx);await f.save({kind:'final',to:'management@example.test'});
 await assert.rejects(f.approve('final'),/Complete Final/);
 f.store.transaction(()=>{f.t().stage='Final Review & Confirmation';f.t().feedbackRows=[{rating:'Average',recommendation:'Confirm',comments:'Review'}];});
 await assert.rejects(f.approve('final'),/Good/);
 f.store.transaction(()=>{f.t().feedbackRows[0].rating='Good';f.t().feedbackRows[0].recommendation='Extend Training';});await assert.rejects(f.approve('final'),/Confirm/);
 f.store.transaction(()=>f.t().feedbackRows[0].recommendation='Confirm');await f.approve('final');
 f.store.transaction(()=>f.t().feedbackRows[0].comments='Changed after review');await assert.rejects(f.run('communicationSend',{kind:'final'}),/approve/);
 await f.approve('final');await f.run('communicationSend',{kind:'final'});assert.equal(f.sent.length,1);assert.equal(f.t().status,'Active');assert.equal(f.t().stage,'Asset Allotment');assert.equal(f.t().closedAt,null);assert.ok(f.t().finalEmailSentAt);
 assert.equal((await f.run('communicationSend',{kind:'final'})).alreadySent,true);assert.equal(f.sent.length,1);
});
test('Uncertain delivery cannot retry until HR resolves and approves again',async ctx=>{
 const f=fixture(ctx,async()=>{throw Error('SMTP timeout');});await f.save();await f.approve();await assert.rejects(f.run('communicationSend'),/could not be confirmed/);assert.equal(f.store.data.outbox[0].status,'Delivery uncertain');await assert.rejects(f.run('communicationSend'),/uncertain/);await assert.rejects(f.save(),/uncertain/);
 const messageId=f.store.data.outbox[0].id;await assert.rejects(f.run('communicationResolve',{messageId,result:'not-sent',note:'Checked mailbox'},trainer),/HR/);
 await f.run('communicationResolve',{messageId,result:'not-sent',note:'Checked sender mailbox and provider logs'});await assert.rejects(f.run('communicationSend'),/approve/);assert.equal(f.t().status,'Active');
});
test('Async delivery survives rollback and concurrent duplicate is blocked',async ctx=>{
 let release,started;const gate=new Promise(r=>release=r),start=new Promise(r=>started=r);let calls=0;
 const f=fixture(ctx,async()=>{calls++;started();await gate;return {messageId:'race'};});await f.save();await f.approve();const pending=f.run('communicationSend');await start;assert.equal(f.service.locked(),true);
 await assert.rejects(f.run('communicationSend'),/progress/);assert.throws(()=>f.store.transaction(()=>{throw Error('unrelated failure');}));release();await pending;
 assert.equal(calls,1);assert.equal(f.store.data.outbox[0].status,'Sent');assert.ok(f.t().communications.welcome.sentAt);assert.equal(f.service.locked(),false);
 assert.equal(openStore(path.dirname(f.store.file)).data.outbox[0].status,'Sent');
});
test('Assigned trainer sends handover directly without HR approval; transfer and duplicate protections remain',async ctx=>{
 const f=fixture(ctx);f.store.transaction(()=>f.t().handovers.push({id:'h',stage:'Operations Training',email:'next@example.test',status:'Draft',note:'Prepare transfer'}));
 await f.save({kind:'handover:h',to:'next@example.test'});
 await assert.rejects(f.run('communicationSend',{kind:'handover:h'},{...trainer,id:'other'}),/Forbidden/);
 await f.run('communicationSend',{kind:'handover:h'},trainer);assert.equal(f.sent[0].to,'next@example.test');assert.equal(f.t().stage,'Induction');assert.equal(f.t().status,'Active');assert.equal(f.t().handovers[0].status,'Draft');
 assert.equal((await f.run('communicationSend',{kind:'handover:h'})).alreadySent,true);assert.equal(f.sent.length,1);
 await assert.rejects(f.save({kind:'handover:missing'}),/Unknown/);
 f.store.transaction(()=>f.t().handovers.push({id:'final',stage:'Onboard Final Email'}));await assert.rejects(f.save({kind:'handover:final'}),/Unknown/);
});

test('proven unsent failure permits safe retry without resetting approval',async ctx=>{
 let calls=0;const f=fixture(ctx,async()=>{if(++calls===1)throw Object.assign(Error('Connection failed'),{deliveryState:'not-sent',code:'ECONNECTION'});return {messageId:'ok'};});await f.save();await f.approve();await assert.rejects(f.run('communicationSend'),/was not sent/);assert.equal(f.store.data.outbox[0].status,'Failed');assert.match(f.service.view(f.t()).welcome.lastError,/Connection failed/);await f.run('communicationSend');assert.equal(f.store.data.outbox[1].status,'Sent');assert.equal(calls,2);
});
test('explicit mentor resend preserves tasks and rejects stale confirmation',async ctx=>{
 const f=fixture(ctx);const t=f.t();t.mentor={id:'mentor1',tasks:[{topicId:'task1',complete:true}]};const kind='mentor:mentor1';t.communications={[kind]:{id:'first-message',kind,to:'mentor@example.test',subject:'Mentoring',body:'Guide tasks',attachments:[],revision:1,sentAt:new Date().toISOString()}};
 await assert.rejects(f.run('communicationResend',{kind,communicationId:'first-message'}),/Review/);
 await f.run('communicationResend',{kind,communicationId:'first-message',confirm:true});assert.equal(f.sent.length,1);assert.equal(t.mentor.tasks[0].complete,true);assert.ok(t.communications[kind].sentAt);
 await assert.rejects(f.run('communicationResend',{kind,communicationId:'first-message',confirm:true}),/Review/);assert.equal(f.sent.length,1);
});
test('handover email refreshes full history before send and preserves the sent snapshot',async ctx=>{
 const f=fixture(ctx);f.store.transaction(()=>f.t().handovers.push({id:'h-summary',stage:'Sales Training',status:'Draft',note:'Continue training',ownerName:'Next trainer',email:'next@example.test'}));
 const kind='handover:h-summary';await f.run('communicationSave',{kind,to:'next@example.test',subject:'Training handover',body:'Review the trainee',attachments:[]});
 f.store.transaction(db=>db.audit.push({traineeId:'t',actor:'trainer@example.test',action:'Checklist saved after draft',at:'2026-11-04'}));
 await f.run('communicationSend',{kind});assert.match(f.sent[0].body,/Checklist saved after draft/);assert.match(f.sent[0].body,/trainer@example.test/);assert.match(f.t().handovers[0].note,/TRAINING HISTORY/);
 const sent=f.sent[0].body;f.store.transaction(db=>db.audit.push({traineeId:'t',action:'Later activity'}));await f.run('communicationSend',{kind});assert.equal(f.sent.length,1);assert.equal(f.sent[0].body,sent);
});
test('Reskilling cannot generate, email or WhatsApp-share a welcome letter',async ctx=>{
 const f=fixture(ctx);await f.save();await f.approve();f.t().purpose='Reskilling';
 for(const purpose of ['Reskilling','Revaluation']){f.t().purpose=purpose;for(const action of ['communicationSave','communicationSend','communicationShare'])await assert.rejects(f.run(action),/not required for reskilling/);}
 assert.equal(f.sent.length,0);
});

test('welcome preview, email and PDF preserve reviewed text and include the generated letter in delivery history',async ctx=>{
 const f=fixture(ctx),body='Dear Trainee,\n\nWelcome <script>alert(1)</script> & learn.\n\nWarm regards,\nHR Team';
 await f.save({body});
 await assert.rejects(f.run('communicationPreview',{},trainer),/approve/);
 const preview=await f.run('communicationPreview');
 assert.match(preview.html,/PEOPLE &amp; CULTURE/);assert.match(preview.html,/&lt;script&gt;/);assert.doesNotMatch(preview.html,/<script>/);
 assert.equal(preview.file.filename,'Welcome-letter.pdf');assert.equal(Buffer.from(preview.file.base64,'base64').subarray(0,5).toString(),'%PDF-');assert.equal(f.sent.length,0);
 await f.approve();await f.run('communicationSend');
 assert.equal(f.sent[0].html,preview.html);assert.equal(f.sent[0].body,body);
 assert.equal(f.sent[0].attachments[0].filename,'Welcome-letter.pdf');assert.ok(f.sent[0].attachments[0].content.length>5000);
 assert.equal(f.store.data.outbox[0].attachments[0].filename,'Welcome-letter.pdf');
 assert.ok(f.store.data.outbox[0].attachments[0].bytes>5000);
});

test('revised welcome is a new unapproved draft and preserves the sent version without sending',async ctx=>{
 const f=fixture(ctx);await f.save();await f.approve();await f.run('communicationSend');
 const previous=structuredClone(f.t().communications.welcome),p={communicationId:previous.id,confirm:true,subject:'A warm welcome',body:'Dear Trainee,\n\nYour new welcome letter.'};
 await assert.rejects(f.run('communicationRevise',p,trainer),/HR/);
 await assert.rejects(f.run('communicationRevise',{...p,confirm:false}),/Review/);
 await assert.rejects(f.run('communicationRevise',{...p,communicationId:'stale'}),/Review/);
 await f.run('communicationRevise',p);
 const revised=f.t().communications.welcome;assert.notEqual(revised.id,previous.id);assert.equal(revised.revises,previous.id);assert.equal(revised.sentAt,undefined);
 assert.equal(f.service.view(f.t()).welcome.approved,false);assert.deepEqual(f.t().communicationHistory[0],previous);assert.equal(f.sent.length,1);
 assert.equal(f.store.data.outbox[0].communicationId,previous.id);assert.equal(openStore(path.dirname(f.store.file)).data.trainees[0].communicationHistory[0].sentAt,previous.sentAt);
 await assert.rejects(f.run('communicationSend'),/approve/);await f.approve();await f.run('communicationSend');assert.equal(f.sent.length,2);assert.equal(f.sent[1].body,p.body);
});
