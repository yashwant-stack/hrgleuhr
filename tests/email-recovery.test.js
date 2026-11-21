import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createApp} from '../server.js';
test('interrupted Sending records become reviewable without automatically resending',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mail-recovery-'));let sent=0;const options={dataDir:dir,scheduler:false,mailer:{configured:true,send:async()=>{sent++;}}};
 try{const app=createApp(options);app.store.transaction(db=>db.outbox.push({id:'interrupted',status:'Sending'}));const restarted=createApp(options);assert.equal(restarted.store.data.outbox[0].status,'Delivery uncertain');assert.match(restarted.store.data.outbox[0].error,/interrupted/);assert.equal(sent,0);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
