import test from 'node:test';
import assert from 'node:assert/strict';
import {issueAcknowledgement,acknowledgementAction} from '../lifecycle.js';
import {deliverLifecycleMail} from '../lifecycle-mail.js';
import {createMailer} from '../mailer.js';

const env={SMTP_HOST:'smtp.example.test',SMTP_FROM:'hr@example.test',SMTP_USER:'hr@example.test',SMTP_PASS:'test-only'};
for(const kind of ['flow-update','flow-evaluation','module','evaluation','outcome','feedback','declaration','asset','handover-feedback']){
 test(kind+' email places its personal acknowledgement first and loads the trainee name without confirming',async()=>{
  const t={id:'demo',name:'Demo <Trainee> & Team',email:'demo@example.test',version:1,stage:'Induction',flowEnabled:true,trainingFlow:{Induction:{steps:{TheoryEvaluation:{complete:true,ref:'ref'}}}}};
  const db={trainees:[t],users:[]},store={data:db,transaction:fn=>fn(db)},sent=[];
  const mailer=createMailer(env,{transportFactory:()=>({sendMail:async m=>{sent.push(m);return {messageId:'mock',accepted:[t.email]};}})});
  const details='DETAIL-START\n'+Array.from({length:30},(_,i)=>'Assessment '+i+': 8/10').join('\n');
  issueAcknowledgement(db,t,kind,'ref','Training review',details,'https://example.test');
  const token=db.lifecycleNotifications[0].body.match(/ack.html#([a-f0-9]{64})/)[1];
  await deliverLifecycleMail({store,mailer,traineeId:t.id});assert.equal(sent.length,1);
  const m=sent[0],url='https://example.test/ack.html#'+token;
  assert.equal(m.to,t.email);assert.equal(m.cc,undefined);
  assert.ok(m.text.indexOf(url)<m.text.indexOf('DETAIL-START'));
  assert.ok(m.html.indexOf('href="'+url+'"')<m.html.indexOf('DETAIL-START'));
  assert.match(m.html,/Review &amp; acknowledge/);assert.match(m.html,/Dear Demo &lt;Trainee&gt; &amp; Team,/);
  assert.doesNotMatch(m.html,/Open training portal/);assert.match(m.text,/Dear Demo <Trainee> & Team,/);
  const response=acknowledgementAction(db,{token});assert.equal(response.name,t.name);assert.equal(response.done,false);
  assert.equal(db.ackTokens[0].usedAt,undefined);assert.equal(t.lifecycle.acknowledgements.length,0);
 });
}
test('previously queued acknowledgement emails are upgraded at delivery using their own token',async()=>{
 const t={id:'demo',name:'Existing Trainee',email:'demo@example.test',version:1},db={trainees:[t],users:[]};
 issueAcknowledgement(db,t,'flow-update','old','Earlier request','Original details','https://example.test');
 const n=db.lifecycleNotifications[0],url=n.body.match(/^https:\/\/.*\/ack\.html#[a-f0-9]+$/m)[0];
 n.body='Original details\n\nPlease review and acknowledge securely:\nhttps://unrelated.example/ack.html#'+'b'.repeat(64)+'\n'+url+'\n\nThis personal link expires in 7 days. Do not forward it.';
 let sent;await deliverLifecycleMail({store:{data:db,transaction:fn=>fn(db)},mailer:{configured:true,send:async m=>{sent=m;return {messageId:'mock'};}},traineeId:t.id});
 assert.ok(sent.html.includes('href="'+url+'"'));assert.ok(sent.body.indexOf(url)<sent.body.indexOf('Original details'));assert.doesNotMatch(sent.html,/unrelated.example/);
});
