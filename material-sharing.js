// Preparing another download does not undo a confirmed delivery. Explicit resets
// and a new approval still require a new confirmation.
export function materialSharing(t, materialId) {
 const approval=t?.approvedMaterials?.find(a=>a.id===materialId);
 if(!approval)return null;
 let state=null;
 for(const share of t.materialShares||[]){
  if(share.materialId!==materialId||share.approvalAt!==approval.at)continue;
  if(share.status==='prepared'&&state?.status==='confirmed')continue;
  state=share;
 }
 return state;
}
