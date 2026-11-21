import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const config={ APP_URL:'https://hrgleuhr.vercel.app', TRAINING_TIMEZONE:'Asia/Kolkata', SMTP_HOST:'smtp.gmail.com', SMTP_PORT:'587', SMTP_USER:'rahul.verma@gleuhr.com', SMTP_FROM:'rahul.verma@gleuhr.com', CRON_SECRET:randomBytes(32).toString('hex') };
for (const [name,value] of Object.entries(config)) {
  execFileSync('vercel',['env','add',name,'production','--type',name==='CRON_SECRET'?'secret':'config','--scope','rahul-43f8'],{input:value,stdio:['pipe','pipe','pipe']});
  console.log('Configured', name);
}
