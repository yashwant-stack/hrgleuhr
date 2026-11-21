const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function trainingEmail({title,body,url,action='Open training portal',recipientName=''}){
 const target=new URL(url);if(!['https:','http:'].includes(target.protocol))throw Error('Invalid portal URL');
 const blocks=String(body).split(/\n\s*\n/).filter(x=>x.trim()&&!/\nNo previous records\.$/.test(x)&&!x.startsWith('Portal:'));
 return `<!doctype html><html><body style="margin:0;background:#f7f2ef;color:#49373b;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="640" style="width:100%;max-width:640px;background:#fff;border:1px solid #eadcd5;border-radius:18px" cellspacing="0" cellpadding="0"><tr><td style="padding:28px;background:#51363f;color:#fff;border-radius:18px 18px 0 0"><div style="letter-spacing:5px;color:#efc8bb;font-size:24px">GLEUHR</div><p style="font-size:11px;letter-spacing:3px">PEOPLE &amp; DEVELOPMENT</p><h1 style="font-size:26px;line-height:1.3;margin-bottom:0">${esc(title)}</h1></td></tr><tr><td style="padding:24px">${recipientName?`<p style="margin:0 0 18px;font-size:16px">Dear ${esc(recipientName)},</p>`:''}<p style="margin:0 0 24px"><a href="${esc(target.href)}" style="display:inline-block;background:#aa655f;color:white;padding:14px 22px;border-radius:9px;text-decoration:none;font-weight:bold">${esc(action)} →</a></p>${blocks.map(block=>{const lines=block.split('\n');return `<div style="padding:16px 18px;margin:0 0 14px;background:#fcf8f5;border:1px solid #f0e5df;border-radius:10px;font-size:14px;line-height:1.7"><strong style="color:#8c514e">${esc(lines[0])}</strong>${lines.length>1?'<div style="white-space:pre-line;margin-top:8px">'+esc(lines.slice(1).join('\n'))+'</div>':''}</div>`;}).join('')}<p style="font-size:12px;color:#8d7b79;margin:24px 0 0">Gleuhr HR Portal · People. Progress. Possibility.</p></td></tr></table></td></tr></table></body></html>`;
}

export function acknowledgementEmail({title,details,name,url}){
 const notice='This personal link expires in 7 days. Do not forward it.';
 return {
  body:`Dear ${name},\n\nReview & acknowledge:\n${url}\n\n${notice}\n\n${details}`,
  html:trainingEmail({title,body:details+'\n\n'+notice,url,action:'Review & acknowledge',recipientName:name})
 };
}
