import {prepareJourneyFixture} from './journey-fixture.js';
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server.js";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gleuhr-test-"));
let app, url;
async function boot() {
  app = createApp({
    dataDir: dir,
    scheduler: false,
    mailer: {
      configured: true,
      from: "test@example.com",
      send: async (m) => ({ messageId: m.id }),
      verify: async () => true,
    },
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${app.server.address().port}`;
}
async function call(route, body, cookie) {
  const res = await fetch(url + route, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get("set-cookie")?.split(";")[0],
  };
}
let admin, trainer, other, t, user;
const act = (action, payload = {}, cookie = admin) => {
  prepareJourneyFixture(app,action,payload);return call("/api/action", { action, payload }, cookie);
};
await boot();
test.after(async () => {
  await new Promise((r) => app.server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});
test("initial setup and hashed password", async () => {
  assert.equal((await call("/api/session")).data.setup, true);
  let r = await call("/api/setup", {
    name: "Local Admin",
    email: "admin@example.com",
    password: "local-test-admin-2026",
  });
  assert.equal(r.status, 200);
  admin = r.cookie;
  assert.equal(r.data.password, undefined);
  assert.ok(
    !fs.readFileSync(app.store.file, "utf8").includes("local-test-admin-2026"),
  );
  assert.equal((await call("/api/setup", {})).status, 409);
});
test("unauthenticated access rejected", async () => {
  assert.equal((await call("/api/action", { action: "state" })).status, 401);
});
test("create trainer accounts", async () => {
  let r = await act("createUser", {
    name: "Trainer A",
    email: "trainer@example.com",
    password: "local-test-trainer",
    role: "trainer",
  });
  user = r.data;
  assert.equal(r.status, 200);
  trainer = (
    await call("/api/login", {
      email: user.email,
      password: "local-test-trainer",
    })
  ).cookie;
  await act("createUser", {
    name: "Other Trainer",
    email: "other@example.com",
    password: "local-test-other",
    role: "trainer",
  });
  other = (
    await call("/api/login", {
      email: "other@example.com",
      password: "local-test-other",
    })
  ).cookie;
});
test("create trainee seeds initial phases", async () => {
  let r = await act("createTrainee", {
    name: "Demo Person",
    designation: "Branch Manager",
    branch: "Test Clinic",
    joiningDate: "2026-10-01",
    ownerId: user.id,
  });
  assert.equal(r.status, 200);
  t = r.data;
  assert.ok(t.checklist.length > 0);
  assert.ok(
    t.checklist.every((x) => ["Induction", "Onboarding"].includes(x.phase)),
  );
  assert.ok(t.assessments.every((x) => x.department === "HR"));
});
test("server scopes assigned trainees", async () => {
  assert.equal((await act("state", {}, other)).data.trainees.length, 0);
  assert.equal((await act("state", {}, trainer)).data.trainees.length, 1);
  assert.equal(
    (
      await act(
        "module",
        { traineeId: t.id, moduleId: 1, complete: true },
        other,
      )
    ).status,
    403,
  );
  assert.equal((await act("createUser", { name: "Bad" }, trainer)).status, 403);
});
test("save checklist, conflicts and N/A restore", async () => {
  const itemId = t.checklist[0].id;
  assert.equal(
    (
      await act(
        "checklist",
        {
          traineeId: t.id,
          itemId,
          covered: true,
          remarks: "Verified",
          version: 1,
        },
        trainer,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await act(
        "checklist",
        { traineeId: t.id, itemId, covered: false, version: 1 },
        trainer,
      )
    ).status,
    409,
  );
  await act("checklist", { traineeId: t.id, itemId, removed: true }, trainer);
  await act("checklist", { traineeId: t.id, itemId, removed: false }, trainer);
  t = (await act("state")).data.trainees[0];
  assert.equal(t.checklist[0].covered, false);
  assert.equal(t.checklist[0].removed, false);
});
test("score and assessment validation", async () => {
 app.store.data.trainees.find(x=>x.id===t.id).stage="Onboarding";
  assert.equal(
    (
      await act(
        "score",
        { traineeId: t.id, itemId: t.scores[0].id, score: 11 },
        trainer,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await act(
        "score",
        { traineeId: t.id, itemId: t.scores[0].id, score: 8 },
        trainer,
      )
    ).status,
    200,
  );
  await act(
    "assessment",
    {
      traineeId: t.id,
      itemId: t.assessments[0].id,
      answer: "Recorded answer",
      rating: "Good",
    },
    trainer,
  );
  t = (await act("state")).data.trainees[0];
  assert.equal(t.assessments[0].score, 7);
  assert.equal((await act("assessment", {traineeId:t.id,itemId:t.assessments[0].id,rating:"Excellent"},trainer)).status,200);
  t=(await act("state")).data.trainees[0];
  assert.equal(t.assessments[0].score,10);
  assert.equal(t.assessments[0].answer,"Recorded answer");
  assert.equal((await act("assessment",{traineeId:t.id,itemId:t.assessments[1].id,rating:"Good"},trainer)).status,200);
  t=(await act("state")).data.trainees[0];
  assert.equal(t.assessments[1].score,7);
  assert.equal(t.assessments[1].answer,"");
  await act("score",{traineeId:t.id,itemId:t.scores[0].id,score:8,remarks:"Existing observation"},trainer);
  await act("score",{traineeId:t.id,itemId:t.scores[0].id,score:10},trainer);
  t=(await act("state")).data.trainees[0];
  assert.equal(t.scores[0].score,10);
  assert.equal(t.scores[0].remarks,"Existing observation");


});
test("rename preserves linked records", async () => {
  await act("editTrainee", {
    traineeId: t.id,
    name: "Renamed Person",
    email: "trainee@example.test",
    branch: t.branch,
    joiningDate: t.joiningDate,
    status: "Active",
  });
  const next = (await act("state")).data.trainees[0];
  assert.equal(next.id, t.id);
  assert.equal(next.checklist[0].remarks, "");
  assert.equal(next.name, "Renamed Person");
});
test("draft activation transfers phase and sends trainee feedback without emailing next owner", async () => {
 const second=(await act("state")).data.users.find(u=>u.email==="other@example.com");
 const draft=await act("draftHandover",{traineeId:t.id,stage:"Sales Training",ownerId:second.id,note:"Continue sales"},trainer);
 assert.equal(draft.status,200);
 assert.equal((await act("activateHandover",{traineeId:t.id,handoverId:draft.data.handoverId},trainer)).status,200);
 assert.equal((await act("state",{},trainer)).data.trainees.length,0);
 t=(await act("state",{},other)).data.trainees[0];
 assert.ok(t.checklist.some(i=>i.phase==="Sales Training"));
 assert.equal((await act("state")).data.outbox.length,0);
 assert.ok(app.store.data.lifecycleNotifications.some(n=>n.traineeId===t.id&&n.title.startsWith("How was your training?")&&n.to==="trainee@example.test"&&n.status==="Sent"));
});
test("answers hidden and server grades tests", async () => {
  const start = await act("startTest", { traineeId: t.id, moduleId: 1 }, other);
  assert.equal(start.status, 200);
  assert.ok(
    start.data.questions.every(
      (q) => q.correctIndex === undefined && q.clinicalRationale === undefined,
    ),
  );
  assert.equal(
    (await act("submitTest", { testId: start.data.id, answers: [] }, other))
      .status,
    400,
  );
  const answers = start.data.questions.map(() => 0);
  const r = await act("submitTest", { testId: start.data.id, answers }, other);
  assert.equal(r.status, 200);
  assert.equal(
    r.data.score,
    Math.round(
      (r.data.result.filter((r) => r.ok).length / answers.length) * 100,
    ),
  );
  assert.equal(
    (await act("submitTest", { testId: start.data.id, answers }, other)).status,
    400,
  );
});
test("module idempotency and admin certificate approval", async () => {
  await act("module", { traineeId: t.id, moduleId: 1, complete: true }, other);
  await act("module", { traineeId: t.id, moduleId: 1, complete: true }, other);
  assert.equal(
    (await act("state")).data.trainees[0].completedModules.length,
    1,
  );
  assert.equal(
    (await act("certificate", { traineeId: t.id, note: "Reviewed" }, other))
      .status,
    403,
  );
  assert.equal(
    (await act("certificate", { traineeId: t.id, note: "HR reviewed results" }))
      .status,
    200,
  );
});
test("daily records save without fake scores", async () => {
  for (const kind of [
    "eod",
    "coaching",
    "evaluation",
    "branch",
    "outcome",
    "roleplay",
  ])
    assert.equal(
      (
        await act(
          "record",
          {
            traineeId: t.id,
            kind,
            title: "Test " + kind,
            notes: "Observed",
            score: "",
          },
          other,
        )
      ).status,
      200,
    );
  assert.equal(
    (await act("state")).data.records.find((r) => r.kind === "roleplay").score,
    null,
  );
});
test("rejected action rolls back changes", async () => {
  const before = JSON.stringify(app.store.data.trainees);
  assert.equal(
    (
      await act(
        "handover",
        { traineeId: t.id, stage: "Onboard Final Email", ownerId: user.id },
        other,
      )
    ).status,
    403,
  );
  assert.equal(JSON.stringify(app.store.data.trainees), before);
});
test("automatic reminders disabled", async () => {
  assert.equal((await act("reminders")).data.count, 0);
  assert.equal((await act("reminders")).data.count, 0);
});
test("cross-site writes and private files blocked", async () => {
  const res = await fetch(url + "/api/action", {
    method: "POST",
    headers: {
      Origin: "https://example.com",
      "Content-Type": "application/json",
      Cookie: admin,
    },
    body: JSON.stringify({ action: "state" }),
  });
  assert.equal(res.status, 403);
  assert.equal((await fetch(url + "/data/database.json")).status, 404);
});
test("restart preserves data and expires sessions", async () => {
  await new Promise((r) => app.server.close(r));
  await boot();
  assert.equal((await act("state")).status, 401);
  admin = (
    await call("/api/login", {
      email: "admin@example.com",
      password: "local-test-admin-2026",
    })
  ).cookie;
  const s = (await act("state")).data;
  assert.equal(s.trainees[0].name, "Renamed Person");
  assert.equal(s.trainees[0].checklist[0].covered, false);
  assert.ok(s.trainees[0].certificate);
  assert.equal(s.records.filter((r) => r.kind === "eod").length, 1);
});
test("source custom designation mapping and CRM phase", async () => {
  const a = (await act("state")).data.user;
  const r = await act("createTrainee", {
    name: "HR Role Check",
    designation: "HR Manager",
    branch: "HR",
    joiningDate: "2026-10-01",
    ownerId: a.id,
  });
  assert.equal(r.status, 200);
  const draft=await act("draftHandover", {
    traineeId: r.data.id,
    stage: "CRM & Tech Training",
    ownerId: a.id,
  });
  await act("activateHandover",{traineeId:r.data.id,handoverId:draft.data.handoverId});
  const tr = (await act("state")).data.trainees.find((t) => t.id === r.data.id);
  assert.ok(
    tr.checklist.some((r) => r.module.startsWith("CRM Branch Manager")),
  );
});
test("exercise choices are validated and server evaluates", async () => {
  const s = (await act("state")).data,
    m = s.academy.modules[0];
  const r = await act("exercise", {
    traineeId: t.id,
    moduleId: m.id,
    choices: m.exerciseScenario.steps.map(
      (step) => step.choices.find((c) => c.tier === "good").id,
    ),
  });
  assert.equal(r.status, 200);
  const result = (await act("state")).data.records
    .filter((r) => r.kind === "exercise")
    .at(-1);
  assert.equal(result.score, 100);
  assert.equal(
    (
      await act("exercise", {
        traineeId: t.id,
        moduleId: m.id,
        choices: ["invalid"],
      })
    ).status,
    400,
  );
});
test("fresh Academy excludes historical sample operational records", async () => {
  const s = (await act("state")).data;
  assert.equal(s.academy.branch.DELHI_OCTOBER_2026_BM_EOD_LOGS, undefined);
  assert.equal(s.academy.questions, undefined);
  assert.ok(s.academy.modules.every((m) => m.quizQuestions === undefined));
});
