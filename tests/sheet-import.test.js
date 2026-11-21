import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreSheet, stamp } from '../sheet-import.js';
const state=()=>({users:[],trainees:[],records:[],audit:[],outbox:[],customDesignations:{}});
const source=()=>({
 Trainees:[['ID','Name'],['TR-001','Example',null,'Clinic','Other','2026-10-27T00:00:00','Trainer','Induction','trainer@example.test',1,.8,'Active',null]],
 Checklist:[['Trainee'],['Example','Induction','Topic',true,'2026-10-29T10:00:00','Existing note','Theory','assessor@example.test',false,3],['Deleted trainee','Old module','Old topic',false]],
 Scores:[['Trainee'],['Example','Behavioral','Criterion',8,'assessor@example.test','Note']],
 Assessment:[['Trainee'],['Example','HR','Question','Key','Existing answer','Good',7,'assessor@example.test','2026-10-29T10:00:00']],
 Feedback:[['Trainee'],['Example','assessor@example.test','2026-10-29T10:00:00','Good','Extend Training','Strength','Area','Comment']],
 Handover:[['Trainee'],['Example','Induction','Trainer','trainer@example.test','Note','Pending','2026-10-29T10:00:00','2026-10-30T09:30:00']],
 Removed_Items:[['Trainee']], Checklist_Template:[['Module','Topic','Phase','Designation','Type']],Scoring_Template:[['Category','Criterion','Phase','Designation']],Question_Bank:[['Department','Question','Key Points (for assessor)','Designation']],Lists:[['Stages','Designation'],['Induction','Other']],
});
test('restoration preserves values, India dates, history and archives orphan rows without accounts or emails',()=>{
 const db=state();db.users.push({id:'owner',email:'trainer@example.test',active:true,password:'unchanged'});const s=source(),r=restoreSheet(db,s),t=db.trainees[0];
 assert.equal(t.ownerId,'owner');assert.equal(t.checklist[0].coveredAt,'2026-10-29T04:30:00.000Z');assert.equal(t.assessments[0].answer,'Existing answer');assert.equal(t.scores[0].score,8);assert.equal(t.feedbackRows[0].recommendation,'Extend Training');assert.equal(t.handovers[0].status,'Pending');assert.equal(t.handovers[0].remindedOn,'2026-10-30');assert.equal(db.outbox.length,0);assert.equal(db.users.length,1);assert.equal(r.archivedCounts.Checklist,1);assert.equal(db.trainees.length,1);
 const before=JSON.stringify(db);assert.equal(restoreSheet(db,s).alreadyImported,true);assert.equal(JSON.stringify(db),before);
});
test('existing Academy progress and login credentials survive restoration',()=>{
 const db=state();db.trainees.push({id:'existing',name:'Example',version:4,completedModules:[1,2],certificate:{id:'cert'}});db.records.push({id:'academy',traineeId:'existing'});restoreSheet(db,source());assert.equal(db.trainees[0].id,'existing');assert.deepEqual(db.trainees[0].completedModules,[1,2]);assert.equal(db.records[0].traineeId,'existing');assert.equal(db.trainees[0].certificate.id,'cert');
});
test('restoration rejects incorrect totals and duplicate source trainees',()=>{
 const s=source();s.Trainees[1][9]=.5;assert.throws(()=>restoreSheet(state(),s),/Checklist total mismatch/);
 const dup=source();dup.Trainees.push(dup.Trainees[1]);assert.throws(()=>restoreSheet(state(),dup),/Duplicate trainee/);
});
test('sheet timestamps are interpreted in India regardless of host timezone',()=>{
 assert.equal(stamp('2026-10-30T00:10:00'),'2026-10-29T18:40:00.000Z');assert.equal(stamp(null),null);
});
