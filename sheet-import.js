import { createHash } from 'node:crypto';
import { initializeWorkflow, original, phaseOf, summary, typeFor } from './training-workflow.js';

export const sheetId = '1AxOudvDetHWT1857DoH0jHNFtLuwEC92_FSnvMCM3zo';
const str = value => String(value ?? '').trim();
const key = value => str(value).toLowerCase();
const number = value => value === null || value === undefined || value === '' ? null : Number(value);
const date = value => value ? String(value).slice(0, 10) : null;
// XLSX dates are spreadsheet-local wall times, not UTC timestamps.
export const stamp = value => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(String(value)) ? value : String(value) + '+05:30').toISOString() : null;
const stableId = (tab, row) => 'sheet-' + createHash('sha256').update(`${sheetId}:${tab}:${row}`).digest('hex').slice(0, 24);
const rows = (source, tab) => (source[tab] || []).slice(1).map((values, index) => ({ values, row: index + 2 })).filter(r => r.values.some(v => v !== null && v !== ''));
const namedRows = (source, tab) => rows(source, tab).filter(r => str(r.values[0]));
const templates = source => Object.fromEntries(['Checklist_Template','Scoring_Template','Question_Bank','Lists'].map(tab => [tab, rows(source, tab).map(({values}) => Object.fromEntries(source[tab][0].map((h,i) => [h, values[i] ?? ''])))]));

export function restoreSheet(db, source, { importedAt = new Date().toISOString() } = {}) {
  for (const tab of ['Trainees','Checklist','Scores','Assessment','Feedback','Handover','Removed_Items','Checklist_Template','Scoring_Template','Question_Bank','Lists']) {
    if (!Array.isArray(source[tab]) || !source[tab].length) throw Error(`Missing sheet: ${tab}`);
  }
  const digest = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  if (db.sheetRestores?.some(r => r.digest === digest)) return { alreadyImported: true, digest };
  const tr = rows(source, 'Trainees').filter(r => str(r.values[1]));
  const names = new Set(tr.map(r => key(r.values[1])));
  if (names.size !== tr.length) throw Error('Duplicate trainee names in source; resolve before import');
  db.trainingTemplates = templates(source);
  const archive = {};
  for (const tab of ['Checklist','Scores','Assessment','Feedback','Handover','Removed_Items']) {
    archive[tab] = namedRows(source, tab).filter(r => !names.has(key(r.values[0])));
  }
  const report = [];
  for (const {values:v,row} of tr) {
    const name = str(v[1]);
    const existing = db.trainees.filter(t => t.sheetSource?.row === row && t.sheetSource?.sheetId === sheetId || key(t.name) === key(name));
    if (existing.length > 1) throw Error(`Ambiguous website trainee match: ${name}`);
    const previous = existing[0];
    const ownerEmail = key(v[8]);
    const t = {
      ...previous,
      id: previous?.id || stableId('Trainees',row), code: str(v[0]), name,
      email:key(v[2]), branch:str(v[3]), designation:str(v[4]), joiningDate:date(v[5]),
      trainerName:str(v[6]), stage:str(v[7]), ownerEmail,
      ownerId:db.users.find(u => key(u.email) === ownerEmail && u.active)?.id || null,
      status:str(v[11]), closedAt:date(v[12]), purpose:previous?.purpose || 'New Hire Onboarding',
      version:(previous?.version || 0)+1, createdAt:previous?.createdAt || importedAt,
      phases:[], checklist:[], scores:[], assessments:[], handovers:[], feedbackRows:[],
      feedback:null, completedModules:previous?.completedModules || [], certificate:previous?.certificate || null,
      sheetSource:{sheetId,row,importedAt},
    };
    const mine = tab => namedRows(source,tab).filter(r => key(r.values[0]) === key(name));
    t.checklist = mine('Checklist').map(({values:r,row}) => ({
      id:stableId('Checklist',row),module:str(r[1]),topic:str(r[2]),covered:r[3]===true,
      coveredAt:stamp(r[4]),remarks:r[5]??'',type:str(r[6])||typeFor(str(r[2])),assessor:str(r[7]),removed:false,
      phase:phaseOf('',str(r[1]),original.MODULE_PHASE),sourceRow:row,
    }));
    for (const {values:r,row} of mine('Removed_Items')) {
      if (t.checklist.some(c=>c.module===str(r[1])&&c.topic===str(r[2]))) throw Error(`Both active and removed checklist item for ${name}`);
      t.checklist.push({id:stableId('Removed_Items',row),module:str(r[1]),topic:str(r[2]),type:str(r[3])||typeFor(str(r[2])),phase:phaseOf('',str(r[1]),original.MODULE_PHASE),covered:false,coveredAt:null,remarks:'',assessor:'',removed:true,removedBy:str(r[4]),removedAt:stamp(r[5]),sourceRow:row});
    }
    t.scores=mine('Scores').map(({values:r,row})=>({id:stableId('Scores',row),category:str(r[1]),criterion:str(r[2]),score:number(r[3]),assessor:str(r[4]),remarks:r[5]??'',phase:phaseOf('',str(r[1]),original.CAT_PHASE),sourceRow:row}));
    t.assessments=mine('Assessment').map(({values:r,row})=>({id:stableId('Assessment',row),department:str(r[1]),question:str(r[2]),keyPoints:r[3]??'',answer:r[4]??'',rating:str(r[5]),score:number(r[6]),assessor:str(r[7]),at:stamp(r[8]),sourceRow:row}));
    t.feedbackRows=mine('Feedback').map(({values:r,row})=>({id:stableId('Feedback',row),by:str(r[1]),at:stamp(r[2]),rating:str(r[3]),recommendation:str(r[4]),strengths:r[5]??'',improve:r[6]??'',comments:r[7]??'',sourceRow:row}));
    t.feedbackRequested=!!t.feedbackRows.length;
    t.handovers=mine('Handover').map(({values:r,row})=>({id:stableId('Handover',row),stage:str(r[1]),ownerName:str(r[2]),email:key(r[3]),ownerId:db.users.find(u=>key(u.email)===key(r[3])&&u.active)?.id||null,note:r[4]??'',status:str(r[5]),at:stamp(r[6]),createdAt:stamp(r[6])||importedAt,remindedOn:date(r[7]),lastReminderAt:stamp(r[7]),by:'',sourceRow:row}));
    t.feedback=summary(t).feedback;
    const actual=summary(t);
    if (number(v[9])!==null && Math.abs(actual.checklistPercent-number(v[9]))>1e-8) throw Error(`Checklist total mismatch: ${name}`);
    if (number(v[10])!==null && Math.abs(actual.scorePercent-number(v[10]))>1e-8) throw Error(`Score total mismatch: ${name}`);
    const counts = {checklist:t.checklist.length,scores:t.scores.length,assessments:t.assessments.length};
    if(previous)db.trainees[db.trainees.indexOf(previous)]=t;else db.trainees.push(t);
    report.push({name,code:t.code,counts,covered:t.checklist.filter(r=>r.covered).length,scorePercent:actual.scorePercent,checklistPercent:actual.checklistPercent,handovers:t.handovers.length,feedbackRows:t.feedbackRows.length,sourceStage:t.stage});
  }
  initializeWorkflow(db);
  for(const r of report){
    const t=db.trainees.find(t=>t.name===r.name);
    for(const field of ['checklist','scores','assessments'])if(t[field].length!==r.counts[field])throw Error(`Automatic sync adds ${t[field].length-r.counts[field]} ${field} rows for ${r.name}; reconcile before import`);
  }
  db.nextTraineeNumber=Math.max(db.nextTraineeNumber||0,...db.trainees.map(t=>Number(t.code?.replace('TR-',''))||0));
  const result={sheetId,digest,importedAt,report,archivedCounts:Object.fromEntries(Object.entries(archive).map(([tab,r])=>[tab,r.length]))};
  db.sheetRestores??=[];
  db.sheetRestores.push({...result,archive});
  db.audit.push({id:stableId('Import',digest),at:importedAt,actor:'Spreadsheet restoration',action:'Restored live training sheet',traineeId:null,detail:`${report.length} trainees; orphan rows archived; no email sent`});
  return result;
}
