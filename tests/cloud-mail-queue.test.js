import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {randomUUID} from 'node:crypto';import {Readable} from 'node:stream';
import {withCloudStore} from '../cloud-store.js';import {createApp} from '../server.js';import {queuedMailer,drainMailQueue} from '../mail-queue.js';
test('cloud email queue commits before response, releases DB lock for SMTP, and survives a fresh app instance',{skip:!process.env.DATABASE_URL_UNPOOLED},async()=>{
 const key='verification-mail-'+randomUUID(),db=new pg.Client({connectionString:process.env.DATABASE_URL_UNPOOLED});await db.connect();
 const run=fn=>withCloudStore(fn,{key});let cookie='',unblock;const sent=[];const materialIds=[];
 const mailer={configured:true,send:async m=>{sent.push(m);await new Promise(r=>unblock=r);return {messageId:'mock-only'};}};
 const call=async(url,data)=>run(async(store,runtime)=>{const app=createApp({store,runtime,scheduler:false,hosted:true,mailer:queuedMailer(store,mailer)});const req=Readable.from([JSON.stringify(data)]);req.method='POST';req.url=url;req.headers={host:'test.example',origin:'https://test.example','content-type':'application/json',cookie};req.socket={remoteAddress:'127.0.0.1'};const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,h){this.status=status;Object.assign(this.headers,h);},end(body){this.body=JSON.parse(body);}};await app.handler(req,res);if(res.headers['Set-Cookie'])cookie=res.headers['Set-Cookie'].split(';')[0];assert.equal(res.status,200,JSON.stringify(res.body));return res.body;});
 try{
 await db.query('INSERT INTO gleuhr_state(id,data) VALUES ($1,$2)',[key,JSON.stringify({schema:1,users:[],trainees:[],records:[],outbox:[],audit:[],customQuestions:[],resources:[],customDesignations:{}})]);
 await call('/api/setup',{name:'Test HR',email:'hr@example.test',password:'Temporary-test-password-2026'});
 const act=(action,payload={})=>call('/api/action',{action,payload,includeState:action!=='state'});
 const state=await act('state'),t=await act('createTrainee',{name:'Queue fixture',designation:'Counsellor',email:'learner@example.test',ownerId:state.user.id,branch:'Test',department:'Training'});
 const saved=await act('flowComplete',{traineeId:t.id,step:'Start'});assert.equal(sent.length,0);assert.equal(saved.state.lifecycleNotifications.at(-1).status,'Queued');
 await run(async store=>{materialIds.push(...store.data.emailJobs.map(j=>j.payloadId));assert.equal(store.data.emailJobs.length,1);});
 const draining=drainMailQueue({withStore:run,mailer});
 for(let i=0;i<100&&!unblock;i++)await new Promise(r=>setTimeout(r,20));assert.ok(unblock,'worker reached mock SMTP');
 const time=performance.now();const concurrent=await act('state');const elapsed=performance.now()-time;
 assert.ok(elapsed<5000,'state must load while SMTP is waiting');assert.equal(concurrent.lifecycleNotifications.at(-1).status,'Sending');
 unblock();await draining;const final=await act('state');assert.equal(final.lifecycleNotifications.at(-1).status,'Sent');assert.equal(sent.length,1);
 console.log(JSON.stringify({cloudQueueVerified:true,stateReadDuringSlowEmailMs:Math.round(elapsed),mockEmails:sent.length}));
 }finally{unblock?.();if(materialIds.length)await db.query('DELETE FROM gleuhr_material_files WHERE id=ANY($1::text[])',[materialIds]);await db.query('DELETE FROM gleuhr_state WHERE id=$1',[key]);await db.end();}
});
