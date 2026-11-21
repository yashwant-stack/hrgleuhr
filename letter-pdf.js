import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
export function letterPdf({subject,body,name,designation,clinic,department,unicode=false}){
 return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margins:{top:55,bottom:55,left:55,right:55},info:{Title:subject,Author:'Gleuhr HR'}}),chunks=[];
 doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 if(unicode)doc.font(fileURLToPath(new URL('./public/fonts/manrope-regular.ttf',import.meta.url)));
 doc.fillColor('#a65e59').fontSize(27).text('GLEUHR');doc.fontSize(10).fillColor('#76615d').text('HR PORTAL | PEOPLE & TRAINING');doc.moveDown();
 doc.moveTo(55,112).lineTo(540,112).strokeColor('#e4ccc7').stroke();doc.y=135;
 doc.fillColor('#45332f').fontSize(18).text(subject);doc.moveDown(.6);
 doc.fontSize(10).fillColor('#76615d').text([name,designation,clinic,department].filter(Boolean).join(' | '));doc.moveDown();
 doc.fontSize(11).fillColor('#302b29').text(body,{lineGap:4,paragraphGap:8});doc.end();});
}
