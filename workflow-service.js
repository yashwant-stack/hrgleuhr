import {mailJobActive} from './mail-queue.js';
import {handoverNote,SUMMARY_MARKER} from './handover-summary.js';
import {samePhase,canonicalPhase} from './training-phases.js';
import {switchTrainingPhase} from './phase-training.js';
import { normalizePhone } from "./training-materials.js";
import { id, now } from "./store.js";
import {
  original,
  model,
  listValues,
  initializeWorkflow,
  syncTrainee,
  summary,
  localDate,
  closeTraining,
  ratingMap,
  zone,
} from "./training-workflow.js";
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const text = (x, max = 6000) =>
  String(x ?? "")
    .trim()
    .slice(0, max);
const mail = (x) => {
  const v = text(x, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    fail("Valid next owner email is required");
  return v;
};
export function workflowService({ store, mailer, audit, trainee }) {
  const locks = new Set();
  store.transaction((db) => {
    initializeWorkflow(db);
    for (const r of db.outbox)
      if (r.status === "Sending" && !mailJobActive(db,r.id)) r.status = "Delivery uncertain";
  });
  const ensureAdmin = (u) => {
    if (u.role !== "admin") fail("HR/admin access required", 403);
  };
  const fresh = (u, p) => {
    const t = trainee(u, p);
    if (p.version !== undefined && p.version !== t.version)
      fail("This record changed. Refresh and try again.", 409);
    return t;
  };
  function snapshot() {
    return {
      stages: listValues(store.data, "Stages"),
      designations: [
        ...new Set([
          ...listValues(store.data, "Designation"),
          "Front Desk Manager",
          ...Object.keys(store.data.customDesignations),
        ]),
      ],
      ratings: ratingMap(store.data),
      email: {
        configured: mailer.configured,
        from: mailer.from,
        reminderHour: 9,
        timezone: zone,
        automatic: false,
        lastRun: store.data.scheduler.lastRun,
        lastError: store.data.scheduler.lastError,
      },
      trainingTemplateCounts: Object.fromEntries(
        Object.entries(model(store.data)).map(([k, v]) => [k, v.length]),
      ),
    };
  }
  const handles = new Set([
    "handover",
    "draftHandover",
    "sendHandover",
    "activateHandover",
    "handoverStatus",
    "deleteHandover",
    "reminders",
    "emailVerify",
    "retryEmail",
    "templates",
    "saveTemplateRow",
    "deleteTemplateRow",
    "sync",
    "setupCheck",
    "deleteTrainee",
    "deleteTrainees",
    "feedback",
    "removedItems",
    "editTrainee",
  ]);
  function saveDraft(u, p) {
    return store.transaction((db) => {
      const t = fresh(u, p);
      let h = p.handoverId
        ? t.handovers.find((h) => h.id === p.handoverId)
        : null;
      if (p.handoverId && !h) fail("Handover not found");
      if (h && h.status !== "Draft") fail("Only draft handovers can be edited");
      p={...p,stage:canonicalPhase(p.stage)};
      if (!listValues(db, "Stages").includes(p.stage)) fail("Choose next step");
      if(["Induction","Onboarding"].includes(t.stage)&&samePhase(t.stage,p.stage))fail("Induction and Onboarding are one phase. Choose the next phase.");
      if (p.stage === "Onboard Final Email") ensureAdmin(u);
      const owner = p.ownerId
        ? db.users.find((u) => u.id === p.ownerId && u.active)
        : null;
      const address = mail(p.email || owner?.email);
      const linked =
        owner || db.users.find((u) => u.email === address && u.active);
      if(!text(p.ownerName||linked?.name))fail("Next owner name is required");
      if(!text(p.note))fail("Handover summary is required");
      const values = {
        stage: p.stage,
        ownerId: linked?.id || null,
        ownerName: text(p.ownerName || linked?.name, 200),
        email: address,
        manualNote: text(p.note.split(SUMMARY_MARKER)[0]),
        note: handoverNote(t,db,text(p.note.split(SUMMARY_MARKER)[0])),
        status: "Draft",
        by: u.email,
      };
      if (h) Object.assign(h, values);
      else {
        h = { id: id(), ...values, createdAt: now(), at: null };
        t.handovers.push(h);
      }
      if (["Final Feedback", "Final Review & Confirmation"].includes(h.stage)) {
        t.feedbackRequested = true;
        if (!t.feedbackRows.length)
          t.feedbackRows.push({
            id: id(),
            rating: "",
            recommendation: "",
            strengths: "",
            improve: "",
            comments: "",
            by: "",
            at: null,
          });
      }
      t.version++;
      audit(db, u, "Handover draft saved", t.id);
      return { handoverId: h.id, traineeId: t.id };
    });
  }
  async function sendHandover() {
    fail("Use the trainee Welcome letter or Final onboarding approval workflow. Legacy email sending is disabled.",403);
  }
  async function reminders() { return {count:0,failed:0,disabled:true}; }
  async function tick() { return {disabled:true}; }
  function startScheduler() {} // Communications are always explicitly reviewed and sent.
  function stopScheduler() {}
  async function run(u, name, p) {
    if(name === "handover")fail("Use draft handover and activate to transfer training. Emails require separate HR approval.",403);
    if (name === "emailVerify") {
      ensureAdmin(u);
      try {
        await mailer.verify();
        return { ok: true };
      } catch (e) {
        fail(text(e.message, 1000), 502);
      }
    }
    if (name === "templates") {
      ensureAdmin(u);
      return structuredClone(model(store.data));
    }
    if (name === "setupCheck") {
      ensureAdmin(u);
      return {
        ...snapshot(),
        trainees: store.data.trainees.length,
        missing: store.data.trainees
          .filter((t) => !t.checklist.length)
          .map((t) => t.name),
        storage: "Local database.json",
        scheduler:
          "Disabled. HR approval and explicit Send are required.",
      };
    }
    if (name === "reminders") {
      ensureAdmin(u);
      return reminders();
    }
    if (name === "draftHandover") return saveDraft(u, p);
    if (name === "activateHandover") {
      return store.transaction((db) => {
        const t = fresh(u, p);
        const h = t.handovers.find((h) => h.id === p.handoverId);
        if (!h) fail("Handover not found", 404);
        if (h.stage === "Onboard Final Email")
          fail("Choose Send email for Onboard Final Email. Training closes only after successful delivery.");
        if (h.status !== "Draft") fail("Only a draft can be handed over", 409);
        if (locks.has(t.id) || db.outbox.some(r => r.handoverId === h.id && ["Sending", "Delivery uncertain"].includes(r.status)))
          fail("Email delivery is in progress or uncertain. Review delivery before handing over.", 409);
        if(!t.communications?.['handover:'+h.id]?.sentAt)h.note=handoverNote(t,db,h.manualNote??h.note);
        h.previousTrainerId=t.ownerId;h.previousTrainerName=t.trainerName;h.previousTrainerEmail=t.ownerEmail;h.fromStage=t.stage;switchTrainingPhase(t,h.stage);
        const owner = db.users.find(u => u.active && u.email.toLowerCase() === h.email.toLowerCase());
        t.trainerName=owner?.name||h.ownerName;
        t.ownerId = owner?.id || null;
        t.ownerEmail = h.email;
        h.ownerId = t.ownerId;
        syncTrainee(t, db);
        h.status = "Pending";
        h.at = now();
        h.notification = "Not sent";
        h.lastError = "";
        for (const old of t.handovers)
          if (old.id !== h.id && old.status === "Pending") old.status = "Completed";
        t.version++;
        audit(db, u, "Handed over without email", t.id, h.stage);
        return { ok: true, stage: t.stage, emailSent: false };
      });
    }
    if (name === "sendHandover") return sendHandover(u, p);
    if (name === "retryEmail") fail("Retry from the approved trainee communication. Legacy delivery is disabled.",403);
    return store.transaction((db) => {
      if (name === "sync") {
        ensureAdmin(u);
        let added = 0;
        for (const t of db.trainees) {
          added += syncTrainee(t, db);
          t.version++;
        }
        audit(db, u, "Sync trainee rows", null, String(added));
        return { added };
      }
      if (name === "saveTemplateRow" || name === "deleteTemplateRow") {
        ensureAdmin(u);
        const columns = {
          Checklist_Template: [
            "Module",
            "Topic",
            "Phase",
            "Designation",
            "Type",
          ],
          Scoring_Template: ["Category", "Criterion", "Phase", "Designation"],
          Question_Bank: [
            "Department",
            "Question",
            "Key Points (for assessor)",
            "Designation",
          ],
          Lists: [
            "Stages",
            "Handover Status",
            "Trainee Status",
            "Designation",
            "Rating",
            "Points (out of 10)",
            "Final Recommendation",
            "Custom Designation",
            "Use Checklist Of",
          ],
        };
        const keys = columns[p.table];
        if (!keys) fail("Unknown template");
        const rows = model(db)[p.table];
        if (
          p.index !== null &&
          p.index !== undefined &&
          (!Number.isInteger(p.index) || p.index < 0 || p.index >= rows.length)
        )
          fail("Row not found");
        if (name === "deleteTemplateRow") {
          if (p.index == null) fail("Choose a row");
          rows.splice(p.index, 1);
        } else {
          const row = Object.fromEntries(
            keys.map((k) => [k, text(p.values?.[k])]),
          );
          if (p.table !== "Lists" && (!row[keys[0]] || !row[keys[1]]))
            fail("The first two fields are required");
          if (row.Phase && !original.STAGES.includes(row.Phase))
            fail("Choose a valid phase or leave blank");
          if (row.Type && !["Theory", "Practical"].includes(row.Type))
            fail("Type must be Theory or Practical");
          if (row.Department && !original.DEPARTMENTS.includes(row.Department))
            fail("Choose HR, Sales or Operations");
          if (
            row.Rating &&
            (!row["Points (out of 10)"] ||
              !Number.isFinite(Number(row["Points (out of 10)"])) ||
              Number(row["Points (out of 10)"]) < 0 ||
              Number(row["Points (out of 10)"]) > 10)
          )
            fail("Rating points must be 0–10");
          if (
            p.table !== "Lists" &&
            rows.some(
              (r, i) =>
                i !== p.index &&
                r[keys[0]] === row[keys[0]] &&
                r[keys[1]] === row[keys[1]],
            )
          )
            fail("This template item already exists");
          if (p.index == null) rows.push(row);
          else rows[p.index] = row;
        }
        db.customDesignations = Object.fromEntries(
          model(db)
            .Lists.filter((r) => r["Custom Designation"])
            .map((r) => [
              r["Custom Designation"],
              r["Use Checklist Of"] || "All",
            ]),
        );
        const map = ratingMap(db);
        for (const t of db.trainees)
          for (const r of t.assessments)
            r.score = Object.hasOwn(map, r.rating) ? map[r.rating] : null;
        audit(db, u, name, null, p.table);
        return { ok: true };
      }
      if (name === "deleteTrainees") {
        ensureAdmin(u);
        if(p.confirmed!==true || !Array.isArray(p.trainees) || !p.trainees.length || p.trainees.length>1000) fail("Confirm the selected trainees to delete");
        const ids=new Set(p.trainees.map(x=>x.traineeId));
        if(ids.size!==p.trainees.length)fail("Select each trainee only once");
        const rows=p.trainees.map(x=>{if(!Number.isInteger(x.version))fail("Refresh the trainee list first");return fresh(u,x);});
        if(rows.some(t=>locks.has(t.id)) || db.outbox.some(r=>ids.has(r.traineeId)&&['Queued','Sending'].includes(r.status)))fail("Wait for email sending to finish",409);
        db.trainees=db.trainees.filter(t=>!ids.has(t.id));
        db.records=db.records.filter(r=>!ids.has(r.traineeId));
        db.outbox=db.outbox.filter(r=>!ids.has(r.traineeId));
        for(const t of rows)audit(db,u,"Trainee deleted",t.id,t.name);
        return {ok:true,deleted:rows.length};
      }
      const t = fresh(u, p);
      if (locks.has(t.id))
        fail("Wait for this trainee’s email to finish sending", 409);
      if (name === "deleteTrainee") {
        ensureAdmin(u);
        if (p.confirmName !== t.name)
          fail("Type the trainee name to confirm deletion");
        db.trainees = db.trainees.filter((x) => x.id !== t.id);
        db.records = db.records.filter((x) => x.traineeId !== t.id);
        db.outbox = db.outbox.filter((x) => x.traineeId !== t.id);
        audit(db, u, "Trainee deleted", t.id, t.name);
        return { ok: true };
      }
      if (name === "removedItems") return t.checklist.filter((x) => x.removed);
      if (name === "handoverStatus") {
        if(t.lifecycle?.plan&&p.status==='Completed'&&!t.handovers.find(h=>h.id===p.handoverId)?.acknowledgement)fail('Receiving trainer must acknowledge handover first');
        const h = t.handovers.find((x) => x.id === p.handoverId);
        if (!h) fail("Handover not found");
        if (!["Completed", "Pending", "Draft"].includes(p.status))
          fail("Invalid status");
        h.status = p.status;

      }
      if (name === "deleteHandover") {
        const h = t.handovers.find((x) => x.id === p.handoverId);
        if (!h) fail("Handover not found");
        t.handovers = t.handovers.filter((x) => x.id !== h.id);
      }
      if (name === "feedback") {
        let row = p.feedbackId
          ? t.feedbackRows.find((r) => r.id === p.feedbackId)
          : null;
        if (p.feedbackId && !row) fail("Feedback row not found");
        if (!row) {
          row = { id: id() };
          t.feedbackRows.push(row);
        }
        if (p.rating && !Object.hasOwn(ratingMap(db), p.rating))
          fail("Invalid rating");
        if (
          p.recommendation &&
          !listValues(db, "Final Recommendation").includes(p.recommendation)
        )
          fail("Invalid recommendation");
        Object.assign(
          row,
          Object.fromEntries(
            [
              "rating",
              "recommendation",
              "strengths",
              "improve",
              "comments",
            ].map((k) => [k, text(p[k])]),
          ),
        );
        if (
          ["rating", "recommendation", "strengths", "improve", "comments"].some(
            (k) => row[k],
          )
        ) {
          row.by = u.email;
          row.at = now();
        }
        t.feedback = summary(t).feedback;
      }
      if (name === "editTrainee") {
        ensureAdmin(u);
        const name = text(p.name, 200);
        if (!name) fail("Name is required");
        if (
          db.trainees.some(
            (x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase(),
          )
        )
          fail("A trainee with this name already exists");
        t.name = name;
        t.email = p.email ? mail(p.email) : "";
        if (p.phone !== undefined) t.phone = normalizePhone(p.phone);
        t.branch = text(p.branch, 200);
        if(p.department!==undefined)t.department=text(p.department,200);
        if (p.joiningDate !== undefined) {
          if (p.joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.joiningDate))
            fail("Invalid joining date");
          t.joiningDate = p.joiningDate || "";
        }
        if (p.designation !== undefined)
          t.designation = text(p.designation, 200);
        if (p.trainerName !== undefined)
          t.trainerName = text(p.trainerName, 200);
        if (p.stage !== undefined) {
          p={...p,stage:canonicalPhase(p.stage)};
      if (!listValues(db, "Stages").includes(p.stage))
            fail("Invalid stage");
          if(p.stage!==t.stage)fail('Change the training phase through Handover after completing the current phase.');
        }
        if (p.ownerId !== undefined) {
          const owner = db.users.find((x) => x.id === p.ownerId && x.active);
          t.ownerId = owner?.id || null;
          t.ownerEmail = owner?.email || text(p.ownerEmail, 200);
        }
        if (p.status !== undefined) {
          if((t.lifecycleRequired||t.lifecycle?.plan)&&p.status==='Completed'&&!t.lifecycle?.completedAt)fail('Complete Lifecycle HR sign-off and final email first');
          if (!listValues(db, "Trainee Status").includes(p.status))
            fail("Invalid status");
          const changed = t.status !== p.status;
          t.status = p.status;
          if (changed) {
            if (p.status === "Completed") closeTraining(t);
            else t.closedAt = null;
          }
        }
        if (p.closedAt !== undefined) {
          if (p.closedAt && !/^\d{4}-\d{2}-\d{2}$/.test(p.closedAt))
            fail("Invalid closed date");
          t.closedAt = p.closedAt || null;
        }
        syncTrainee(t, db);
      }
      t.version++;
      const detail=name==='feedback' ? ['Rating: '+(p.rating||'—'),'Recommendation: '+(p.recommendation||'—'),p.strengths,p.improve,p.comments].filter(Boolean).join(' · ') : name==='handoverStatus' ? (t.handovers.find(h=>h.id===p.handoverId)?.stage||'')+' → '+p.status : name==='editTrainee' ? t.name+' · '+t.designation+' · '+t.stage+' · '+t.status : '';
      audit(db, u, name, t.id,detail);
      return { ok: true };
    });
  }
  return {
    handles,
    snapshot,
    run,
    reminders,
    tick,
    startScheduler,
    stopScheduler,
    locked: (id) => locks.has(id),
  };
}
