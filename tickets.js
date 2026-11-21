import {isSystemAdmin} from './system-admin.js';
import {id,now} from './store.js';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const required=(v,label,max=4000)=>{const s=String(v??'').trim();if(!s||s.length>max)fail(`${label} is required (maximum ${max} characters)`);return s;};
export function ticketAction(db,u,action,p){
 if(u.role!=='admin')fail('Management access required',403);
 db.tickets??=[];
 const at=now();
 if(action==='createTicket'){
  const assignee=db.users.find(x=>x.id===p.assigneeId&&x.active&&x.role==='admin'&&x.id!==u.id);
  if(!assignee)fail('Choose another active management member');
  const t={id:id(),title:required(p.title,'Title',160),description:required(p.description,'Problem details'),creatorId:u.id,creatorName:u.name,assigneeId:assignee.id,assigneeName:assignee.name,status:'Open',version:1,createdAt:at,updatedAt:at,history:[{at,by:u.name,userId:u.id,action:'Raised',note:String(p.description).trim()}]};
  db.tickets.push(t);return t;
 }
 const t=db.tickets.find(x=>x.id===p.ticketId);if(!t)fail('Ticket not found',404);
 if(![t.creatorId,t.assigneeId].includes(u.id)&&!(isSystemAdmin(u)&&action==='commentTicket'))fail('Only ticket participants can update this ticket',403);
 if(p.version!==t.version)fail('Ticket changed. Refresh and try again.',409);
 let note=required(p.note,'Update');
 if(action==='startTicket'||action==='resolveTicket'){
  if(u.id!==t.assigneeId)fail('Only the assigned manager can perform this action',403);
  if(!['Open','In progress'].includes(t.status))fail('Ticket is not awaiting action',409);
  t.status=action==='startTicket'?'In progress':'Awaiting confirmation';
 }else if(action==='confirmTicket'||action==='reopenTicket'){
  if(u.id!==t.creatorId)fail('Only the person who raised this ticket can confirm or reopen it',403);
  if(t.status!=='Awaiting confirmation')fail('Ticket must await confirmation first',409);
  t.status=action==='confirmTicket'?'Closed':'Open';
 }else if(action==='commentTicket'){
  if(t.status==='Closed')fail('Ticket is closed',409);
 }else fail('Unknown ticket action');
 t.history.push({at,by:u.name,userId:u.id,action:t.status,note});t.updatedAt=at;t.version++;return t;
}
