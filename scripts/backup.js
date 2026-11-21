import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "data", "database.json");
if (!fs.existsSync(source)) {
  console.log(
    "No database yet. Start the app and create your workspace first.",
  );
  process.exit(0);
}
const dir = path.join(root, "backups");
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const target = path.join(
  dir,
  `gleuhr-${new Date().toISOString().replaceAll(":", "-")}.json`,
);
const data = fs.readFileSync(source);
JSON.parse(data);
fs.writeFileSync(target, data, { mode: 0o600 });
const uploads=path.join(root,'data','uploads');
if(fs.existsSync(uploads))fs.cpSync(uploads,target+'.uploads',{recursive:true});
console.log(`Backup saved: ${target} (with uploads when present)`);
