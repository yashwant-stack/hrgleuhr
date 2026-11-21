import {finalEmailDelivered} from './onboarding-completion.js';
import {randomUUID} from 'node:crypto';
import {closeTraining} from './training-workflow.js';
import {completeLearningDelivery} from './learning-delivery.js';
import {deliverLifecycleMail} from './lifecycle-mail.js';

const timestamp=()=>new Date().toISOString();
const recordFor=(db,id)=>db.outbox?.find(n=>n.id===id)||db.lifecycleNotifications?.find(n=>n.id===id);
// The message and its visible status commit together with the user action.
// Only the worker contacts SMTP, after releasing the database lock.
export function queuedMailer(store,mailer){
 return {...mailer,deferred:true,async send(message){
  const payload={...message,attachments:(message.attachments||[]).map(a=>({...a,content:Buffer.from(a.content).toString('base64'),encoding:'base64'}))};
  for(const job of store.data.emailJobs||[])if(!['Queued','Sending'].includes(job.status)&&job.payloadId&&store.deleteMaterial)await store.deleteMaterial(job.payloadId);
  const payloadId='upload-'+randomUUID();
  await store.putMaterial(payloadId,Buffer.from(JSON.stringify(payload)));
  store.transaction(db=>{
   db.emailJobs??=[];
   db.emailJobs=db.emailJobs.filter(j=>['Queued','Sending'].includes(j.status));
   if(!db.emailJobs.some(j=>j.id===message.id))db.emailJobs.push({id:message.id,status:'Queued',at:timestamp(),payloadId});
  });
  return {queued:true,messageId:null};
 }};
}
export function recoverMailJobs(db,clock=Date.now()){
 for(const job of db.emailJobs||[])if(job.status==='Sending'&&job.leaseUntil<=clock){
  const n=recordFor(db,job.id);
   if(n){n.status='Delivery uncertain';n.error='Sending was interrupted. Check the sent mailbox before retrying.';updateTicket(db,n);}
  job.status='Delivery uncertain';delete job.payload;
 }
}
export function mailJobActive(db,id){return (db.emailJobs||[]).some(j=>j.id===id&&(j.status==='Queued'||j.status==='Sending'&&j.leaseUntil>Date.now()));}

// withStore serializes the short claim and completion writes, never SMTP I/O.
export async function drainMailQueue({withStore,mailer,maxMessages=30,maxMs=240000}){
 const started=Date.now();let processed=0;
 while(processed<maxMessages&&Date.now()-started<maxMs){
  const claim=await withStore(async store=>{
   store.transaction(db=>recoverMailJobs(db));
   const job=(store.data.emailJobs||[]).find(j=>j.status==='Queued');
   if(!job)return null;
   const payload=JSON.parse((await store.getMaterial(job.payloadId)).toString());
   return store.transaction(db=>{
   if(job.status!=='Queued')return {skip:true};
   const n=recordFor(db,job.id);
   if(!n||n.status!=='Queued'){job.status='Cancelled';delete job.payload;return {skip:true};}
   job.status='Sending';job.claim=randomUUID();job.leaseUntil=Date.now()+300000;
   n.status='Sending';n.attemptAt=timestamp();updateTicket(db,n);
   return {id:job.id,claim:job.claim,payloadId:job.payloadId,payload};
  });});
  if(!claim)break;if(claim.skip)continue;
  let result,error;
  try{result=await mailer.send({...claim.payload,attachments:claim.payload.attachments.map(a=>({...a,content:Buffer.from(a.content,'base64')}))});}catch(e){error=e;}
  await withStore(async store=>{let learningTrainee;store.transaction(db=>{
   const job=db.emailJobs?.find(j=>j.id===claim.id),n=recordFor(db,claim.id);
   if(!job||job.claim!==claim.claim||job.status!=='Sending')return;
   job.status=error?(error.deliveryState==='not-sent'?'Failed':'Delivery uncertain'):'Sent';
   delete job.payload;delete job.leaseUntil;
   if(!n||n.status!=='Sending')return;
   n.status=job.status;
   if(error){n.error=String(error.message).slice(0,500);updateTicket(db,n);return;}
   n.sentAt=timestamp();n.messageId=result?.messageId;n.accepted=result?.accepted;n.error='';
   updateTicket(db,n);
   const t=db.trainees.find(t=>t.id===n.traineeId);
   if(!t)return;
   if(n.communicationId){
    const d=Object.values(t.communications||{}).find(d=>d.id===n.communicationId&&d.revision===n.revision);
    if(d){d.sentAt=n.sentAt;d.sentBy=n.sentBy;if(n.kind==='final'){finalEmailDelivered(db,t,n.sentAt);t.version++;}if(d.learningDelivery){completeLearningDelivery(db,t,d);learningTrainee=t.id;}}
   }else if(n.kind==='welcome'){t.lifecycle.welcomeSentAt=n.sentAt;}
   else if(n.kind==='final'){finalEmailDelivered(db,t,n.sentAt);t.version++;}
   // Receipt metadata does not edit training inputs or invalidate an open form.
   (db.audit??=[]).push({id:randomUUID(),at:n.sentAt,actor:n.sentBy||'Email service',action:'Email accepted by server',traineeId:t.id,detail:n.kind||n.title});
  });if(learningTrainee)await deliverLifecycleMail({store,mailer:queuedMailer(store,mailer),traineeId:learningTrainee});if(store.deleteMaterial){await store.deleteMaterial(claim.payloadId);store.transaction(db=>{const job=db.emailJobs.find(j=>j.id===claim.id&&j.claim===claim.claim);if(job)delete job.payloadId;});}});
  processed++;
 }
 return {processed};
}

function updateTicket(db,n){
 if(!n.ticketId)return;
 const ticket=db.tickets?.find(t=>t.id===n.ticketId);
 if(ticket&&n.kind==='ticket-escalation'){ticket.escalationStatus=n.status;ticket.escalationError=n.error||'';if(n.sentAt)ticket.escalatedAt=n.sentAt;return;}
 if(ticket){ticket.emailStatus=n.status;ticket.emailError=n.error||'';if(n.sentAt)ticket.emailSentAt=n.sentAt;if(n.messageId)ticket.emailMessageId=n.messageId;}
}
