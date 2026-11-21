/* Completion feedback is derived from saved server state, never unsaved ticks. */
const milestoneSteps=['Start','Learn','Test','Finish','Handover'];
function completedMilestones(before,after){
 if(!before||!after||before.id!==after.id||before.stage!==after.stage)return [];
 return milestoneSteps.filter(step=>!before.journey?.[step]?.complete&&after.journey?.[step]?.complete);
}
let pendingMilestone=null;
function queueMilestone(before,after){
 const steps=completedMilestones(before,after);if(!steps.length)return;
 pendingMilestone={id:after.id,phase:after.stage,name:after.name,steps};
 showMilestone();
}
function showMilestone(){
 if(!pendingMilestone||document.getElementById('modal')?.open)return;
 const event=pendingMilestone;pendingMilestone=null;
 const t=S?.trainees.find(t=>t.id===event.id);if(!t||t.stage!==event.phase)return;
 const next=milestoneSteps.find(step=>!t.journey?.[step]?.complete&&!t.journey?.[step]?.blockedBy);
 const dialog=document.getElementById('milestoneDialog');
 document.getElementById('milestoneTitle').textContent=event.steps.join(' & ')+' completed';
 document.getElementById('milestoneDetail').textContent=event.name+' · '+trainingPhaseLabel(event.phase);
 document.getElementById('milestoneMessage').textContent=next?'Your progress is saved. One more milestone behind you, a new one ahead.':'Your progress is saved. Every step in this journey is now complete.';
 const progress=document.getElementById('milestoneProgress');progress.innerHTML=milestoneSteps.map(step=>`<span class="${t.journey?.[step]?.complete?'complete':''}">${t.journey?.[step]?.complete?'✓ ':''}${step}</span>`).join('');
 const button=document.getElementById('milestoneNext');button.textContent=next?'Continue to '+next:'View progress';
 button.onclick=()=>{dialog.close();const latest=S?.trainees.find(t=>t.id===event.id);if(!latest||latest.stage!==event.phase)return;selected=event.id;view='trainees';const sections={Start:'Welcome letter',Learn:'Modules & handbooks',Test:'Assessment',Finish:'Certificate',Handover:'Handover'};section=next&&!latest.journey[next].blockedBy?sections[next]:'Progress report';render();};
 dialog.showModal();
}
document.getElementById('modal').addEventListener('close',()=>showMilestone());
document.getElementById('milestoneClose').onclick=()=>document.getElementById('milestoneDialog').close();
