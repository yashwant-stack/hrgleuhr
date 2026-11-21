import {id,now} from './store.js';
import {flowConfirmation} from './training-flow.js';

export function completeLearningDelivery(db,t,d){
 const e=d.learningDelivery;
 if(!e||e.completedAt||t.stage!==e.phase)return;
 if(e.materialId){
  if(!t.approvedMaterials?.some(a=>a.id===e.materialId&&a.at===e.approvalAt))return;
  (t.materialShares??=[]).push({id:id(),materialId:e.materialId,status:'confirmed',channel:'email',flowStep:e.flowStep,approvalAt:e.approvalAt,at:now(),by:e.by});
 }else (t.resourceShares??=[]).push({resourceId:e.resourceId,channel:'email',at:now(),by:e.by});
 e.completedAt=now();t.version++;
 (db.audit??=[]).push({id:id(),at:now(),actor:e.by,traineeId:t.id,action:'Training document emailed',detail:e.title});
 if(t.flowEnabled&&t.email)flowConfirmation(db,t,'Training content received — '+t.name,e.title+'\nPhase: '+e.phase,e.origin);
}
