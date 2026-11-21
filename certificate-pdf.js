import PDFDocument from 'pdfkit';
export function certificatePdf({subject,name,designation,clinic,department,certificate={}}){
 return new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',layout:'landscape',margin:0,info:{Title:subject,Author:'Gleuhr HR'}}),chunks=[];
 doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 const w=doc.page.width,h=doc.page.height;
 doc.rect(0,0,w,h).fill('#fbf7f2');doc.rect(0,0,20,h).fill('#51363f');doc.rect(20,0,6,h).fill('#b9786d');
 doc.rect(40,30,w-70,h-60).lineWidth(.8).strokeColor('#cba888').stroke();doc.rect(47,37,w-84,h-74).lineWidth(.4).strokeColor('#e5d5c3').stroke();
 const text=(s,y,size=12,color='#51363f',font='Helvetica',width=w-140,x=80)=>doc.font(font).fontSize(size).fillColor(color).text(String(s||''),x,y,{width,align:'center',lineBreak:true});
 text('G L E U H R',65,23,'#a65e59');text('PEOPLE & DEVELOPMENT',99,9,'#8e7972');
 text('CERTIFICATE OF TRAINING',140,28,'#51363f','Times-Roman');text('Presented in recognition of completing the training phase',184,11,'#8e7972');
 text(name,215,String(name).length>40?25:35,'#a65e59','Times-Italic');text([designation,clinic,department].filter(Boolean).join('  |  '),261,11,'#75655f');
 text(certificate.phase||'Training programme',298,18,'#51363f','Helvetica-Bold');
 doc.roundedRect(225,340,390,58,8).fill('#f0e5dc');
 text('ASSESSMENT SCORE',351,8,'#8e7972', 'Helvetica',180,230);text(certificate.score==null?'Not assessed':Number(certificate.score).toFixed(1)+' / 10',366,17,'#51363f','Helvetica-Bold',180,230);
 text('NEXT TRAINING',351,8,'#8e7972','Helvetica',195,415);text(certificate.nextTraining||'Training complete',369,11,'#51363f','Helvetica',195,415);
 const date=certificate.at&&Number.isFinite(Date.parse(certificate.at))?new Date(certificate.at).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Kolkata'}):'—';
 text(certificate.by||'HR Team',448,12,'#51363f','Helvetica-Bold',280,85);text('ISSUED BY',472,8,'#8e7972','Helvetica',280,85);
 text(date,448,12,'#51363f','Helvetica-Bold',280,465);text('DATE OF ISSUE',472,8,'#8e7972','Helvetica',280,465);
 text('Certificate ID: '+(certificate.id||'Recorded in HR portal'),521,8,'#8e7972');
 doc.end();
 });
}
