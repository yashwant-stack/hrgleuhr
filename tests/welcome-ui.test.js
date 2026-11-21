import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/hr-ui.js',import.meta.url),'utf8');
test('revising a sent welcome respects the completed Start correction workflow',async()=>{
 for(const flowEnabled of [false,true]){
  const t={flowEnabled,journey:{Start:{complete:true}},trainingFlowStatus:[{key:'Start',complete:true}]},actions=[];
  const context=vm.createContext({current:()=>t,handle:async(...args)=>actions.push(args),api:()=>assert.fail('Must obtain correction approval before changing the letter')});
  vm.runInContext(source.slice(source.indexOf('function welcomeStageLocked'),source.indexOf('function communicationView')),context);
  vm.runInContext(source.slice(source.indexOf('async function handleHR'),source.indexOf("document.addEventListener('click'")),context);
  await context.handleHR('communicationRevise',{dataset:{kind:'welcome'}});
  assert.equal(actions.length,1);assert.equal(actions[0][0],'journeyUnlock');assert.equal(actions[0][1].dataset.step,flowEnabled?'Flow:Start':'Start');
 }
});
