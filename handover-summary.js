import {assessmentText} from './transition-assessment.js';
import {materials} from './training-materials.js';
import {phaseScore} from './phase-training.js';
const list=rows=>rows.length?rows.join('\n'):'No records yet.';
const score=n=>n==null||n===''?'Not assessed':Number(n).toFixed(1)+' / 10';
const stamp=r=>[r.assessor||r.by||r.actor||r.completedBy||r.addedBy,r.at||r.coveredAt||r.completedAt].filter(Boolean).join(' · ')||'Not recorded';
export const SUMMARY_MARKER='TRAINING HISTORY — AUTOMATIC SUMMARY';
export function handoverSummary(t,db){
 const catalog=[...materials,...(db.uploadedMaterials||[])],title=id=>catalog.find(m=>m.id===id)?.title||id;
 const sections=[`${SUMMARY_MARKER}\nTrainee: ${t.name}\nDesignation: ${t.designation}\nClinic / department: ${t.branch||'—'} / ${t.department||'—'}\nCurrent phase: ${t.stage}\nCurrent trainer: ${t.trainerName||'Not recorded'}${t.ownerEmail?' ('+t.ownerEmail+')':''}\nCurrent phase score: ${score(phaseScore(t,db.records||[],db))}`];
 const add=(heading,rows)=>sections.push(heading+'\n'+list(rows));
 add('TRAINERS & HANDOVERS',(t.handovers||[]).map(h=>`${h.fromStage||'Draft'} → ${h.stage} · ${h.status}\nPrevious trainer: ${h.previousTrainerName||h.previousTrainerEmail||'Not recorded'} · Next trainer: ${h.ownerName||h.email}\nRecorded by: ${h.by||'Not recorded'} · ${h.at||h.createdAt||''}`));
 add('THEORY & PRACTICAL STAGES',Object.entries(t.trainingFlow||{}).flatMap(([phase,f])=>[...Object.entries(f.steps||{}).map(([step,r])=>`${phase} · ${step}: ${r.complete?'Completed':'Pending'} · ${stamp(r)}`),...Object.entries(f.evaluations||{}).map(([step,r])=>`${phase} · ${step}: ${score(r.score)} · ${stamp(r)}\n${(r.ratings||[]).map(x=>x.title+': '+score(x.score)).join('\n')}`)]));
 add('TRAINEE CONFIRMATIONS',(t.lifecycle?.acknowledgements||[]).map(a=>`${a.kind} · ${a.name} · ${a.by} · ${a.at}`));
 add('CHECKLIST — ALL PHASES',(t.checklist||[]).map(r=>`${r.phase||r.module} · ${r.topic}: ${r.removed?'Removed':r.covered?'Completed':'Pending'}${r.contentShared?' · Content shared':''}\n${stamp(r)}${r.remarks?' · '+r.remarks:''}`));
 add('SCORES — ALL PHASES',(t.scores||[]).map(r=>`${r.phase||r.category} · ${r.criterion}: ${score(r.score)}${r.removed?' · Removed':''}\n${stamp(r)}${r.remarks?' · '+r.remarks:''}`));
 add('ASSESSMENT RATINGS', [...(t.phaseHistory||[]).flatMap(h=>(h.assessments||[]).filter(r=>r.rating||r.score!=null).map(r=>`${h.phase} · ${r.question}: ${r.rating||''} · ${score(r.score)}\n${stamp(r)}`)),...(t.assessments||[]).map(r=>`${t.stage} · ${r.question}: ${r.rating||'Pending'} · ${score(r.score)}\n${stamp(r)}`)]);
 add('MODULES & DOCUMENT SHARING',(t.approvedMaterials||[]).map(a=>`${title(a.id)} · Approved: ${stamp(a)}\nShared: ${list((t.materialShares||[]).filter(s=>s.materialId===a.id).map(s=>`${s.status} · ${s.channel||'Trainer confirmation'} · ${stamp(s)}`))}\nCompleted: ${list((t.completedMaterials||[]).filter(s=>s.id===a.id).map(stamp))}`));
 add('RESOURCES & SOPs',(t.resourceShares||[]).map(r=>`${r.resourceId} · ${r.channel||'Trainer confirmation'} · ${stamp(r)}`));
 add('PRACTICAL MENTORS',[...(t.mentorHistory||[]),...(t.mentor?[t.mentor]:[])].map(m=>`${m.phase} · ${m.name||m.email||m.userId} · Start: ${m.startDate||''}\nPlan: ${m.focus||''}\n${list((m.tasks||[]).map(r=>`${r.title||r.topic||t.checklist?.find(c=>c.id===r.topicId)?.topic||r.topicId}: ${r.complete?'Completed':'Pending'} · ${stamp(r)}`))}`));
 add('TRAINEE HANDOVER RATINGS',(t.handoverFeedback||[]).map(f=>`${f.phase} · ${f.rating}/5 stars · Trainer: ${f.trainer||'—'} · ${f.at}\n${f.answers?assessmentText('trainee',f.answers):''}`));
 add('DEPARTMENT & FINAL EVALUATIONS',(t.transitionAssessments||[]).map(r=>`${r.kind} · ${r.phase} · ${r.by} · ${r.at}\n${assessmentText(r.kind,r.answers)}`));
 add('FEEDBACK',(t.feedbackRows||[]).map(f=>`${f.rating||'Pending'} · ${f.recommendation||''} · ${stamp(f)}\nStrengths: ${f.strengths||'—'}\nImprove: ${f.improve||'—'}\nComments: ${f.comments||'—'}`));
 add('TESTS & OTHER TRAINING RECORDS',(db.records||[]).filter(r=>r.traineeId===t.id).map(r=>Object.entries(r).filter(([k])=>!['id','traineeId'].includes(k)).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`).join(' · ')));
 add('CERTIFICATES',[...(t.phaseHistory||[]).map(h=>h.certificate).filter(Boolean),...(t.certificate?[t.certificate]:[])].map(c=>`${c.phase} · ${score(c.score)} · ${stamp(c)} · Certificate ${c.id}`));
 add('LIFECYCLE RECORDS',Object.entries(t.lifecycle||{}).filter(([k])=>['evaluations','feedback','certifications','events','assets','finalSignoff','managementReview'].includes(k)).map(([k,v])=>`${k}: ${JSON.stringify(v)}`));
 add('ACTIVITY HISTORY',(db.audit||[]).filter(r=>r.traineeId===t.id).map(r=>`${r.at} · ${r.actor||'Not recorded'} · ${r.action}${r.detail?' · '+r.detail:''}`));
 return sections.join('\n\n');
}
export function handoverNote(t,db,manual=''){return [String(manual).split(SUMMARY_MARKER)[0].trim(),handoverSummary(t,db)].filter(Boolean).join('\n\n');}
