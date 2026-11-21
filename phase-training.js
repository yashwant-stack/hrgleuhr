import {samePhase,canonicalPhase,administrativePhase} from './training-phases.js';
import {curriculumTemplates} from './designation-curricula.js';
import {materialForPhase,materials} from './training-materials.js';
import {model,matchesDesignation,phaseOf,original} from './training-workflow.js';
export const phaseDepartment=stage=>['Induction','Onboarding','Asset Allotment'].includes(stage)?'HR':stage==='Sales Training'?'Sales':stage==='CRM & Tech Training'?'Tech':stage==='Operations Training'?'Operations':null;
export function activeTraining(t,db){
 const tpl=db?curriculumTemplates(t,db,model(db)):null,department=phaseDepartment(t.stage);
 const eligible=(r,kind)=>{const rows=tpl?.[kind]||[];const matches=rows.filter(x=>r.curriculumId?x.curriculumId===r.curriculumId:x.curriculumId?false:kind==='Checklist_Template'?x.Module===r.module&&x.Topic===r.topic:kind==='Scoring_Template'?x.Category===r.category&&x.Criterion===r.criterion:x.Question===r.question&&x.Department===r.department);if(!matches.length&&db&&tpl!==model(db)&&!r.custom){const original=model(db)[kind]||[];if(r.curriculumId||original.some(x=>kind==='Checklist_Template'?x.Module===r.module&&x.Topic===r.topic:kind==='Scoring_Template'?x.Category===r.category&&x.Criterion===r.criterion:x.Question===r.question))return false;}return !matches.length?(r.custom?matchesDesignation(r.designation||t.designation,t.designation,db||{}):true):matches.some(x=>matchesDesignation(x.Designation,t.designation,db));};
 const inPhase=r=>{const phase=r.phase||phaseOf('',r.module||r.category,r.module?original.MODULE_PHASE:original.CAT_PHASE);return !phase||samePhase(phase,t.stage);};
 const checklist=(t.checklist||[]).filter(r=>inPhase(r)&&eligible(r,'Checklist_Template'));
 const scores=(t.scores||[]).filter(r=>inPhase(r)&&eligible(r,'Scoring_Template'));
 const assessments=(t.assessments||[]).filter(r=>(!department||r.department===department)&&(!r.curriculumId||inPhase(r)||t.stage==='Assessment')&&eligible(r,'Question_Bank'));
 return {checklist,scores,assessments,department};
}
// Whole-journey checklist progress. activeTraining() covers only the current stage, so it reads 0%
// after a handover and in stages without a checklist (Final Feedback, Onboard Final Email, Asset Allotment).
export function overallChecklistProgress(t,db){
 const phases=new Set([...(t.phases||[]),t.stage,...(t.phaseHistory||[]).map(h=>h.phase)].filter(Boolean).map(canonicalPhase));
 const rows=new Map();
 for(const phase of phases){
  if(administrativePhase(phase))continue;
  for(const r of activeTraining({...t,stage:phase},db).checklist)if(!r.removed)rows.set(r.id??(r.module+'|'+r.topic),r);
 }
 const total=rows.size,covered=[...rows.values()].filter(r=>r.covered).length;
 return {covered,total,percent:total?Math.round(covered/total*100):0};
}
export function phaseQuestions(t,db,academy){
 const department=phaseDepartment(t.stage),tpl=curriculumTemplates(t,db,model(db));
 const rows=tpl.Question_Bank.filter(r=>(!department||r.Department===department)&&matchesDesignation(r.Designation,t.designation,db)&&r['Key Points (for assessor)']);
 const result=rows.map((r,i)=>{const right=r['Key Points (for assessor)'];const wrong=[...new Set(rows.filter(x=>x!==r).map(x=>x['Key Points (for assessor)']))].filter(x=>x!==right).slice(0,3);return {id:'phase-'+i,moduleId:'phase-'+r.Department,moduleTitle:r.Department+' · '+t.stage,question:'Which response meets the expected standard? '+r.Question,options:[right,...wrong],correctIndex:0,clinicalRationale:right,phase:t.stage};}).filter(q=>q.options.length>=2);
 if(t.stage==='CRM & Tech Training')result.push(...techQuestions.map((q,i)=>({...q,id:'tech-'+i,moduleId:'phase-Tech',moduleTitle:'CRM & Tech Training',phase:t.stage})));
 if(t.stage==='Sales Training'&&matchesDesignation('Counsellor,Branch Manager,Regional Head,Doctor',t.designation,db))result.push(...academy.questions.map(q=>({...q,moduleTitle:academy.modules.find(m=>m.id===q.moduleId)?.title,phase:t.stage})));
 result.push(...(db.customQuestions||[]).filter(q=>q.phase===t.stage&&matchesDesignation(q.designation||'All',t.designation,db)));
 return result;
}
export function switchTrainingPhase(t,next){
 if(samePhase(t.stage,next))return;
 t.phaseHistory??=[];t.phaseHistory.push({phase:t.stage,at:new Date().toISOString(),journeySteps:t.journeySteps||{},certificate:t.certificate||null,phaseSaves:t.phaseSaves||{},assessments:structuredClone(t.assessments||[])});
 const start=t.journeySteps?.Start;t.journeySteps=start?{Start:start}:{};
 for(const row of t.assessments||[]){row.rating='';row.score=null;row.answer='';row.assessor='';row.at=null;}
 t.phaseSaves={};t.certificate=null;t.stage=next;t.status='Active';t.closedAt=null;
}
export function phaseScore(t,records,db){if(t.flowEnabled){const phase=Object.keys(t.trainingFlow||{}).find(p=>samePhase(p,t.stage));const saved=Object.values(t.trainingFlow?.[phase]?.evaluations||{}).filter(e=>e.score!=null&&Number.isFinite(Number(e.score))).sort((a,b)=>String(a.at).localeCompare(String(b.at))).at(-1);if(saved)return Number(saved.score);}const evaluation=t.lifecycle?.evaluations?.filter(e=>samePhase(e.phase,t.stage)&&e.planRevision===t.lifecycle.plan?.revision&&e.score!=null).at(-1);if(evaluation)return evaluation.score;const values=activeTraining(t,db).scores.map(r=>r.score).filter(n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))).map(Number);if(values.length)return values.reduce((a,b)=>a+b,0)/values.length;const ratings=activeTraining(t,db).assessments.map(r=>r.score).filter(n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))).map(Number);if(ratings.length)return ratings.reduce((a,b)=>a+b,0)/ratings.length;const test=records.filter(r=>r.traineeId===t.id&&r.kind==='test'&&samePhase(r.phase,t.stage)).at(-1);return test?test.score/10:null;}

// Common CRM learning checks derived from the imported Gleuhr Guide overview.
const techQuestions=[
 {question:'In the CRM, what should you do when a screen refuses an action?',options:['Read the refusal and follow the module rules or hand off to the authorised colleague.','Overwrite the record until it saves.','Use another employee’s login.','Skip the refused action without recording the next step.'],correctIndex:0,clinicalRationale:'The Guide requires refusals to be read and acted on, with decisions handled by the correct role.'},
 {question:'Which practical skill does the CRM training guide require?',options:['Use the correct page, buttons and choices in the right order.','Only memorise the page names.','Use any available screen for every role.','Skip steps when the queue is busy.'],correctIndex:0,clinicalRationale:'The Guide assesses both the sequence of steps and correct use of screens.'},
 {question:'Who signs off a Branch Manager’s CRM training?',options:['The Sales Head.','The Branch Manager signs off their own training.','Any patient.','The software automatically approves attendance.'],correctIndex:0,clinicalRationale:'The imported framework states that the Sales Head signs off a Branch Manager.'},
 {question:'Before working independently, what training evidence is needed?',options:['Completed theory learning and observed practical sign-off.','Attendance alone.','A single high theory score replaces practical work.','A colleague’s login access.'],correctIndex:0,clinicalRationale:'The Guide evaluates theory and observed practical tasks separately.'}
];
export function currentMaterials(t,db){return [...materials,...(db?.uploadedMaterials||[])].filter(m=>!(db?.archivedMaterialIds||[]).includes(m.id)&&materialForPhase(m,t,db||{}));}
export function mentorReady(t,db){
 const practical=activeTraining(t,db).checklist.filter(r=>!r.removed&&r.type==='Practical');
 const approved=(t.approvedMaterials||[]).filter(a=>currentMaterials(t,db).some(m=>m.id===a.id));
 return practical.length>0||t.status==='Completed'||!!t.phaseHistory?.some(h=>h.journeySteps?.Finish?.complete)||!!(t.phaseSaves?.checklist&&practical.length&&practical.every(r=>r.covered)&&approved.every(a=>t.completedMaterials?.some(c=>c.id===a.id)));
}

export function practicalMentorProgress(t,db){
 const practical=activeTraining(t,db).checklist.filter(r=>!r.removed&&r.type==='Practical');
 const assigned=!!t.mentor&&samePhase(t.mentor.phase,t.stage),tasks=assigned?(t.mentor.tasks||[]):[];
 const covered=new Set(tasks.filter(x=>x.complete).map(x=>x.topicId));
 const mandatory=practical.filter(r=>!r.optional),total=mandatory.length,complete=mandatory.filter(r=>covered.has(r.id)).length;
 return {required:total>0,assigned,total,complete,ready:!total||(assigned&&complete===total),tasks:practical.map(r=>({id:r.id,title:r.topic,module:r.module,verification:r.verification,mentor:r.mentor,source:r.source,optional:!!r.optional,evidenceRequired:!!r.curriculumId,complete:covered.has(r.id),evidence:tasks.find(x=>x.topicId===r.id)?.evidence||'',completedAt:tasks.find(x=>x.topicId===r.id)?.completedAt}))};
}
