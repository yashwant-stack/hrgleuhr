import {prepareJourneyFixture} from './journey-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';

test('skip directly from Induction to Operations, persist and transfer trainer access without SMTP', async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gleuhr-phase-'));let app=createApp({dataDir:dir,scheduler:false});
 const boot=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port;};let url=await boot();
 async function call(route,body,cookie){const r=await fetch(url+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 let admin;
 const act=(action,payload={},cookie=admin)=>{prepareJourneyFixture(app,action,payload);return call('/api/action',{action,payload},cookie);};
 try{
 admin=(await call('/api/setup',{name:'Admin',email:'admin@example.test',password:'example-test-password'})).cookie;
 const owner=(await act('createUser',{name:'Trainer',email:'trainer@example.test',password:'example-test-password',role:'trainer'})).data;
 const trainer=(await call('/api/login',{email:owner.email,password:'example-test-password'})).cookie;
 const t=(await act('createTrainee',{name:'Skip phase test',designation:'Branch Manager'})).data;
 const draft=(await act('draftHandover',{traineeId:t.id,stage:'Operations Training',ownerId:owner.id})).data;
 assert.equal((await act('state')).data.trainees[0].stage,'Induction');
 const transfer=await act('activateHandover',{traineeId:t.id,handoverId:draft.handoverId});assert.equal(transfer.status,200);assert.equal(transfer.data.emailSent,false);
 let state=(await act('state',{},trainer)).data;let updated=state.trainees[0];assert.equal(updated.stage,'Operations Training');assert.equal(updated.ownerId,owner.id);assert.ok(updated.checklist.some(r=>r.phase==='Operations Training'));assert.ok(updated.checklist.some(r=>r.phase==='Operations Training'&&r.curriculumId));assert.equal(updated.handovers[0].status,'Pending');assert.equal(state.outbox.length,0);
 const saved=updated.activeTraining.checklist[0];await act('checklist',{traineeId:t.id,itemId:saved.id,covered:true},trainer);
 const second=(await act('draftHandover',{traineeId:t.id,stage:'CRM & Tech Training',email:'other@example.test'})).data;
 assert.equal((await act('activateHandover',{traineeId:t.id,handoverId:second.handoverId})).status,200);
 assert.equal((await act('state',{},trainer)).data.trainees.length,0);
 updated=(await act('state')).data.trainees[0];assert.equal(updated.stage,'CRM & Tech Training');assert.equal(updated.handovers[0].status,'Completed');assert.equal(updated.checklist.find(r=>r.id===saved.id).covered,true);
 const final=(await act('draftHandover',{traineeId:t.id,stage:'Onboard Final Email',email:'other@example.test'})).data;
 assert.equal((await act('activateHandover',{traineeId:t.id,handoverId:final.handoverId})).status,400);assert.equal((await act('state')).data.trainees[0].status,'Active');
 await new Promise(r=>app.server.close(r));app=createApp({dataDir:dir,scheduler:false});url=await boot();admin=(await call('/api/login',{email:'admin@example.test',password:'example-test-password'})).cookie;
 assert.equal((await act('state')).data.trainees[0].stage,'CRM & Tech Training');
 }finally{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
