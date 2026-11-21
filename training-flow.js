import {feedbackPhase} from './final-feedback.js';
import {materialSharing} from './material-sharing.js';
import {trainingPurpose} from './training-purpose.js';
import {activeTraining,currentMaterials,practicalMentorProgress} from './phase-training.js';
import {canonicalPhase,administrativePhase} from './training-phases.js';
import {issueAcknowledgement,acknowledged} from './lifecycle.js';
import {id,now} from './store.js';
import {createHash} from 'node:crypto';
import {model,matchesDesignation} from './training-workflow.js';
export const flowSteps=['Start','Educate','Content','TheoryEvaluation','TheoryAcknowledgement','Mentor','Practical','PracticalEvaluation','PracticalAcknowledgement','Handover'];
const orderedSteps=t=>trainingPurpose(t)==='Revaluation'?['Start','TheoryEvaluation','TheoryAcknowledgement','Educate','Content','Mentor','Practical','PracticalEvaluation','PracticalAcknowledgement','Handover']:flowSteps;
export const flowLabels={Start:'Start · Welcome letter',Educate:'Educate (Theory)',Content:'Content shared',TheoryEvaluation:'Theory evaluation',TheoryAcknowledgement:'Theory acknowledgement',Mentor:'Mentor assigned',Practical:'Practical training & content',PracticalEvaluation:'Practical evaluation',PracticalAcknowledgement:'Practical acknowledgement',Handover:'Handover to next department'};
const fail=(m,s=409)=>{throw Object.assign(Error(m),{status:s});};
export const flowRecord=t=>t.trainingFlow?.[canonicalPhase(t.stage)]||{};
const ensure=t=>{t.flowEnabled=true;t.trainingFlow??={};return t.trainingFlow[canonicalPhase(t.stage)]??={steps:{},evaluations:{}};};
export const flowPassScore=()=>7.5;
export function flowCriteria(t,db,step){
 const active=activeTraining(t,db);
 if(step==='TheoryEvaluation')return active.assessments.length?active.assessments.map(r=>({id:r.id,title:r.question,guidance:r.keyPoints})):active.checklist.filter(r=>r.type!=='Practical'&&!r.removed).map(r=>({id:r.id,title:r.topic}));
 const criteria=active.scores.length?active.scores.map(r=>({id:r.id,title:r.criterion})):active.checklist.filter(r=>r.type==='Practical'&&!r.optional&&!r.removed).map(r=>({id:r.id,title:r.topic,guidance:r.verification}));
 if(criteria.length||canonicalPhase(t.stage)!=='CRM & Tech Training'||active.checklist.some(r=>r.type==='Practical'))return criteria;
 // The designation workbooks cover CRM theory but supply no CRM practical tracker.
 // Use the existing role-specific CRM guide for the trainer's observed assessment.
 const groups=new Map();
 for(const r of model(db||{}).Checklist_Template){
  if(canonicalPhase(r.Phase)!=='CRM & Tech Training'||r.Type!=='Practical'||!matchesDesignation(r.Designation,t.designation,db||{}))continue;
  const topics=groups.get(r.Module)||[];if(!topics.includes(r.Topic))topics.push(r.Topic);groups.set(r.Module,topics);
 }
 return [...groups].map(([module,topics])=>({id:'crm-practical-'+createHash('sha256').update(module).digest('hex').slice(0,20),title:module,guidance:'Observe the trainee demonstrate: '+topics.join('; ')}));
}
export function flowStatus(t,db){
 if(administrativePhase(t.stage))return [];
 const f=flowRecord(t),checks=activeTraining(t,db).checklist.filter(r=>!r.removed),practical=practicalMentorProgress(t,db),available=currentMaterials(t,db),approved=(t.approvedMaterials||[]).filter(a=>available.some(m=>m.id===a.id));
 const shared=step=>(trainingPurpose(t)==='Revaluation'&&step==='Practical'&&f.evaluations?.TheoryEvaluation?.score>=flowPassScore(t))||!available.length||approved.length>0&&approved.every(a=>materialSharing(t,a.id)?.status==='confirmed');
 const evalReady=step=>{const criteria=flowCriteria(t,db,step),saved=f.evaluations?.[step];return criteria.length>0&&saved?.score!=null&&saved.score>=flowPassScore(t)&&criteria.every(c=>saved.ratings.some(r=>r.id===c.id&&r.score>=1&&r.score<=10));};
 const ack=step=>{const ref=f.steps?.[step]?.ref;return !!ref&&acknowledged(t,'flow-evaluation',ref);};
 const ready={Start:true,Educate:checks.filter(r=>r.type!=='Practical').every(r=>r.covered),Content:shared('Content'),TheoryEvaluation:evalReady('TheoryEvaluation'),TheoryAcknowledgement:ack('TheoryEvaluation'),Mentor:practical.ready,Practical:practical.ready&&(!practical.required||shared('Practical')),PracticalEvaluation:evalReady('PracticalEvaluation'),PracticalAcknowledgement:ack('PracticalEvaluation'),Handover:!!t.certificate&&canonicalPhase(t.certificate.phase)===canonicalPhase(t.stage)};
 const unshared=approved.filter(a=>materialSharing(t,a.id)?.status!=='confirmed').map(a=>available.find(m=>m.id===a.id)?.title||a.id);
 const sharingMissing=!shared('Content')?[approved.length?'Confirm sharing for: '+unshared.join(', ')+'.':'Share at least one current-phase training document with the trainee and confirm sharing.']:[];
 const mentorMissing=!practical.ready?[practical.assigned?`Mentor must complete ${practical.total-practical.complete} remaining practical task(s).`:'Assign the practical mentor first.']:[];
 const evaluationMissing=step=>!flowCriteria(t,db,step).length?['No evaluation items are configured for this phase. Ask HR to add assessment criteria.']:!evalReady(step)?[f.evaluations?.[step]?.score!=null&&f.evaluations[step].score<flowPassScore(t)?'Minimum 75% (7.5/10) required. Reset ratings and complete the evaluation again.':'Rate and save every evaluation item with a minimum average of 75% (7.5/10).']:[];
 const missing={TheoryEvaluation:evaluationMissing('TheoryEvaluation'),PracticalEvaluation:evaluationMissing('PracticalEvaluation'),Mentor:mentorMissing,Content:sharingMissing,Practical:[...(!practical.ready?[practical.assigned?`Mentor must complete ${practical.total-practical.complete} remaining practical task(s).`:'Assign the practical mentor first.']:[]),...(practical.required&&!shared('Practical')?['Share the approved training documents with the trainee and confirm sharing. '+sharingMissing.join(' ')]:[])]};
 let blockedBy=null;return orderedSteps(t).map(key=>{const notRequired=(key==='Start'&&['Reskilling','Revaluation'].includes(trainingPurpose(t)))||(trainingPurpose(t)==='Revaluation'&&['Educate','Content'].includes(key)&&f.evaluations?.TheoryEvaluation?.score>=flowPassScore(t));const complete=notRequired|| (key==='Start'?(f.steps?.Start?.complete??t.journeySteps?.Start?.complete??(!!t.communications?.welcome?.sentAt||Object.values(f.steps||{}).some(s=>s.complete))):key.endsWith('Acknowledgement')?ready[key]:(!!f.steps?.[key]?.complete&&!(key.endsWith('Evaluation')&&f.evaluations?.[key]?.score<flowPassScore(t))));const evaluation=key==='TheoryAcknowledgement'?'TheoryEvaluation':key==='PracticalAcknowledgement'?'PracticalEvaluation':null;const acknowledgement=evaluation?t.lifecycle?.acknowledgements?.find(a=>a.kind==='flow-evaluation'&&a.ref===f.steps?.[evaluation]?.ref):null;const ackToken=evaluation?db?.ackTokens?.filter(a=>a.traineeId===t.id&&a.kind==='flow-evaluation'&&a.ref===f.steps?.[evaluation]?.ref).at(-1):null;const ackMail=ackToken?db?.lifecycleNotifications?.find(n=>n.key==='ack:'+ackToken.hash):null;const result={emailDelivery:ackMail?{status:ackMail.status,to:ackMail.to,error:ackMail.error,sentAt:ackMail.sentAt}:null,acknowledgement:acknowledgement?{name:acknowledgement.name,at:acknowledgement.at,by:acknowledgement.by}:null,notRequired,key,label:flowLabels[key],ready:ready[key],complete,blockedBy,missing:missing[key]||[],ref:f.steps?.[key]?.ref};if(!complete&&!blockedBy)blockedBy=key;return result;});
}
export function requireFlow(t,db,step,{read=false}={}){const s=flowStatus(t,db).find(s=>s.key===step);if(!s)fail('Use the final feedback form for this phase.');if(s.blockedBy)fail('Complete '+flowLabels[s.blockedBy]+' first');if(s.complete&&!read)fail(flowLabels[step]+' is locked. Request admin correction first.');}
export function flowConfirmation(db,t,title,details,origin,ref=id()){if(!t.email)fail('Add the trainee email before saving; confirmation email is required.',400);issueAcknowledgement(db,t,'flow-update',ref,title,details,origin);}
export function flowAction(db,t,u,action,p,origin){
 if(action==='enableTrainingFlow'){ensure(t);return {ok:true};}
 const step=p.step;if(!flowSteps.includes(step))fail('Choose a valid training step',400);requireFlow(t,db,step);if(!t.email)fail('Add the trainee email before saving; confirmation email is required.',400);const f=ensure(t);f.steps??={};f.evaluations??={};
 if(action==='flowRetest'){
  if(!['TheoryEvaluation','PracticalEvaluation'].includes(step))fail('Choose an evaluation step',400);
  const saved=f.evaluations[step];
  if(!saved||saved.score==null||saved.score>=flowPassScore(t))fail('Retest is available only for a saved score below the minimum threshold',409);
  f.evaluationHistory??={};(f.evaluationHistory[step]??=[]).push({...structuredClone(saved),retestAt:now(),retestBy:u.email});
  resetFlow(t,step);
  delete f.evaluations[step];
  const active=activeTraining(t,db);
  for(const row of step==='TheoryEvaluation'?active.assessments:active.scores){row.score=null;row.rating='';row.assessor='';row.at=null;}
 }else if(action==='flowChecklist'){
  if(!['Educate','Practical'].includes(step))fail('Choose a checklist step',400);
  const rows=activeTraining(t,db).checklist.filter(r=>!r.removed&&(step==='Practical'?r.type==='Practical':r.type!=='Practical'));
  if(!Array.isArray(p.rows)||!p.rows.length||p.rows.some(x=>!rows.some(r=>r.id===x.id)||typeof x.complete!=='boolean'))fail('Choose current checklist items',400);
  const changed=[];for(const input of p.rows){const r=rows.find(r=>r.id===input.id);if(r.covered===input.complete)continue;r.covered=input.complete;r.coveredAt=input.complete?now():null;r.assessor=u.email;r.at=now();changed.push(r.topic+': '+(input.complete?'Completed':'Pending'));}
  if(changed.length){const ref=id();f.checklistSaves??={};f.checklistSaves[step]={ref,at:now(),by:u.email};flowConfirmation(db,t,flowLabels[step]+' checklist updated — '+t.name,`Phase: ${t.stage}\nTrainer: ${u.name} (${u.email})\n\n`+changed.join('\n'),origin,ref);}
 }else if(action==='flowEvaluation'){
  if(!['TheoryEvaluation','PracticalEvaluation'].includes(step))fail('Choose an evaluation step',400);const criteria=flowCriteria(t,db,step);
  if(!criteria.length)fail('No evaluation items are configured for this phase. Ask HR to add assessment criteria.',400);
  if(!Array.isArray(p.ratings)||p.ratings.length!==criteria.length||new Set(p.ratings.map(r=>r.id)).size!==criteria.length||criteria.some(c=>!p.ratings.some(r=>r.id===c.id&&Number.isInteger(Number(r.score))&&Number(r.score)>=1&&Number(r.score)<=10)))fail('Rate every evaluation item from 1 to 10',400);
  if(f.evaluations[step]&&p.ratings.every(r=>f.evaluations[step].ratings.some(x=>x.id===r.id&&x.score===Number(r.score))))return {ok:true};
  const ratings=p.ratings.map(r=>({id:r.id,title:criteria.find(c=>c.id===r.id).title,score:Number(r.score)}));f.evaluations[step]={ratings,score:ratings.length?ratings.reduce((n,r)=>n+r.score,0)/ratings.length:null,by:u.email,at:now()};
  const active=activeTraining(t,db);for(const r of ratings){const row=(step==='TheoryEvaluation'?active.assessments:active.scores).find(x=>x.id===r.id);if(row){row.score=r.score;row.assessor=u.email;row.at=now();if(step==='TheoryEvaluation')row.rating=r.score>=8?'Excellent':r.score>=6?'Good':'Average';}}
  flowConfirmation(db,t,flowLabels[step]+' saved — '+t.name,`Phase: ${t.stage}\nTrainer: ${u.email}\n\n`+ratings.map(r=>r.title+': '+r.score+'/10').join('\n'),origin);
 }else if(action==='flowComplete'){
  if(step.endsWith('Acknowledgement')||step==='Handover')fail('This step requires its own acknowledgement or handover action',400);
  if(!flowStatus(t,db).find(s=>s.key===step).ready)fail('Complete all requirements in '+flowLabels[step]+' before saving');
  const ref=id();f.steps[step]={complete:true,by:u.email,at:now(),ref};
  const details=`Trainee: ${t.name}\nPhase: ${t.stage}\nStep: ${flowLabels[step]}\nCompleted by: ${u.name} (${u.email})\n\n`+(f.evaluations[step]?.ratings.map(r=>r.title+': '+r.score+'/10').join('\n')||'Please confirm receipt and completion of this training step.');
  if(step.endsWith('Evaluation'))issueAcknowledgement(db,t,'flow-evaluation',ref,flowLabels[step]+' — review & acknowledge',details,origin);else flowConfirmation(db,t,flowLabels[step]+' completed — '+t.name,details,origin,ref);
 }else if(action==='flowResendAcknowledgement'){
  const evaluation=step==='TheoryAcknowledgement'?'TheoryEvaluation':step==='PracticalAcknowledgement'?'PracticalEvaluation':null;
  if(!evaluation)fail('Choose acknowledgement step');const ref=f.steps[evaluation]?.ref;const token=db.ackTokens?.find(a=>a.traineeId===t.id&&a.kind==='flow-evaluation'&&a.ref===ref&&!a.usedAt&&a.expiresAt>Date.now());if(token){const mail=db.lifecycleNotifications?.find(n=>n.key==='ack:'+token.hash);if(mail?.status==='Delivery uncertain')fail('Review the uncertain email delivery before retrying');if(mail&&!['Queued','Sending'].includes(mail.status)){if(!t.email)fail('Employee email is required for acknowledgement');mail.to=t.email;mail.status='Pending';mail.error='';mail.retryAt=now();}}
  issueAcknowledgement(db,t,'flow-evaluation',ref,flowLabels[evaluation]+' — review & acknowledge',`Phase: ${t.stage}\n`+f.evaluations[evaluation].ratings.map(r=>r.title+': '+r.score+'/10').join('\n'),origin);
 }else fail('Unknown flow action',400);
 t.version++;db.audit.push({id:id(),at:now(),actor:u.email,traineeId:t.id,action:flowLabels[step]+' · '+action,detail:t.stage});return {ok:true};
}
export function resetFlow(t,step){const f=ensure(t),steps=orderedSteps(t),index=steps.indexOf(step);for(const key of steps.slice(index)){if(f.steps)delete f.steps[key];if(f.evaluations&&key!==step)delete f.evaluations[key];}if(step==='Start')f.steps.Start={complete:false};t.certificate=null;}
