import {samePhase} from './training-phases.js';
import fs from 'node:fs';
export const materials = JSON.parse(fs.readFileSync(new URL('./seed/materials.json', import.meta.url)));
const canonical = value => {
 const key=String(value||'').trim().toLowerCase();
 return ({fdm:'front desk manager',bm:'branch manager',rh:'regional head',reception:'receptionist',sales:'counsellor',counselor:'counsellor'})[key]||key;
};
export function materialApplies(material, trainee, db) {
 if(material.roles.includes('All'))return true;
 const roles=new Set();let role=trainee.designation;
 for(let i=0;role&&i<6;i++){
  roles.add(canonical(role));
  const entry=Object.entries(db.customDesignations||{}).find(([key])=>canonical(key)===canonical(role));
  if(!entry||canonical(entry[1])==='all')break;
  role=entry[1];
 }
 const specific=/KRA|KPI/i.test(material.title)?(/Counsellor/i.test(material.title)?['Counsellor']:/Reception/i.test(material.title)?['Receptionist']:material.roles):material.roles;
 return specific.some(role=>roles.has(canonical(role)));
}
export function materialContent(id) {
 if(!materials.some(m=>m.id===id))throw Error('Unknown training material');
 return JSON.parse(fs.readFileSync(new URL(`./materials/${id}.json`,import.meta.url)));
}
export function materialFile(material) {
 return fs.readFileSync(new URL(`./materials/${material.filename}`,import.meta.url));
}
export function normalizePhone(value) {
 const raw=String(value??'').trim();if(!raw)return '';
 if(!/^\+?[\d\s().-]+$/.test(raw))throw Object.assign(Error('Enter a valid WhatsApp number with country code'),{status:400});
 let digits=raw.replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(!raw.startsWith('+')&&digits.length===10)digits='91'+digits;
 if(!/^[1-9]\d{7,14}$/.test(digits))throw Object.assign(Error('Use a 10-digit Indian number or an international number with country code'),{status:400});
 return digits;
}

export function materialPhases(m){
 if(Array.isArray(m.phases)&&m.phases.length)return m.phases;
 const text=(m.group+' '+m.title).toLowerCase();
 if(/crm|tech/.test(text))return ['CRM & Tech Training'];
 if(m.group==='HR'||/handbook|letter|kra|kpi|profile|responsibilit/.test(text))return ['Induction','Onboarding'];
 if(m.group.toLowerCase()==='sales'||/crosssell|upsell|sales/.test(text))return ['Sales Training'];
 return ['Operations Training'];
}
export function materialForPhase(m,t,db){return !t.removedMaterialIds?.includes(m.id)&&materialApplies(m,t,db)&&materialPhases(m).some(p=>samePhase(p,t.stage));}
