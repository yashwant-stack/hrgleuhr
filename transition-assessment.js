import {issueAcknowledgement} from './lifecycle.js';
import fields from './public/assessment-fields.json' with {type:'json'};
import {id,now} from './store.js';
import {canonicalPhase,phaseLabel} from './training-phases.js';
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
export function validateAssessment(kind,values){
 if(!fields[kind])fail('Unknown assessment');
 const result={};for(const [key,label,choices] of fields[kind]){const value=String(values?.[key]??'').trim();if(!value||value.length>4000||choices&&!choices.includes(value))fail('Please complete: '+label);result[key]=value;}return result;
}
export function assessmentText(kind,values){return fields[kind].map(([key,label])=>label+'\n'+(values?.[key]||'Not recorded')).join('\n\n');}
export function saveAssessment(db,u,t,p,origin){
 const kind=p.kind;if(!['trainer','hr','management'].includes(kind))fail('Invalid assessment');
 if(kind!=='trainer'&&u.role!=='admin')fail('HR/Management administrator access required',403);
 if(kind==='trainer'&&u.role!=='admin'&&u.id!==t.ownerId)fail('Only the assigned trainer can submit this review',403);
 if(p.version!==t.version)fail('Record changed. Refresh before saving.',409);
 const answers=validateAssessment(kind,p.answers),at=now();
 const record={id:id(),kind,phase:canonicalPhase(t.stage),answers,at,by:u.email,name:u.name};
 (t.transitionAssessments??=[]).push(record);t.version++;
 (db.audit??=[]).push({id:id(),at,actor:u.email,action:kind+' assessment submitted',traineeId:t.id,detail:assessmentText(kind,answers)});
 if(origin&&kind==='hr')requestAssessmentEmail(db,t,record,origin);
 return {ok:true,emailed:!!origin&&kind==='hr'};
}

function requestAssessmentEmail(db,t,record,origin){
 issueAcknowledgement(db,t,'hr-assessment',record.id,'HR head assessment — '+t.name,'Phase: '+phaseLabel(record.phase)+'\nReviewed by: '+(record.name||record.by)+'\n\n'+assessmentText(record.kind,record.answers),origin);
 const token=db.ackTokens?.find(a=>a.traineeId===t.id&&a.kind==='hr-assessment'&&a.ref===record.id&&!a.usedAt&&a.expiresAt>Date.now());
 const message=token&&db.lifecycleNotifications?.find(n=>n.key==='ack:'+token.hash);if(message)message.assessmentId=record.id;
 record.emailRequestedAt=now();
}
export function emailAssessment(db,u,t,p,origin){
 if(u.role!=='admin')fail('HR administrator access required',403);
 if(t.version!==p.version)fail('Record changed. Refresh before sending.',409);
 const record=t.transitionAssessments?.find(r=>r.id===p.assessmentId&&r.kind==='hr');if(!record)fail('HR assessment not found',404);
 requestAssessmentEmail(db,t,record,origin);t.version++;
 (db.audit??=[]).push({id:id(),at:now(),actor:u.email,action:'HR assessment email requested',traineeId:t.id,detail:record.id});
 return {ok:true};
}
