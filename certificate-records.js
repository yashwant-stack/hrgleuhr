// Completed-phase certificates remain shareable after the trainee moves on.
// Removed certificates stay excluded until explicitly restored.
export function issuedCertificates(t){
 const removed=new Set((t.archivedEntries||[]).filter(r=>r.kind==='certificate').map(r=>r.entry?.id));
 const seen=new Set();
 return [t.certificate,...(t.phaseHistory||[]).slice().reverse().map(h=>h.certificate)]
  .filter(c=>{if(!c?.id||removed.has(c.id)||seen.has(c.id))return false;seen.add(c.id);return true;});
}
export function issuedCertificate(t,id=t.certificate?.id){
 return id?issuedCertificates(t).find(c=>c.id===id):undefined;
}
