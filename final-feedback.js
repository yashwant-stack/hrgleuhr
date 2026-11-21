import {issueAcknowledgement} from './lifecycle.js';
import {id,now} from './store.js';
import {canonicalPhase} from './training-phases.js';
import {activeTraining,currentMaterials,switchTrainingPhase} from './phase-training.js';
import {syncTrainee,ratingMap} from './training-workflow.js';

export const feedbackPhase=t=>['Final Feedback','Final Review & Confirmation'].includes(canonicalPhase(t.stage));
export const restartPhases=['Induction','CRM & Tech Training','Sales Training','Operations Training','Assessment'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const clean=v=>String(v||'').trim().slice(0,4000);
export const traineeWorkUrl=(origin,t,h)=>origin+'/?trainee='+encodeURIComponent(t.id)+(h?'&handover='+encodeURIComponent(h.id):'');

export function saveFinalFeedback(db,u,t,p,origin){
 if(!feedbackPhase(t))fail('Open Final Feedback & Confirmation to save this decision.',409);
 if(u.role!=='admin'&&t.ownerId!==u.id)fail('Only the assigned reviewer or HR can save final feedback.',403);
 if(t.version!==p.version)fail('Record changed. Refresh before saving.',409);
 if(!['save','continue','restart'].includes(p.decision))fail('Choose the next action.');
 if(!Object.hasOwn(ratingMap(db),p.rating)||!['Complete','Incomplete'].includes(p.completion))fail('Choose the overall rating and training completion.');
 if(!clean(p.comments)||!clean(p.strengths)||!clean(p.improve))fail('Complete strengths, training gaps and feedback. Use None where appropriate.');
 if(p.decision==='continue'&&p.completion!=='Complete')fail('Incomplete training must be reviewed or restarted before final confirmation.');
 if(p.decision==='restart'&&p.completion!=='Incomplete')fail('Choose Training incomplete to restart.');
 const next=p.decision==='restart'?canonicalPhase(p.restartPhase):'Onboard Final Email';
 if(p.decision==='restart'&&!restartPhases.includes(next))fail('Choose the department to restart.');
 if(p.decision==='restart'&&[...(db.outbox||[]),...(db.lifecycleNotifications||[])].some(n=>n.traineeId===t.id&&['Queued','Sending'].includes(n.status)))fail('An email is still queued or sending for this trainee. Wait for delivery to finish before restarting.',409);
 const person=p.decision!=='save'?db.users.find(x=>x.id===p.ownerId&&x.active):null;
 if(p.decision!=='save'&&!person)fail('Choose an active person responsible for the next step.');
 if(p.decision==='continue'&&!['Good','Excellent'].includes(p.rating))fail('A Good or Excellent rating is required for confirmation.');
 const record={id:id(),phase:t.stage,rating:p.rating,completion:p.completion,recommendation:p.completion==='Incomplete'?'Extend Training':p.rating==='Average'?'Not Confirmed':'Confirm',strengths:clean(p.strengths),improve:clean(p.improve),comments:clean(p.comments),decision:p.decision,ownerId:person?.id||null,nextPhase:p.decision==='save'?null:next,by:u.email,at:now()};
 (t.feedbackRows??=[]).push(record);t.finalFeedback=record;
 if(p.decision!=='restart')issueAcknowledgement(db,t,'final-feedback',record.id,'Final feedback & confirmation — '+t.name,`Phase: Final Feedback & Confirmation\nOverall rating: ${record.rating}\nTraining completion: ${record.completion}\n\nStrengths: ${record.strengths}\nTraining gaps / support: ${record.improve}\n\nFeedback: ${record.comments}\n\n${p.decision==='continue'?'HR will review and send the final onboarding email. Asset allotment follows.':'Your review has been saved. Please acknowledge receipt.'}`,origin);
 if(p.decision!=='save'){
  const from=t.stage,oldOwner=t.ownerId;
  const h={id:id(),fromStage:from,stage:next,previousTrainerId:oldOwner,previousTrainerName:t.trainerName,previousTrainerEmail:t.ownerEmail,ownerId:person.id,ownerName:person.name,email:person.email,note:record.comments+'\nTraining gaps: '+record.improve,status:'Pending',at:now(),createdAt:now(),by:u.email,notification:'Queued'};
  for(const old of t.handovers||[])if(old.status==='Pending')old.status='Completed';
  (t.handovers??=[]).push(h);
  const previousAssessments=structuredClone(activeTraining({...t,stage:next},db).assessments);
  switchTrainingPhase(t,next);t.ownerId=person.id;t.ownerEmail=person.email;t.trainerName=person.name;syncTrainee(t,db);
  if(p.decision==='restart'){
   const active=activeTraining(t,db);
   const documents=Object.fromEntries(Object.entries(t.communications||{}).filter(([,d])=>d.documentShare&&canonicalPhase(d.phase)===next));
   const attempt={id:id(),phase:next,at:now(),by:u.email,reason:record.improve,flow:structuredClone(t.trainingFlow?.[next]||{}),checklist:structuredClone(active.checklist),scores:structuredClone(active.scores),assessments:previousAssessments,mentor:structuredClone(t.mentor||null),communications:structuredClone(documents),materialShares:structuredClone(t.materialShares||[])};
   (t.trainingRestarts??=[]).push(attempt);
   t.trainingFlow??={};t.trainingFlow[next]={steps:{Start:{complete:true,at:now(),by:u.email}},evaluations:{},restartId:attempt.id};t.flowEnabled=true;
   for(const row of active.checklist){row.covered=false;row.coveredAt=null;row.assessor='';row.at=null;}
   for(const row of [...active.scores,...active.assessments]){row.score=null;row.rating='';row.answer='';row.assessor='';row.at=null;}
   if(t.mentor&&canonicalPhase(t.mentor.phase)===next){(t.mentorHistory??=[]).push(t.mentor);t.mentor=null;}
   t.journeySteps={Start:{complete:true,at:now(),by:u.email}};t.phaseSaves={};t.certificate=null;
   const refs=new Set(Object.values(attempt.flow.steps||{}).map(s=>s.ref).filter(Boolean));
   for(const token of db.ackTokens||[])if(token.traineeId===t.id&&refs.has(token.ref)&&!token.usedAt)token.expiresAt=0;
   // New attempt requires fresh document sharing and trainee acknowledgement.
   const materialIds=new Set(currentMaterials(t,db).map(m=>m.id));
   t.materialShares=(t.materialShares||[]).filter(s=>!materialIds.has(s.materialId));
   for(const key of Object.keys(documents))delete t.communications[key];
  }
  const hr=[...(db.users||[]).filter(x=>x.active&&x.role==='admin').map(x=>x.email),...String(db.lifecycleSettings?.hrHeadEmail||'').split(/[,;]\s*/)];
  const to=[...new Set([person.email,...(p.decision==='restart'?hr:[])].filter(Boolean))].join(', ');
  (db.lifecycleNotifications??=[]).push({id:id(),key:'final-decision:'+record.id,kind:p.decision==='restart'?'training-restart':'training-handover',traineeId:t.id,to,cc:'',title:(p.decision==='restart'?'Restart training required — ':'Final onboarding responsibility — ')+t.name,body:`Trainee: ${t.name}\nDesignation: ${t.designation}\nAssigned trainer: ${person.name}\nPhase: ${next}\n\nFeedback: ${record.comments}\nTraining gaps: ${record.improve}\n\nOpen the assigned training:\n${traineeWorkUrl(origin,t,h)}`,portalUrl:traineeWorkUrl(origin,t,h),status:'Pending',at:now(),readBy:[]});
 }
 t.version++;
 (db.audit??=[]).push({id:id(),at:now(),actor:u.email,traineeId:t.id,action:p.decision==='restart'?'Training restarted':'Final feedback saved',detail:record.completion+' · '+record.decision+' · '+(record.nextPhase||record.phase)});
 return {ok:true,stage:t.stage,decision:p.decision};
}

