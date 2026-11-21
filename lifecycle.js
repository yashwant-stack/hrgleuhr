import {validateAssessment,assessmentText} from './transition-assessment.js';
import {acknowledgementEmail} from './training-email.js';
import {materialForPhase} from './training-materials.js';
import {randomBytes,createHash} from 'node:crypto';
import {id,now} from './store.js';
import {canonicalPhase,samePhase,phaseLabel,administrativePhase} from './training-phases.js';
export const declaration='I hereby confirm that I have successfully completed my assigned training modules and evaluations. I have understood my role, responsibilities, KRAs, KPIs, company policies and operational expectations. I acknowledge that I am aware of my responsibilities and am ready to perform my assigned duties.';
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
const req=(v,label,max=12000)=>{const s=String(v??'').trim();if(!s||s.length>max)fail(label+' is required');return s;};
const emails=v=>{const a=String(v||'').split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean);if(a.length>25||a.some(x=>!/^\S+@[^\s@]+\.[^\s@]+$/.test(x)))fail('Enter valid recipient emails');return [...new Set(a)].join(', ');};
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('Choose a valid date');return v;};
const hash=x=>createHash('sha256').update(x).digest('hex');
const user=(db,uid)=>{const u=db.users.find(x=>x.id===uid&&x.active&&['admin','trainer'].includes(x.role));if(!u)fail('Select an active trainer or mentor');return u;};
const admin=u=>{if(u.role!=='admin')fail('HR/Management access required',403);};
export function lifecycle(t){const l=t.lifecycle??={plan:null};for(const key of ['planHistory','changes','evaluations','certifications','acknowledgements','feedback','assets','escalations','events'])l[key]??=[];return l;}
export function phasePlan(t,phase=t.stage){return t.lifecycle?.plan?.phases.find(p=>samePhase(p.phase,phase));}
const event=(t,u,action,detail)=>{lifecycle(t).events.push({id:id(),at:now(),by:u.email||u.name,action,detail});};
const notify=(db,t,to,title,body,key)=>{db.lifecycleNotifications??=[];if(db.lifecycleNotifications.some(n=>n.key===key))return;db.lifecycleNotifications.push({id:id(),traineeId:t.id,to,title,body,key,at:now(),status:'Pending',readBy:[]});};
export function acknowledged(t,kind,ref){return !!t.lifecycle?.acknowledgements.some(a=>a.kind===kind&&a.ref===ref);}
export function phaseMissing(t,phase=t.stage){
 const l=t.lifecycle,p=phasePlan(t,phase);if(!l?.plan?.approved||!p)return ['Approved training plan'];
 const misses=[];for(const h of t.handovers||[])if(samePhase(h.stage,phase)&&h.status!=='Draft'&&!h.acknowledgement)misses.push('Receiving trainer handover acknowledgement');for(const mid of p.moduleIds){if(!acknowledged(t,'module',l.plan.revision+':'+mid))misses.push('Module receipt acknowledgement');if(!t.completedMaterials?.some(m=>m.id===mid))misses.push('Trainer module completion');}
 const checks=(t.checklist||[]).filter(r=>!r.removed&&!r.optional&&(!r.phase||samePhase(r.phase,phase)));if(checks.some(r=>!r.covered))misses.push('Mandatory checklist');
 const es=l.evaluations.filter(e=>samePhase(e.phase,phase)&&e.planRevision===l.plan.revision),e=es.at(-1);
 if(!e||e.score==null||e.score<p.passScore)misses.push('Qualifying evaluation / retest');
 if(es.some(e=>!acknowledged(t,'evaluation',e.id)))misses.push('Evaluation assignment acknowledgement');
 if(es.some(e=>e.score!=null&&!acknowledged(t,'outcome',e.id)))misses.push('Evaluation outcome acknowledgement');
 return [...new Set(misses)];
}
export function finalMissing(t,db){
 const l=t.lifecycle,p=l?.plan;if(!p?.approved)return ['Approved training plan'];const m=[];
 for(const ph of p.phases.filter(ph=>!administrativePhase(ph.phase))){if(phaseMissing(t,ph.phase).length)m.push(phaseLabel(ph.phase)+' requirements');if(!l.certifications.some(c=>samePhase(c.phase,ph.phase)&&c.planRevision===p.revision))m.push(phaseLabel(ph.phase)+' trainer certification');}
 for(const role of ['trainer','trainee','mentor','hr','management'])if(!l.feedback.some(f=>f.role===role&&f.planRevision===p.revision))m.push(role+' feedback');
 if(l.plan.phases.some(ph=>!l.feedback.some(f=>f.role==='trainer'&&f.planRevision===p.revision&&f.by)))m.push('Trainer feedback');if(!l.finalMentor)m.push('Three-month mentor');if(!l.hrMeeting)m.push('HR Head meeting');if(!l.managementReview)m.push('Management review');if(!acknowledged(t,'declaration',String(p.revision)))m.push('Trainee declaration');
 if(l.escalations.some(e=>e.status!=='Resolved'))m.push('Unresolved HR escalation');
 if(!db.lifecycleSettings?.hrHeadEmail)m.push('HR Head settings');return [...new Set(m)];
}
export function lifecycleView(t,db){
 const l=t.lifecycle||{},p=l.plan,today=day();const phases=(p?.phases||[]).map(ph=>{const done=l.certifications?.find(c=>samePhase(c.phase,ph.phase)&&c.planRevision===p.revision);const transfer=(t.handovers||[]).find(h=>samePhase(h.stage,ph.phase)&&h.at);return {...ph,actualStart:transfer?.at||(p.phases[0]===ph?t.createdAt:null),trainer:userName(db,ph.trainerId),mentor:userName(db,ph.mentorId),completedAt:done?.at,overdue:!done&&ph.end<today,pendingModules:ph.moduleIds.filter(mid=>!t.completedMaterials?.some(c=>c.id===mid)).length};});
 const start=phases[0]?.start,end=phases.at(-1)?.end,total=start?Math.round((Date.parse(end)-Date.parse(start))/864e5)+1:0,elapsed=start?Math.max(0,Math.min(total,Math.floor((Date.parse(today)-Date.parse(start))/864e5)+1)):0;
 const completedDays=phases.filter(ph=>ph.completedAt).reduce((n,ph)=>n+Math.round((Date.parse(ph.end)-Date.parse(ph.start))/864e5)+1,0);
 return {...l,acknowledgements:(l.acknowledgements||[]).map(a=>({...a,title:db.ackTokens?.find(token=>token.traineeId===t.id&&token.kind===a.kind&&token.ref===a.ref)?.title||'',phase:db.ackTokens?.find(token=>token.traineeId===t.id&&token.kind===a.kind&&token.ref===a.ref)?.details?.match(/^Phase: (.+)$/m)?.[1]||''})),phases,completedDays,totalDays:total,elapsedDays:elapsed,remainingDays:Math.max(0,total-elapsed),expectedCompletion:end,actualCompletion:l.completedAt,phaseMissing:phaseMissing(t),finalMissing:finalMissing(t,db),declaration,notifications:(db.lifecycleNotifications||[]).filter(n=>n.traineeId===t.id).map(({body,...n})=>n)};
}
const userName=(db,uid)=>db.users.find(u=>u.id===uid)?.name||'Unassigned';
export function issueAcknowledgement(db,t,kind,ref,title,details,origin){
 const l=lifecycle(t);if(acknowledged(t,kind,ref))return;
 db.ackTokens??=[];const old=db.ackTokens.find(a=>a.traineeId===t.id&&a.kind===kind&&a.ref===ref&&!a.usedAt&&a.expiresAt>Date.now());if(old)return;
 if(!t.email)fail('Employee email is required for acknowledgement');
 const token=randomBytes(32).toString('hex');db.ackTokens.push({id:id(),hash:hash(token),traineeId:t.id,kind,ref,title,details,assessmentVersion:kind==='handover-feedback'?1:undefined,planRevision:l.plan?.revision,expiresAt:Date.now()+7*864e5});
 notify(db,t,t.email,title,acknowledgementEmail({title,details,name:t.name,url:`${origin}/ack.html#${token}`}).body, 'ack:'+hash(token));
 if(kind==='handover-feedback')db.lifecycleNotifications.find(n=>n.key==='ack:'+hash(token)).kind='handover-feedback-request';
 event(t,{name:'System'},'Acknowledgement requested',title);
}
export function acknowledgementAction(db,p){
 if(!/^[a-f0-9]{64}$/.test(p.token||''))fail('Invalid acknowledgement link',404);
 const a=db.ackTokens?.find(x=>x.hash===hash(p.token));if(!a||a.expiresAt<Date.now())fail('This link has expired. Ask your trainer for a new link.',410);
 const t=db.trainees.find(t=>t.id===a.traineeId);if(!t||(a.kind!=='handover-feedback'&&a.planRevision!==t.lifecycle?.plan?.revision))fail('This request has been replaced. Ask your trainer for the current link.',410);
 if(a.kind==='flow-evaluation'&&!Object.values(t.trainingFlow?.[canonicalPhase(t.stage)]?.steps||{}).some(s=>s.ref===a.ref&&s.complete))fail('This evaluation has changed. Ask your trainer for the current link.',410);
 if(p.submit){if(a.kind==='handover-feedback'&&!a.usedAt&&(!Number.isInteger(p.rating)||p.rating<1||p.rating>5))fail('Choose a rating from 1 to 5 stars');if(a.kind==='feedback')req(p.feedback,'Your feedback',5000);if(a.usedAt)return {done:true,name:t.name,title:a.title};if(p.confirm!==true)fail('Confirm that you have reviewed the information');
 const transitionAnswers=a.kind==='handover-feedback'&&a.assessmentVersion&&!a.usedAt?validateAssessment('trainee',p.answers):undefined;
 if(a.kind==='declaration'&&trainingMissing(t).length)fail('Complete training and feedback before declaration');
 const at=now();a.usedAt=at;lifecycle(t).acknowledgements.push({id:id(),kind:a.kind,ref:a.ref,at,by:t.email,name:req(p.name,'Your full name',200),statement:a.kind==='declaration'?declaration:'I confirm receipt and review of this information.',planRevision:a.planRevision});
 if(a.kind==='feedback')lifecycle(t).feedback.push({id:id(),role:'trainee',by:t.email,at,comments:req(p.feedback,'Your feedback',5000),planRevision:a.planRevision});
 if(a.kind==='handover-feedback'){const h=(t.handovers||[]).find(h=>h.id===a.ref)||{fromStage:a.feedbackPhase,previousTrainerName:a.feedbackTrainer};t.handoverFeedback??=[];t.handoverFeedback.push({id:id(),handoverId:a.ref,rating:p.rating,answers:transitionAnswers,at,by:t.email,phase:h?.fromStage,moduleTitle:a.moduleTitle,trainer:h?.previousTrainerName});notify(db,t,'','Training feedback received — '+t.name,`${t.name} rated their training ${p.rating}/5 stars.\nCompleted phase: ${h?.fromStage||'—'}\nTrainer: ${h?.previousTrainerName||'—'}\nNext phase: ${h?.stage||'—'}\nSubmitted: ${at}\n\n${transitionAnswers?assessmentText('trainee',transitionAnswers):''}`,'handover-feedback-result:'+a.id);db.lifecycleNotifications.find(n=>n.key==='handover-feedback-result:'+a.id).kind='handover-feedback-admin';t.version++;event(t,{email:t.email},'Handover feedback submitted',`${p.rating}/5 stars`);return {done:true,name:t.name,title:a.title,traineeId:t.id};}
 t.version++;event(t,{email:t.email},'Employee acknowledgement',a.title);notify(db,t,t.ownerEmail,'Employee acknowledged: '+a.title,t.name+' acknowledged '+a.title,'ack-done:'+a.id);return {done:true,name:t.name,title:a.title,traineeId:t.id};}
 return {name:t.name,title:a.title,details:a.details,kind:a.kind,assessmentVersion:a.assessmentVersion,done:!!a.usedAt};
}
function trainingMissing(t){const p=t.lifecycle?.plan;if(!p?.approved)return ['Approved plan'];return p.phases.filter(ph=>!administrativePhase(ph.phase)).flatMap(ph=>phaseMissing(t,ph.phase));}
export function lifecycleAction(db,u,t,name,p,origin,materials=[]){
 const l=lifecycle(t);if(l.finalSignoff&&!['lifecycleRequestChange','lifecycleApproveChange','lifecycleRequestAck','lifecycleAssets'].includes(name))fail('Final sign-off is locked. Request an authorised plan correction first.',409);if(p.version!==undefined&&p.version!==t.version)fail('Record changed. Refresh and try again.',409);
 if(name==='lifecyclePlan'){
 admin(u);if(l.plan?.approved)fail('Approved plan is locked. Request an authorised correction first.',409);
 if(p.confirm!==true)fail('Review and confirm the training plan');if(!t.email)fail('Employee email is required');
 if(!Array.isArray(p.phases)||!p.phases.length||p.phases.length>20)fail('Add the required training phases');
 const seen=new Set();let prior='';const phases=p.phases.map(ph=>{const phase=canonicalPhase(req(ph.phase,'Phase',100));if(!['Induction','Asset Allotment','CRM & Tech Training','Sales Training','Operations Training','Assessment','Final Feedback','Final Review & Confirmation'].includes(phase))fail('Choose a recognised training phase');if(seen.has(phase))fail('Each phase can appear only once');seen.add(phase);const start=date(ph.start),end=date(ph.end);if(end<start||prior&&start<=prior)fail('Phase dates must be sequential and cannot overlap');prior=end;user(db,ph.trainerId);user(db,ph.mentorId);const passScore=Number(ph.passScore);if(!Number.isFinite(passScore)||passScore<1||passScore>10)fail('Passing score must be 1–10');const moduleIds=[...new Set(ph.moduleIds||[])];if(moduleIds.some(mid=>!materials.some(m=>m.id===mid&&materialForPhase(m,{...t,stage:phase},db))))fail('Choose modules matching this designation and phase');return {phase,start,end,trainerId:ph.trainerId,mentorId:ph.mentorId,passScore,moduleIds,responsibilities:req(ph.responsibilities,'Mentor responsibilities',4000)};});
 if(l.plan)l.planHistory.push(structuredClone(l.plan));
 l.plan={id:id(),revision:(l.plan?.revision||0)+1,designation:t.designation,kra:req(p.kra,'Designation KRA'),kpi:req(p.kpi,'Designation KPI'),guidelines:req(p.guidelines,'Training guidelines'),hrContact:req(p.hrContact,'HR contact'),phases,approved:true,at:now(),by:u.email};
 if(!phases.some(ph=>samePhase(ph.phase,t.stage)))fail('Include the current training phase in the plan');
 db.designationPlans??={};db.designationPlans[t.designation]=structuredClone(l.plan);
 l.welcomeSentAt=null;const first=phases.find(ph=>samePhase(ph.phase,t.stage));t.ownerId=first.trainerId;t.ownerEmail=user(db,first.trainerId).email;t.trainerName=userName(db,first.trainerId);l.finalSignoff=null;l.hrMeeting=null;l.managementReview=null;l.assetsReviewed=null;l.finalMentor=null;
 for(const ph of phases){notify(db,t,user(db,ph.mentorId).email,'Phase mentoring plan: '+t.name,`${phaseLabel(ph.phase)}\n${ph.start} to ${ph.end}\n${ph.responsibilities}\n\nPrevious training history:\n${l.events.map(e=>e.at+' '+e.action+' '+e.detail).join('\n')}`,'mentor-plan:'+l.plan.id+':'+ph.phase);}
 event(t,u,'Training plan approved and locked','Revision '+l.plan.revision);notify(db,t,db.lifecycleSettings?.hrHeadEmail,'Training plan approved',t.name+' · '+t.designation,'plan:'+l.plan.id);
 }else if(name==='lifecycleRequestChange'){
 if(!l.plan?.approved)fail('No locked plan');if(l.changes.some(c=>c.status==='Pending'))fail('A correction request is already pending');const c={id:id(),reason:req(p.reason,'Reason'),by:u.email,at:now(),status:'Pending'};l.changes.push(c);notify(db,t,db.lifecycleSettings?.hrHeadEmail,'Training plan correction requested',t.name+'\n'+c.reason,'change:'+c.id);event(t,u,'Plan correction requested',c.reason);
 }else if(name==='lifecycleApproveChange'){
 admin(u);const c=l.changes.find(c=>c.id===p.requestId&&c.status==='Pending');if(!c)fail('Request not found');c.status=p.approve===true?'Approved':'Rejected';c.reviewedBy=u.email;c.reviewedAt=now();c.reviewNote=req(p.reason,'Approval reason');if(p.approve){l.plan.approved=false;l.finalSignoff=null;}event(t,u,'Plan correction '+c.status,c.reviewNote);notify(db,t,t.ownerEmail,'Plan correction '+c.status,c.reviewNote,'change-reviewed:'+c.id);
 }else if(name==='lifecycleEvaluation'){
 const ph=phasePlan(t);if(!l.plan?.approved||!ph)fail('Approve the training plan first');if(u.id!==ph.trainerId)fail('Only the assigned phase trainer can assign evaluations',403);const prior=l.evaluations.filter(e=>samePhase(e.phase,t.stage)&&e.planRevision===l.plan.revision).at(-1);if(prior&&prior.score==null)fail('The current evaluation is still pending');const due=date(p.due);if(prior&&prior.score>=ph.passScore)fail('This phase already has a qualifying evaluation');const e={id:id(),phase:t.stage,planRevision:l.plan.revision,title:req(p.title,'Evaluation title',200),due,passScore:ph.passScore,attempt:prior?prior.attempt+1:1,score:null,assignedBy:u.email,at:now()};l.evaluations.push(e);issueAcknowledgement(db,t,'evaluation',e.id,'Evaluation assigned: '+e.title,`Phase: ${phaseLabel(e.phase)}\nDue: ${e.due}\nPassing score: ${e.passScore}/10\nAttempt: ${e.attempt}`,origin);event(t,u,'Evaluation assigned',e.title);
 }else if(name==='lifecycleResult'){
 const e=l.evaluations.find(e=>e.id===p.evaluationId),ph=e&&phasePlan(t,e.phase);if(!e||e.planRevision!==l.plan?.revision)fail('Evaluation not found');if(u.id!==ph.trainerId)fail('Assigned trainer must record results',403);if(e.score!=null)fail('Saved results are immutable. Assign a retest.');if(!acknowledged(t,'evaluation',e.id))fail('Trainee must acknowledge the assigned evaluation first');const score=Number(p.score);if(p.score===''||!Number.isFinite(score)||score<1||score>10)fail('Score must be 1–10');e.score=score;e.feedback=req(p.feedback,'Trainer feedback');e.resultAt=now();e.by=u.email;e.result=score>=ph.passScore?'Pass':'Fail';if(e.result==='Fail')e.retestDue=date(p.retestDue);issueAcknowledgement(db,t,'outcome',e.id,'Evaluation outcome: '+e.title,`${e.phase}\nAttempt ${e.attempt}: ${score}/10 · ${e.result}\nMinimum ${ph.passScore}/10\nTrainer feedback: ${e.feedback}${e.retestDue?'\nRetest scheduled for '+e.retestDue:''}`,origin);event(t,u,'Evaluation '+e.result,e.title+' '+score+'/10');
 if(e.result==='Fail'){const retry={id:id(),phase:e.phase,planRevision:e.planRevision,title:e.title+' — retest',due:e.retestDue,passScore:e.passScore,attempt:e.attempt+1,score:null,assignedBy:u.email,at:now()};l.evaluations.push(retry);issueAcknowledgement(db,t,'evaluation',retry.id,'Retest assigned: '+retry.title,`Phase: ${e.phase}\nDue: ${retry.due}\nMinimum ${retry.passScore}/10\nPrevious score: ${e.score}/10`,origin);}
 }else if(name==='lifecycleCertify'){
 const ph=phasePlan(t);if(!ph||u.id!==ph.trainerId)fail('Assigned phase trainer must certify',403);const missing=phaseMissing(t);if(missing.length)fail('Pending: '+missing.join(', '));if(l.certifications.some(c=>samePhase(c.phase,t.stage)&&c.planRevision===l.plan.revision))fail('Phase already certified');const certification={id:id(),phase:canonicalPhase(t.stage),planRevision:l.plan.revision,at:now(),by:u.email};l.certifications.push(certification);t.certificate={...certification,score:l.evaluations.filter(e=>samePhase(e.phase,t.stage)&&e.result==='Pass').at(-1)?.score,note:'Certified by assigned trainer',nextTraining:l.plan.phases[l.plan.phases.findIndex(p=>samePhase(p.phase,t.stage))+1]?.phase||'Final HR review'};event(t,u,'Phase certified',t.stage);
 }else if(name==='lifecycleFeedback'){
 const role=p.role,ph=phasePlan(t);if(!['trainer','mentor','hr','management'].includes(role))fail('Choose feedback role');if(['hr','management'].includes(role))admin(u);else if(u.id!==(role==='trainer'?ph?.trainerId:ph?.mentorId))fail('Only the assigned '+role+' can submit this feedback',403);l.feedback.push({id:id(),role,comments:req(p.comments,'Feedback'),at:now(),by:u.email,planRevision:l.plan?.revision});event(t,u,role+' feedback recorded',p.comments);
 }else if(name==='lifecycleEscalate'){
 const e={id:id(),category:req(p.category,'Issue category',200),details:req(p.details,'Issue details'),status:'Open',by:u.email,at:now(),history:[]};l.escalations.push(e);notify(db,t,db.lifecycleSettings?.hrHeadEmail,'HR escalation: '+t.name,e.category+'\n'+e.details,'escalate:'+e.id);event(t,u,'HR escalation raised',e.category);
 }else if(name==='lifecycleResolveEscalation'){
 admin(u);const e=l.escalations.find(e=>e.id===p.id);if(!e)fail('Issue not found');e.history.push({at:now(),by:u.email,note:req(p.note,'Resolution')});e.status='Resolved';event(t,u,'HR escalation resolved',p.note);
 }else if(name==='lifecycleAssets'){
 admin(u);if(!t.finalEmailSentAt&&!t.communications?.final?.sentAt&&!l.finalEmailSentAt)fail('Send the approved final onboarding email before asset allotment.');if(l.assetsReviewed)fail('Assets are already recorded');if(!Array.isArray(p.assets))fail('Provide assets or confirm none');l.assets=p.assets.map(a=>({id:id(),type:req(a.type,'Asset type'),details:req(a.details,'Asset / serial details'),date:date(a.date)}));if(!l.assets.length)req(p.reason,'Reason no assets are applicable');l.assetsReviewed={at:now(),by:u.email,reason:p.reason||''};for(const a of l.assets)issueAcknowledgement(db,t,'asset',a.id,'Asset receipt: '+a.type,`${a.details}\nHandover date: ${a.date}`,origin);event(t,u,'Assets recorded',l.assets.length+' assets');
 }else if(name==='lifecycleFinalMentor'){
 admin(u);const m=user(db,p.mentorId),start=date(p.start),end=new Date(start+'T00:00:00Z');end.setUTCMonth(end.getUTCMonth()+3);l.finalMentor={userId:m.id,name:m.name,email:m.email,start,end:end.toISOString().slice(0,10),responsibilities:req(p.responsibilities,'Three-month mentoring responsibilities'),by:u.email,at:now()};notify(db,t,m.email,'Three-month mentoring responsibility: '+t.name,JSON.stringify(l.finalMentor,null,2),'final-mentor:'+t.id+':'+l.finalMentor.at);event(t,u,'Final mentor assigned',m.email);
 }else if(name==='lifecycleMeeting'){
 admin(u);if(u.email!==db.lifecycleSettings?.hrHeadEmail)fail('Only the configured HR Head can record this meeting',403);l.hrMeeting={date:date(p.date),note:req(p.note,'Meeting notes / role confirmation'),by:u.email,at:now()};event(t,u,'HR Head meeting recorded',p.note);
 }else if(name==='lifecycleManagement'){
 admin(u);l.managementReview={note:req(p.note,'Management review / role confirmation'),by:u.email,at:now()};event(t,u,'Management review recorded',p.note);
 }else if(name==='lifecycleRequestAck'){
 const kind=p.kind;if(!['feedback','declaration','module','evaluation','outcome','asset'].includes(kind))fail('Invalid acknowledgement');let ref,details,title;
 if(kind==='feedback'){ref=String(l.plan?.revision);title='End-of-training feedback';details='Please provide your own feedback about your training.';}
 if(kind==='declaration'){if(trainingMissing(t).length)fail('Complete all training and qualifying evaluations first');ref=String(l.plan.revision);title='Final trainee declaration';details=declaration+'\n\nKRA:\n'+l.plan.kra+'\n\nKPI:\n'+l.plan.kpi;}
 if(kind==='module'){const mid=p.materialId,ph=phasePlan(t);if(!ph?.moduleIds.includes(mid))fail('Module must belong to the current training plan');if(!t.materialShares?.some(s=>s.materialId===mid&&s.status==='confirmed'))fail('Share the module first');ref=l.plan.revision+':'+mid;title='Module receipt: '+(materials.find(m=>m.id===mid)?.title||mid);details='Please confirm that you have received and reviewed this training module.';}
 if(['evaluation','outcome'].includes(kind)){const e=l.evaluations.find(e=>e.id===p.ref&&e.planRevision===l.plan?.revision);if(!e||kind==='outcome'&&e.score==null)fail('Evaluation not available');ref=e.id;title=(kind==='evaluation'?'Evaluation assigned: ':'Evaluation outcome: ')+e.title;details=`Phase: ${e.phase}\nDue: ${e.due}\nMinimum: ${e.passScore}/10\nScore: ${e.score??'Pending'}\n${e.feedback||''}`;}
 if(kind==='asset'){const a=l.assets.find(a=>a.id===p.ref);if(!a)fail('Asset not found');ref=a.id;title='Asset receipt: '+a.type;details=a.details+'\n'+a.date;}
 issueAcknowledgement(db,t,kind,ref,title,details,origin);
 }else if(name==='lifecycleHandoverAck'){
 const h=t.handovers.find(h=>h.id===p.id);if(!h||h.email?.toLowerCase()!==u.email)fail('Only the receiving trainer can acknowledge this handover',403);h.acknowledgement={at:now(),by:u.email,note:req(p.note,'Acknowledgement note')};event(t,u,'Trainer handover acknowledged',h.stage);
 }else if(name==='lifecycleSignoff'){
 admin(u);if(u.email!==db.lifecycleSettings?.hrHeadEmail)fail('Only the configured HR Head may sign off',403);const missing=finalMissing(t,db);if(missing.length)fail('Pending: '+missing.join(', '));l.finalSignoff={by:u.email,at:now(),note:req(p.note,'Final sign-off notes'),revision:l.plan.revision};l.finalCertificate={id:id(),at:now(),by:u.email,scores:l.evaluations.filter(e=>e.result==='Pass').map(e=>({phase:e.phase,score:e.score}))};event(t,u,'Final HR sign-off approved',p.note);
 }else fail('Unknown lifecycle action');
 t.version++;return {ok:true};
}
export function lifecycleSettings(db,u,p){admin(u);const hrHeadEmail=emails(p.hrHeadEmail);if(hrHeadEmail.includes(','))fail('Choose one HR Head');if(hrHeadEmail&&!db.users.some(x=>x.email===hrHeadEmail&&x.role==='admin'&&x.active))fail('HR Head must be an active admin account');db.lifecycleSettings={hrHeadEmail,managementEmails:emails(p.managementEmails),departmentEmails:emails(p.departmentEmails),hrContact:String(p.hrContact||'').trim()};return {ok:true};}

export function requestCompletionFeedback(db,t,ref,title,origin){
 if(t.completionFeedbackEnabled===false||!t.email)return;
 issueAcknowledgement(db,t,'handover-feedback',ref,'Training feedback — '+title,`Completed: ${title}\nPhase: ${t.stage}\nTrainer: ${t.trainerName||t.ownerEmail||'Training team'}\nPlease rate your experience and share your feedback. Only portal administrators receive the feedback notification.`,origin);
 const token=db.ackTokens?.find(a=>a.traineeId===t.id&&a.kind==='handover-feedback'&&a.ref===ref);
 if(token){token.feedbackPhase=t.stage;token.feedbackTrainer=t.trainerName||t.ownerEmail;token.moduleTitle=title;}
}
