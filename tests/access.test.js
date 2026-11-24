import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {allowedSections,normalizeAccess,roleSections,canAccess} from '../access.js';
import {createApp} from '../server.js';

test('role defaults: trainers never get admin-only sections',()=>{
 assert.ok(!roleSections('trainer').includes('users'));
 assert.ok(!roleSections('trainer').includes('tickets'));
 assert.ok(roleSections('admin').includes('templates'));
 assert.deepEqual(allowedSections({role:'trainer'}),roleSections('trainer'));
});

test('normalizeAccess keeps a valid subset, resets a full list, rejects empty or unknown',()=>{
 assert.equal(normalizeAccess('trainer',null),null);
 assert.equal(normalizeAccess('trainer',roleSections('trainer')),null);
 assert.deepEqual(normalizeAccess('trainer',['trainees','dashboard','users']),['dashboard','trainees']);
 assert.throws(()=>normalizeAccess('admin',[]),/at least one section/);
 assert.throws(()=>normalizeAccess('admin',['nope']),/valid sections/);
});

test('System Admin always keeps every section',()=>{
 const u={role:'admin',email:'mizraem@gleuhr.com',active:true,access:['dashboard']};
 assert.deepEqual(allowedSections(u),roleSections('admin'));
 assert.ok(canAccess(u,'users'));
});

test('restricted user: menu list, blocked actions and hidden tickets are enforced by the server',async ctx=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'access-'));
 const app=createApp({dataDir:dir,scheduler:false,mailer:{configured:true,verify:async()=>true,send:async()=>({messageId:'x'})}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 ctx.after(async()=>{await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const call=async(route,body,cookie)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const hr=(await call('/api/setup',{name:'HR',email:'hr@example.test',password:'dummy-test-password'})).cookie;
 const act=(action,payload={},cookie=hr)=>call('/api/action',{action,payload},cookie);

 const created=await act('createUser',{name:'Limited Admin',email:'limited@example.test',role:'admin',password:'dummy-test-password',access:['dashboard','trainees']});
 assert.equal(created.status,200);
 assert.deepEqual(created.data.sections,['dashboard','trainees']);

 const limited=(await call('/api/login',{email:'limited@example.test',password:'dummy-test-password'})).cookie;
 const state=(await act('state',{},limited)).data;
 assert.deepEqual(state.user.sections,['dashboard','trainees']);
 assert.deepEqual(state.tickets,[]);
 assert.equal((await act('emailVerify',{},limited)).status,403);
 assert.equal((await act('createTicket',{title:'x',description:'y'},limited)).status,403);
 assert.equal((await act('emailVerify',{},hr)).status,200,'full-access admin is unaffected');

 // A user manager cannot lock themselves out of user management.
 const me=(await act('state')).data.user;
 assert.equal((await act('updateUser',{id:me.id,access:['dashboard']})).status,400);

 // Clearing every section is refused; granting all sections returns the user to full access.
 assert.equal((await act('updateUser',{id:created.data.id,access:[]})).status,400);
 assert.equal((await act('updateUser',{id:created.data.id,access:roleSections('admin')})).status,200);
 const after=(await act('state')).data.users.find(u=>u.email==='limited@example.test');
 assert.equal(after.access,null);
 assert.deepEqual(after.sections,roleSections('admin'));

 // Changing an admin with custom access to trainer drops admin-only sections.
 await act('updateUser',{id:created.data.id,access:['dashboard','tickets']});
 await act('updateUser',{id:created.data.id,role:'trainer'});
 assert.deepEqual((await act('state')).data.users.find(u=>u.email==='limited@example.test').sections,['dashboard']);
});
