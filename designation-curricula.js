import fs from 'node:fs';
import {canonicalPhase} from './training-phases.js';

export const curricula=JSON.parse(fs.readFileSync(new URL('./seed/designation-curricula.json',import.meta.url)));
const defaults=JSON.parse(fs.readFileSync(new URL('./seed/training.json',import.meta.url)));
const placementVersion='2026-11-18-hr-onboarding-only-v2';
const foundationPhase=role=>role?.key==='counsellor'?'Sales Training':'Operations Training';
const commonFoundations=new Set(['Company introduction & history','Vision, mission & core values','Clinics network & skincare product line overview']);
const isCommonFoundation=row=>!row.custom&&!row.curriculumId&&(row.Module||row.module)==='Induction'&&commonFoundations.has(row.Topic||row.topic);
const commonFoundationQuestions=new Set(['In your own words, explain the vision, mission and core values of Gleuhr and give one example of how you will apply them in your role.','Describe Gleuhr: its clinics network and its skincare product line.']);
const isFoundationQuestion=row=>!row.custom&&!row.curriculumId&&commonFoundationQuestions.has(row.Question||row.question);
// Workbook day numbers belong to the designation course, not the HR induction.
for(const role of curricula.roles){
 for(const row of role.days)if(row.phase==='Induction')row.phase=foundationPhase(role);
 role.notes.push('Day numbers refer to the designation training course. Brand, role responsibilities and KRA/KPI foundations are covered in '+foundationPhase(role)+', separately from HR Induction.');
}
const canonical=value=>{
 const key=String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
 return ({bm:'branch manager',rh:'regional head',counselor:'counsellor'})[key]||key;
};
export function curriculumFor(designation,db={}){
 let key=canonical(designation);const seen=new Set();
 while(key&&!seen.has(key)){
  seen.add(key);const found=curricula.roles.find(r=>canonical(r.designation)===key);if(found)return found;
  const mapping=Object.entries(db.customDesignations||{}).find(([name])=>canonical(name)===key);key=canonical(mapping?.[1]);
 }
 return null;
}
export function initializeCurriculum(t,db){
 if(!curriculumFor(t.designation,db)||t.curriculumVersion)return;
 // A started/approved phase remains on its original requirements. New phases use the new source curriculum.
 const legacy=new Set();
 for(const r of [...(t.checklist||[]),...(t.scores||[])])if(r.covered||r.removed||r.score!=null)legacy.add(canonicalPhase(r.phase||t.stage));
 for(const r of t.assessments||[])if(r.score!=null||r.rating)legacy.add(canonicalPhase(t.stage));
 for(const [phase,f] of Object.entries(t.trainingFlow||{}))if(Object.entries(f.steps||{}).some(([step,s])=>step!=='Start'&&s.complete)||Object.keys(f.evaluations||{}).length)legacy.add(canonicalPhase(phase));
 for(const ph of t.lifecycle?.plan?.approved?t.lifecycle.plan.phases:[])legacy.add(canonicalPhase(ph.phase));
 if(t.status==='Completed')for(const p of ['Induction','Sales Training','CRM & Tech Training','Operations Training','Assessment'])legacy.add(p);
 t.curriculumVersion=curricula.version;t.curriculumLegacyPhases=[...legacy];
}
const metadata=(id,phase,extra={})=>({curriculumId:id,Phase:phase,...extra});
export function curriculumRows(role){
 const checks=role.days.map(r=>({...metadata(r.id,r.phase,{trainingDay:r.day,mentor:r.mentor,verification:r.verification,source:r.source,sourceKind:'schedule'}),Designation:role.designation,Module:`Day ${r.day} · ${r.module}`,Topic:r.content,Type:r.type}));
 for(const [index,m] of role.modules.entries()){
  const n=Number(m.title.match(/(?:Module |M)(\d+)/)?.[1]);
  const phase=role.key==='counsellor'?(n===6?'CRM & Tech Training':'Sales Training'):role.key==='bm'?(n===5||n===6?'Sales Training':/Final Test/.test(m.title)?'Assessment':'Operations Training'):(n===1?'Operations Training':n<=6?'Sales Training':/Final Evaluation/.test(m.title)?'Assessment':'Operations Training');
  checks.push({...metadata(role.key+'-overview-'+index,phase,{source:m.source,verification:m.competency||'',sourceKind:'overview'}),Designation:role.designation,Module:m.title,Topic:m.content,Type:'Theory'});
 }
 for(const m of role.practical)for(const r of m.tasks)checks.push({...metadata(r.id,m.phase,{mentor:m.trainer,verification:r.verification,source:r.source,optional:!!r.optional,sourceKind:'tracker'}),Designation:role.designation,Module:m.title,Topic:r.title,Type:'Practical'});
 for(const r of role.signoff)checks.push({...metadata(r.id,'Assessment',{verification:'Record the review date and reference to the written confirmation or deployment record.',source:r.source,sourceKind:'signoff'}),Designation:role.designation,Module:'Deployment sign-off',Topic:r.title,Type:'Practical'});
 return {Checklist_Template:checks,Scoring_Template:[],Question_Bank:role.questions.map(r=>({...metadata(r.id,r.phase,{mentor:r.owner,source:r.sources[0],sources:r.sources}),Designation:role.designation,Department:r.phase==='Operations Training'?'Operations':'Sales',Question:r.question,'Key Points (for assessor)':r.answer}))};
}
const rowKey=(kind,r)=>kind==='Checklist_Template'?r.Module+'|'+r.Topic:kind==='Scoring_Template'?r.Category+'|'+r.Criterion:r.Department+'|'+r.Question;
export function relocateCurriculumFoundations(t,db){
 if(t.curriculumPlacementVersion===placementVersion)return;
 const role=curriculumFor(t.designation,db),phases=new Map(role?curriculumRows(role).Checklist_Template.map(r=>[r.curriculumId,r.Phase]):[]),moved=[],assessments=[];
 for(const row of t.checklist||[]){
  const destination=isCommonFoundation(row)?foundationPhase(role):phases.get(row.curriculumId);
  if(canonicalPhase(row.phase)==='Induction'&&destination&&destination!=='Induction'){
   moved.push({rowId:row.id,...(row.curriculumId?{curriculumId:row.curriculumId}:{}),from:row.phase,to:destination});
   row.phase=destination;row.curriculumPreviousPhase='Induction';
  }
 }
 for(const row of t.assessments||[]){
  if(row.department!=='HR'||!isFoundationQuestion(row))continue;
  const destination=foundationPhase(role),department=destination==='Sales Training'?'Sales':'Operations';
  assessments.push({rowId:row.id,fromDepartment:'HR',toDepartment:department,to:destination});
  row.department=department;row.phase=destination;row.curriculumPreviousDepartment='HR';
 }
 t.curriculumPlacementVersion=placementVersion;
 if(moved.length||assessments.length){
  t.curriculumPhaseCorrections??=[];t.curriculumPhaseCorrections.push({version:placementVersion,at:new Date().toISOString(),rows:moved,assessments});
  if(Number.isInteger(t.version))t.version++;
 }
}
export function curriculumTemplates(t,db,base){
 const role=curriculumFor(t.designation,db);
 // The generic brand overview also belongs outside HR onboarding for every role.
 const destination=foundationPhase(role),department=destination==='Sales Training'?'Sales':'Operations';
 base={...base,Checklist_Template:base.Checklist_Template.map(r=>isCommonFoundation(r)&&canonicalPhase(r.Phase)==='Induction'?{...r,Phase:destination}:r),Question_Bank:base.Question_Bank.map(r=>isFoundationQuestion(r)&&r.Department==='HR'?{...r,Phase:destination,Department:department}:r)};
 if(!role||!t.curriculumVersion)return base;
 const imported=curriculumRows(role),legacy=new Set(t.curriculumLegacyPhases||[]);
 const replaced=new Set(imported.Checklist_Template.map(r=>canonicalPhase(r.Phase)).filter(p=>!legacy.has(p)));
 const result={...base};
 for(const kind of ['Checklist_Template','Scoring_Template','Question_Bank']){
  const seeds=new Set(defaults[kind].map(r=>rowKey(kind,r)));
  result[kind]=base[kind].filter(r=>{
   const phase=canonicalPhase(r.Phase||({HR:'Induction',Sales:'Sales Training',Operations:'Operations Training'})[r.Department]);
   if(kind==='Checklist_Template'&&isCommonFoundation(r))return true;
   if(kind==='Question_Bank'&&isFoundationQuestion(r))return true;
   if(phase==='Induction'&&r.Designation==='All')return true;
   return !replaced.has(phase)||!seeds.has(rowKey(kind,r));
  }).concat(imported[kind].filter(r=>!legacy.has(canonicalPhase(r.Phase))||kind==='Checklist_Template'&&t.checklist?.some(saved=>saved.curriculumId===r.curriculumId&&saved.curriculumPreviousPhase==='Induction')));
 }
 return result;
}
export function curriculumView(t,db){
 const role=curriculumFor(t.designation,db);if(!role)return null;
 return {...role,version:curricula.version,legacyPhase:(t.curriculumLegacyPhases||[]).includes(canonicalPhase(t.stage))};
}
export function curriculumText(role,{answers=false}={}){
 if(!role)return '';
 return [role.designation+' · '+role.duration+'-day training plan',...role.notes,
  'MODULES',...role.modules.map(m=>m.title+'\n'+m.content+(m.competency?'\nExpected competency: '+m.competency:'')),
  'DAY-WISE PLAN',...role.days.map(r=>`Day ${r.day} | ${r.module}\n${r.content}\nMentor: ${r.mentor||'To be assigned'}${r.verification?'\nVerification: '+r.verification:''}`),
  'PRACTICAL COMPETENCIES · 0 pending / 1 verified',...role.practical.flatMap(m=>[m.title+'\nTrainer: '+m.trainer,...m.tasks.map(r=>r.title+(r.optional?' [Optional]':'')+'\nVerify: '+r.verification)]),
  'ASSESSMENT QUESTIONS',...role.questions.map((r,i)=>`${i+1}. ${r.question}${answers?'\nExpected answer / evidence: '+r.answer:''}`),
  'TRAINER CHECKLIST',...role.trainerTasks.map(r=>r.task+' · '+r.from+' → '+r.to),
  'DEPLOYMENT SIGN-OFF',...role.signoff.map(r=>r.title),...role.guidance,
  'SOURCES',...role.sources.map(r=>r.filename)].join('\n\n');
}
