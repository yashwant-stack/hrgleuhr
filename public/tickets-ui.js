let ticketFilter='active';
function ticketsView(){
 if(!isAdmin())return '<p class="notice">Management access required.</p>';
 const all=S.tickets||[],mine=all.filter(t=>S.user.systemAdmin||t.creatorId===S.user.id||t.assigneeId===S.user.id),rows=mine.filter(t=>ticketFilter==='closed'?t.status==='Closed':t.status!=='Closed');
 return heading('Management tickets','Raise it. Work together. Confirm the resolution.',button('+ Raise ticket','newTicket','','primary'))+`<div class="ticket-summary"><div><small>OPEN & IN PROGRESS</small><strong>${mine.filter(t=>['Open','In progress'].includes(t.status)).length}</strong></div><div><small>YOUR CONFIRMATION</small><strong>${mine.filter(t=>t.creatorId===S.user.id&&t.status==='Awaiting confirmation').length}</strong></div><div><small>RESOLVED TOGETHER</small><strong>${mine.filter(t=>t.status==='Closed').length}</strong></div></div><div class="actions">${button('Active','ticketFilter','data-filter="active"',ticketFilter==='active'?'primary':'')}${button('Closed','ticketFilter','data-filter="closed"',ticketFilter==='closed'?'primary':'')}${button('Refresh','refreshTickets')}</div><div class="ticket-list">${rows.map(t=>`<article class="ticket-card"><div><span class="ticket-status ${t.status==='Closed'?'closed':''}">${esc(t.status)}</span><h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><small>Raised by ${esc(t.creatorName)} → ${esc(t.assigneeName)} · ${dt(t.updatedAt)}</small></div>${t.emailStatus?`<p class="${t.emailStatus==='Sent'?'notice':'error'}">Email: ${esc(t.emailStatus)}${t.emailError?' · '+esc(t.emailError):''}</p>${t.emailStatus==='Failed'?button('Retry email','retryTicketEmail',`data-id="${esc(t.id)}"`):''}`:''}${button('View ticket →','viewTicket',`data-id="${esc(t.id)}"`)}</article>`).join('')||'<div class="card empty">No tickets here. Raise a ticket whenever you need another manager’s help.</div>'}</div>`;
}
async function ticketHandle(action,b){
 if(action==='ticketFilter'){ticketFilter=b.dataset.filter;render();return;}
 if(action==='refreshTickets'){await refresh();return;}
 if(action==='retryTicketEmail'){await mutate('retryTicketEmail',{ticketId:b.dataset.id});return;}
 if(action==='newTicket'){
 const people=S.users.filter(u=>u.role==='admin'&&u.active&&u.id!==S.user.id);
 if(!people.length){toast('Add another management user first.');return;}
 modal('Raise a management ticket',field('title','Title','','text',[],true)+field('assigneeId','Assign to','','select',people.map(u=>[u.id,u.name+' · '+u.email]),true)+field('description','Why are you sending this email? Please specify the details.','','textarea',[],true),p=>mutate('createTicket',p),'Raise ticket');return;
 }
 const t=S.tickets.find(t=>t.id===b.dataset.id);if(!t)return;
 const canWork=t.assigneeId===S.user.id&&['Open','In progress'].includes(t.status),canConfirm=t.creatorId===S.user.id&&t.status==='Awaiting confirmation';
 const choices=[['commentTicket','Add an update'],...(canWork?[['startTicket','Work in progress'],['resolveTicket','Resolved — request confirmation']]:[]),...(canConfirm?[['confirmTicket','Confirm solved & close'],['reopenTicket','Not solved — reopen']]:[])];
 const history=`<div class="ticket-timeline">${t.history.map(h=>`<div><strong>${esc(h.action)}</strong><small>${esc(h.by)} · ${new Date(h.at).toLocaleString('en-IN')}</small><p>${esc(h.note)}</p></div>`).join('')}</div>`;
 modal(t.title,`<p class="notice">${esc(t.status)} · ${esc(t.creatorName)} → ${esc(t.assigneeName)}<br>Only ${esc(t.creatorName)} can confirm the resolution and close this ticket.</p>${history}`+(t.status==='Closed'?'':field('action','Next action','','select',choices,true)+field('note','Update / resolution details','','textarea',[],true)),async p=>{if(t.status!=='Closed')await mutate(p.action,{ticketId:t.id,version:t.version,note:p.note});},t.status==='Closed'?'Close':'Save update');
}
