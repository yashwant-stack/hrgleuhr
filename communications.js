import {appUrl} from './app-url.js';
import {finalEmailDelivered} from './onboarding-completion.js';
import {canonicalPhase} from './training-phases.js';
import {traineeWorkUrl} from './final-feedback.js';
import {issuedCertificate} from './certificate-records.js';
import {trainingPurpose} from './training-purpose.js';
import {welcomeDocuments, rememberWelcomeDocuments} from './designation-documents.js';
import {managementCc,managementRecipients} from './management-mail.js';
import {handoverNote,SUMMARY_MARKER} from './handover-summary.js';
import {trainingEmail} from './training-email.js';
import {finalMissing} from './lifecycle.js';
import {letterPdf} from './letter-pdf.js';
import {welcomeEmail,welcomePdf} from './welcome-letter.js';
import {journeyStatus} from './journey.js';
import {createHash} from 'node:crypto';
import {id,now} from './store.js';
import {summary,closeTraining} from './training-workflow.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const clean=(v,max=200)=>String(v??'').trim().slice(0,max);
const requireAdmin=u=>{if(u.role!=='admin')fail('HR/Management approval required',403);};
const recipients=v=>{
 const list=String(v||'').split(/[;,\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);
 if(list.length>25||list.some(x=>!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x)))fail('Enter valid email addresses, separated by commas');
 return [...new Set(list)].join(', ');
};
export function finalReadiness(t,records=[]){
 if(t.lifecycle?.plan&&!t.flowEnabled)return 'Use Lifecycle final HR sign-off and automatic final onboarding email.';
 const f=summary(t).feedback;
 if(!['Start','Learn','Test'].every(step=>journeyStatus(t,records)[step].complete)&&!['Final Feedback','Onboard Final Email','Asset Allotment'].includes(canonicalPhase(t.stage)))return 'Complete Final Feedback & Confirmation before final approval.';
 if(!f||!['Good','Excellent'].includes(f.rating)||f.recommendation!=='Confirm')return 'Final feedback must be Good/Excellent with recommendation Confirm.';
 return '';
}
export function communicationService({store,mailer,trainee,audit,welcomeAttachments}){
 const locks=new Set();
 const letter=(t,d)=>({subject:d.subject,body:d.body,name:t.name,designation:t.designation,clinic:t.branch,department:t.department});
 const mentorKind=(t,kind)=>!!t.mentor?.id&&kind==='mentor:'+t.mentor.id;
 const documentKind=(t,kind)=>kind?.startsWith('document:')&&!!t.communications?.[kind]?.documentShare;
 const certificateKind=(t,kind)=>{const d=t.communications?.[kind],c=d?.certificateId&&issuedCertificate(t,d.certificateId);return !!c&&kind.startsWith('certificate:'+c.id+':');};
 const get=(t,kind)=>{if(!documentKind(t,kind)&&!certificateKind(t,kind)&&!mentorKind(t,kind)&&!['welcome','final'].includes(kind)&&!(typeof kind==='string'&&kind.startsWith('handover:')&&t.handovers.some(h=>'handover:'+h.id===kind&&h.stage!=='Onboard Final Email')))fail('Unknown communication type');return t.communications?.[kind];};
 const fingerprint=(t,d)=>createHash('sha256').update(JSON.stringify({
  revision:d.revision,to:d.to,cc:d.cc,phone:d.phone,subject:d.subject,body:d.body,attachments:d.attachments,
  profile:[t.name,t.email,t.phone,t.designation,t.branch,t.joiningDate,t.trainerName],
  training:(d.kind==='final'||d.kind.startsWith('handover:'))?[t.stage,t.checklist,t.scores,t.assessments,t.feedbackRows,t.completedModules,t.completedMaterials,t.handovers,store.data.records.filter(r=>r.traineeId===t.id)]:null
 })).digest('hex');
 const approved=(t,d)=>!!d?.approval && d.approval.fingerprint===fingerprint(t,d);
 function view(t){
  return Object.fromEntries(['welcome','final',...(t.mentor?.id?['mentor:'+t.mentor.id]:[]),...Object.keys(t.communications||{}).filter(k=>certificateKind(t,k)||documentKind(t,k)),...t.handovers.filter(h=>h.stage!=='Onboard Final Email').map(h=>'handover:'+h.id)].map(kind=>{
   const d=get(t,kind);if(!d)return [kind,null];
   const last=store.data.outbox.filter(x=>x.communicationId===d.id).at(-1);
   const valid=approved(t,d),inFlight=store.data.outbox.some(x=>x.communicationId===d.id&&['Queued','Sending','Delivery uncertain'].includes(x.status));
   return [kind,{...d,lastError:last?.status==='Failed'?last.error:null,approved:valid,status:d.sentAt?'Sent':inFlight?(last?.status||'Delivery uncertain'):last?.status==='Failed'?'Failed':valid?'Approved':d.approval?'Approval expired':'Draft'}];
  }));
 }
 const fresh=(u,p)=>{const t=trainee(u,p);if(p.version!==undefined&&t.version!==p.version)fail('Record changed. Refresh and try again.',409);return t;};
 function unlocked(t,d){if(locks.has(t.id)||store.data.outbox.some(x=>x.communicationId===d?.id&&['Queued','Sending','Delivery uncertain'].includes(x.status)))fail('Delivery is in progress or uncertain. Check delivery before continuing.',409);}
 function requireSendable(t,d){if(documentKind(t,d?.kind)){if(d.phase!==t.stage||d.materialId&&!t.approvedMaterials?.some(a=>a.id===d.materialId&&a.at===d.approvalAt))fail('Document approval or phase changed. Prepare sharing again',403);return;}if(certificateKind(t,d?.kind))return;if(d?.kind.startsWith('handover:')||mentorKind(t,d?.kind))return;requireApproved(t,d);}
 function requireApproved(t,d){if(!d)fail('Save a draft first');if(!approved(t,d))fail('HR/Management must approve this exact draft before sharing or sending',403);if(d.kind==='final'&&finalReadiness(t,store.data.records))fail(finalReadiness(t,store.data.records));}
 async function files(d){return Promise.all(d.attachments.map(async a=>({...a,base64:(await store.getMaterial(a.id)).toString('base64')})));}
 async function run(u,name,p){
  let t=fresh(u,p);const kind=p.kind;if(kind==='welcome'&&['Reskilling','Revaluation'].includes(trainingPurpose(t)))fail('Welcome letters are not required for reskilling or revaluation.',409);let d=get(t,kind);
  if(name==='communicationSave'){
   if(documentKind(t,kind))fail('Use document sharing to prepare this email');
   if(kind.startsWith('certificate:'))fail('Use certificate sharing to prepare this document');
   if(mentorKind(t,kind))fail('Use Assign mentor to update mentor details');
   const originalVersion=t.version;unlocked(t,d);if(d?.sentAt)fail('This email has already been sent. The sent record cannot be edited.',409);
   const subject=clean(p.subject,200);let body=clean(p.body,20000);if(kind.startsWith('handover:')){const h=t.handovers.find(h=>'handover:'+h.id===kind);if(h.status==='Draft')h.note=handoverNote(t,store.data,h.manualNote??h.note);body=body.split(SUMMARY_MARKER)[0].trim()+'\n\n'+h.note.split(SUMMARY_MARKER).slice(1).map(x=>SUMMARY_MARKER+x).join('');}if(!subject||!body)fail('Subject and letter text are required');
   const to=recipients(p.to),cc=managementCc(store.data.lifecycleSettings,kind,to,recipients(p.cc)),phone=clean(p.phone,25);
   if(phone&&!/^[1-9]\d{7,14}$/.test(phone))fail('Use WhatsApp number with country code, digits only');
   if(kind!=='welcome'&&!to)fail('Management recipient email is required');
   // Only files explicitly uploaded to this welcome draft become reusable.
   // Generated trainee-specific plans, letters and other communications do not.
   const reusableUploads=new Set(kind==='welcome'&&Array.isArray(p.attachments)?p.attachments.filter(f=>!f.id):[]),reusableIds=new Set();
   const shared=kind==='welcome'?welcomeDocuments(store.data,t.designation):[];
   if(kind==='welcome'&&welcomeAttachments&&(p.includeTrainingPlan||p.materialIds?.length))p={...p,attachments:[...(p.attachments||[]),...await welcomeAttachments(t,p)]};
   if(!Array.isArray(p.attachments)||p.attachments.length>4)fail('Up to four optional attachments are supported');
   let total=0;const attachments=[];
   for(const f of p.attachments){
    if(f.id){const old=d?.attachments.find(a=>a.id===f.id)||shared.find(a=>a.id===f.id);if(!old)fail('Invalid existing attachment');attachments.push(old);total+=old.bytes;continue;}
    const filename=clean(f.filename,150).replace(/[\\/\r\n]/g,'_'),ext=filename.split('.').pop().toLowerCase();
    if(!['pdf','doc','docx'].includes(ext)||typeof f.base64!=='string'||f.base64.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64))fail('Use PDF, DOC or DOCX attachments; total limit 2 MB');
    const bytes=Buffer.from(f.base64,'base64');total+=bytes.length;
    const valid=ext==='pdf'?bytes.subarray(0,5).toString()==='%PDF-':ext==='doc'?bytes.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1':bytes.subarray(0,2).toString()==='PK'&&bytes.includes(Buffer.from('word/document.xml'))&&bytes.includes(Buffer.from('[Content_Types].xml'));
    if(!valid||!bytes.length||total>2*1024*1024)fail('Invalid attachment or total exceeds 2 MB');
    const hash=createHash('sha256').update(bytes).digest('hex');
    const existing=reusableUploads.has(f)&&shared.find(a=>a.hash===hash&&a.filename===filename);
    const attachment=existing||{id:'upload-'+id(),filename,bytes:bytes.length,hash,contentType:ext==='pdf'?'application/pdf':ext==='doc'?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',_bytes:bytes};
    attachments.push(attachment);if(reusableUploads.has(f))reusableIds.add(attachment.id);
   }
   if(total>2*1024*1024)fail('Total attachments must be at most 2 MB');
   for(const a of attachments)if(a._bytes){await store.putMaterial(a.id,a._bytes);delete a._bytes;}
   t=trainee(u,p);if(t.version!==originalVersion)fail('Record changed. Refresh and try again.',409);d=get(t,kind);unlocked(t,d);
   return store.transaction(db=>{if(kind==='welcome')rememberWelcomeDocuments(db,t.designation,attachments.filter(a=>reusableIds.has(a.id)),u.email,now());t.communications??={};t.communications[kind]={id:d?.id||id(),kind,revision:(d?.revision||0)+1,to,cc,phone,subject,body,attachments,updatedAt:now(),updatedBy:u.email};t.version++;audit(db,u,'Communication draft saved',t.id,kind);return {ok:true};});
  }
  if(name==='communicationAttachment'&&!d&&kind==='welcome'){
   requireAdmin(u);
   const a=welcomeDocuments(store.data,t.designation).find(file=>file.id===p.attachmentId);
   if(!a)fail('Attachment not found',404);
   return {...a,base64:(await store.getMaterial(a.id)).toString('base64')};
  }
  if(!d)fail('Save a draft first');
  if(name==='communicationPreview'){
   if(kind!=='welcome')fail('Welcome letter preview only');
   if(u.role!=='admin')requireApproved(t,d);
   const content=letter(t,d),bytes=await welcomePdf(content);
   return {html:welcomeEmail(content),file:{filename:'Welcome-letter.pdf',contentType:'application/pdf',base64:bytes.toString('base64')}};
  }
  if(name==='communicationRevise'){
   requireAdmin(u);unlocked(t,d);
   if(kind!=='welcome'||!d.sentAt)fail('Only a sent welcome letter can be revised');
   if(p.confirm!==true||p.communicationId!==d.id)fail('Review the current sent letter before creating a new draft',409);
   const subject=clean(p.subject,200),body=clean(p.body,20000);
   if(!subject||!body)fail('Subject and letter text are required');
   return store.transaction(db=>{
    t.communicationHistory??=[];t.communicationHistory.push(structuredClone(d));
    t.communications[kind]={id:id(),kind,revision:1,to:d.to,cc:d.cc,phone:d.phone,subject,body,attachments:structuredClone(d.attachments),revises:d.id,updatedAt:now(),updatedBy:u.email};
    t.version++;audit(db,u,'Revised welcome draft prepared',t.id,'Previous sent letter preserved; fresh approval required');return {ok:true};
   });
  }
  if(name==='communicationApprove'){
   requireAdmin(u);unlocked(t,d);if(d.sentAt)fail('Already sent',409);if(kind==='final'&&finalReadiness(t,store.data.records))fail(finalReadiness(t,store.data.records));
   if(p.reviewed!==true||p.revision!==d.revision)fail('Review the current letter, recipients and attachments before approval',409);
   return store.transaction(db=>{d.approval={by:u.email,at:now(),fingerprint:fingerprint(t,d)};t.version++;audit(db,u,'Communication approved',t.id,kind+' revision '+d.revision);return {ok:true};});
  }
  if(name==='communicationRevoke'){
   requireAdmin(u);unlocked(t,d);return store.transaction(db=>{d.approval=null;t.version++;audit(db,u,'Communication approval revoked',t.id,kind);return {ok:true};});
  }
  if(name==='communicationAttachment'){
   // HR can review draft documents. Trainers can retrieve them for sharing only after approval.
   if(u.role!=='admin')requireSendable(t,d);
   const a=d.attachments.find(x=>x.id===p.attachmentId)||(kind==='welcome'&&u.role==='admin'?welcomeDocuments(store.data,t.designation).find(x=>x.id===p.attachmentId):null);if(!a)fail('Attachment not found',404);
   return {...a,base64:(await store.getMaterial(a.id)).toString('base64')};
  }
  if(name==='communicationShare'){
   if(kind!=='welcome'&&!certificateKind(t,kind)){requireSendable(t,d);const phone=String(p.phone||d.phone||'').replace(/[^0-9]/g,'');if(!/^[1-9]\d{7,14}$/.test(phone))fail('Enter the recipient WhatsApp number with country code');const bytes=await letterPdf({subject:d.subject,body:d.body,name:t.name,designation:t.designation});return {subject:d.subject,phone,recipientName:d.recipientName||'Team',letter:{filename:'Training-update.pdf',contentType:'application/pdf',base64:bytes.toString('base64')},attachments:await files(d)};}if(certificateKind(t,kind)){const attachments=await files(d);return {subject:d.subject,phone:d.phone,recipientName:d.recipientName,letter:attachments[0],attachments:[]};}requireApproved(t,d);
   if(!d.phone)fail('Save a WhatsApp number and obtain approval first');
   const expected=fingerprint(t,d),attachments=await files(d);t=trainee(u,p);d=get(t,kind);requireApproved(t,d);if(expected!==fingerprint(t,d))fail("Draft changed. Refresh before sharing.",409);
   store.transaction(db=>audit(db,u,'Approved welcome letter prepared for sharing',t.id,'WhatsApp / device sharing; delivery not confirmed'));
   const bytes=await welcomePdf(letter(t,d));
   return {subject:d.subject,body:d.body,phone:d.phone,letter:{filename:'Welcome-letter.pdf',contentType:'application/pdf',base64:bytes.toString('base64')},attachments};
  }
  if(name==='communicationResend'){
   if((!mentorKind(t,kind)&&!certificateKind(t,kind))||!d?.sentAt)fail('Only an already sent mentor or certificate email can be resent here');
   if(p.confirm!==true||p.communicationId!==d.id)fail('Review the current email before resending',409);
   unlocked(t,d);
   store.transaction(db=>{t.communications[kind]={...d,id:id(),revision:d.revision+1,sentAt:null,sentBy:null,updatedAt:now(),updatedBy:u.email};t.version++;audit(db,u,certificateKind(t,kind)?'Certificate email resend requested':'Mentor email resend requested',t.id,kind);});
   return run(u,'communicationSend',{traineeId:t.id,kind});
  }
  if(name==='communicationSend'){
   if(d.sentAt)return {ok:true,alreadySent:true};requireSendable(t,d);unlocked(t,d);if(!d.to)fail('Save recipient email and obtain approval again');
   if(!mailer.configured)fail('Email sending is not configured. Contact HR administrator.');
   const delivery=managementRecipients(store.data.lifecycleSettings,kind,d.to,d.cc);if(!delivery.to&&!delivery.cc)fail('Top management emails are limited to new joining, handover and certification. This update remains in the portal.',409);
   locks.add(t.id);let msg;
   try{
    const attachments=(await files(d)).map(a=>({filename:a.filename,content:Buffer.from(a.base64,'base64'),contentType:a.contentType}));
    if(kind==='welcome')attachments.unshift({filename:'Welcome-letter.pdf',content:await welcomePdf(letter(t,d)),contentType:'application/pdf'});
    t=trainee(u,p);d=get(t,kind);requireSendable(t,d);
    if(kind.startsWith('handover:')){const h=t.handovers.find(h=>'handover:'+h.id===kind);store.transaction(()=>{if(h.status==='Draft')h.note=handoverNote(t,store.data,h.manualNote??h.note);if(h.note.includes(SUMMARY_MARKER))d.body=d.body.split(SUMMARY_MARKER)[0].trim()+'\n\n'+SUMMARY_MARKER+h.note.split(SUMMARY_MARKER).slice(1).join(SUMMARY_MARKER);});}
    store.transaction(db=>{msg={id:id(),traineeId:t.id,communicationId:d.id,revision:d.revision,kind,at:now(),status:'Sending',to:delivery.to,cc:delivery.cc,subject:d.subject,body:kind.startsWith('handover:')?'Open assigned training: '+traineeWorkUrl(appUrl(),t,t.handovers.find(h=>'handover:'+h.id===kind))+'\n\n'+d.body:d.body,approvedBy:d.approval?.by||null,approvedAt:d.approval?.at||null,sentBy:u.email,attachments:attachments.map(({filename,content})=>({filename,bytes:content.length}))};db.outbox.push(msg);audit(db,u,'Approved email sending',t.id,kind);});
    try{const result=await mailer.send({...msg,html:kind.startsWith('handover:')?trainingEmail({title:d.subject,body:d.body,url:traineeWorkUrl(appUrl(),t,t.handovers.find(h=>'handover:'+h.id===kind)),action:'Continue assigned training'}):kind==='welcome'?welcomeEmail(letter(t,d)):mentorKind(t,kind)?trainingEmail({title:d.subject,body:d.body,url:d.portalUrl||appUrl()+'/?view=mentoring',action:'Open my practical tasks'}):undefined,attachments});if(result?.queued){store.transaction(()=>{msg.status='Queued';msg.queuedAt=now();});return {ok:true,queued:true};}store.transaction(db=>{msg=db.outbox.find(x=>x.id===msg.id);t=db.trainees.find(x=>x.id===t.id);d=get(t,kind);msg.status='Sent';msg.sentAt=now();msg.messageId=result.messageId;msg.accepted=result.accepted;msg.attempts=result.attempts||1;d.sentAt=msg.sentAt;d.sentBy=u.email;if(kind==='final'){finalEmailDelivered(db,t,msg.sentAt);}t.version++;audit(db,u,kind==='final'?'Final onboarding email sent':kind.startsWith('handover:')?'Handover email sent':mentorKind(t,kind)?'Mentor email sent':certificateKind(t,kind)?'Certificate email sent':'Welcome email sent',t.id,d.to);});}
    catch(e){store.transaction(db=>{msg=db.outbox.find(x=>x.id===msg.id);msg.status=e.deliveryState==='not-sent'?'Failed':'Delivery uncertain';msg.error=clean(e.message,1000);msg.errorCode=e.code||null;audit(db,u,e.deliveryState==='not-sent'?'Email not sent':'Email delivery requires review',t.id,kind);});fail(e.deliveryState==='not-sent'?'Email was not sent. '+clean(e.message,300)+' Retry using Send email.':'Delivery could not be confirmed. HR must check sent mail before retrying.',502);}
    return {ok:true};
   }finally{locks.delete(t.id);}
  }
  if(name==='communicationResolve'){
   requireAdmin(u);if(locks.has(t.id))fail('Delivery is still running',409);
   const msg=store.data.outbox.find(x=>x.id===p.messageId&&x.communicationId===d.id&&x.status==='Delivery uncertain');
   if(!msg||!['sent','not-sent'].includes(p.result)||!clean(p.note))fail('Select a delivery result and record how it was checked');
   return store.transaction(db=>{msg.status=p.result==='sent'?'Sent':'Failed';msg.reviewNote=clean(p.note,1000);msg.reviewedBy=u.email;if(p.result==='sent'){msg.sentAt=now();d.sentAt=msg.sentAt;if(kind==='final'){finalEmailDelivered(db,t,msg.sentAt);}}else d.approval=null;t.version++;audit(db,u,'Email delivery reviewed',t.id,kind+': '+p.result);return {ok:true};});
  }
  fail('Unknown communication action',404);
 }
 return {locked:()=>locks.size>0,view,run,readiness:t=>finalReadiness(t,store.data.records),handles:new Set(['communicationPreview','communicationRevise','communicationSave','communicationApprove','communicationRevoke','communicationAttachment','communicationShare','communicationSend','communicationResend','communicationResolve'])};
}
