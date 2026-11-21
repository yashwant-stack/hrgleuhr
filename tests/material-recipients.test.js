import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function materialSharing('),source.indexOf('function materialStatus('));
test('shared-with list includes confirmed recipients once, uses current approval status and excludes corrections/prepared',()=>{
 const record=(status,approvalAt,at='2026-11-02')=>({materialId:'doc',status,approvalAt,at,by:'trainer@test.invalid'});
 const context=vm.createContext({S:{trainees:[
  {name:'Zara',materialSharingStates:{doc:record('prepared','new')}},
  {name:'Aman',materialSharingStates:{doc:record('confirmed','second')}},
  {name:'Corrected',materialSharingStates:{doc:record('reset','one')}},
  {name:'Prepared',materialSharingStates:{doc:record('prepared','one')}},
  {name:'Unshared',materialShares:[]}
 ]}});
 vm.runInContext(code,context);
 assert.equal(vm.runInContext("materialRecipients({id:'doc'}).map(r=>r.trainee.name).join(',')",context),'Aman');
 assert.equal(vm.runInContext("materialRecipients({id:'other'}).length",context),0);
 context.S.trainees=context.S.trainees.slice(0,1);
 assert.equal(vm.runInContext("materialRecipients({id:'doc'}).length",context),0);
});
