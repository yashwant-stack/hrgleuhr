import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('feedback and certificate buttons inside the modal dispatch to their handlers',async()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),calls=[],listeners={};
 const c=vm.createContext({$:id=>({addEventListener:(event,fn)=>listeners[event]=fn}),modalSubmitting:false,handle:async action=>calls.push(action)});
 vm.runInContext(source.slice(source.indexOf('$("modalFields").addEventListener'),source.indexOf('let modalSubmitting=false;')),c);
 for(const action of ['viewTraineeFeedback','certificateShare']){
  const b={dataset:{action},disabled:false};
  await listeners.click({target:{closest:selector=>selector.includes('[data-action="'+action+'"]')?b:null}});
  assert.equal(b.disabled,false);
 }
 assert.deepEqual(calls,['viewTraineeFeedback','certificateShare']);
});

test('feedback opens directly from a notification even without a selected trainee',async()=>{
 const source=fs.readFileSync(new URL('../public/transition-ui.js',import.meta.url),'utf8'),views=[];
 const t={id:'t',name:'Test trainee',handoverFeedback:[{phase:'Induction',rating:4,at:'2026-11-18',answers:{learnings:'<script>unsafe</script>'}}]};
 const c=vm.createContext({S:{trainees:[t]},refresh:async()=>{},fetch:async()=>({ok:true,json:async()=>({trainee:[['learnings','Key learnings']]})}),esc:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),dt:x=>x,modal:(...x)=>views.push(x),current:()=>{throw Error('No selection');}});
 vm.runInContext(source,c);await c.handleTransition('viewTraineeFeedback',{dataset:{trainee:'t'}});
 assert.equal(views[0][0],'Trainee feedback — Test trainee');assert.match(views[0][1],/4\/5 stars/);assert.match(views[0][1],/&lt;script&gt;/);assert.doesNotMatch(views[0][1],/<script>/);
});

test('a sent certificate offers an explicit resend instead of a no-op send',async()=>{
 const source=fs.readFileSync(new URL('../public/hr-ui.js',import.meta.url),'utf8'),views=[],calls=[],kind='certificate:issued:trainee';
 const t={communications:{[kind]:{id:'previous',to:'learner@example.test',sentAt:'2026-11-18'}}};
 const c=vm.createContext({current:()=>t,modal:(...x)=>views.push(x),esc:x=>x,mutate:async(...x)=>calls.push(x),payload:x=>x,toast:()=>{}});
 vm.runInContext(source.slice(source.indexOf('async function handleHR'),source.indexOf("document.addEventListener('click'")),c);
 await c.handleHR('communicationSend',{dataset:{kind}});
 assert.equal(views[0][0],'Send certificate email again');assert.equal(calls.length,0);
 await views[0][2]();assert.equal(calls[0][0],'communicationResend');assert.equal(calls[0][1].confirm,true);assert.equal(calls[0][1].communicationId,'previous');
});
