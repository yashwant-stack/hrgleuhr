// Adds the non-secret Production settings to the linked Vercel project.
// Usage (PowerShell): $env:APP_URL='https://your-final-domain'; node scripts/configure-vercel.mjs --scope gleuhr
// Add DATABASE_URL_UNPOOLED and SMTP_PASS yourself in the Vercel dashboard (never in source control).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const scopeIndex=process.argv.indexOf('--scope');
const scope=scopeIndex>0?process.argv[scopeIndex+1]:'gleuhr';
if(!process.env.APP_URL)throw Error('Set APP_URL to the final portal domain first, e.g. https://hr.gleuhr.com');
const config={ APP_URL:process.env.APP_URL.replace(/\/+$/,''), TRAINING_TIMEZONE:'Asia/Kolkata', SMTP_HOST:'smtp.gmail.com', SMTP_PORT:'587', SMTP_USER:'mizraem@gleuhr.com', SMTP_FROM:'mizraem@gleuhr.com', CRON_SECRET:randomBytes(32).toString('hex') };
for (const [name,value] of Object.entries(config)) {
  execFileSync('vercel',['env','add',name,'production','--scope',scope],{input:value,stdio:['pipe','pipe','pipe']});
  console.log('Configured', name);
}
