import {canonicalPhase,orderedPhases} from './training-phases.js';
import fs from "node:fs";
import {initializeCurriculum,curriculumTemplates,relocateCurriculumFoundations} from './designation-curricula.js';
import { id, now } from "./store.js";
export const original = JSON.parse(
  fs.readFileSync(new URL("./seed/workflow.json", import.meta.url)),
);
export const defaults = JSON.parse(
  fs.readFileSync(new URL("./seed/training.json", import.meta.url)),
);
export const zone = process.env.TRAINING_TIMEZONE || "Asia/Kolkata";
export function localDate(value = new Date()) {
  if (!value) return "";
  if(typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
export const diffDays = (a, b) =>
  a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 86400000) : null;
export const dayNumber = (covered, joining) =>
  covered && joining ? diffDays(localDate(covered), joining) + 1 : null;
export const trainingDays = (t) =>
  !t.joiningDate
    ? null
    : t.closedAt
      ? diffDays(localDate(t.closedAt), t.joiningDate)
      : t.status === "Active"
        ? diffDays(localDate(), t.joiningDate)
        : null;
export const avg = (a) =>
  a.length ? a.reduce((s, n) => s + n, 0) / a.length : null;
export const model = (db) => db.trainingTemplates || defaults;
export const listValues = (db, key) => {const values=model(db).Lists.map(r=>r[key]).filter(Boolean);return key==='Stages'?orderedPhases(values):values;};
const designationAlias=value=>{const key=String(value||'').trim().replace(/\s+/g,' ').toLowerCase();return ({bm:'branch manager',rh:'regional head',counselor:'counsellor'})[key]||key;};
export function matchesDesignation(list, designation, db) {
  const allowed = String(list || "")
    .split(",")
    .map(designationAlias)
    .filter(Boolean);
  if (!allowed.length || allowed.includes("all")) return true;
  let d = designationAlias(designation);
  if(allowed.includes(d))return true;
  const mapping = Object.fromEntries(
    Object.entries(db.customDesignations || {}).map(([k, v]) => [
      designationAlias(k),
      designationAlias(v),
    ]),
  );
  for (let i = 0; i < 5 && Object.hasOwn(mapping, d); i++) {
    if (mapping[d] === "all") return false;
    d = mapping[d];
  }
  if (
    d === "other" ||
    !listValues(db, "Designation")
      .map(designationAlias)
      .concat(Object.keys(mapping))
      .includes(d)
  )
    return false;
  return allowed.includes(d);
}
export function phaseOf(ph, key, map) {
  ph = String(ph || "").trim();
  if (original.STAGES.includes(ph)) return ph;
  if (ph === "Branch Manager") return "Operations Training";
  return map[key] || "";
}
export function typeFor(topic) {
  return /tour|login|meet the team|observation|scenario|one-to-one|photo|independently|shadow|^ran |completed|submitted|raised|sign-off|role-play|mock|briefing|walk /i.test(
    topic,
  )
    ? "Practical"
    : "Theory";
}
export function phasesFor(t) {
  return new Set(
    [
      "Induction",
      "Onboarding",
      t.stage,
      ...t.handovers.map((h) => h.stage),
    ].filter(Boolean),
  );
}
export function syncTrainee(t, db) {
  t.stage=canonicalPhase(t.stage);if(t.stageOrder)t.stageOrder=orderedPhases(t.stageOrder);
  initializeCurriculum(t,db);
  relocateCurriculumFoundations(t,db);
  const tpl = curriculumTemplates(t,db,model(db)),
    phases = phasesFor(t);
  t.phases = [...phases];
  let added = 0;
  for (const r of tpl.Checklist_Template) {
    const ph = phaseOf(r.Phase, r.Module, original.MODULE_PHASE);
    if (
      (!ph || phases.has(ph)) &&
      matchesDesignation(r.Designation, t.designation, db) &&
      r.Module &&
      r.Topic &&
      !t.checklist.some((x) => r.curriculumId ? x.curriculumId===r.curriculumId : !x.curriculumId&&x.module === r.Module && x.topic === r.Topic)
    ) {
      t.checklist.push({
        ...curriculumMetadata(r),
        id: id(),
        module: r.Module,
        topic: r.Topic,
        phase: ph,
        type: r.Type || typeFor(r.Topic),
        covered: false,
        removed: false,
        remarks: "",
        coveredAt: null,
        assessor: "",
      });
      added++;
    }
  }
  for (const r of tpl.Scoring_Template) {
    const ph = phaseOf(r.Phase, r.Category, original.CAT_PHASE);
    if (
      (!ph || phases.has(ph)) &&
      matchesDesignation(r.Designation, t.designation, db) &&
      r.Category &&
      r.Criterion &&
      ![...t.scores,...(t.archivedEntries||[]).filter(x=>x.kind==="scores").map(x=>x.entry)].some(
        (x) => x.category === r.Category && x.criterion === r.Criterion,
      )
    ) {
      t.scores.push({
        id: id(),
        category: r.Category,
        criterion: r.Criterion,
        phase: ph,
        score: null,
        remarks: "",
        assessor: "",
      });
      added++;
    }
  }
  for (const r of tpl.Question_Bank) {
    if (
      (phases.has("Assessment") ||
        phases.has(
          {
            HR: "Onboarding",
            Sales: "Sales Training",
            Operations: "Operations Training",
          }[r.Department],
        )) &&
      matchesDesignation(r.Designation, t.designation, db) &&
      r.Department &&
      r.Question &&
      ![...t.assessments,...(t.archivedEntries||[]).filter(x=>x.kind==="assessments").map(x=>x.entry)].some(
        (x) => r.curriculumId ? x.curriculumId===r.curriculumId : !x.curriculumId&&x.department === r.Department && x.question === r.Question,
      )
    ) {
      t.assessments.push({
        ...curriculumMetadata(r),
        id: id(),
        department: r.Department,
        question: r.Question,
        keyPoints: r["Key Points (for assessor)"] || "",
        answer: "",
        rating: "",
        score: null,
        assessor: "",
        at: null,
      });
      added++;
    }
  }
  if (phases.has("Final Feedback") || phases.has("Final Review & Confirmation"))
    t.feedbackRequested = true;
  // Render sorting does not rewrite unrelated records. This is the script's Theory / Practical > phase > module > template order.
  const indices = new Map(
    tpl.Checklist_Template.map((r, i) => [r.Module + "|" + r.Topic, i]),
  );
  const rank = (arr, v, fallback) => {
    const i = arr.indexOf(v);
    return i < 0 ? fallback : i;
  };
  t.checklist.sort(
    (a, b) =>
      (a.type === "Practical") - (b.type === "Practical") ||
      rank(original.STAGES, original.MODULE_PHASE[a.module], 99) -
        rank(original.STAGES, original.MODULE_PHASE[b.module], 99) ||
      rank(original.MODULES, a.module, 999) -
        rank(original.MODULES, b.module, 999) ||
      (indices.get(a.module + "|" + a.topic) ?? 99999) -
        (indices.get(b.module + "|" + b.topic) ?? 99999),
  );
  return added;
}
function curriculumMetadata(r){
 if(!r.curriculumId)return {};
 return {curriculumId:r.curriculumId,phase:r.Phase,plannedDay:r.trainingDay,mentor:r.mentor,verification:r.verification,source:r.source,optional:!!r.optional,sourceKind:r.sourceKind};
}
export function summary(t) {
  const cl = t.checklist.filter((r) => !r.removed),
    sc = t.scores.filter((r) => r.score !== null && r.score !== ""),
    values = sc.map((r) => Number(r.score));
  const pct = (rows) =>
    rows.length ? rows.filter((r) => r.covered).length / rows.length : null;
  const phaseRows = original.PHASES.map((p) => {
    const rows = cl.filter((r) =>
      r.curriculumId ? r.phase===p.stage : p.dash
        ? p.dash.some((pattern) =>
            r.module.startsWith(pattern.replace(/\*$/, "")),
          )
        : p.modules.includes(r.module),
    );
    const days = rows
      .filter((r) => r.covered)
      .map((r) => dayNumber(r.coveredAt, t.joiningDate))
      .filter((x) => x !== null);
    return {
      phase: p.stage,
      covered: rows.filter((r) => r.covered).length,
      total: rows.length,
      percent: pct(rows) ?? 0,
      firstDay: days.length ? Math.min(...days) : null,
      lastDay: days.length ? Math.max(...days) : null,
    };
  });
  const categories = original.SCORE_CATEGORIES.map((category) => ({
    category,
    score: avg(
      sc.filter((r) => r.category === category).map((r) => Number(r.score)),
    ),
  }));
  const qa = original.DEPARTMENTS.map((department) => {
    const rows = t.assessments.filter((r) => r.department === department);
    const score = avg(
      rows
        .filter((r) => r.score !== null && r.score !== "")
        .map((r) => Number(r.score)),
    );
    return {
      department,
      score,
      total: rows.length,
      answered: rows.filter((r) => r.rating).length,
      rating: !score
        ? "Not assessed"
        : score >= 8.5
          ? "Excellent"
          : score >= 5.5
            ? "Good"
            : "Average",
    };
  });
  const filled = (t.feedbackRows || [t.feedback])
    .filter(Boolean)
    .filter((f) =>
      ["rating", "recommendation", "strengths", "improve", "comments"].some(
        (k) => String(f[k] || "").trim(),
      ),
    );
  const allDays = cl
    .filter((r) => r.covered)
    .map((r) => dayNumber(r.coveredAt, t.joiningDate))
    .filter((x) => x !== null);
  phaseRows.push({
    phase: "Overall",
    covered: cl.filter((r) => r.covered).length,
    total: cl.length,
    percent: pct(cl) ?? 0,
    firstDay: allDays.length ? Math.min(...allDays) : null,
    lastDay: allDays.length ? Math.max(...allDays) : null,
  });
  const checklistTypes = ["Theory", "Practical"].map((type) => {
    const rows = cl.filter((r) => r.type === type);
    return {
      type,
      total: rows.length,
      covered: rows.filter((r) => r.covered).length,
      percent: pct(rows) ?? 0,
    };
  });
  return {
    checklistTypes,
    trainingDays: trainingDays(t),
    checklistPercent: pct(cl) ?? 0,
    scorePercent: (avg(values) ?? 0) / 10,
    overallScore: avg(values),
    categories,
    qa,
    phases: phaseRows,
    feedback: filled.at(-1) || null,
    feedbackRequested: !!t.feedbackRequested,
    lastTrainingDay: cl
      .filter((r) => r.covered)
      .map((r) => dayNumber(r.coveredAt, t.joiningDate))
      .filter((x) => x !== null)
      .reduce((a, b) => Math.max(a, b), 0),
    verdict: !values.some((x) => x > 0)
      ? "Not yet assessed"
      : avg(values) >= 8
        ? "Strong fit - recommend"
        : avg(values) >= 6
          ? "Moderate fit - needs coaching"
          : "Needs improvement",
  };
}
export function closeTraining(t) {
  t.status = "Completed";
  if (!t.closedAt) t.closedAt = localDate();
}
export function ratingMap(db) {
  return Object.fromEntries(
    model(db)
      .Lists.filter((x) => x.Rating)
      .map((x) => [x.Rating, Number(x["Points (out of 10)"])]),
  );
}
export function initializeWorkflow(db) {
  if (!db.trainingTemplates) {
    db.trainingTemplates = structuredClone(defaults);
    for (const [k, v] of Object.entries(db.customDesignations || {}))
      if (
        !db.trainingTemplates.Lists.some((r) => r["Custom Designation"] === k)
      )
        db.trainingTemplates.Lists.push({
          Designation: k,
          "Custom Designation": k,
          "Use Checklist Of": v,
        });
  }
  db.customDesignations = Object.fromEntries(
    db.trainingTemplates.Lists.filter((r) => r["Custom Designation"]).map(
      (r) => [r["Custom Designation"], r["Use Checklist Of"] || "All"],
    ),
  );
  for (const t of db.trainees) {
    t.feedbackRows ??= t.feedback ? [{ id: id(), ...t.feedback }] : [];
    t.trainerName ??= db.users.find((u) => u.id === t.ownerId)?.name || "";
    t.ownerEmail ??= db.users.find((u) => u.id === t.ownerId)?.email || "";
    syncTrainee(t, db);
  }
  db.scheduler ??= { lastRun: null, lastError: null };
}
