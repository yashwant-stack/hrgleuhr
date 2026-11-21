import test from 'node:test';import assert from 'node:assert/strict';
import {saveAssessment,validateAssessment} from '../transition-assessment.js';
import {issueAcknowledgement,acknowledgementAction} from '../lifecycle.js';
import {handoverSummary} from '../handover-summary.js';
const answers={competent:'Yes',independent:'With support',gaps:'More observation',recommendation:'Retraining required'};
test('trainer review validates role, required answers, concurrency and preserves previous reviews',()=>{
 const db={audit:[]},t={id:'t',ownerId:'trainer',stage:'Sales Training',version:1},u={id:'trainer',role:'trainer',email:'trainer@test.com'};
 assert.throws(()=>saveAssessment(db,{...u,id:'other'},t,{kind:'trainer',version:1,answers}),/assigned trainer/);
 assert.throws(()=>saveAssessment(db,u,t,{kind:'hr',version:1,answers}),/administrator/);
 assert.throws(()=>saveAssessment(db,u,t,{kind:'trainer',version:0,answers}),/Record changed/);
 assert.throws(()=>saveAssessment(db,u,t,{kind:'trainer',version:1,answers:{...answers,gaps:''}}),/gaps/);
 saveAssessment(db,u,t,{kind:'trainer',version:1,answers});saveAssessment(db,u,t,{kind:'trainer',version:2,answers});assert.equal(t.transitionAssessments.length,2);assert.equal(db.audit.length,2);
});
test('HR and management questions enforce supported recommendations',()=>{
 assert.throws(()=>validateAssessment('management',{competency:'Yes',behaviour:'Satisfactory',patientHandling:'Meets standards',responsibilities:'Yes',recommendation:'Auto deploy'}),/recommendation/);
 assert.deepEqual(validateAssessment('hr',{departments:'Complete',discipline:'Satisfactory',feedback:'Yes',gaps:'None',documentation:'Yes'}).gaps,'None');
});
test('new handover feedback requires structured trainee answers before consuming token; old tokens remain compatible',()=>{
 const t={id:'t',name:'Test',email:'t@example.test',version:1,handovers:[{id:'h',fromStage:'Sales Training',stage:'Operations Training'}]},db={trainees:[t]};
 issueAcknowledgement(db,t,'handover-feedback','h','Review','Test','https://test.example');const token=db.lifecycleNotifications[0].body.match(/#([a-f0-9]{64})/)[1],p={token,submit:true,confirm:true,name:'Test',rating:5};
 assert.throws(()=>acknowledgementAction(db,p),/Key learnings/);assert.equal(db.ackTokens[0].usedAt,undefined);
 const a={learnings:'Consultation',independentTasks:'CRM',support:'None',adequate:'Yes',ready:'Yes'};acknowledgementAction(db,{...p,answers:a});assert.deepEqual(t.handoverFeedback[0].answers,a);assert.match(db.lifecycleNotifications[1].body,/Consultation/);assert.equal(db.lifecycleNotifications[1].kind,'handover-feedback-admin');
 acknowledgementAction(db,p);assert.equal(t.handoverFeedback.length,1);
});

test('module completion requests feedback once, supports opt-out and stores the module context',async()=>{
 const {requestCompletionFeedback}=await import('../lifecycle.js');
 const t={id:'t',name:'Demo',email:'demo@example.test',stage:'Sales Training',trainerName:'Mentor',version:1},db={trainees:[t]};
 requestCompletionFeedback(db,t,'module:1','Sales basics','https://test.example');
 requestCompletionFeedback(db,t,'module:1','Sales basics','https://test.example');
 assert.equal(db.ackTokens.length,1);assert.equal(db.lifecycleNotifications.length,1);
 const token=db.lifecycleNotifications[0].body.match(/#([a-f0-9]{64})/)[1];
 acknowledgementAction(db,{token,submit:true,confirm:true,name:'Demo',rating:4,answers:{learnings:'Sales',independentTasks:'CRM',support:'None',adequate:'Yes',ready:'Yes'}});
 assert.equal(t.handoverFeedback[0].moduleTitle,'Sales basics');assert.equal(t.handoverFeedback[0].phase,'Sales Training');assert.equal(db.lifecycleNotifications.at(-1).kind,'handover-feedback-admin');
 t.completionFeedbackEnabled=false;requestCompletionFeedback(db,t,'module:2','Other','https://test.example');assert.equal(db.ackTokens.length,1);
});
