import {escalateOverdueTickets} from '../ticket-mail.js';
import { createApp } from '../server.js';
import { createMailer } from '../mailer.js';
import { withCloudStore } from '../cloud-store.js';
import { timingSafeEqual } from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {queuedMailer,drainMailQueue} from '../mail-queue.js';

function secretMatches(value, expected) {
  if (!value || !expected) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export default async function handler(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const cron = ['/api/cron/reminders','/api/cron/mail'].includes(pathname);
  if (cron && (req.method !== 'GET' || !secretMatches(req.headers.authorization, process.env.CRON_SECRET && `Bearer ${process.env.CRON_SECRET}`))) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }
  const mailer=createMailer();
  try {
    if(pathname==='/api/cron/mail'){
      await withCloudStore(store=>escalateOverdueTickets({store,mailer:queuedMailer(store,mailer)}));
      const result=await drainMailQueue({withStore:withCloudStore,mailer});
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
      return res.end(JSON.stringify(result));
    }
    let queued=false;
    const output = await withCloudStore(async (store, runtime) => {
      const app = createApp({ store, runtime, scheduler: false, hosted: true, mailer:queuedMailer(store,mailer) });
      if (cron) {
        return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, disabled: true }) };
      }
      // Hold the response until its database writes have committed successfully.
      const response = { status: 200, headers: {}, body: '',
        setHeader(k, v) { this.headers[k] = v; },
        writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
        end(body) { this.body = body; },
      };
      await app.handler(req, response);
      queued=(store.data.emailJobs||[]).some(j=>j.status==='Queued');
      return response;
    });
    res.writeHead(output.status, { 'Cache-Control': 'no-store', ...output.headers });
    res.end(output.body);
    if(queued)waitUntil(drainMailQueue({withStore:withCloudStore,mailer}).catch(error=>console.error('Email worker failed',{code:error.code||'worker_error'})));
  } catch (error) {
    console.error('Cloud request failed', { code: error.code || 'database_unavailable' });
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '10' });
    res.end(JSON.stringify({ error: 'The database is temporarily unavailable. Please retry shortly.' }));
  }
}
