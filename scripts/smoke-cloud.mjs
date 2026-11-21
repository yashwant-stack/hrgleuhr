import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { withCloudStore } from '../cloud-store.js';
import { passwordHash } from '../store.js';
import pg from 'pg';
import {materials,materialFile} from '../training-materials.js';
const deployment=process.argv[2];
if(!deployment?.startsWith('https://'))throw Error('Deployment URL required');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gleuhr-smoke-'));
const uid=randomUUID(),email=`verify-${uid}@example.test`,password=randomBytes(24).toString('hex');let tid;const uploadedIds=[];
await withCloudStore(async store=>store.transaction(db=>db.users.push({id:uid,email,password:passwordHash(password),name:'Deployment verification',role:'admin',active:true,branch:''})));
const jar=path.join(temp,'cookies');
function call(route,body,auth=true){
 const args=['curl',deployment+route,'--scope','rahul-43f8','--','-sS','--max-time','55','-w','\n%{http_code}','-c',jar];
 if(auth&&fs.existsSync(jar))args.push('-b',jar);
 if(body){const file=path.join(temp,'body.json');fs.writeFileSync(file,JSON.stringify(body),{mode:0o600});args.push('-H','Content-Type: application/json','-H',`Origin: ${deployment}`,'--data-binary','@'+file);}
 const raw=execFileSync('vercel',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});const i=raw.lastIndexOf('\n');let data;try{data=JSON.parse(raw.slice(0,i))}catch{throw Error('Non-JSON response '+raw.slice(-100))}return {status:Number(raw.slice(i+1)),data};
}
const action=(name,p={})=>call('/api/action',{action:name,payload:p});
try{
 assert.equal(call('/api/session').data.setup,false);
 const login=call('/api/login',{email,password});assert.equal(login.status,200,JSON.stringify(login.data));console.log('Hosted password login: passed');
 assert.equal(call('/api/session').data.user.id,uid);console.log('Session across separate function requests: passed');
 const added=action('createTrainee',{name:'Deployment verification '+uid,designation:'Counsellor',ownerId:uid,joiningDate:'2026-10-29',phone:'9876543210'});assert.equal(added.status,200,JSON.stringify(added.data));tid=added.data.id;
 const state=action('state');assert.equal(state.status,200);assert.ok(state.data.trainees.some(t=>t.id===tid));console.log('Create trainee, persist and reload: passed');
 const material=state.data.materials.find(m=>m.group==='HR');assert.ok(material);
 const mp={traineeId:tid,materialId:material.id};
 assert.equal(action('materialContent',mp).status,403);
 assert.equal(action('materialContent',{...mp,review:true}).status,200);
 assert.equal(action('approveMaterial',{...mp,approved:true}).status,200);
 assert.equal(action('materialContent',mp).status,200);
 assert.equal(action('approveMaterial',{...mp,approved:false}).status,200);
 assert.equal(action('materialContent',mp).status,403);
 assert.equal(state.data.trainees.find(t=>t.id===tid).phone,'919876543210');
 console.log('Hosted handbook approval, preview, revocation and phone: passed');
 const original=materials.find(m=>m.format==='DOCX');
 const uploaded=action('uploadMaterial',{title:'Deployment verification '+uid,designation:'Counsellor',filename:'verification.docx',base64:materialFile(original).toString('base64')});
 if(uploaded.data.id)uploadedIds.push(uploaded.data.id);
 assert.equal(uploaded.status,200,JSON.stringify(uploaded.data));
 const uploadedPayload={traineeId:tid,materialId:uploaded.data.id};
 assert.equal(action('materialContent',uploadedPayload).status,403);
 assert.equal(action('approveMaterial',{...uploadedPayload,approved:true}).status,200);
 const download=path.join(temp,'uploaded.docx');
 execFileSync('vercel',['curl',deployment+`/api/material?id=${uploaded.data.id}&traineeId=${tid}`,'--scope','rahul-43f8','--','-fsS','-b',jar,'-o',download],{stdio:['ignore','pipe','pipe']});
 assert.deepEqual(fs.readFileSync(download),materialFile(original));
 console.log('Cloud Word upload, persistent file download and approval: passed');
 const draft=action('draftHandover',{traineeId:tid,stage:'Operations Training',email});assert.equal(draft.status,200);
 const transfer=action('activateHandover',{traineeId:tid,handoverId:draft.data.handoverId});assert.equal(transfer.status,200,JSON.stringify(transfer.data));assert.equal(transfer.data.emailSent,false);
 const moved=action('state').data.trainees.find(t=>t.id===tid);assert.equal(moved.stage,'Operations Training');assert.ok(moved.checklist.some(r=>r.phase==='Operations Training'));console.log('Direct Induction to Operations handover without SMTP: passed');
 const quiz=action('startTest',{traineeId:tid,moduleId:1});assert.equal(quiz.status,200);assert.ok(quiz.data.questions.every(q=>q.correctIndex===undefined));
 const graded=action('submitTest',{testId:quiz.data.id,answers:quiz.data.questions.map(()=>0)});assert.equal(graded.status,200,JSON.stringify(graded.data));assert.equal(graded.data.kind,'test');console.log('Quiz persists across requests and grades server-side: passed');
 await withCloudStore(async store=>store.transaction(db=>{db.users.find(u=>u.id===uid).role='trainer';db.trainees.find(t=>t.id===tid).ownerId=null;db.trainees.find(t=>t.id===tid).ownerEmail='';}));
 assert.equal(action('state').data.trainees.length,0);
 assert.equal(action('startTest',{traineeId:tid,moduleId:1}).status,403);console.log('Trainer assignment access control: passed');
 assert.equal(call('/api/cron/reminders').status,401);console.log('Cron authorization: passed');
 assert.equal(call('/api/logout',{}).status,200);assert.equal(call('/api/session').data.user,null);console.log('Logout revocation: passed');
}finally{
 await withCloudStore(async(store,runtime)=>store.transaction(db=>{db.uploadedMaterials=(db.uploadedMaterials||[]).filter(m=>!uploadedIds.includes(m.id));db.users=db.users.filter(u=>u.id!==uid);db.trainees=db.trainees.filter(t=>t.id!==tid);db.records=db.records.filter(r=>r.traineeId!==tid);db.audit=db.audit.filter(r=>r.actor!==email&&r.traineeId!==tid);for(const [k,v]of runtime.sessions)if(v.uid===uid)runtime.sessions.delete(k);for(const[k,v]of runtime.tests)if(v.uid===uid)runtime.tests.delete(k);}));
 if(uploadedIds.length){const c=new pg.Client({connectionString:process.env.DATABASE_URL_UNPOOLED});await c.connect();try{await c.query('DELETE FROM gleuhr_material_files WHERE id=ANY($1::text[])',[uploadedIds]);}finally{await c.end();}}
 fs.rmSync(temp,{recursive:true,force:true});console.log('Temporary verification records removed');
}
