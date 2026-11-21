const addresses=value=>[...new Set(String(value||'').split(/[,;\n]/).map(x=>x.trim().toLowerCase()).filter(Boolean))];
export const managementMilestone=kind=>kind==='welcome'||kind==='certificate'||String(kind).startsWith('certificate:')||String(kind).startsWith('handover:');
export function managementCc(settings,kind,to,cc=''){
 const primary=new Set(addresses(to));return [...new Set([...addresses(cc),...(managementMilestone(kind)?addresses(settings?.managementEmails):[])])].filter(x=>!primary.has(x)).join(', ');
}
export function managementRecipients(settings,kind,to,cc=''){
 const excluded=new Set(managementMilestone(kind)?[]:addresses(settings?.managementEmails));
 const primary=addresses(to).filter(x=>!excluded.has(x));return {to:primary.join(', '),cc:addresses(cc).filter(x=>!excluded.has(x)&&!primary.includes(x)).join(', ')};
}
