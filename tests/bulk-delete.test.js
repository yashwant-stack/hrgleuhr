import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createApp} from '../server.js';import {prepareJourneyFixture} from './journey-fixture.js';
test('bulk deletion is admin-only, confirmed, atomic and removes only selected records',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hr-bulk-'));const app=createApp({dataDir:dir,scheduler:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 let admin;async function call(route,body,cookie=admin){const r=await fetch('http://127.0.0.1:'+app.server.address().port+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const act=(action,payload={},cookie=admin)=>{prepareJourneyFixture(app,action,payload);return call('/api/action',{action,payload},cookie);};
 admin=(await call('/api/setup',{name:'Admin',email:'admin@example.test',password:'test-password-long'})).cookie;
 await act('createUser',{name:'Trainer',email:'trainer@example.test',password:'test-password-long',role:'trainer'});
 const trainer=(await call('/api/login',{email:'trainer@example.test',password:'test-password-long'})).cookie;
 const ids=[];for(const name of ['One','Two','Keep'])ids.push((await act('createTrainee',{name,designation:'Branch Manager'})).data.id);
 const rows=app.store.data.trainees;const trainees=rows.filter(t=>ids.slice(0,2).includes(t.id)).map(t=>({traineeId:t.id,version:t.version}));
 assert.equal((await act('deleteTrainees',{trainees,confirmed:true},trainer)).status,403);
 assert.equal((await act('deleteTrainees',{trainees})).status,400);
 assert.equal((await act('deleteTrainees',{trainees:[trainees[0],{...trainees[1],version:-1}],confirmed:true})).status,409);assert.equal(app.store.data.trainees.length,3);
 app.store.data.records.push(...ids.map(id=>({id:'r'+id,traineeId:id})));app.store.data.outbox.push(...ids.map(id=>({id:'m'+id,traineeId:id,status:'Sent'})));
 const result=await act('deleteTrainees',{trainees,confirmed:true});assert.equal(result.status,200);assert.equal(result.data.deleted,2);
 assert.deepEqual(app.store.data.trainees.map(t=>t.id),[ids[2]]);assert.deepEqual(app.store.data.records.map(t=>t.traineeId),[ids[2]]);assert.deepEqual(app.store.data.outbox.map(t=>t.traineeId),[ids[2]]);
});
