import {id,now} from './store.js';
import {switchTrainingPhase} from './phase-training.js';
import {closeTraining,syncTrainee} from './training-workflow.js';

export const finalEmailSent=t=>!!(t.finalEmailSentAt||t.communications?.final?.sentAt||t.lifecycle?.finalEmailSentAt);
export const assetsReady=t=>!!t.lifecycle?.assetsReviewed&&(t.lifecycle.assets||[]).every(a=>t.lifecycle.acknowledgements?.some(r=>r.kind==='asset'&&r.ref===a.id));
export function finalEmailDelivered(db,t,at){
 for(const key of ['handovers','checklist','scores','assessments'])t[key]??=[];
 t.finalEmailSentAt=at;t.lifecycle??={};t.lifecycle.finalEmailSentAt=at;
 if(t.stage!=='Asset Allotment')switchTrainingPhase(t,'Asset Allotment');
 t.status='Active';t.closedAt=null;syncTrainee(t,db);
}
export function completeAssetAllotment(db,u,t,p){
 if(u.role!=='admin'&&u.id!==t.ownerId)throw Object.assign(Error('Only HR or the assigned owner can complete asset allotment.'),{status:403});
 if(t.version!==p.version)throw Object.assign(Error('Record changed. Refresh before completing asset allotment.'),{status:409});
 if(t.stage!=='Asset Allotment'||!finalEmailSent(t))throw Object.assign(Error('Send the approved final onboarding email before completing asset allotment.'),{status:409});
 if(!assetsReady(t))throw Object.assign(Error('Record assets (or a reason none apply) and wait for trainee receipt acknowledgements.'),{status:409});
 if(t.assetAllotmentCompletedAt)return {ok:true};
 t.assetAllotmentCompletedAt=now();t.lifecycle.completedAt=t.assetAllotmentCompletedAt;closeTraining(t);t.version++;
 (db.audit??=[]).push({id:id(),at:now(),actor:u.email,action:'Asset allotment completed',traineeId:t.id,detail:'Final onboarding email and asset receipt requirements completed.'});
 return {ok:true};
}
