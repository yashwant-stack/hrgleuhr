import {isSystemAdmin} from './system-admin.js';

// Portal sections (sidebar pages). adminOnly sections are never available to trainers.
export const SECTIONS=[
 ['dashboard','Dashboard'],['trainees','Trainees'],['materials','Modules & handbooks'],['academy','Sales Academy'],
 ['tests','Test centre'],['resources','Resources & SOPs'],['reports','Progress & insights'],['audit','Activity log'],
 ['outbox','Email delivery'],['mentoring','My mentor tasks'],
 ['users','Users & trainers',true],['hrconnect','HR head connect',true],['mgmtconnect','MGMT connect',true],
 ['tickets','Tickets',true],['templates','Training templates',true],
].map(([key,label,adminOnly])=>({key,label,adminOnly:!!adminOnly}));
const KEYS=new Set(SECTIONS.map(s=>s.key));

export const roleSections=role=>SECTIONS.filter(s=>role==='admin'||!s.adminOnly).map(s=>s.key);

// user.access: null/undefined = every section the role allows; otherwise the chosen subset.
// The System Admin always keeps full access so user management can never be locked out.
export function allowedSections(u){
 const base=roleSections(u?.role);
 if(isSystemAdmin(u)||!Array.isArray(u?.access))return base;
 return base.filter(k=>u.access.includes(k));
}
export const canAccess=(u,key)=>allowedSections(u).includes(key);

// Validates a submitted list; returns null when it equals the role default (keeps future sections visible).
export function normalizeAccess(role,list){
 if(list==null)return null;
 if(!Array.isArray(list)||list.some(k=>typeof k!=='string'||!KEYS.has(k)))throw Object.assign(Error('Choose valid sections'),{status:400});
 const allowed=roleSections(role),chosen=allowed.filter(k=>list.includes(k));
 if(!chosen.length)throw Object.assign(Error('Give access to at least one section'),{status:400});
 return chosen.length===allowed.length?null:chosen;
}

// Server actions that belong to a single section; blocked when that section is not allowed.
export const ACTION_SECTIONS={
 createTicket:'tickets',startTicket:'tickets',resolveTicket:'tickets',confirmTicket:'tickets',reopenTicket:'tickets',commentTicket:'tickets',retryTicketEmail:'tickets',
 testEmail:'outbox',emailVerify:'outbox',
 saveTemplateRow:'templates',deleteTemplateRow:'templates',
 createUser:'users',updateUser:'users',
};
