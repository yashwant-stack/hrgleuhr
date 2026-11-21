import test from 'node:test';import assert from 'node:assert/strict';import {mentorPlan,mentorHistoryText} from '../mentor-plan.js';
test('mentor plan follows current phase and history retains prior guidance and results',()=>{
 const t={stage:'Sales Training',designation:'Branch Manager',checklist:[{phase:'Induction',type:'Practical',topic:'Office tour'},{phase:'Sales Training',type:'Practical',topic:'Sales demonstration'}],scores:[{phase:'Induction',criterion:'HR knowledge',score:8}],assessments:[],phaseHistory:[{phase:'Induction',at:'2026-11-01',assessments:[]}],mentorHistory:[{name:'Previous mentor',phase:'Induction',startDate:'2026-11-01',focus:'Welcome guidance'}]};
 assert.match(mentorPlan(t,{}),/Sales demonstration/);assert.doesNotMatch(mentorPlan(t,{}),/Office tour/);const history=mentorHistoryText(t,{});assert.match(history,/HR knowledge: 8.0/);assert.match(history,/Previous mentor/);assert.match(history,/Welcome guidance/);
});
test('legacy checklist rows without phase use module mapping, excluding induction from sales guidance',()=>{
 const t={stage:'Sales Training',designation:'Branch Manager',checklist:[{module:'Induction',type:'Practical',topic:'Office tour'},{phase:'Sales Training',type:'Practical',topic:'Sales demonstration'}],scores:[],assessments:[]};
 // Use an actual induction module from the imported mapping.
 t.checklist[0].module=Object.keys(original.MODULE_PHASE).find(k=>original.MODULE_PHASE[k]==='Induction'||original.MODULE_PHASE[k]==='Onboarding');
 assert.ok(t.checklist[0].module);assert.doesNotMatch(mentorPlan(t,{}),/Office tour/);assert.match(mentorPlan(t,{}),/Sales demonstration/);
});
import {original} from '../training-workflow.js';
