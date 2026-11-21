import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openStore} from '../store.js';import {queuedMailer,drainMailQueue,recoverMailJobs} from '../mail-queue.js';import {createApp} from '../server.js';
function fixture(ctx){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-queue-')),store=openStore(dir);ctx.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return store;}
async function enqueue(store,id='m',extra={}){store.transaction(db=>db.outbox.push({id,status:'Sending',...extra}));await queuedMailer(store,{}).send({id,to:'dummy@example.test',subject:'Mock',body:'Test',attachments:[{filename:'certificate.pdf',content:Buffer.from('%PDF-test')} ]});store.transaction(db=>{db.outbox.find(n=>n.id===id).status='Queued';});}
test('slow SMTP runs without blocking state reads; concurrent workers send each queued email only once with intact attachment',async ctx=>{
 const store=fixture(ctx);await enqueue(store);let unblock,started;const ready=new Promise(r=>started=r),waiting=new Promise(r=>unblock=r);let calls=0;
 const mailer={configured:true,send:async m=>{calls++;assert.equal(m.attachments[0].content.toString(),'%PDF-test');started();await waiting;return {messageId:'smtp-1'};}};
 const withStore=async fn=>fn(store,{}),drain=drainMailQueue({withStore,mailer});await ready;
 const time=performance.now();const app=createApp({store,scheduler:false,mailer:queuedMailer(store,mailer)});assert.ok(performance.now()-time<1000);assert.equal(app.store.data.outbox[0].status,'Sending');
 const other=await drainMailQueue({withStore,mailer});assert.equal(other.processed,0);assert.equal(calls,1);assert.equal(store.data.outbox[0].sentAt,undefined);
 unblock();await drain;assert.equal(store.data.outbox[0].status,'Sent');assert.equal(calls,1);
 assert.ok(!JSON.stringify(store.data).includes('%PDF-test'));
});
test('uncertain SMTP is never retried automatically; expired claims require review',async ctx=>{
 const store=fixture(ctx);await enqueue(store);let calls=0;const mailer={send:async()=>{calls++;throw Object.assign(Error('DATA timeout'),{deliveryState:'uncertain'});}},withStore=async fn=>fn(store,{});
 await drainMailQueue({withStore,mailer});await drainMailQueue({withStore,mailer});assert.equal(calls,1);assert.equal(store.data.outbox[0].status,'Delivery uncertain');
 await enqueue(store,'old');store.data.emailJobs.find(j=>j.id==='old').status='Sending';store.data.emailJobs.find(j=>j.id==='old').leaseUntil=0;store.data.outbox.find(n=>n.id==='old').status='Sending';recoverMailJobs(store.data);assert.equal(store.data.outbox.find(n=>n.id==='old').status,'Delivery uncertain');
});
test('confirmed failure remains retryable and queued receipt never completes a final onboarding email',async ctx=>{
 const store=fixture(ctx);store.data.trainees.push({id:'t',stage:'Final Review & Confirmation',version:2,communications:{final:{id:'d',revision:1}},lifecycle:{}});
 await enqueue(store,'m',{traineeId:'t',kind:'final',communicationId:'d',revision:1});let calls=0;
 await drainMailQueue({withStore:async fn=>fn(store,{}),mailer:{send:async()=>{calls++;throw Object.assign(Error('Connection refused'),{deliveryState:'not-sent'});}}});
 assert.equal(store.data.outbox[0].status,'Failed');assert.equal(store.data.trainees[0].stage,'Final Review & Confirmation');assert.equal(store.data.trainees[0].communications.final.sentAt,undefined);
 await queuedMailer(store,{}).send({id:'m',to:'dummy@example.test',body:'retry'});store.data.outbox[0].status='Queued';
 await drainMailQueue({withStore:async fn=>fn(store,{}),mailer:{send:async()=>{calls++;return {messageId:'ok'};}}});
 assert.equal(calls,2);assert.equal(store.data.trainees[0].status,'Active');assert.equal(store.data.trainees[0].stage,'Asset Allotment');assert.ok(store.data.trainees[0].communications.final.sentAt);
});
test('ticket delivery status updates only when the background send finishes',async ctx=>{
 const store=fixture(ctx);store.data.tickets=[{id:'t',emailStatus:'Queued'}];await enqueue(store,'m',{ticketId:'t',kind:'ticket'});
 await drainMailQueue({withStore:async fn=>fn(store,{}),mailer:{send:async()=>({messageId:'ticket-smtp'})}});
 assert.equal(store.data.tickets[0].emailStatus,'Sent');assert.equal(store.data.tickets[0].emailMessageId,'ticket-smtp');
});
test('learning content is confirmed and acknowledgement queued only after successful SMTP',async ctx=>{
 const store=fixture(ctx);store.data.trainees.push({id:'t',name:'Demo',email:'demo@example.test',stage:'Induction',version:1,flowEnabled:true,approvedMaterials:[{id:'doc',at:'approval'}],communications:{doc:{id:'d',revision:1,learningDelivery:{materialId:'doc',approvalAt:'approval',phase:'Induction',title:'Handbook',flowStep:'Content',origin:'https://example.test',by:'hr@example.test'}}}});
 await enqueue(store,'m',{traineeId:'t',communicationId:'d',revision:1,kind:'document:doc'});
 assert.equal(store.data.trainees[0].materialShares,undefined);
 await drainMailQueue({withStore:async fn=>fn(store,{}),maxMessages:1,mailer:{configured:true,send:async()=>({messageId:'doc-smtp'})}});
 assert.equal(store.data.trainees[0].materialShares[0].status,'confirmed');assert.equal(store.data.lifecycleNotifications[0].status,'Queued');assert.equal(store.data.emailJobs.filter(j=>j.status==='Queued').length,1);
});
