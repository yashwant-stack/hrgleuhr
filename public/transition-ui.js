let transitionFields;
function finalFeedbackPanel(t){
 const f=t.finalFeedback||t.summary?.feedback||{};
 return `<section class="card final-feedback-card"><div class="flow-heading"><div><small>TRAINING REVIEW</small><h2>Final Feedback & Confirmation</h2><p>Review the learning journey, record feedback and choose who takes the next step.</p></div><span class="badge">${esc(t.name)}</span></div>
 <details class="notice"><summary>View training results and history</summary><pre class="prewrap">${esc(t.handoverSummary||'No training records yet.')}</pre></details>
 <form id="finalFeedbackForm"><div class="final-feedback-grid"><div>${field('rating','Overall rating',f.rating||'','select',Object.keys(S.ratings),true)}</div><div>${field('completion','Training completion',f.completion||'','select',['Complete','Incomplete'],true)}</div><div>${field('strengths','Strengths',f.strengths||'','textarea',[],true)}</div><div>${field('improve','Training gaps / support needed',f.improve||'','textarea',[],true)}</div></div>
 ${field('comments','Final feedback',f.comments||'','textarea',[],true)}
 <div class="final-feedback-next"><h3>What happens next?</h3>${field('decision','Next action','save','select',[['save','Save feedback & email trainee'],['continue','Confirm & continue to final onboarding email'],['restart','Restart incomplete training']],true)}
 <div id="feedbackOwner" hidden>${field('ownerId','Person responsible for the next step','','select',S.users.filter(u=>u.active).map(u=>[u.id,u.name+' · '+(u.role==='admin'?'HR / Admin':'Trainer')]))}</div>
 <div id="feedbackRestart" hidden>${field('restartPhase','Department to restart','','select',['Induction','CRM & Tech Training','Sales Training','Operations Training','Assessment'])}<p class="notice">Assigned trainer and HR receive the restart notification. Previous attempts stay in training history.</p></div></div>
 <p id="finalFeedbackError" class="error" role="alert"></p><button class="primary" type="submit" id="saveFinalFeedback">Save feedback</button><p class="muted">Use “None” where no additional support is needed.</p></form></section>
 ${(t.feedbackRows||[]).some(r=>r.at)?`<details class="card"><summary>Previous feedback (${t.feedbackRows.filter(r=>r.at).length})</summary>${t.feedbackRows.filter(r=>r.at).slice().reverse().map(r=>`<article class="item"><div><h3>${esc(r.completion||r.recommendation)}</h3><small>${esc(r.by)} · ${dt(r.at)}</small><p class="prewrap">${esc(r.comments)}</p></div></article>`).join('')}</details>`:''}`;
}
function bindFinalFeedback(){
 const form=$('finalFeedbackForm');if(!form)return;
 const update=()=>{const action=$('f-decision').value,transfer=action!=='save';$('feedbackOwner').hidden=!transfer;$('f-ownerId').required=transfer;$('feedbackRestart').hidden=action!=='restart';$('f-restartPhase').required=action==='restart';$('saveFinalFeedback').textContent=action==='restart'?'Restart training & notify trainer / HR':action==='continue'?'Confirm & continue':'Save feedback & email trainee';};
 $('f-decision').onchange=update;update();
 form.onsubmit=async e=>{
  e.preventDefault();if(!form.reportValidity())return;
  const p=Object.fromEntries(new FormData(form)),t=current(),button=$('saveFinalFeedback');
  button.disabled=true;button.textContent='Saving…';$('finalFeedbackError').textContent='';
  try{await mutate('finalFeedback',{...p,traineeId:t.id,version:t.version});selectedFlowStep=null;section='Training stages';render();toast(p.decision==='restart'?'Training restarted. Assigned trainer and HR have been notified in the portal; email delivery is being processed.':p.decision==='continue'?'Feedback confirmed. Review and send the final onboarding email.':'Feedback saved. Trainee acknowledgement email queued.');}
  catch(error){if($('finalFeedbackError'))$('finalFeedbackError').textContent=error.message;}
  finally{if(button.isConnected){button.disabled=false;update();}}
 };
}
async function transitionSchema(){return transitionFields??=await fetch('/assessment-fields.json').then(r=>{if(!r.ok)throw Error('Unable to load assessment questions');return r.json();});}
async function showTraineeFeedback(traineeId){
 await refresh();
 const t=S.trainees.find(t=>t.id===traineeId);if(!t)throw Error('This trainee is no longer available in your workspace.');
 const schema=await transitionSchema(),rows=[...(t.handoverFeedback||[])].reverse();
 modal('Trainee feedback — '+t.name,`<p>Submitted training feedback, saved in the trainee profile. HR/admins receive the feedback notification.</p>${rows.map(r=>`<article class="card"><h2>${esc(r.moduleTitle||r.phase||'Training')}</h2><p><strong>${r.rating}/5 stars</strong> · ${dt(r.at)}${r.trainer?' · Trainer: '+esc(r.trainer):''}</p>${r.answers?schema.trainee.map(([key,label])=>`<h3>${esc(label)}</h3><p class="prewrap">${esc(r.answers[key]||'—')}</p>`).join(''):'<p>This earlier response contains a star rating only.</p>'}</article>`).join('')||'<p>No trainee feedback has been submitted yet.</p>'}`,async()=>{},'Close');
}
function transitionPanel(t){
 const rows=t.transitionAssessments||[],feedback=t.handoverFeedback||[];
 return `<details class="card transition-review" ${document.querySelector('.transition-review')?.open||['hrconnect','mgmtconnect'].includes(view)?'open':''}><summary><strong>Feedback & connect history</strong><span class="muted"> · ${rows.length} reviews · ${feedback.length} trainee responses</span></summary><p>Optional feedback, saved in this trainee’s profile. It does not block training.</p><label class="answer"><input type="checkbox" data-action="completionFeedback" ${t.completionFeedbackEnabled!==false?'checked':''}> Email trainee a feedback request after each completed module or department</label><div class="actions">${button('Trainer review','transitionReview','data-kind="trainer"')}</div>${[...rows].reverse().map(r=>`<article class="item"><div><span class="badge">${esc(r.kind==='trainer'?'Department trainer':r.kind==='hr'?'HR head connect':'MGMT connect')}</span><h3>${esc(trainingPhaseLabel(r.phase,t))}</h3><p>${esc(r.name||r.by)} · ${dt(r.at)}</p>${button('View answers','transitionView',`data-id="${r.id}"`)}${r.kind==='hr'&&isAdmin()?assessmentEmailButton(t,r):''}</div></article>`).join('')}${feedback.map(r=>`<article class="item"><div><h3>Trainee feedback · ${esc(r.moduleTitle||r.phase||'Department')}</h3><p>${esc(t.name)} · ${r.rating}/5 stars · ${dt(r.at)}</p>${r.answers?button('View trainee answers','transitionView',`data-id="${r.id}" data-kind="trainee"`):''}</div></article>`).join('')}</details>`;
}
async function handleTransition(action,b){
 if(action==='viewTraineeFeedback'){await showTraineeFeedback(b.dataset.trainee||current().id);return true;}
 if(action==='completionFeedback'){await mutate('completionFeedback',payload({enabled:b.checked}));return true;}
 if(action==='completeAssetAllotment'){await mutate(action,payload({}));toast('Asset allotment complete. Onboarding finished.');return true;}
 if(action==='emailTransitionAssessment'){await mutate(action,payload({assessmentId:b.dataset.id}));toast('HR assessment email queued. Check Email delivery.');return true;}
 if(!['transitionReview','transitionView'].includes(action))return false;
 const t=current(),schema=await transitionSchema();
 if(action==='transitionView'){const r=(b.dataset.kind==='trainee'?t.handoverFeedback:t.transitionAssessments).find(r=>r.id===b.dataset.id),kind=b.dataset.kind==='trainee'?'trainee':r.kind;modal('Assessment record',`<p>${esc(t.name)} · ${esc(r.phase||'')} · ${dt(r.at)}</p>`+schema[kind].map(([key,label])=>`<h3>${esc(label)}</h3><p class="prewrap">${esc(r.answers[key])}</p>`).join(''),async()=>{},'Close');return true;}
 const kind=b.dataset.kind,prior=(t.transitionAssessments||[]).filter(r=>r.kind===kind&&r.phase===canonicalPhase(t.stage)).at(-1);
 modal(kind==='trainer'?'Department transition — trainer review':kind==='hr'?'HR head connect':'MGMT connect',`<p>${esc(t.name)} · ${esc(trainingPhaseLabel(t.stage,t))}</p><details class="notice"><summary>Review training history, scores & feedback</summary><pre class="prewrap" style="max-height:260px;overflow:auto">${esc(t.handoverSummary||'No records yet.')}</pre></details>`+schema[kind].map(([key,label,choices])=>field(key,label,prior?.answers[key]||'',choices?'select':'textarea',choices||[],true)).join('')+(kind==='hr'?'<p class="notice">This assessment will be emailed to '+esc(t.email||'the trainee')+' with a personal acknowledgement link.</p>':'')+'<p>All answers are required. Enter “None” if there are no gaps or additional support needs. Saving keeps the previous review in history.</p>',p=>mutate('saveTransitionAssessment',payload({kind,answers:p})),kind==='hr'?'Save assessment & email trainee':'Save assessment');return true;
}

function connectWorkspace(kind){
 if(!isAdmin())return empty('Administrator access required.');
 const t=current(),label=kind==='hr'?'HR head connect':'MGMT connect';
 return heading(label,'Optional feedback for any trainee. Separate from the training workflow.')+selectTrainee()+(t?`<div class="card"><h2>${esc(t.name)}</h2><p>${esc(t.designation)} · ${esc(trainingPurpose(t))} · ${esc(trainingPhaseLabel(t.stage,t))}</p>${button('Give feedback','transitionReview',`data-kind="${kind}"`,'primary')}</div>`+transitionPanel(t):empty('Select a trainee to give feedback.'));
}

function assessmentEmailButton(t,r){
 const n=(t.lifecycle.notifications||[]).filter(n=>n.assessmentId===r.id).at(-1),busy=n&&['Queued','Sending','Sent'].includes(n.status);
 return `<p class="muted">Trainee email: ${esc(n?.status||'Not requested')}</p>${button(busy?'Email '+n.status.toLowerCase():'Email assessment to trainee','emailTransitionAssessment',`data-id="${r.id}" ${busy?'disabled':''}`)}`;
}
function assetAllotmentPanel(t){
 const l=t.lifecycle||{},assets=l.assets||[],sent=!!(t.finalEmailSentAt||t.communications?.final?.sentAt||l.finalEmailSentAt),received=a=>(l.acknowledgements||[]).some(r=>r.kind==='asset'&&r.ref===a.id),ready=sent&&l.assetsReviewed&&assets.every(received);
 return `<section class="card"><small>FINAL ONBOARDING STEP</small><h2>Asset Allotment</h2><p>Record the assets provided to ${esc(t.name)}. The trainee receives an email to acknowledge each asset.</p><p class="notice">${sent?'Final onboarding email sent. Complete asset allotment below.':'Send the approved final onboarding email before allotting assets.'}</p>${assets.map(a=>`<article class="item"><div><h3>${esc(a.type)}</h3><p>${esc(a.details)} · ${dt(a.date)}</p><span class="badge">${received(a)?'Receipt acknowledged':'Waiting for trainee acknowledgement'}</span></div></article>`).join('')}${l.assetsReviewed&&!assets.length?'<p>No assets applicable: '+esc(l.assetsReviewed.reason)+'</p>':''}<div class="actions">${!l.assetsReviewed&&isAdmin()?button('Record assets / no assets','lifeAssets',sent?'':'disabled','primary'):''}${t.assetAllotmentCompletedAt?'<span class="badge">Onboarding completed</span>':button('Complete asset allotment','completeAssetAllotment',ready?'':'disabled','primary')}${button('Refresh receipt status','refresh')}</div></section>`;
}
