import test from 'node:test';
import assert from 'node:assert/strict';
import {overallChecklistProgress,activeTraining} from '../phase-training.js';

const row=(id,phase,covered,extra={})=>({id,phase,module:'M'+id,topic:'T'+id,covered,...extra});
const trainee=over=>({designation:'Counsellor',stage:'Induction',phases:['Induction','Onboarding'],checklist:[
 row('a','Induction',true),row('b','Induction',true),row('c','Onboarding',true),row('d','Onboarding',false),row('x','Onboarding',false,{removed:true})],...over});

test('overall progress counts every training stage and ignores removed rows',()=>{
 assert.deepEqual(overallChecklistProgress(trainee()),{covered:3,total:4,percent:75});
});

test('progress does not reset to 0% after moving to a stage without a checklist',()=>{
 const t=trainee({stage:'Onboard Final Email',phases:['Induction','Onboarding','Onboard Final Email','Final Feedback'],phaseHistory:[{phase:'Induction'},{phase:'Final Feedback'}]});
 for(const r of t.checklist)r.covered=true;
 assert.equal(activeTraining(t).checklist.length,0,'current stage has no checklist');
 assert.deepEqual(overallChecklistProgress(t),{covered:4,total:4,percent:100});
});

test('a later stage adds its rows to the total',()=>{
 const t=trainee({stage:'Sales Training',phases:['Induction','Onboarding','Sales Training'],checklist:[...trainee().checklist,row('s1','Sales Training',false),row('s2','Sales Training',true)]});
 assert.deepEqual(overallChecklistProgress(t),{covered:4,total:6,percent:67});
});

test('a trainee with no checklist reports 0 of 0',()=>{
 assert.deepEqual(overallChecklistProgress({stage:'Induction',phases:['Induction'],checklist:[]}),{covered:0,total:0,percent:0});
});
