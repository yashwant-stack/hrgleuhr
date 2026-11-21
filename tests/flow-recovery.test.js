import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {syncTrainee} from '../training-workflow.js';
import {flowCriteria,flowStatus,flowAction} from '../training-flow.js';

const makeTrainee=()=>({id:'learner',name:'Demo',email:'demo@example.test',designation:'Counsellor',stage:'CRM & Tech Training',purpose:'New Joiner',status:'Active',version:4,flowEnabled:true,curriculumVersion:'2026-11-18',curriculumLegacyPhases:[],checklist:[],scores:[],assessments:[],handovers:[],trainingFlow:{'CRM & Tech Training':{steps:Object.fromEntries(['Start','Educate','Content','TheoryEvaluation','Mentor','Practical'].map(key=>[key,{complete:true,ref:'previous'}])),evaluations:{PracticalEvaluation:{score:null,ratings:[]}}}},lifecycle:{events:[],acknowledgements:[{kind:'flow-evaluation',ref:'previous'}]}});
test('workbook CRM practical assessment is populated from role-specific guide and empty prior saves can be replaced',()=>{
 const db={customDesignations:{},audit:[],lifecycleNotifications:[],ackTokens:[]},t=makeTrainee();db.trainees=[t];syncTrainee(t,db);
 const criteria=flowCriteria(t,db,'PracticalEvaluation');assert.ok(criteria.length>0);assert.equal(new Set(criteria.map(r=>r.id)).size,criteria.length);
 assert.ok(criteria.some(r=>r.guidance.includes('Build a package')));assert.ok(criteria.every(r=>!r.title.includes('Accounts:')&&!r.title.includes('Reception:')));
 assert.deepEqual(flowCriteria(structuredClone(t),db,'PracticalEvaluation'),criteria);
 const before=structuredClone(t.trainingFlow[t.stage].steps);
 const state=flowStatus(t,db).find(s=>s.key==='PracticalEvaluation');assert.equal(state.blockedBy,null);assert.equal(state.ready,false);assert.doesNotMatch(state.missing.join(' '),/Reset ratings/);
 const user={name:'Trainer',email:'trainer@example.test'};
 assert.throws(()=>flowAction(db,t,user,'flowEvaluation',{step:'PracticalEvaluation',ratings:[]},'https://example.test'),/Rate every/);
 flowAction(db,t,user,'flowEvaluation',{step:'PracticalEvaluation',ratings:criteria.map(r=>({id:r.id,score:8}))},'https://example.test');
 assert.deepEqual(t.trainingFlow[t.stage].steps,before);assert.equal(flowStatus(t,db).find(s=>s.key==='PracticalEvaluation').ready,true);
 flowAction(db,t,user,'flowComplete',{step:'PracticalEvaluation'},'https://example.test');
 const states=flowStatus(t,db);assert.equal(states.find(s=>s.key==='PracticalEvaluation').complete,true);assert.equal(states.find(s=>s.key==='PracticalAcknowledgement').complete,false);assert.equal(states.find(s=>s.key==='Handover').blockedBy,'PracticalAcknowledgement');
});
test('an unconfigured evaluation cannot save an empty result or pass with a fabricated aggregate',()=>{
 const t={...makeTrainee(),stage:'Sales Training',purpose:'Revaluation',trainingFlow:{'Sales Training':{steps:{},evaluations:{TheoryEvaluation:{score:9,ratings:[]}}}}};
 const db={audit:[],customDesignations:{}};
 assert.equal(flowStatus(t,db).find(s=>s.key==='TheoryEvaluation').ready,false);
 assert.throws(()=>flowAction(db,t,{email:'trainer@example.test'},'flowEvaluation',{step:'TheoryEvaluation',ratings:[]},'https://example.test'),/No evaluation items/);
});
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('let flowSaving=false;'),source.indexOf('function button('));
function client(initial,api){
 const input={dataset:{flowRating:'criterion'},value:'8'},nodes={modal:{open:false}};
 const c=vm.createContext({S:{trainees:[initial]},view:'trainees',selected:initial.id,selectedFlowStep:'PracticalEvaluation',section:'Training stages',current(){return c.S.trainees.find(t=>t.id===c.selected);},api,refresh:async()=>{},initialiseNavigation(){},render(){input.value='';},updateEvaluationAverage(){},document:{querySelectorAll:selector=>selector==='[data-flow-rating]'?[input]:[],querySelector:()=>null,hidden:false},$:id=>nodes[id]});
 vm.runInContext(helper,c);return {c,input};
}
const initial=()=>({id:'demo',version:1,stage:'CRM & Tech Training',flowEnabled:true,flowRecord:{steps:{},evaluations:{}},flowCriteria:{PracticalEvaluation:[{id:'criterion'}]},activeTraining:{checklist:[]}});
const stale=()=>Object.assign(Error('Record changed. Refresh first.'),{status:409});
test('delivery/ack version changes retry once without discarding entered ratings',async()=>{
 const t=initial(),next={trainees:[{...structuredClone(t),version:5,lifecycle:{acknowledgements:[{}]}}]},calls=[];
 const {c}=client(t,async(action,p)=>{calls.push({action,p});if(action==='state')return next;if(calls.length===1)throw stale();return {ok:true};});
 await c.mutateFlow('flowEvaluation',{traineeId:'demo',version:1,step:'PracticalEvaluation',ratings:[{id:'criterion',score:8}]});
 assert.equal(calls.length,3);assert.equal(calls[2].p.version,5);assert.equal(calls[2].p.ratings[0].score,8);
});
test('a real edit refreshes state, keeps entered ratings for review and never overwrites the other trainer',async()=>{
 const t=initial(),next=structuredClone(t);next.version=2;next.flowRecord.evaluations.PracticalEvaluation={ratings:[{id:'criterion',score:6}]};let mutations=0;
 const {c,input}=client(t,async action=>{if(action==='state')return {trainees:[next]};mutations++;throw stale();});
 await assert.rejects(c.mutateFlow('flowEvaluation',{traineeId:'demo',version:1,step:'PracticalEvaluation',ratings:[{id:'criterion',score:8}]}),/updated elsewhere/);
 assert.equal(mutations,1);assert.equal(c.current().version,2);assert.equal(input.value,'8');
});
test('network failures do not retry writes and stage changes cannot retarget an old action',async()=>{
 let mutations=0;const {c}=client(initial(),async()=>{mutations++;throw Error('Connection interrupted');});
 await assert.rejects(c.mutateFlow('flowComplete',{traineeId:'demo',version:1,step:'Practical'}),/Connection interrupted/);assert.equal(mutations,1);
 const next={...initial(),version:2,stage:'Sales Training'};
 const {c:other}=client(initial(),async action=>{if(action==='state')return {trainees:[next]};throw stale();});
 await assert.rejects(other.mutateFlow('flowComplete',{traineeId:'demo',version:1,step:'Practical'}),/phase changed/);
});
const polling=source.slice(source.indexOf('async function refreshAcknowledgementStatus(){'),source.indexOf('setInterval(refreshAcknowledgementStatus'));
test('background confirmation refresh also updates version-only changes',async()=>{
 const t=initial(),next={trainees:[{...t,version:9}]};let renders=0;
 const {c}=client(t,async()=>next);c.acknowledgementRefreshing=false;c.hasFlowDraft=()=>false;c.render=()=>renders++;
 vm.runInContext(polling,c);await c.refreshAcknowledgementStatus();assert.equal(c.current().version,9);assert.equal(renders,0);
});
test('a slow poll cannot replace a state loaded by a newer save',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),t=initial();const {c}=client(t,async()=>pending);c.acknowledgementRefreshing=false;c.hasFlowDraft=()=>false;
 vm.runInContext(polling,c);const wait=c.refreshAcknowledgementStatus();c.S={trainees:[{...t,version:7}]};resolve({trainees:[{...t,version:2}]});await wait;assert.equal(c.current().version,7);
});
