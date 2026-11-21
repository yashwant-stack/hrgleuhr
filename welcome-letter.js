import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const profile=letter=>[['TEAM MEMBER',letter.name],['DESIGNATION',letter.designation],['CLINIC',letter.clinic],['DEPARTMENT',letter.department]].filter(([,value])=>value);

// The exact reviewed letter text is used in both the email and PDF.
export function welcomeEmail(letter){
 const paragraphs=String(letter.body||'').split(/\n\s*\n/).filter(p=>p.trim());
 return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f1ee;font-family:Arial,sans-serif;color:#44343d"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#fff;border:1px solid #e7d9d2;border-radius:16px"><tr><td style="padding:30px 32px;background:#49333f;border-radius:16px 16px 0 0"><div style="font-family:Georgia,serif;font-size:32px;letter-spacing:3px;color:#f4d8cb">GLEUHR</div><p style="margin:14px 0 0;color:#e7c8bb;font-size:11px;letter-spacing:2px">PEOPLE &amp; CULTURE</p><h1 style="font-size:25px;line-height:1.35;font-weight:normal;margin:18px 0 0;color:#fff">${esc(letter.subject)}</h1></td></tr><tr><td style="padding:26px 32px 0"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fbf5f1;border-left:3px solid #b67c6c">${profile(letter).map(([label,value])=>`<tr><td style="padding:8px 14px;font-size:10px;letter-spacing:1px;color:#8c6963;width:32%">${label}</td><td style="padding:8px 14px;font-size:13px;line-height:1.5;color:#49333f;overflow-wrap:anywhere">${esc(value)}</td></tr>`).join('')}</table></td></tr><tr><td style="padding:24px 32px 30px">${paragraphs.map(p=>`<p style="font-size:15px;line-height:1.8;margin:0 0 18px;overflow-wrap:anywhere">${esc(p).replace(/\n/g,'<br>')}</p>`).join('')}</td></tr><tr><td style="border-top:1px solid #ede2dc;padding:20px 32px;color:#92766f;font-size:11px;line-height:1.7">GLEUHR · PEOPLE &amp; CULTURE<br>Care. Learning. Growth.</td></tr></table></td></tr></table>`;
}

export function welcomePdf(letter){
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margins:{top:48,bottom:50,left:50,right:50},bufferPages:true,info:{Title:letter.subject,Author:'Gleuhr HR'}}),chunks=[];
  doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  doc.registerFont('Body',fileURLToPath(new URL('./public/fonts/manrope-regular.ttf',import.meta.url)));
  doc.registerFont('Heading',fileURLToPath(new URL('./public/fonts/manrope-semibold.ttf',import.meta.url)));
  const header=()=>{
   doc.rect(0,0,doc.page.width,9).fill('#a96f64');
   doc.font('Heading').fontSize(27).fillColor('#49333f').text('GLEUHR',50,39,{characterSpacing:3});
   doc.font('Body').fontSize(8).fillColor('#987269').text('PEOPLE & CULTURE',51,80,{characterSpacing:2});
   doc.moveTo(50,108).lineTo(545,108).strokeColor('#e7d7cf').stroke();doc.x=50;doc.y=130;doc.font('Body').fontSize(10.5).fillColor('#44343d');
  };
  doc.on('pageAdded',header);header();
  doc.font('Heading').fontSize(20).fillColor('#49333f').text(letter.subject,{lineGap:3});doc.moveDown(.8);
  const rows=profile(letter),cardY=doc.y;
  doc.font('Body').fontSize(9);
  const rowHeights=rows.map(([,value])=>Math.max(24,doc.heightOfString(String(value),{width:340})+12));
  const cardHeight=rowHeights.reduce((a,b)=>a+b,16);
  doc.roundedRect(50,cardY,495,cardHeight,7).fill('#fbf3ed');
  let y=cardY+8;
  rows.forEach(([label,value],index)=>{
   doc.font('Heading').fontSize(7.5).fillColor('#946b62').text(label,64,y+5,{width:112});
   doc.font('Body').fontSize(9).fillColor('#49333f').text(String(value),180,y+4,{width:348});y+=rowHeights[index];
  });
  doc.x=50;doc.y=cardY+cardHeight+24;
  doc.font('Body').fontSize(10.5).fillColor('#44343d').text(String(letter.body||''),{width:495,lineGap:2,paragraphGap:0});
  const range=doc.bufferedPageRange();
  for(let page=0;page<range.count;page++){
   doc.switchToPage(page);const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
   doc.moveTo(50,790).lineTo(545,790).strokeColor('#e7d7cf').stroke();
   doc.font('Body').fontSize(8).fillColor('#987269').text('GLEUHR  |  Care. Learning. Growth.',50,803,{lineBreak:false});
   doc.text(`${page+1} / ${range.count}`,495,803,{width:50,align:'right',lineBreak:false});doc.page.margins.bottom=bottom;
  }
  doc.end();
 });
}
