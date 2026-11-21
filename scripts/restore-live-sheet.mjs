import fs from 'node:fs';
import path from 'node:path';
import { withCloudStore } from '../cloud-store.js';
import { openStore } from '../store.js';
import { restoreSheet } from '../sheet-import.js';
const [sourcePath, destination, backupDir] = process.argv.slice(2);
if (!sourcePath || !destination || !backupDir) throw Error('Usage: source.json cloud|local-data-directory private-backup-directory');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
fs.mkdirSync(backupDir, { recursive:true, mode:0o700 });
const restore = async store => {
  // Validate on a clone before touching the live state; preserve all existing accounts and Academy records.
  const preview = restoreSheet(structuredClone(store.data), source);
  if (preview.alreadyImported) { console.log('This snapshot is already restored. No records changed.'); return; }
  const file=path.join(backupDir,`before-sheet-restore-${Date.now()}.json`);
  fs.writeFileSync(file,JSON.stringify(store.data),{mode:0o600,flag:'wx'});
  const result=store.transaction(db=>restoreSheet(db,source));
  if(store.flush)await store.flush();
  fs.writeFileSync(path.join(backupDir,'restore-report.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({restored:result.report,archived:result.archivedCounts},null,2));
};
if(destination==='cloud')await withCloudStore(restore);else await restore(openStore(destination));
