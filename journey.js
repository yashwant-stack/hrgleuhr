import {trainingPurpose} from './training-purpose.js';
import {assetsReady} from './onboarding-completion.js';
import {feedbackPhase} from './final-feedback.js';
import {flowStatus} from './training-flow.js';
import {phaseMissing,phasePlan,acknowledged} from './lifecycle.js';
import {samePhase,administrativePhase} from './training-phases.js';
import {activeTraining,currentMaterials,practicalMentorProgress} from './phase-training.js';
export const journeySteps=['Start','Learn','Test','Finish','Handover'];
export function journeyStatus(t,records=[],db){
 if(administrativePhase(t.stage)){
  if(t.stage==='Asset Allotment')return {...Object.fromEntries(['Start','Learn','Test','Handover'].map(key=>[key,{ready:true,complete:true,notRequired:true}])),Finish:{ready:assetsReady(t),complete:!!t.assetAllotmentCompletedAt,requirement:'Complete asset allotment and trainee receipt acknowledgements.'}};
  const feedback=!!(t.finalFeedback||t.feedbackRows?.some(f=>f.at));
  return {...Object.fromEntries(['Start','Learn','Test'].map(key=>[key,{ready:true,complete:true,notRequired:true}])),Finish:{ready:feedback,complete:false,requirement:'Record final feedback and choose the next action.'},Handover:{ready:feedback,complete:false,requirement:'Choose the person responsible for the next step.'}};
 }
 if(t.flowEnabled){const start=flowStatus(t,db).find(s=>s.key==='Start'),states=flowStatus(t,db).filter(s=>s.key!=='Start'),done=n=>states.slice(0,n).every(s=>s.complete),test=done(8);return {Start:start,Learn:{ready:done(2),complete:done(2)},Test:{ready:test,complete:test},Finish:{ready:!!t.certificate,complete:!!t.certificate,blockedBy:test?null:'Test'},Handover:{ready:test&&!!t.certificate,complete:false,blockedBy:!test?'Test':!t.certificate?'Finish':null}};}
 const active=activeTraining(t,db);const checklist=active.checklist.filter(r=>!r.removed&&!r.optional),approved=(t.approvedMaterials||[]).filter(a=>!db||currentMaterials(t,db).some(m=>m.id===a.id)),assessments=active.assessments,scores=active.scores;
 const own=records.filter(r=>r.traineeId===t.id&&samePhase(r.phase,t.stage));
 const assessed=r=>r.score!==null&&r.score!==undefined&&r.score!==''&&Number.isFinite(Number(r.score));
 const inferred={
  Start:!!t.communications?.welcome?.sentAt,
  Learn:!!t.phaseSaves?.checklist&&checklist.every(r=>r.covered)&&approved.every(m=>t.completedMaterials?.some(c=>c.id===m.id)),
  Test:assessments.every(assessed)&&!!t.phaseSaves?.scores&&scores.every(assessed),
  Finish:!!t.certificate&&samePhase(t.certificate.phase,t.stage),
  Handover:(t.handovers||[]).length>0&&t.handovers.every(h=>h.status==='Completed'&&(t.communications?.['handover:'+h.id]?.sentAt||h.notification==='Sent'))
 };
 const legacyCorrection=t.journeySteps?.Practice?.requestId&&t.journeySteps.Practice.complete===false;
 const result=Object.fromEntries(journeySteps.map(step=>[step,{ready:step==='Start'||inferred[step],complete:t.journeySteps?.[step]?.complete??(step==='Finish'?false:inferred[step]),...t.journeySteps?.[step]}]));

 if(t.lifecycle?.plan){
  const l=t.lifecycle,ph=phasePlan(t),approved=l.plan.approved;
  const ready={Start:true,Learn:!!ph&&checklist.every(r=>r.covered)&&ph.moduleIds.every(mid=>acknowledged(t,'module',l.plan.revision+':'+mid)&&t.completedMaterials?.some(c=>c.id===mid)),Test:!phaseMissing(t).length,Finish:l.certifications.some(c=>samePhase(c.phase,t.stage)&&c.planRevision===l.plan.revision),Handover:inferred.Handover};
  for(const step of journeySteps){result[step].ready=(step==='Start'||approved)&&ready[step];result[step].complete=(step==='Start'||approved)&&ready[step]&&(t.journeySteps?.[step]?.complete??false);}
 }
 const requirements={Start:'Review the optional welcome letter step.',Learn:'Complete every active checklist item and every approved module.',Test:'Rate every assessment and save every score.',Finish:'Issue the certificate for this training phase.',Handover:'Complete every handover and its email.'};
 if(legacyCorrection)result.Test.complete=false;
 for(const step of journeySteps)result[step].requirement=t.lifecycle?.plan?(step==='Start'?'Review the welcome letter. Send by email or share on WhatsApp as needed.':step==='Learn'?'Complete checklist, module receipt acknowledgements and trainer completion.':step==='Test'?'Complete a passing evaluation and trainee acknowledgements.':step==='Finish'?'Assigned trainer must certify this phase in Lifecycle.':requirements[step]):requirements[step];
 const mentoring=practicalMentorProgress(t,db);if(mentoring.required&&!mentoring.ready){for(const step of ['Learn','Test','Finish','Handover']){result[step].ready=false;result[step].complete=false;}result.Learn.requirement=mentoring.assigned?'Mentor must complete all practical tasks ('+mentoring.complete+'/'+mentoring.total+').':'Assign a practical mentor and complete all required mentor tasks.';}
 if(['Reskilling','Revaluation'].includes(trainingPurpose(t)))result.Start={...result.Start,ready:true,complete:true,notRequired:true};
 let blockedBy=null;for(const step of journeySteps){result[step].blockedBy=blockedBy;if(!result[step].complete&&!blockedBy)blockedBy=step;}
 return result;
}
export function journeyMutationStep(name,p,t,records=[]){
 if(name.startsWith('communication')&&(p.kind?.startsWith('mentor:')||p.kind?.startsWith('certificate:')))return null;
 // Sending an approved, unchanged welcome is allowed after Start is complete.
 if(p.kind==='welcome'&&['communicationSend','communicationShare'].includes(name))return null;
 if(name.startsWith('communication')&&!['communicationAttachment','communicationPreview','communicationResolve'].includes(name))return p.kind==='welcome'?'Start':p.kind==='final'?'Finish':'Handover';
 if(name==='saveTrainingRows')return p.kind==='checklist'?'Learn':'Test';
 if(['archiveMaterial','checklist','addChecklist','approveMaterial','completeMaterial','module','exercise'].includes(name))return 'Learn';
 if(name==='assessment')return 'Test';
 if(['score','startTest','submitTest'].includes(name))return 'Test';
 if(['certificate','feedback'].includes(name))return 'Finish';
 if(['draftHandover','activateHandover','handoverStatus','deleteHandover','sendHandover'].includes(name))return 'Handover';
 if(['record','updateRecord'].includes(name))return (p.kind||records.find(r=>r.id===p.recordId)?.kind)==='evaluation'?'Test':null;
 if(['archiveEntry','restoreEntry'].includes(name)){
  const entry=name==='restoreEntry'?t.archivedEntries?.find(r=>r.id===p.entryId):null;
  const kind=entry?.kind||p.kind;
  return {scores:'Test',assessments:'Test',feedbackRows:'Finish',certificate:'Finish',handovers:'Handover'}[kind]||(kind==='records'&&(entry?.entry||records.find(r=>r.id===p.entryId))?.kind==='evaluation'?'Test':null);
 }
 return null;
}
