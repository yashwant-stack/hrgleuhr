import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyStatus,journeyMutationStep,journeySteps} from '../journey.js';
test('empty steps are not complete; existing evidence and HR reopening determine locks',()=>{
 const t={id:'t',checklist:[],scores:[],assessments:[],handovers:[]};
 assert.ok(Object.values(journeyStatus(t)).every(s=>!s.complete));
 t.communications={welcome:{sentAt:'2026-11-02'}};
 t.checklist=[{covered:true}];t.approvedMaterials=[{id:'m'}];
 assert.equal(journeyStatus(t).Start.complete,true);assert.equal(journeyStatus(t).Learn.complete,false);
 t.phaseSaves={checklist:{},scores:{}};t.completedMaterials=[{id:'m'}];assert.equal(journeyStatus(t).Learn.complete,true);
 t.journeySteps={Learn:{complete:false}};assert.equal(journeyStatus(t).Learn.complete,false);
 t.scores=[{score:null}];assert.equal(journeyStatus(t,[{traineeId:'t',kind:'test'}]).Test.complete,false);
 t.scores=[{score:8}];assert.equal(journeyStatus(t,[{traineeId:'t',kind:'test'}]).Test.complete,true);
 assert.equal(journeySteps.at(-1),'Handover');
});
test('mutation groups cover direct API changes while preserving read access',()=>{
 assert.equal(journeyMutationStep('assessment',{},{}),'Test');
 assert.equal(journeyMutationStep('submitTest',{},{}),'Test');
 assert.equal(journeyMutationStep('communicationSend',{kind:'final'},{}),'Finish');
 assert.equal(journeyMutationStep('materialContent',{},{}),null);
 assert.equal(journeyMutationStep('restoreEntry',{entryId:'old'},{archivedEntries:[{id:'old',kind:'scores'}]}),'Test');
});
test('only the first incomplete step is accessible and reopening relocks later steps',()=>{
 const t={id:'t',journeySteps:{Start:{complete:true},Learn:{complete:false},Test:{complete:true}}};
 let state=journeyStatus(t);assert.equal(state.Learn.blockedBy,null);assert.equal(state.Practice,undefined);assert.equal(state.Test.blockedBy,'Learn');assert.equal(state.Handover.blockedBy,'Learn');
 t.journeySteps.Learn.complete=true;state=journeyStatus(t);assert.equal(state.Test.blockedBy,null);
 t.journeySteps.Start.complete=false;assert.equal(journeyStatus(t).Learn.blockedBy,'Start');
});

test('Test requires assessment ratings and saved scores, without a separate practice or quiz requirement',()=>{
 const t={id:'t',stage:'Induction',checklist:[],assessments:[{department:'HR',score:7}],scores:[{score:8}],phaseSaves:{scores:{}}};
 assert.equal(journeyStatus(t,[]).Test.ready,true);assert.equal(journeyStatus(t,[]).Practice,undefined);
 t.assessments[0].score=null;assert.equal(journeyStatus(t,[]).Test.ready,false);
 t.assessments[0].score=7;delete t.phaseSaves.scores;assert.equal(journeyStatus(t,[]).Test.ready,false);
 assert.deepEqual(journeySteps,['Start','Learn','Test','Finish','Handover']);
});
