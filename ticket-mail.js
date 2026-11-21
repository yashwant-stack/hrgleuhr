import {trainingEmail} from './training-email.js';
import {now} from './store.js';
export async function deliverTicketMail({store,mailer,ticketId,origin='https://hrgleuhr.vercel.app'}){
 const t=store.data.tickets?.find(t=>t.id===ticketId);if(!t)return;
 if(['Sent','Queued','Sending','Delivery uncertain'].includes(t.emailStatus))return;
 const assignee=store.data.users.find(u=>u.id===t.assigneeId&&u.active&&u.role==='admin');
 if(!assignee?.email||!mailer.configured){store.transaction(()=>{t.emailStatus='Failed';t.emailError=!mailer.configured?'SMTP is not configured':'Assigned manager email is unavailable';});return;}
 const subject='New management ticket — '+t.title;
 const body=`Dear ${assignee.name},\n\n${t.creatorName} has raised a ticket and assigned it to you.\n\nTitle: ${t.title}\n\nReason and details:\n${t.description}\n\nRaised by: ${t.creatorName}\nRaised on: ${t.createdAt}\nTicket ID: ${t.id}\n\nOpen Tickets in the portal to take action. Once resolved, the person who raised this ticket must confirm before it closes.\n\nHR Team, Gleuhr`;
 store.transaction(()=>{t.emailStatus='Sending';t.emailError='';});
 try{const result=await mailer.send({id:'ticket-'+t.id,to:assignee.email,subject,body,html:trainingEmail({title:subject,body,url:origin,action:'Open management tickets'})});if(result?.queued){store.transaction(db=>{t.emailStatus='Queued';const existing=db.outbox.find(n=>n.id==='ticket-'+t.id),record={id:'ticket-'+t.id,ticketId:t.id,kind:'ticket',status:'Queued',to:assignee.email,subject,body,at:now()};if(existing)Object.assign(existing,record);else db.outbox.push(record);});return;}store.transaction(()=>{t.emailStatus='Sent';t.emailSentAt=now();t.emailMessageId=result?.messageId;});}
 catch(e){store.transaction(()=>{t.emailStatus=e.deliveryState==='not-sent'?'Failed':'Delivery uncertain';t.emailError=String(e.message).slice(0,500);});}
}

// Run under the same database lock as ticket updates; queue delivery outside it.
export async function escalateOverdueTickets({store,mailer,clock=Date.now(),origin='https://hrgleuhr.vercel.app'}) {
 const {SYSTEM_ADMIN_EMAIL,isSystemAdmin}=await import('./system-admin.js');
 const recipient=store.data.users.find(isSystemAdmin);
 if(!recipient||!mailer.configured)return {queued:0};
 let queued=0;
 for(const t of store.data.tickets||[]) {
  if(t.status==='Closed'||!Number.isFinite(Date.parse(t.createdAt))||clock-Date.parse(t.createdAt)<7200000)continue;
  const id='ticket-escalation-'+t.id;
  const prior=store.data.outbox?.find(n=>n.id===id);
  if(prior && !['Failed'].includes(prior.status))continue;
  if(prior?.attemptAt && clock-Date.parse(prior.attemptAt)<900000)continue;
  const subject='Ticket overdue · 2 hours — '+t.title;
  const body=`Dear ${recipient.name},\n\nThis ticket has been open for at least two hours and needs your attention.\n\nTitle: ${t.title}\nRaised by: ${t.creatorName}\nAssigned to: ${t.assigneeName}\nStatus: ${t.status}\nRaised on: ${t.createdAt}\n\nDetails:\n${t.description}\n\nRecent updates:\n${(t.history||[]).slice(-10).map(h=>`${h.at} · ${h.by}: ${h.note}`).join('\n')}\n\nThe requester must confirm resolution before the ticket closes.\n\nHR Team, Gleuhr`;
  const record={id,ticketId:t.id,kind:'ticket-escalation',status:'Sending',to:SYSTEM_ADMIN_EMAIL,subject,body,at:new Date(clock).toISOString(),attemptAt:new Date(clock).toISOString()};
  store.transaction(db=>{db.outbox??=[];if(prior)Object.assign(prior,record);else db.outbox.push(record);});
  const n=store.data.outbox.find(n=>n.id===id);
  try {
   const result=await mailer.send({id,to:SYSTEM_ADMIN_EMAIL,subject,body,html:trainingEmail({title:subject,body,url:origin,action:'Review support tickets'})});
   store.transaction(()=>{n.status=result?.queued?'Queued':'Sent';if(!result?.queued)n.sentAt=new Date(clock).toISOString();t.escalationStatus=n.status;t.escalatedTo=SYSTEM_ADMIN_EMAIL;});
   queued++;
  }catch(e){store.transaction(()=>{n.status=e.deliveryState==='not-sent'?'Failed':'Delivery uncertain';n.error=String(e.message).slice(0,500);t.escalationStatus=n.status;});}
 }
 return {queued};
}
