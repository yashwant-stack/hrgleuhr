import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/portal-help.js';
const {search,topics}=globalThis.PortalHelp;
test('help finds common Hindi and English portal questions',()=>{
 for(const [q,id] of [['mentor task complete kaise karein','mentor'],['email nahi aa rahi','email'],['75 threshold retest','score'],['reskilling welcome','types'],['ticket escalation 2 hours','tickets'],['trainee acknowledgement link','ack']]) assert.equal(search(q)[0]?.[0],id,q);
});
test('unknown questions do not invent answers',()=>assert.deepEqual(search('quantum mechanics'),[]));
test('documentation preserves workflow and delivery boundaries',()=>{
 assert.match(topics.find(t=>t[0]==='score')[3],/7.5\/10/);
 assert.match(topics.find(t=>t[0]==='whatsapp')[3],/automatically PDF attach nahi/);
 assert.match(topics.find(t=>t[0]==='mentor')[3],/sirf mentor assign/i);
 assert.match(topics.find(t=>t[0]==='email')[3],/inbox delivery ka proof nahi/);
});
