let activityFilter={from:'',to:'',traineeId:'',page:0};
const activityDate=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
function activityRows(t){
 const rows=S.audit.filter(a=>(!t||a.traineeId===t.id)&&(!activityFilter.traineeId||a.traineeId===activityFilter.traineeId)&&(!activityFilter.from||activityDate(a.at)>=activityFilter.from)&&(!activityFilter.to||activityDate(a.at)<=activityFilter.to)).slice().sort((a,b)=>b.at.localeCompare(a.at));
 const pages=Math.max(1,Math.ceil(rows.length/50));activityFilter.page=Math.min(activityFilter.page,pages-1);
 const today=activityDate(new Date()), visible=rows.slice(activityFilter.page*50,activityFilter.page*50+50);
 let lastDay='';
 const timeline=visible.map(a=>{
  const day=activityDate(a.at), name=S.trainees.find(x=>x.id===a.traineeId)?.name||'Workspace';
  const dateLabel=day===today?'Today':new Date(a.at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',year:'numeric'});
  const divider=day!==lastDay?`<div class="activity-day"><span>${esc(dateLabel)}</span><i></i></div>`:'';lastDay=day;
  const icon=/mail|email|share|sent/i.test(a.action)?'outbox':/score|assess|evaluat/i.test(a.action)?'reports':/complete|approv|acknowledg/i.test(a.action)?'check':'audit';
  return `${divider}<article class="activity-event"><div class="activity-event-icon activity-tone-${icon}">${uiIcon(icon)}</div><div class="activity-event-body"><div class="activity-event-top"><h3>${esc(a.action)}</h3><time datetime="${esc(a.at)}">${new Date(a.at).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})}</time></div><div class="activity-event-meta"><span class="activity-person">${esc(name)}</span><span>By ${esc(a.actor||'System')}</span></div>${a.detail?`<div class="activity-event-detail">${esc(a.detail)}</div>`:''}</div></article>`;
 }).join('');
 return `<div class="activity-metrics"><div><span class="activity-metric-icon">${uiIcon('audit')}</span><div><strong>${rows.length}</strong><small>Matching activities</small></div></div><div><span class="activity-metric-icon">${uiIcon('check')}</span><div><strong>${rows.filter(a=>activityDate(a.at)===today).length}</strong><small>Today · within filters</small></div></div><div><span class="activity-metric-icon">${uiIcon('trainees')}</span><div><strong>${new Set(rows.filter(a=>a.traineeId).map(a=>a.traineeId)).size}</strong><small>Trainees in these records</small></div></div></div><section class="activity-timeline"><div class="activity-timeline-heading"><div><span class="report-eyebrow">Recorded history</span><h2>Every update, in context</h2></div><span class="activity-timezone">India time · Newest first</span></div>${timeline||`<div class="activity-empty">${uiIcon('audit')}<h3>No activities found</h3><p>Try another trainee or a wider date range.</p></div>`}<div class="activity-pagination"><span>Page ${activityFilter.page+1} of ${pages}</span><div>${button('← Previous','activityPage',`data-page="${Math.max(0,activityFilter.page-1)}" ${activityFilter.page===0?'disabled':''}`)}${button('Next →','activityPage',`data-page="${activityFilter.page+1}" ${activityFilter.page+1>=pages?'disabled':''}`)}</div></div></section>`;
}
function activityView(t=null){
 return `<div class="activity-studio">${t?'':heading('Activity log','A clear history of training, feedback and team updates.')}<div class="filters activity-filters">${!t?`<label>Trainee<select id="activityTrainee">${options(S.trainees.map(t=>[t.id,t.name]),activityFilter.traineeId,'All trainees')}</select></label>`:''}<label>From date<input type="date" id="activityFrom" value="${esc(activityFilter.from)}"></label><label>To date<input type="date" id="activityTo" value="${esc(activityFilter.to)}"></label><div class="activity-filter-actions">${button('Apply filters','activityFilter','','primary')}${button('Clear','activityClear')}</div></div><div id="activityResults">${activityRows(t)}</div></div>`;
}
function trainingInsights(ts=S.trainees){
 const scored=ts.filter(t=>t.summary.overallScore!==null),pending=ts.reduce((n,t)=>n+items(t).filter(r=>!r.covered).length,0);
 return `<section class="card insights-card"><div class="row"><div><h2>Training insights</h2><p class="muted">Live metrics from saved training records.</p></div>${button('View all reports','nav','data-view="reports"')}</div><div class="insight-grid"><div><strong>${ts.length?Math.round(ts.reduce((n,t)=>n+percent(t),0)/ts.length):0}%</strong><span>Average progress</span></div><div><strong>${scored.length?average(scored.map(t=>t.summary.overallScore)):'—'}</strong><span>Average score / 10 · ${scored.length} assessed</span></div><div><strong>${pending}</strong><span>Pending checklist topics</span></div><div><strong>${ts.filter(t=>t.communications?.welcome?.status==='Draft'||t.communications?.final?.status==='Draft'||Object.values(t.communications||{}).some(d=>d?.status==='Approval expired')).length}</strong><span>Trainees with drafts needing approval</span></div></div></section>`;
}
function profileReport(t){
 return `<div class="row"><h2>Training progress report</h2>${button('Print / Save PDF','printProfile','','primary')}</div>${workflowSummary(t)}<h2>All recorded scores</h2>${t.scores.map(r=>item(r.criterion,r.category,`${r.score===null?'Not scored':r.score+' / 10'}\n${r.remarks||''}\nAssessor: ${r.assessor||'—'}`)).join('')||empty('No scores yet.')}<h2>Assessment ratings</h2>${t.assessments.map(r=>item(r.question,r.department,`${r.rating||'Not assessed'} · ${r.score??'—'}/10\n${r.answer?'Previous answer: '+r.answer:''}\nAssessor: ${r.assessor||'—'}`)).join('')||empty('No assessments yet.')}<h2>Evaluations</h2>${recordList(t,'evaluation')}<h2>Academy tests</h2>${recordList(t,'test')}<h2>Coaching</h2>${recordList(t,'coaching')}<h2>Training activity</h2>${activityView(t)}`;
}
function welcomeAttachmentDefaults(t) {
 let total=0;
 return (t.welcomeDocuments||[]).filter(file=>{if(total+file.bytes>2*1024*1024)return false;total+=file.bytes;return true;}).slice(0,4);
}
function welcomeAttachmentChoices(t,d) {
 return [...d.attachments,...(t.welcomeDocuments||[]).filter(file=>!d.attachments.some(current=>current.id===file.id))];
}
function communicationDefaults(t,kind){
 if(kind.startsWith('handover:')){const h=t.handovers.find(h=>'handover:'+h.id===kind);return {to:h.email,cc:S.lifecycleSettings?.managementEmails||'',phone:'',subject:`Training handover — ${t.name} — ${h.stage}`,body:`Dear ${h.ownerName||'Team'},\n\nPlease review the training handover for ${t.name}.\n\nDesignation: ${t.designation}\nClinic: ${t.branch}\nHandover phase: ${h.stage}\nHandover status: ${h.status}\nTraining progress: ${percent(t)}%\nCurrent score: ${scoreAvg(t)} / 10\n\n${h.note||'Please continue the assigned training and update the trainee record.'}\n\nRegards,\nHR Team, Gleuhr`,attachments:[]};}

 return kind==='welcome'?{to:t.email||'',cc:S.lifecycleSettings?.managementEmails||'',phone:t.phone||'',subject:`Welcome to Gleuhr, ${t.name}`,body:`Dear ${t.name},

A warm welcome to Gleuhr! We are delighted to have you join us as ${t.designation}. You are becoming part of a team that values thoughtful care, teamwork and continuous learning.

Your journey begins
Joining date: ${t.joiningDate||'To be confirmed'}
Clinic: ${t.branch||'To be confirmed'}
Department: ${t.department||'To be confirmed'}
Your trainer: ${t.trainerName||owner(t)}

During your training, your trainer will help you understand your role, learn our processes and build confidence through guided practice. Your designation-specific training plan sets out the topics and practical activities ahead.

Please review the attached training plan and any role documents included with this email. Discuss your schedule and initial priorities with your trainer, ask questions freely, and keep your learning and practical work up to date.

If you need support or clarification, please reach out to your trainer or the HR team. We are here to help you settle in and make a confident start.

We look forward to the care, ideas and energy you will bring to Gleuhr. Welcome to the team!

Warm regards,
Human Resources Team
Gleuhr`,attachments:welcomeAttachmentDefaults(t)}: {to:t.email||'',cc:S.lifecycleSettings?.hrHeadEmail||'',phone:'',subject:`Training completed & onboarding confirmation — ${t.name}`,body:`Dear ${t.name},\n\nFollowing satisfactory training feedback and final HR approval, we confirm successful completion of training for ${t.name}.\n\nEmployee: ${t.name}\nDesignation: ${t.designation}\nClinic / department: ${t.branch||'—'}\nJoining date: ${t.joiningDate||'—'}\nTrainer: ${t.trainerName||owner(t)}\nTraining progress: ${percent(t)}%\nOverall score: ${t.summary.overallScore===null?'Not scored':t.summary.overallScore.toFixed(1)+' / 10'}\nFinal rating: ${t.summary.feedback?.rating||'Pending'}\nRecommendation: ${t.summary.feedback?.recommendation||'Pending'}\n\nPlease coordinate with HR for asset allotment, the final onboarding step.\n\nRegards,\nHR Team\nGleuhr`,attachments:[]};
}
function welcomeStageLocked(t){return t.flowEnabled?!!t.trainingFlowStatus?.find(step=>step.key==='Start')?.complete:!!t.journey?.Start?.complete;}
function communicationView(t,kind){
 const d=t.communications?.[kind],final=kind==='final',handover=kind.startsWith('handover:'),title=handover?'Handover email':final?'Final onboarding email':'Welcome letter';
 const canApprove=!handover&&isAdmin()&&d&&!d.sentAt&&!d.approved&&(!final||!t.finalReadiness),canSend=d&&(handover||d.approved)&&!d.sentAt&&!['Queued','Sending','Delivery uncertain'].includes(d.status)&&(!final||!t.finalReadiness);
 return `<div class="card communication-card"><div class="row"><div><h2>${title}</h2><p class="muted">${handover?'Review the recipient and send directly. No HR approval required.':final?'Send the trainee their onboarding confirmation after HR approval. Asset Allotment follows successful email delivery.':'Review your welcome letter, KRA/KPI and training plan. Choose Email or WhatsApp.'}</p></div><span class="badge">${esc(d?.status||'Not created')}</span></div>${final&&t.finalReadiness?`<p class="notice">${esc(t.finalReadiness)}</p>`:''}${handover?'':'<p class="notice">Sharing and sending require HR/Management approval. No automatic emails.</p>'}${d?`<div class="letter-preview"><p><strong>To:</strong> ${esc(d.to||'Not specified')}<br><strong>CC:</strong> ${esc(d.cc||'None')}${kind==='welcome'?`<br><strong>WhatsApp:</strong> ${esc(d.phone||'Not specified')}`:''}</p><h3>${esc(d.subject)}</h3><pre>${esc(d.body)}</pre><h4>Documents (${d.attachments.length+(kind==='welcome'?1:0)})</h4>${kind==='welcome'?'<p><strong>Welcome-letter.pdf</strong> · Personalised letter included with every welcome email.</p>':''}${d.attachments.map(a=>`<p>${esc(a.filename)} · ${Math.ceil(a.bytes/1024)} KB ${isAdmin()||d.approved?button('Review document','communicationAttachment',`data-kind="${kind}" data-id="${a.id}"`):''}</p>`).join('')||(kind==='welcome'?'':'<p class="muted">No attachments.</p>')}</div>${d.approval?`<p class="muted">${d.sentAt||d.approved?'Approved':'Previous approval'} by ${esc(d.approval.by)} · ${dt(d.approval.at)}</p>`:''}`:(kind==='welcome'?`<div class="letter-preview"><h3>${esc(communicationDefaults(t,kind).subject)}</h3><pre>${esc(communicationDefaults(t,kind).body)}</pre><p>Welcome PDF is generated automatically. Review the designation documents and training plan below.</p>${(t.welcomeDocuments||[]).length?`<h4>Saved designation documents</h4>${t.welcomeDocuments.map(a=>`<p>${esc(a.filename)} · ${Math.ceil(a.bytes/1024)} KB</p>`).join('')}<p class="muted">Already available for this trainee. Choose which files to attach when reviewing the letter.</p>`:''}</div>`:empty('No letter has been generated. This step is optional.'))}<div class="actions">${kind==='welcome'&&d?button('Preview welcome letter','communicationPreview',`data-kind="${kind}"`):''}${kind==='welcome'&&d?.sentAt&&isAdmin()?button(welcomeStageLocked(t)?'Request revised letter':'Prepare revised letter','communicationRevise',`data-kind="${kind}"`):''}${!d?.sentAt?button(d?'Edit letter & documents':kind==='welcome'?'Review & Approve':'Generate draft','communicationEdit',`data-kind="${kind}"`):''}${canApprove?button('Review & approve','communicationReview',`data-kind="${kind}"`,'primary'):''}${!handover&&isAdmin()&&d?.approved&&!d.sentAt?button('Revoke approval','communicationRevoke',`data-kind="${kind}"`,'danger'):''}${button(handover?'Send handover email':final?'Send onboarding email':'Send Email','communicationSend',`data-kind="${kind}" ${kind==='welcome'?(d?.sentAt?'disabled':''):(!canSend||!d?.to?'disabled':'')}`,'primary')}${button('WhatsApp','communicationShare',`data-kind="${kind}" ${!d||(!handover&&!d.approved)?'disabled':''}`)}</div>${d?.sentAt?`<p>Sent ${new Date(d.sentAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})}.</p>`:''}${(S.outbox||[]).filter(m=>m.communicationId===d?.id&&m.status==='Delivery uncertain').map(m=>`<p class="error">Delivery is uncertain. Check the sent mailbox before another attempt.</p>${isAdmin()?button('Review delivery result','communicationResolve',`data-kind="${kind}" data-id="${m.id}"`):''}`).join('')}</div>`;
}
const fileData=async f=>({filename:f.name,base64:await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('Could not read attachment'));r.readAsDataURL(f);})});
function downloadData(file){const bytes=Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:file.contentType}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function handleHR(action,b){
 const t=current(),kind=b.dataset.kind;
 if(action==='activityFilter'||action==='activityClear'||action==='activityPage'){
  if(action==='activityClear')activityFilter={from:'',to:'',traineeId:'',page:0};
  else if(action==='activityPage')activityFilter.page=Number(b.dataset.page);
  else {activityFilter={from:$('activityFrom').value,to:$('activityTo').value,traineeId:t&&view==='trainees'?'':$('activityTrainee')?.value||'',page:0};if(activityFilter.from&&activityFilter.to&&activityFilter.from>activityFilter.to)throw Error('From date must be before To date');}
  render();return true;
 }
 if(action==='printProfile'){window.print();return true;}
 if(action==='communicationEdit'||action==='communicationAddDocument'){
  const d=t.communications?.[kind]||communicationDefaults(t,kind);
  const choices=kind==='welcome'?welcomeAttachmentChoices(t,d):d.attachments;
  const defaultBuiltins=!d.attachments.length;
  modal(kind.startsWith('handover:')?'Handover email draft':kind==='welcome'?'Welcome letter draft':'Final onboarding email draft',field('to',kind.startsWith('handover:')?'Next owner email':kind==='final'?'Management / employee emails (comma separated)':'Trainee email',d.to,'text',[],kind!=='welcome')+field('cc','CC emails (optional)',d.cc)+(kind==='welcome'?field('phone','WhatsApp number with country code (digits only)',d.phone):'')+field('subject','Subject',d.subject,'text',[],true)+field('body','Letter / email text',d.body,'textarea',[],true)+`${kind==='welcome'?`<h3>Designation-wise attachments</h3><label class="answer"><input type="checkbox" name="includeTrainingPlan" ${defaultBuiltins?'checked':''}>Attach training plan for ${esc(t.designation)}</label>${S.materials.filter(m=>t.letterMaterialIds?.includes(m.id)&&/KRA|KPI/i.test(m.title)).map(m=>`<label class="answer"><input type="checkbox" name="material-${m.id}" ${defaultBuiltins?'checked':''}>${esc(m.title)}</label>`).join('')}`:''}${kind==='welcome'?`<p class="notice">Training documents added here are saved for future welcome letters for ${esc(t.designation)}. Each letter keeps its own recipients, text and approval.</p>`:''}<p>Choose up to 4 PDF or Word files, 2 MB combined. Saved designation documents are listed below; uncheck files you do not need in this letter.</p>${choices.map(a=>`<div><label class="answer"><input type="checkbox" name="keep-${a.id}" ${d.attachments.some(file=>file.id===a.id)?'checked':''}>Keep ${esc(a.filename)}</label><button type="button" data-hr-document="${a.id}" data-kind="${esc(kind)}">Review document</button></div>`).join('')}<label for="letterAttachments">Add documents (optional)</label><input type="file" id="letterAttachments" accept=".pdf,.doc,.docx" multiple>`,async p=>{
   const added=Array.from($('letterAttachments').files),kept=choices.filter(a=>p['keep-'+a.id]==='on');if(added.length+kept.length>4||added.reduce((n,f)=>n+f.size,0)+kept.reduce((n,f)=>n+f.bytes,0)>2*1024*1024)throw Error('Use up to four files, total 2 MB');
   await mutate('communicationSave',payload({...p,kind,includeTrainingPlan:p.includeTrainingPlan==='on',materialIds:S.materials.filter(m=>p['material-'+m.id]==='on').map(m=>m.id),attachments:[...kept.map(a=>({id:a.id})),...await Promise.all(added.map(fileData))]}));
   if(kind==='welcome'&&isAdmin())setTimeout(()=>handleHR('communicationReview',{dataset:{kind}}),0);
  },kind==='welcome'&&isAdmin()?'Save & Review':'Save draft');
  if(action==='communicationAddDocument'){$('letterAttachments').scrollIntoView({block:'center'});$('letterAttachments').focus();}
  return true;
 }
 if(action==='communicationReview'){
  const d=t.communications[kind];
  modal('HR review & approval',`<p><strong>Subject:</strong> ${esc(d.subject)}<br><strong>To:</strong> ${esc(d.to||'WhatsApp only')}<br><strong>CC:</strong> ${esc(d.cc||'None')}<br><strong>WhatsApp:</strong> ${esc(d.phone||'None')}</p><pre class="review-letter">${esc(d.body)}</pre><h3>Attachments</h3>${kind==='welcome'?'<p><strong>Welcome-letter.pdf</strong> is included automatically.</p>':''}<div class="actions">${kind==='welcome'?'<button type="button" data-hr-preview="welcome">Preview welcome letter</button>':''}<button type="button" data-hr-edit="edit" data-kind="${esc(kind)}">Edit letter & documents</button><button type="button" data-hr-edit="add" data-kind="${esc(kind)}">+ Add document</button></div>${d.attachments.map(a=>`<p>${esc(a.filename)} <button type="button" data-hr-document="${a.id}" data-kind="${kind}">Review document</button></p>`).join('')||'<p>None</p>'}${kind==='final'?`<p class="notice">Current final feedback: ${esc(t.summary.feedback?.rating)} · ${esc(t.summary.feedback?.recommendation)}. Overall score ${t.summary.overallScore??'—'}/10 · Progress ${percent(t)}%.</p>`:''}<label class="answer"><input type="checkbox" name="reviewed" required>I have reviewed the content, recipients and attachments${kind==='final'?' and approve final employee onboarding':''}.</label>`,p=>mutate('communicationApprove',payload({kind,reviewed:p.reviewed==='on',revision:d.revision})),'Approve');return true;
 }
 if(action==='communicationPreview'){
  const preview=await api(action,payload({kind}));
  modal('Welcome letter preview',preview.html+'<button type="button" id="downloadWelcomeLetter">Download welcome PDF</button>',async()=>{},'Close');
  $('downloadWelcomeLetter').onclick=()=>downloadData(preview.file);return true;
 }
 if(action==='communicationRevise'){
  if(welcomeStageLocked(t)){await handle('journeyUnlock',{dataset:{step:t.flowEnabled?'Flow:Start':'Start'}});return true;}
  const d=t.communications[kind],suggested=communicationDefaults(t,kind);
  modal('Prepare a revised welcome letter','<p>Create a new draft with the suggested welcome text and the existing recipients and documents. The previous sent letter stays in email history. Review and approve the new draft before sending.</p>',async()=>{
   await mutate(action,payload({kind,communicationId:d.id,confirm:true,subject:suggested.subject,body:suggested.body}));
   setTimeout(()=>handleHR('communicationEdit',{dataset:{kind}}).catch(error=>toast(error.message)),0);
  },'Create new draft');return true;
 }
 if(action==='communicationRevoke'){await mutate(action,payload({kind}));return true;}
 if(action==='communicationAttachment'){downloadData(await api(action,payload({kind,attachmentId:b.dataset.id})));return true;}
 if(action==='communicationResend'){
  const d=t.communications?.[kind];
  modal(kind.startsWith('certificate:')?'Send certificate email again':'Send mentor email again',`<p>The email server already accepted the previous email to <strong>${esc(d.to)}</strong>. Check Spam/Junk first.</p><p>Send another copy? Existing training records stay saved.</p>`,async()=>{const result=await mutate(action,payload({kind,communicationId:d.id,confirm:true}));toast(result?.queued?'Email queued. Track its status in Email delivery.':'Email accepted by server. Check the recipient inbox or Spam/Junk.');},'Send another copy');return true;
 }
 if(action==='communicationSend'){
  const d=t.communications?.[kind];
  if(kind.startsWith('certificate:')&&d?.sentAt)return handleHR('communicationResend',b);
  if(['Queued','Sending'].includes(d?.status)){toast('Email is queued or sending. Check Email delivery for progress.');return true;}
  if(kind==='welcome'){
   if(d?.sentAt){toast('Welcome email already sent.');return true;}
   if(d?.status==='Delivery uncertain')throw Error('Check Email delivery before retrying: the previous send could not be confirmed.');
   if(!d?.to){await handleHR('communicationEdit',b);$('f-to').focus();$('modalError').textContent='Add the trainee email, then Save & Review before sending.';return true;}
   if(!d.approved){if(!isAdmin())throw Error('Ask HR/Management to approve this letter before sending.');await handleHR('communicationReview',b);$('modalError').textContent='Review and approve this letter before sending by email.';return true;}
  }modal(kind.startsWith('handover:')?'Send handover email':kind.startsWith('certificate:')?'Send certificate email':'Send approved email',`<p><strong>${esc(d.subject)}</strong></p><p>To: ${esc(d.to)}<br>CC: ${esc(d.cc||'None')}</p><p>${d.attachments.length+(kind==='welcome'?1:0)} attachments${kind==='welcome'?' including Welcome-letter.pdf':''}.${d.approval?' Approved by '+esc(d.approval.by):''}</p>`,async()=>{if(kind.startsWith('handover:'))await sendHandoverEmail(t.id,kind.slice(9));else {const result=await mutate(action,payload({kind}));toast(result?.queued?'Email queued. You can continue working; track progress in Email delivery.':result?.alreadySent?'This email was already sent.':'Email accepted by server. Check Inbox or Spam/Junk.');}},'Send email');return true;
 }
 if(action==='communicationResolve'){
  modal('Check sent mailbox first',field('result','Verified delivery result','','select',[['sent','Email was sent'],['not-sent','Email was not sent']],true)+field('note','How was the delivery checked?','','textarea',[],true),p=>mutate(action,payload({...p,kind,messageId:b.dataset.id})),'Save review');return true;
 }
 if(action==='communicationShare'){
  if(kind!=='welcome'&&!kind.startsWith('certificate:')&&!b.dataset.phone){modal('Share on WhatsApp',field('phone','Recipient WhatsApp number with country code','','tel',[],true),p=>{setTimeout(()=>handleHR(action,{dataset:{kind,phone:p.phone}}).catch(e=>toast(e.message)),0);},'Continue');return true;}
  const d=await api(action,payload({kind,phone:b.dataset.phone})),recipient=d.recipientName||t.name,message=`Hi ${recipient}, I am sharing the training documents for ${t.name}.`,href='https://wa.me/'+d.phone+'?text='+encodeURIComponent(message);
  const files=[d.letter,...d.attachments].map(a=>new File([Uint8Array.from(atob(a.base64),c=>c.charCodeAt(0))],a.filename,{type:a.contentType}));
  modal('Choose documents to share',`<p>Select the documents you want to send to ${esc(recipient)}.</p><div id="approvedShareFiles">${files.map((f,i)=>`<label class="answer"><input type="checkbox" data-share-file="${i}" checked>${esc(f.name)}</label>`).join('')}</div><p id="shareSelectionCount" class="muted"></p><div class="actions"><button type="button" id="shareSelectedFiles" class="primary">Share selected · choose WhatsApp</button><button type="button" id="downloadSelectedFiles">Download selected</button><a class="whatsapp-link" href="${esc(href)}" target="_blank" rel="noopener">Open recipient WhatsApp</a></div><p class="muted">In the share menu, choose WhatsApp and the recipient. If file sharing is unavailable, download the selected documents and attach them in the recipient chat.</p>`,async()=>{},'Done');
  const selected=()=>Array.from($('approvedShareFiles').querySelectorAll('input:checked')).map(el=>files[Number(el.dataset.shareFile)]);
  const update=()=>{const n=selected().length;$('shareSelectionCount').textContent=n+' of '+files.length+' documents selected';$('shareSelectedFiles').disabled=!n;$('downloadSelectedFiles').disabled=!n;};
  $('approvedShareFiles').onchange=update;update();
  $('downloadSelectedFiles').onclick=()=>{for(const f of selected()){const url=URL.createObjectURL(f),a=document.createElement('a');a.href=url;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}};
  $('shareSelectedFiles').onclick=async()=>{const chosen=selected();if(!chosen.length)return;const btn=$('shareSelectedFiles');$('modalError').textContent='';
   if(!navigator.share||!navigator.canShare?.({files:chosen})){$('modalError').textContent='This browser cannot attach files through its share menu. Click Download selected, then Open recipient WhatsApp and attach the downloaded files.';return;}
   btn.disabled=true;try{await navigator.share({files:chosen,title:d.subject});$('shareSelectionCount').textContent='Selected documents handed to the share app. Check the WhatsApp chat to confirm sending.';}catch(error){if(error.name!=='AbortError')$('modalError').textContent='Could not share files. Download selected and attach them in WhatsApp.';}finally{btn.disabled=!selected().length;}
  };return true;
 }
 return false;
}
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hr-document]');if(!b)return;b.disabled=true;try{downloadData(await api('communicationAttachment',payload({kind:b.dataset.kind,attachmentId:b.dataset.hrDocument})));}catch(e){$('modalError').textContent=e.message;}finally{b.disabled=false;}});

// Review actions reopen the draft without approving or sending it.
document.addEventListener('click',async e=>{const b=e.target.closest('[data-hr-edit]');if(!b||b.disabled||modalSubmitting)return;b.disabled=true;try{await handleHR(b.dataset.hrEdit==='add'?'communicationAddDocument':'communicationEdit',b);}catch(error){$('modalError').textContent=error.message;}finally{b.disabled=false;}});

document.addEventListener('click',async e=>{const b=e.target.closest('[data-hr-preview]');if(!b||b.disabled||modalSubmitting)return;b.disabled=true;try{await handleHR('communicationPreview',{dataset:{kind:b.dataset.hrPreview}});}catch(error){$('modalError').textContent=error.message;}finally{b.disabled=false;}});
