import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server.js';import {materials} from '../training-materials.js';import {prepareJourneyFixture} from './journey-fixture.js';
test('document email requires approval, attaches bytes, records sharing only on success and deduplicates',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'document-email-'));const sent=[];let failing=true;
 const app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,from:'sender@example.test',verify:async()=>true,send:async m=>{if(failing)throw Object.assign(Error('Temporary connection failure'),{deliveryState:'not-sent'});sent.push(m);return {messageId:'test',accepted:[m.to]};}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;let cookie;
 async function call(route,body){const res=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie||''},body:JSON.stringify(body)});cookie||=res.headers.get('set-cookie')?.split(';')[0];return {status:res.status,data:await res.json()};}
 const act=(action,payload={})=>{prepareJourneyFixture(app,action==='sendLearningEmail'?'materialShareStatus':action,payload);return call('/api/action',{action,payload});};
 await call('/api/setup',{name:'HR',email:'hr@example.test',password:'test-password-long'});
 const t=(await act('createTrainee',{name:'Test trainee',designation:'Branch Manager',email:'trainee@example.test'})).data;
 const m=materials.find(m=>m.group==='HR'),p={traineeId:t.id,materialId:m.id};
 assert.equal((await act('sendLearningEmail',p)).status,403);
 await act('approveMaterial',{...p,approved:true});
 assert.equal((await act('sendLearningEmail',p)).status,502);
 assert.equal(app.store.data.trainees[0].materialShares?.length||0,0);
 failing=false;assert.equal((await act('sendLearningEmail',p)).status,200);assert.equal(sent.length,1);assert.ok(sent[0].attachments[0].content.length>100);assert.equal(app.store.data.trainees[0].materialShares[0].channel,'email');
 assert.equal((await act('sendLearningEmail',p)).data.alreadySent,true);assert.equal(sent.length,1);
 const diagnostic=await act('testEmail',{to:'hr@example.test',confirm:true});assert.equal(diagnostic.status,200);assert.equal(sent[1].attachments[0].filename,'TEST-Sample-certificate.pdf');assert.equal((await act('testEmail',{to:'hr@example.test',confirm:true})).status,400);
});
