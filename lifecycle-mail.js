import {finalEmailDelivered} from './onboarding-completion.js';
import {managementRecipients} from './management-mail.js';
import {trainingEmail,acknowledgementEmail} from './training-email.js';
import {createHash} from 'node:crypto';
import {id,now} from './store.js';
import {letterPdf} from './letter-pdf.js';
import {finalMissing} from './lifecycle.js';
export async function deliverLifecycleMail({store,mailer,traineeId}){
 const db=store.data,settings=db.lifecycleSettings||{},t=db.trainees.find(t=>t.id===traineeId);if(!t)return;
 const l=t.lifecycle||{},p=t.flowEnabled?null:l.plan;
 db.lifecycleNotifications??=[];
 for(const n of db.lifecycleNotifications)if(n.traineeId===t.id&&n.kind==='welcome'&&n.status==='Pending')n.status='Use Start: Send Email / WhatsApp';
 const queue=(key,kind,to,cc,title,body)=>{if(!db.lifecycleNotifications.some(n=>n.key===key))store.transaction(db=>db.lifecycleNotifications.push({id:id(),traineeId:t.id,key,kind,to,cc,title,body,at:now(),status:'Pending',readBy:[]}));};
 const recipients=[settings.hrHeadEmail,settings.managementEmails,settings.departmentEmails].filter(Boolean).join(', ');
 const handover=t.handovers?.filter(h=>h.stage===t.stage&&h.at).at(-1),current=p?.phases.find(ph=>ph.phase===t.stage);
 if(p?.approved&&handover&&current){const mentor=db.users.find(u=>u.id===current.mentorId);queue('phase-start:'+handover.id,'mentor',mentor?.email,'','New training phase & mentor guidance — '+t.name,`Phase: ${current.phase}\nPlanned: ${current.start} to ${current.end}\nPrevious trainer: ${handover.previousTrainerName||handover.previousTrainerEmail||handover.by}\nCurrent trainer: ${t.trainerName}\nMentor responsibilities:\n${current.responsibilities}\n\nHandover summary:\n${handover.note}\n\nEvaluation history:\n${l.evaluations.map(e=>e.phase+' · attempt '+e.attempt+' · '+(e.score??'Pending')+'/10 · '+(e.feedback||'')).join('\n')}\n\nEarlier guidance / activity:\n${l.events.map(e=>e.at+' '+e.action+' '+(e.detail||'')).join('\n')}`);}
 if(p?.approved&&['trainer','trainee','mentor','hr','management'].every(role=>l.feedback.some(f=>f.role===role&&f.planRevision===p.revision))){
 queue('report:'+t.id+':'+p.revision,'report',settings.hrHeadEmail,'','Consolidated training evaluation — '+t.name,l.feedback.filter(f=>f.planRevision===p.revision).map(f=>f.role+' — '+f.by+'\n'+f.comments).join('\n\n')+'\n\nEvaluation history:\n'+l.evaluations.map(e=>e.phase+' attempt '+e.attempt+': '+(e.score??'Pending')+'/10').join('\n'));
 }
 if(l.plan&&l.finalSignoff&&!finalMissing(t,db).length){
 const p=l.plan;
 queue('final-lifecycle:'+t.id+':'+p.revision,'final',t.email,[recipients,l.finalMentor?.email].filter(Boolean).join(', '),'Training completed & onboarding confirmed — '+t.name,`Employee: ${t.name}\nDesignation: ${t.designation}\nClinic / department: ${t.branch} / ${t.department}\n\nAll mandatory training, evaluations, acknowledgements and trainer certifications have been completed.\n\nQualifying scores:\n${l.finalCertificate.scores.map(e=>e.phase+': '+e.score+'/10').join('\n')}\n\nHR sign-off: ${l.finalSignoff.by} at ${l.finalSignoff.at}\nManagement review: ${l.managementReview.by}\nEmployee declaration and KRA/KPI acknowledged.\nAsset allotment will be completed after this onboarding confirmation.\n\nFirst three months mentor: ${l.finalMentor.name} (${l.finalMentor.email})\nPeriod: ${l.finalMentor.start} to ${l.finalMentor.end}\nResponsibilities: ${l.finalMentor.responsibilities}\n\nHR contact: ${p.hrContact}`);
 }
 // Bounded event-driven dispatch; pending items remain visible and can be retried.
 const pending=db.lifecycleNotifications.filter(n=>n.traineeId===t.id&&['Pending','Failed'].includes(n.status)&&n.kind!=='welcome').sort((a,b)=>Number(!!b.retryAt)-Number(!!a.retryAt)||Number(db.ackTokens?.some(t=>b.key==='ack:'+t.hash&&t.kind==='flow-evaluation'))-Number(db.ackTokens?.some(t=>a.key==='ack:'+t.hash&&t.kind==='flow-evaluation'))||Number(b.key?.startsWith('ack:'))-Number(a.key?.startsWith('ack:'))||Number(String(b.kind).startsWith('handover-feedback'))-Number(String(a.kind).startsWith('handover-feedback')));
 for(const n of pending){
 if(!['Pending','Failed'].includes(n.status))continue;
 if(n.kind==='handover-feedback-admin'){n.to=[...new Set(db.users.filter(u=>u.active&&u.role==='admin').map(u=>u.email))].join(', ');n.cc='';}
 if(n.kind==='welcome')n.cc=recipients;if(n.kind==='final'){n.to=t.email;n.cc=recipients;}if(!n.to&&n.kind!=='handover-feedback-admin'&&!n.key.startsWith('ack:'))n.to=settings.hrHeadEmail||'';
 if(!n.to||!mailer.configured||(['welcome','final'].includes(n.kind)&&(!settings.hrHeadEmail||!settings.managementEmails||!settings.departmentEmails))){store.transaction(()=>{n.error=!mailer.configured?'SMTP not configured':'Configure required HR Head, management and department recipients';});continue;}
 const delivery=(['handover-feedback-admin','training-restart','training-handover'].includes(n.kind)||n.key?.startsWith('ack:'))?{to:n.to,cc:''}:managementRecipients(settings,n.kind,n.to,n.cc);if(!delivery.to&&!delivery.cc){store.transaction(()=>{n.status='In-app only';n.error='Top management email is limited to joining, handover and certification.';});continue;}
 let attachments=[];if(['welcome','final'].includes(n.kind)){const bytes=await letterPdf({subject:n.kind==='welcome'?'Welcome & designation training plan':'Final training completion certificate',body:n.body,name:t.name,designation:t.designation,clinic:t.branch,department:t.department});attachments=[{filename:n.kind==='welcome'?'Welcome-and-training-plan.pdf':'Training-completion-certificate.pdf',content:bytes,contentType:'application/pdf'}];}
 // Format pending requests from older releases too, using only the request's own token.
 let content={body:n.body,html:n.portalUrl?trainingEmail({title:n.title,body:n.body,url:n.portalUrl,action:n.kind==='correction'?'Review correction request':'Open assigned training'}):undefined};
 const acknowledgement=db.ackTokens?.find(a=>a.traineeId===t.id&&n.key==='ack:'+a.hash);
 if(acknowledgement){
  const url=String(n.body).match(/^https?:\/\/[^\s<>]+\/ack\.html#[a-f0-9]{64}$/gm)?.find(value=>createHash('sha256').update(value.split('#').at(-1)).digest('hex')===acknowledgement.hash);
  if(url)content=acknowledgementEmail({title:n.title,details:acknowledgement.details||'',name:t.name,url});
 }
 store.transaction(()=>{n.status='Sending';n.attemptAt=now();n.error='';});
 try{const result=await mailer.send({id:n.id,to:delivery.to,cc:delivery.cc,subject:n.title,...content,attachments});if(result?.queued){store.transaction(()=>{n.status='Queued';n.queuedAt=now();});continue;}store.transaction(()=>{n.status='Sent';n.sentAt=now();n.messageId=result?.messageId;if(n.kind==='welcome')l.welcomeSentAt=n.sentAt;if(n.kind==='final')finalEmailDelivered(db,t,n.sentAt);t.version++;});}
 catch(e){store.transaction(()=>{n.status=e.deliveryState==='not-sent'?'Pending':'Delivery uncertain';n.error=String(e.message).slice(0,500);});}
 }
}
