import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../store.js";
import {
  defaults,
  original,
  syncTrainee,
  initializeWorkflow,
  summary,
  localDate,
  dayNumber,
} from "../training-workflow.js";
import { workflowService } from "../workflow-service.js";
const source = fs.readFileSync(
  new URL("../reference/Code_v8_5.gs", import.meta.url),
  "utf8",
);
const context = vm.createContext({});
vm.runInContext(source, context);
const custom = {
  "HR Manager": "Regional Head",
  "Custom Reception": "Receptionist",
};
context.localRoles = defaults.Lists.map((x) => x.Designation)
  .filter(Boolean)
  .concat("Custom Reception");
context.customRoles = custom;
vm.runInContext(
  "designationList=()=>localRoles;customBaseMap_=()=>Object.fromEntries(Object.entries(customRoles).map(([k,v])=>[k.toLowerCase(),v.toLowerCase()]));scoreRule=()=>null;ratingRule=()=>null;",
  context,
);
class Sheet {
  constructor(rows = []) {
    this.rows = rows;
  }
  getLastRow() {
    return this.rows.length;
  }
  getRange(start, col, count = 1, width = 1) {
    const sheet = this;
    return {
      getValues() {
        return Array.from({ length: count }, (_, i) =>
          Array.from(
            { length: width },
            (_, j) => sheet.rows[start - 1 + i]?.[col - 1 + j] ?? "",
          ),
        );
      },
      setValues(rows) {
        rows.forEach((r, i) => {
          sheet.rows[start - 1 + i] ??= [];
          r.forEach((v, j) => (sheet.rows[start - 1 + i][col - 1 + j] = v));
        });
        return this;
      },
      insertCheckboxes() {
        return this;
      },
      setDataValidation() {
        return this;
      },
      setFormulas() {
        return this;
      },
    };
  }
}
const cl = new Sheet([
  ["Module", "Topic", "Phase", "Designation", "Type"],
  ...defaults.Checklist_Template.map((r) => [
    r.Module,
    r.Topic,
    r.Phase,
    r.Designation,
    r.Type,
  ]),
]);
const qb = new Sheet([
  ["Department", "Question", "Key Points", "Designation"],
  ...defaults.Question_Bank.map((r) => [
    r.Department,
    r.Question,
    r["Key Points (for assessor)"],
    r.Designation,
  ]),
]);
const sc = new Sheet([
  ["Category", "Criterion", "Phase", "Designation"],
  ...defaults.Scoring_Template.map((r) => [
    r.Category,
    r.Criterion,
    r.Phase,
    r.Designation,
  ]),
]);
for (const designation of [
  "Regional Head",
  "Branch Manager",
  "Counsellor",
  "Receptionist",
  "Therapist",
  "Doctor",
  "Accounts",
  "HR Manager",
  "Custom Reception",
]) {
  test("Legacy Apps Script generation parity outside relocated brand foundations: " + designation, () => {
    const db = {
      trainingTemplates: structuredClone(defaults),
      customDesignations: custom,
    };
    const t = {
      name: "Person",
      curriculumVersion: 'legacy-parity',
      curriculumLegacyPhases: original.STAGES.map(p=>p==='Onboarding'?'Induction':p),
      designation,
      stage: "Induction",
      handovers: [],
      checklist: [],
      scores: [],
      assessments: [],
    };
    let targetCL = new Sheet([["Trainee"]]),
      targetSC = new Sheet([["Trainee"]]),
      targetASM = new Sheet([["Trainee"]]);
    context.sheetMap = { Assessment: targetASM, Question_Bank: qb };
    vm.runInContext("SS=()=>({getSheetByName:n=>sheetMap[n]});", context);
    for (const stage of original.STAGES) {
      t.stage = stage;
      t.handovers.push({ stage });
      syncTrainee(t, db);
      const phases = new Set([
        "Induction",
        "Onboarding",
        ...t.handovers.map((h) => h.stage),
      ]);
      context.addMissing(
        targetCL,
        cl,
        "Person",
        true,
        phases,
        designation,
        new Set(),
      );
      context.addMissing(
        targetSC,
        sc,
        "Person",
        false,
        phases,
        designation,
        new Set(),
      );
      context.addMissingAssessment("Person", phases, designation);
      // Brand foundations now belong to designation training, not HR Induction.
      // The placement and saved-row migration are verified in designation-curricula.test.js.
      const foundations=new Set(['Induction|Company introduction & history','Induction|Vision, mission & core values','Induction|Clinics network & skincare product line overview']);
      assert.deepEqual(
        t.checklist.map((r) => r.module + "|" + r.topic).filter(key=>!foundations.has(key)).sort(),
        targetCL.rows
          .slice(1)
          .map((r) => r[1] + "|" + r[2])
          .filter(key=>!foundations.has(key))
          .sort(),
        stage + " checklist",
      );
      assert.deepEqual(
        t.scores.map((r) => r.category + "|" + r.criterion).sort(),
        targetSC.rows
          .slice(1)
          .map((r) => r[1] + "|" + r[2])
          .sort(),
        stage + " scores",
      );
      assert.deepEqual(
        t.assessments.filter(r=>!/^In your own words, explain the vision, mission|^Describe Gleuhr: its clinics network/.test(r.question)).map((r) => r.department + "|" + r.question).sort(),
        targetASM.rows
          .slice(1)
          .filter(r=>!/^In your own words, explain the vision, mission|^Describe Gleuhr: its clinics network/.test(r[2]))
          .map((r) => r[1] + "|" + r[2])
          .sort(),
        stage + " assessment",
      );
    }
  });
}
test("India day boundary and training day convention", () => {
  assert.equal(localDate("2026-10-28T19:00:00Z"), "2026-10-29");
  assert.equal(dayNumber("2026-10-28T19:00:00Z", "2026-10-28"), 2);
  assert.equal(
    summary({
      joiningDate: "2026-10-20",
      status: "On Hold",
      closedAt: null,
      checklist: [],
      scores: [],
      assessments: [],
    }).trainingDays,
    null,
  );
});
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gleuhr-parity-"));
const store = openStore(dir);
const user = {
  id: "a",
  name: "HR",
  email: "admin@example.com",
  role: "admin",
  active: true,
};
const t = {
  id: "t",
  name: "Person",
  email: "trainee@example.com",
  designation: "Branch Manager",
  branch: "Clinic",
  joiningDate: "2026-10-01",
  stage: "Induction",
  ownerId: "a",
  status: "Active",
  closedAt: null,
  version: 1,
  handovers: [],
  checklist: [],
  scores: [],
  assessments: [],
  feedback: null,
  completedModules: [],
};
store.transaction((db) => {
  db.users.push(user);
  db.trainees.push(t);
  initializeWorkflow(db);
});
const sent = [];
let shouldFail = false;
const mailer = {
  configured: true,
  from: "sender@example.com",
  send: async (m) => {
    if (shouldFail) throw Error("Simulated SMTP failure");
    sent.push(structuredClone(m));
    return { messageId: m.id };
  },
  verify: async () => true,
};
const service = workflowService({
  store,
  mailer,
  audit: (db, u, action, traineeId) => db.audit.push({ action, traineeId }),
  trainee: (u, p) => {
    const t = store.data.trainees.find((t) => t.id === p.traineeId);
    if (!t) throw Error("Trainee not found");
    return t;
  },
});
const run = (a, p = {}) => service.run(user, a, { traineeId: "t", note:"Reviewed training summary", ...p });
const current = () => store.data.trainees[0];
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
test("Draft final feedback creates blank row immediately", async () => {
  await run("draftHandover", { stage: "Final Feedback", ownerId: "a" });
  assert.equal(current().stage, "Induction");
  assert.equal(current().feedbackRows.length, 1);
  assert.equal(current().feedbackRequested, true);
  assert.equal(sent.length, 0);
});
test("Latest filled feedback ignores trailing blank rows", async () => {
  await run("feedback", { comments: "First filled", rating: "Good" });
  await run("feedback", {});
  assert.equal(summary(current()).feedback.comments, "First filled");
  await run("feedback", {
    comments: "Latest filled",
    recommendation: "Extend Training",
  });
  assert.equal(summary(current()).feedback.comments, "Latest filled");
});
async function transfer(stage){const d=await run("draftHandover",{stage,ownerId:"a"});await run("activateHandover",d);}
test("Phase transfer works without automatic communication", async()=>{
 await transfer("Sales Training");assert.equal(current().stage,"Sales Training");assert.equal(current().handovers.at(-1).status,"Pending");assert.equal(sent.length,0);
 await transfer("Operations Training");assert.equal(current().handovers.at(-2).status,"Completed");assert.equal(sent.length,0);
});
test("Legacy handover email is denied without mutation",async()=>{
 const before=JSON.stringify(current());await assert.rejects(run("handover",{stage:"Operations Training",ownerId:"a"}),/approval/);assert.equal(JSON.stringify(current()),before);assert.equal(sent.length,0);
});
test("Manual final review completion keeps final email and asset allotment pending",async()=>{
 await transfer("Final Review & Confirmation");await run("handoverStatus",{handoverId:current().handovers.at(-1).id,status:"Completed"});assert.equal(current().status,"Active");assert.ok(!current().closedAt);assert.equal(sent.length,0);
});
test("Any non-completed status clears closure and pauses day count", async () => {
  await run("editTrainee", {
    name: "Person",
    branch: "Clinic",
    email: "trainee@example.com",
    status: "On Hold",
  });
  assert.equal(current().closedAt, null);
  assert.equal(summary(current()).trainingDays, null);
  await run("editTrainee", {
    name: "Person",
    branch: "Clinic",
    email: "trainee@example.com",
    status: "Active",
  });
  assert.ok(Number.isFinite(summary(current()).trainingDays));
});
test("Legacy final email and scheduler cannot send without approval",async()=>{
 const before=JSON.stringify(current());await assert.rejects(run("handover",{stage:"Onboard Final Email",email:"recipient@example.com",ownerName:"Team"}));assert.equal(JSON.stringify(current()),before);
 await assert.rejects(run("sendHandover",{handoverId:current().handovers.at(-1).id}));
 for(const at of ["2026-11-02T03:29:00Z","2026-11-02T03:30:00Z","2026-11-02T10:00:00Z"])await service.tick(new Date(at));
 assert.equal(sent.length,0);assert.equal((await run("reminders")).disabled,true);
});
test("Blank unknown-module phase is created for every trainee on sync", async () => {
  await run("saveTemplateRow", {
    table: "Checklist_Template",
    index: null,
    values: {
      Module: "Custom module",
      Topic: "Always required",
      Phase: "",
      Designation: "All",
      Type: "Theory",
    },
  });
  await run("sync");
  assert.ok(current().checklist.some((r) => r.topic === "Always required"));
  const count = current().checklist.length;
  await run("sync");
  assert.equal(current().checklist.length, count);
});
test("Designation change adds matching rows without losing existing work", async () => {
  await transfer("CRM & Tech Training");
  const count = current().checklist.length;
  await run("editTrainee", {
    name: "Person",
    branch: "Clinic",
    designation: "Therapist",

  });
  assert.ok(
    current().checklist.some((r) => r.module.startsWith("CRM Therapist")),
  );
  assert.ok(current().checklist.length > count);
});
test("Trainee deletion cascades and stale selection cannot return data", async () => {
  store.transaction((db) =>
    db.records.push({ id: "r", traineeId: "t", kind: "test" }),
  );
  await assert.rejects(run("deleteTrainee", { confirmName: "wrong" }));
  await run("deleteTrainee", { confirmName: "Person" });
  assert.equal(store.data.trainees.length, 0);
  assert.equal(store.data.records.length, 0);
  assert.equal(store.data.outbox.length, 0);
});

