import {activeTraining,phaseScore} from './phase-training.js';
import {phaseLabel,samePhase} from './training-phases.js';
export function mentorPlan(t,db){
 const practical=activeTraining(t,db).checklist.filter(r=>!r.removed&&r.type==='Practical');
 return `Practical guidance — ${phaseLabel(t.stage)}\nDesignation: ${t.designation}\n\n`+(practical.length?practical.map(r=>'• '+r.topic).join('\n'):`• Demonstrate the core tasks for ${phaseLabel(t.stage)}.\n• Supervise hands-on practice and check understanding.\n• Review gaps and record feedback before the next phase.`);
}
export function mentorHistoryText(t,db){
 const fmt=x=>x==null?'Not assessed':Number(x).toFixed(1)+' / 10';
 const active=activeTraining(t,db);
 const lines=rows=>rows.length?rows.join('\n'):'No previous records.';
 return `Current phase checklist\n${lines(active.checklist.filter(r=>!r.removed).map(r=>`${r.covered?'Completed':'Pending'} — ${r.topic}`))}\n\nCurrent scores\n${lines(active.scores.map(r=>`${r.criterion}: ${fmt(r.score)}`))}\n\nPrevious phase history\n${lines((t.phaseHistory||[]).map(h=>{const scores=(t.scores||[]).filter(r=>samePhase(r.phase,h.phase));return `${phaseLabel(h.phase)} · ${h.at}\n${scores.map(r=>r.criterion+': '+fmt(r.score)).join('\n')}\nAssessment ratings: ${(h.assessments||[]).filter(r=>r.score!=null).map(r=>r.question+': '+fmt(r.score)).join('; ')||'Not assessed'}`;}))}\n\nPrevious mentor plans\n${lines((t.mentorHistory||[]).map(m=>`${m.name} · ${phaseLabel(m.phase)} · ${m.startDate}\n${m.focus}`))}\n\nHandover history\n${lines((t.handovers||[]).map(h=>`${h.fromStage||'Previous phase'} → ${h.stage} · ${h.status} · ${h.at||''}\n${h.note||''}`))}\n\nFeedback\n${lines((t.feedbackRows||[]).map(f=>`${f.at||''} · ${f.rating||''} · ${f.recommendation||''}\n${f.strengths||''}\n${f.improve||''}\n${f.comments||''}`))}`;
}
