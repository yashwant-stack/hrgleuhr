import test from 'node:test';import assert from 'node:assert/strict';
import {issueAcknowledgement,acknowledgementAction} from '../lifecycle.js';import {deliverLifecycleMail} from '../lifecycle-mail.js';
test('handover stars validate, persist once and email active admins only, including admins also listed as management',async()=>{
 const t={id:'t',name:'Trainee',email:'trainee@example.test',ownerEmail:'trainer@example.test',version:0,handovers:[{id:'h',fromStage:'Sales Training',stage:'Operations Training',previousTrainerName:'Sales Trainer'}]};
 const db={trainees:[t],users:[{role:'admin',active:true,email:'admin@example.test'},{role:'trainer',active:true,email:'trainer@example.test'},{role:'admin',active:false,email:'inactive@example.test'}],lifecycleSettings:{managementEmails:'admin@example.test,boss@example.test'}};
 const store={data:db,transaction:fn=>fn(db)},sent=[],mailer={configured:true,send:async m=>{sent.push(m);return {messageId:'test'};}};
 issueAcknowledgement(db,t,'handover-feedback','h','Rate training','Completed Sales Training','https://example.test');
 await deliverLifecycleMail({store,mailer,traineeId:'t'});assert.equal(sent.length,1);assert.equal(sent[0].to,t.email);
 const token=sent[0].body.match(/ack.html#([a-f0-9]{64})/)[1];
 for(const rating of [0,6,1.5,'5',null])assert.throws(()=>acknowledgementAction(db,{token,submit:true,confirm:true,name:'Trainee',rating}),/1 to 5/);
 acknowledgementAction(db,{token,submit:true,confirm:true,name:'Trainee',rating:4,answers:{learnings:'Processes',independentTasks:'CRM',support:'None',adequate:'Yes',ready:'Yes'}});
 await deliverLifecycleMail({store,mailer,traineeId:'t'});assert.equal(sent.length,2);assert.equal(sent[1].to,'admin@example.test');assert.equal(sent[1].cc,'');assert.match(sent[1].body,/4\/5/);assert.equal(t.handoverFeedback[0].rating,4);
 acknowledgementAction(db,{token,submit:true,confirm:true,name:'Trainee',rating:5});await deliverLifecycleMail({store,mailer,traineeId:'t'});assert.equal(t.handoverFeedback.length,1);assert.equal(sent.length,2);
 issueAcknowledgement(db,t,'handover-feedback','h','Rate training','Again','https://example.test');assert.equal(db.ackTokens.length,1);
});
