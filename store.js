import fs from "node:fs";
import path from "node:path";
import {
  randomUUID,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
export const id = () => randomUUID(),
  now = () => new Date().toISOString();
export function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password, hash) {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(
    Buffer.from(key, "hex"),
    scryptSync(password, salt, 64),
  );
}
export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "database.json");
  let state = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {
        schema: 1,
        users: [],
        trainees: [],
        records: [],
        outbox: [],
        audit: [],
        customQuestions: [],
        resources: [],
        customDesignations: {},
        createdAt: now(),
      };
  function save() {
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  if (!fs.existsSync(file)) save();
  return {
    get data() {
      return state;
    },
    transaction(fn) {
      const before = structuredClone(state);
      try {
        const result = fn(state);
        save();
        return result;
      } catch (e) {
        state = before;
        throw e;
      }
    },
    async putMaterial(id, bytes) {
      const folder=path.join(dir,'uploads');fs.mkdirSync(folder,{recursive:true,mode:0o700});
      fs.writeFileSync(path.join(folder,id),bytes,{mode:0o600,flag:'wx'});
    },
    async getMaterial(id) {
      if(!/^upload-[a-f0-9-]+$/.test(id))throw Error('Invalid upload id');
      return fs.readFileSync(path.join(dir,'uploads',id));
    },
    async deleteMaterial(id) {
      if(!/^upload-[a-f0-9-]+$/.test(id))throw Error('Invalid upload id');
      fs.rmSync(path.join(dir,'uploads',id),{force:true});
    },
    file,
  };
}
