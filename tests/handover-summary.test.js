import test from 'node:test';import assert from 'node:assert/strict';
import {handoverSummary,handoverNote,SUMMARY_MARKER} from '../handover-summary.js';
test('handover contains cross-phase work, attribution, feedback and only this trainee activity',()=>{
 const t={id:'a',name:'Demo',designation:'Branch Manager',stage:'Sales Training',trainerName:'Sales trainer',checklist:[{phase:'Induction',topic:'HR introduction',covered:true,assessor:'hr@example.test'},{phase:'Sales Training',topic:'Pitch',covered:false}],scores:[{phase:'Sales Training',criterion:'Product knowledge',score:8,assessor:'sales@example.test'}],assessments:[],phaseHistory:[{phase:'Induction',assessments:[{question:'Policy',score:7,assessor:'hr@example.test'}]}],handovers:[{stage:'Sales Training',previousTrainerName:'HR trainer',ownerName:'Sales trainer',note:'MUST NOT RECURSE'}],feedbackRows:[{rating:'Good',comments:'Needs practice',by:'reviewer@example.test'}],lifecycle:{ackToken:'SECRET',events:[{action:'Reviewed'}]}};
 const db={records:[{traineeId:'a',kind:'test',score:80},{traineeId:'b',kind:'private',score:10}],audit:[{traineeId:'a',actor:'hr@example.test',action:'Updated training'},{traineeId:'b',action:'OTHER SECRET'}]};
 const result=handoverSummary(t,db);for(const text of ['HR introduction','Pending','sales@example.test','HR trainer','Policy','Needs practice','Updated training','80'])assert.ok(result.includes(text),text);
 for(const text of ['SECRET','MUST NOT RECURSE','private'])assert.ok(!result.includes(text),text);
 const note=handoverNote(t,db,'Continue training');assert.equal(handoverNote(t,db,note),note);assert.equal(note.split(SUMMARY_MARKER).length,2);
});
