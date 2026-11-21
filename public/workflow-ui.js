let handoverEmailId=null;
async function prepareHandoverEmail(traineeId,handoverId){
 await refresh();const t=S.trainees.find(t=>t.id===traineeId),kind='handover:'+handoverId;
 if(!t)throw Error('This trainee is no longer assigned to you. Refresh the trainee list.');
 if(!t.communications?.[kind])await api('communicationSave',{traineeId,version:t.version,kind,...communicationDefaults(t,kind)});
 handoverEmailId=handoverId;section=t.journey.Handover.blockedBy?'Handover history':'Handover';await refresh();
}
async function sendHandoverEmail(traineeId,handoverId){
 await prepareHandoverEmail(traineeId,handoverId);
 const t=S.trainees.find(t=>t.id===traineeId),kind='handover:'+handoverId;
 const delivery=await api('communicationSend',{traineeId,version:t.version,kind});
 await refresh();
 const updated=S.trainees.find(t=>t.id===traineeId);
 if(updated?.handovers.find(h=>h.id===handoverId)?.status==='Draft'){
  try{await api('activateHandover',{traineeId,handoverId});}
  catch(e){throw Error((delivery?.queued?'Email queued.':'Email sent.')+' Handover still needs activation: '+e.message);}
 }
 await refresh();toast(delivery?.queued?'Handover activated. Email queued for the receiving trainer.':'Handover email sent');
}
function departmentCompletion(t,department){
 const names=department==='HR'?['Induction','Onboarding']:department==='Overall'?['Overall']:[department+' Training'];
 const rows=t.summary.phases.filter(r=>names.includes(r.phase));const total=rows.reduce((n,r)=>n+r.total,0);return total?rows.reduce((n,r)=>n+r.covered,0)/total:null;
}
let templateData = null,
  templateTable = "Checklist_Template";
function workflowSummary(t) {
  const s = t.summary,
    p = (n) => (n === null ? "Not scored" : (n * 100).toFixed(0) + "%");
  return `<div class="stats">${[
    ["Checklist completion", p(s.checklistPercent)],
    [
      "Behavioral score",
      p(
        (s.categories.find((x) => x.category === "Behavioral")?.score ?? 0) /
          10,
      ),
    ],
    [
      "Cultural fit score",
      p(
        (s.categories.find((x) => x.category === "Cultural Fit")?.score ?? 0) /
          10,
      ),
    ],
    ["Overall score", p(s.scorePercent)],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><small>${label}</small><strong>${value}</strong></div>`,
    )
    .join(
      "",
    )}</div><div class="card"><h2>${esc(s.verdict)}</h2><p>Score-based indication from the original dashboard. Final feedback and confirmation remain the reviewer’s decision.</p><p>${s.trainingDays === null ? "Training days not running" : s.trainingDays + " training days"} · ${t.closedAt ? "Closed on " + dt(t.closedAt) : t.status === "Active" ? "Still running" : esc(t.status)}</p><p>${s.lastTrainingDay ? "Last item ticked on Day " + s.lastTrainingDay : "No item ticked yet"}</p><p>Trainer: ${esc(t.trainerName || "—")} · Current owner: ${esc(t.ownerEmail || "—")}</p><p>Latest handover: ${esc(t.handovers.at(-1)?.status || "Not handed over")} · ${esc(t.handovers.at(-1)?.ownerName || "—")}</p></div><div class="table"><table><thead><tr><th>Phase</th><th>Covered / Total</th><th>Complete</th><th>Days</th></tr></thead><tbody>${s.phases.map((r) => `<tr><td>${esc(r.phase)}</td><td>${r.covered} / ${r.total}</td><td>${p(r.percent)}</td><td>${r.firstDay === null ? "—" : `Day ${r.firstDay} – ${r.lastDay} (${r.lastDay - r.firstDay + 1} d)`}</td></tr>`).join("")}</tbody></table></div><div class="grid"><div class="card"><h2>Score categories</h2>${s.categories.map((r) => `<p>${esc(r.category)}: <strong>${(r.score ?? 0).toFixed(1) + " / 10"}</strong></p>`).join("")}</div><div class="card"><h2>Q&A evaluation</h2>${s.qa.map((r) => `<p>${esc(r.department)}: <strong>${(r.score ?? 0).toFixed(1)} / 10 · ${r.rating}</strong> · ${r.answered} / ${r.total} rated</p>`).join("")}</div><div class="card"><h2>Theory & Practical</h2>${s.checklistTypes.map((r) => `<p>${r.type}: ${r.covered} / ${r.total} · ${p(r.percent)}</p>`).join("")}</div></div>${workflowFeedback(t)}`;
}
function workflowFeedback(t) {
  const f = t.summary.feedback;
  return `<div class="card"><div class="row"><h2>Final feedback</h2>${button("+ Add feedback row", "feedbackNew", "", "primary")}</div>${f ? `<span class="badge">${esc(f.recommendation || "No recommendation yet")}</span><p>${esc(f.rating)} · ${dt(f.at)} · ${esc(f.by)}</p><h3>Strengths</h3><pre>${esc(f.strengths)}</pre><h3>Areas to improve</h3><pre>${esc(f.improve)}</pre><h3>Comments</h3><pre>${esc(f.comments)}</pre>` : `<p>${t.feedbackRequested ? "Waiting for feedback" : "Final feedback not requested yet"}</p>`}</div><h3>Feedback rows</h3>${(t.feedbackRows || []).map((f) => item(f.recommendation || "Blank feedback row", f.by || "Not filled", f.comments || "", button("Edit row", "feedbackEdit", `data-id="${f.id}"`)+removeEntryButton("feedbackRows",f.id))).join("")}`;
}
function workflowHandovers(t) {
  return `<div class="row"><h2>Handovers</h2>${button("+ Add handover", "handover", "", "primary")}</div><p class="notice">Hand over directly to any selected phase. Save draft does not change the current phase. Use Send email to review and send a handover email directly. Sending a draft handover email activates the transfer once the email is queued. Check Email delivery for its progress. Final Feedback & Confirmation is one stage. After the final onboarding email succeeds, Asset Allotment is the last step.</p>${
    t.handovers
      .slice()
      .reverse()
      .map((h) =>
        item(
          h.stage,
          `${h.ownerName || ""} · ${h.email} · ${dt(h.at)}`,
          `${h.status}${t.communications?.["handover:"+h.id]?.sentAt ? " · Email sent "+dt(t.communications["handover:"+h.id].sentAt) : h.notification === "Not sent" ? " · Handover email not sent" : ""}\n${h.note || ""}${h.lastError ? "\nEmail error: " + h.lastError : ""}\nLast reminder: ${h.remindedOn || "—"}`,
          (h.status === "Draft"
            ? button("Edit draft", "handoverEdit", `data-id="${h.id}"`) + (h.stage !== "Onboard Final Email" ? button("Hand over without email", "handoverActivate", `data-id="${h.id}"`, "primary") : "")
            : button("Update status", "handoverStatus", `data-id="${h.id}"`)) + (h.stage!=="Onboard Final Email"?button(t.communications?.["handover:"+h.id]?.sentAt?"View sent email":"Send email","handoverEmail",`data-id="${h.id}"`):"") + removeEntryButton("handovers",h.id),
        ),
      )
      .join("") || empty("No handovers yet.")
  }${handoverEmailId&&t.handovers.some(h=>h.id===handoverEmailId)?communicationView(t,"handover:"+handoverEmailId):""}`;
}
function workflowRemoved(t) {
  return `<h2>Removed items</h2><p class="muted">Restoring creates a fresh unchecked topic, as in the original script.</p>${
    t.checklist
      .filter((x) => x.removed)
      .map((r) =>
        item(
          r.topic,
          `${r.module} · ${r.type}`,
          `Removed by ${r.removedBy || "—"}\nRemoved on ${dt(r.removedAt)}`,
          button("Restore", "restore", `data-id="${r.id}"`),
        ),
      )
      .join("") || empty("No removed topics.")
  }<h3>Other removed records</h3><p class="muted">Restoring retains saved values. Restored handovers return as drafts and do not switch phases or send email.</p>${(t.archivedEntries||[]).map(a=>item(a.entry.title||a.entry.criterion||a.entry.question||a.entry.stage||a.entry.recommendation||a.kind,a.kind,`Removed ${dt(a.at)} · ${a.by}`,button('Restore','restoreEntry',`data-id="${a.id}"`))).join('')||empty('No other removed records.')}`;
}
function workflowOutbox() {
 return heading('Email delivery','Track sending results and test delivery.')+(isAdmin()?'<button type="button" class="primary" data-email-test>Send test email with PDF</button>':'')+`<p class="notice">Sender: ${esc(S.email.from)} · ${S.email.configured?'Email configured':'Contact HR to configure email sending'}. Automatic reminders are disabled.</p>${[...S.outbox,...(S.lifecycleNotifications||[]).map(n=>({...n,subject:n.title,body:'Training notification'}))].sort((a,b)=>String(b.at).localeCompare(String(a.at))).map(r=>item(r.subject,`${r.to} · ${r.status} · ${dt(r.sentAt||r.at)}`,r.body+(r.error?'\n'+r.error:''))).join('')||empty('No emails recorded.')}`;
}
function workflowTemplates() {
  return (
    heading(
      "Templates & lists",
      "Edit the same checklist, scoring, assessment and list definitions used by the sheet.",
      button("Sync trainee rows", "sync") +
        button("+ Add row", "templateAdd", "", "primary"),
    ) +
    `<div class="filters"><select id="templateTable" aria-label="Template table">${options(["Checklist_Template", "Scoring_Template", "Question_Bank", "Lists"], templateTable, null)}</select></div><p class="notice">Changes apply to newly created rows. Use Sync to add missing items to trainees who have reached the relevant phases. Existing completed work is kept; removed topics stay excluded.</p><div id="templateRows">Loading…</div>`
  );
}
function paintTemplates() {
  if (!$("templateRows") || !templateData) return;
  const rows = templateData[templateTable];
  $("templateRows").innerHTML = rows
    .map((r, i) =>
      item(
        r.Topic ||
          r.Criterion ||
          r.Question ||
          Object.values(r).filter(Boolean).join(" · "),
        r.Module || r.Category || r.Department || "Lists",
        Object.entries(r)
          .filter(([k]) => !["Topic", "Criterion", "Question"].includes(k))
          .map(([k, v]) => `${k}: ${v || "—"}`)
          .join("\n"),
        button("Edit", "templateEdit", `data-id="${i}"`) +
          button("Delete row", "templateDelete", `data-id="${i}"`),
      ),
    )
    .join("");
  $("templateTable").onchange = (e) => {
    templateTable = e.target.value;
    paintTemplates();
  };
}
function workflowInsightStats() {
  const ts = S.trainees,
    closed = ts.filter(
      (t) => t.status === "Completed" && t.summary.trainingDays !== null,
    ),
    active = ts.filter(
      (t) => t.status === "Active" && t.summary.trainingDays !== null,
    );
  return `<div class="card"><h2>Training time</h2><p>Fastest / slowest completed: ${closed.length ? Math.min(...closed.map((t) => t.summary.trainingDays)) + " / " + Math.max(...closed.map((t) => t.summary.trainingDays)) + " days" : "—"}</p><p>Average days so far (Active): ${average(active.map((t) => t.summary.trainingDays))}</p></div><div class="card"><h2>Average across trainees</h2>${[
    "HR",
    "Sales",
    "Operations",
    "Overall",
  ]
    .map((dep) => {
      const values = ts
        .map((t) => {
          const value=departmentCompletion(t,dep);
          return value===null?null:value*100;
        })
        .filter((v) => v !== null);
      return `<p>${dep} completion: ${average(values)}${values.length ? "%" : ""} · ${values.length} trainees</p>`;
    })
    .join("")}${["HR", "Sales", "Operations"]
    .map((dep) => {
      const values = ts
        .map((t) => t.summary.qa.find((r) => r.department === dep)?.score)
        .filter((v) => v != null);
      return `<p>${dep} Q&A: ${average(values)} / 10 · ${values.length} trainees</p>`;
    })
    .join("")}</div>`;
}
async function workflowHandle(action, b) {
  const t = current(),
    key = b.dataset.id;
  if (action === "handover" || action === "handoverEdit") {
    if(b.dataset.phase==="Onboard Final Email"){section="Final onboarding";render();return true;}
    const h =
      action === "handoverEdit" ? t.handovers.find((h) => h.id === key) : {stage:b.dataset.phase,ownerId:t.ownerId,ownerName:t.trainerName,email:t.ownerEmail};
    modal(
      "Handover",
      field("stage", "Next step", h.stage, "select", orderedStages(t).filter(s=>s!=="Onboard Final Email" && canonicalPhase(s)!==canonicalPhase(t.stage)).map(s=>[s,trainingPhaseLabel(s)]), true) +
        field("ownerName", "Next owner name", h.ownerName,"text",[],true) +
        field("email","Next owner email",h.email,"email",[],true)+
        `<details class="notice"><summary>Automatic training summary — scores, trainers & activity history</summary><pre style="white-space:pre-wrap;max-height:320px;overflow:auto">${esc(t.handoverSummary||'Summary will be generated when saved.')}</pre></details>` +
        field("note", "Additional note for next owner", h.manualNote??(h.note?h.note.split('TRAINING HISTORY — AUTOMATIC SUMMARY')[0].trim():'Please continue the next phase training.'), "textarea",[],true) +
        field("mode", "Action", "Email", "select", [["Transfer", "Hand over without email"], ["Email", "Send email & hand over"], ["Draft", "Save draft only"]], true),
      async (p) => {
        const data = payload({ ...p, handoverId: h.id });
        try {
          const saved = await api("draftHandover", data);
          h.id = saved.handoverId;
          if (p.mode === "Transfer")
            await api("activateHandover", { traineeId: saved.traineeId, handoverId: saved.handoverId });
          if(p.mode==='Email')await sendHandoverEmail(saved.traineeId,saved.handoverId);
          await refresh();
        } catch (e) {
          await refresh();
          throw e;
        }
      },
      "Save handover",
    );
    return true;
  }
  if(action==='handoverEmail'){await prepareHandoverEmail(t.id,key);document.querySelector('.communication-card')?.scrollIntoView({behavior:'smooth',block:'start'});return true;}
  if (action === "handoverActivate") {
    await mutate("activateHandover", payload({ handoverId: key }));
    toast("Phase and owner updated. No handover email sent.");
    return true;
  }
  if (action === "handoverSend") {
    try {
      await mutate("sendHandover", payload({ handoverId: key }));
      toast("Handover email sent");
    } catch (e) {
      await refresh();
      throw e;
    }
    return true;
  }
  if (action === "handoverDelete") {
    if (
      confirm("Delete this handover row? Existing training items are retained.")
    )
      await mutate("deleteHandover", payload({ handoverId: key }));
    return true;
  }
  if (action === "handoverStatus") {
    const h = t.handovers.find((h) => h.id === key);
    modal(
      "Handover status",
      field(
        "status",
        "Status",
        h.status,
        "select",
        ["Draft", "Pending", "Completed"],
        true,
      ) +
        (h.stage === "Final Review & Confirmation"
          ? "<p>Record the review status here. Onboarding finishes after the final email and Asset Allotment.</p>"
          : ""),
      (p) => mutate("handoverStatus", payload({ ...p, handoverId: key })),
    );
    return true;
  }
  if (
    action === "feedback" ||
    action === "feedbackNew" ||
    action === "feedbackEdit"
  ) {
    const f =
      action === "feedbackEdit" ? t.feedbackRows.find((f) => f.id === key) : {};
    modal(
      "Feedback row",
      field(
        "rating",
        "Overall rating",
        f.rating,
        "select",
        Object.keys(S.ratings),
      ) +
        field(
          "recommendation",
          "Final recommendation",
          f.recommendation,
          "select",
          ["Confirm", "Extend Training", "Not Confirmed"],
        ) +
        field("strengths", "Strengths", f.strengths, "textarea") +
        field("improve", "Areas to improve", f.improve, "textarea") +
        field("comments", "Comments", f.comments, "textarea"),
      (p) => mutate("feedback", payload({ ...p, feedbackId: f.id })),
    );
    return true;
  }
  if (action === "editTrainee") {
    modal(
      "Edit trainee",
      field("name", "Name", t.name, "text", [], true) +
        field("email", "Email", t.email, "email") +
        field("phone", "WhatsApp number (India: 10 digits; otherwise +country code)", t.phone || "", "tel") +
        field("branch", "Clinic name", t.branch,"select",[...new Set([...S.clinics,t.branch].filter(Boolean))],true)+field("department","Department name",t.department||'',"select",[...new Set([...S.departments,t.department].filter(Boolean))],true) +
        field(
          "designation",
          "Designation",
          t.designation,
          "select",
          S.designations,
          true,
        ) +
        field("joiningDate", "Joining date", t.joiningDate, "date") +
        field("trainerName", "Trainer (profile)", t.trainerName) +
        `<p>Current phase: ${esc(t.stage)}. Change it through Handover after Finish.</p>` +
        field(
          "ownerId",
          "Current owner",
          t.ownerId,
          "select",
          S.users
            .filter((u) => u.active)
            .map((u) => [u.id, u.name + " · " + u.email]),
        ) +
        field(
          "ownerEmail",
          "Current owner email (if not registered)",
          t.ownerEmail,
          "email",
        ) +
        field(
          "status",
          "Status",
          t.status,
          "select",
          ["Active", "Completed", "On Hold", "Dropped"],
          true,
        ) +
        field(
          "closedAt",
          "Closed On (optional override)",
          t.closedAt?.slice(0, 10) || "",
          "date",
        ),
      (p) => {
        if (p.closedAt === (t.closedAt?.slice(0, 10) || "")) delete p.closedAt;
        return mutate("editTrainee", payload(p));
      },
    );
    return true;
  }
  if (action === "deleteTrainee") {
    modal(
      "Delete trainee and related records",
      `<p>This removes ${esc(t.name)} and their checklist, scores, assessments, feedback, handovers, removed items and Academy records. This cannot be undone except from backup.</p>` +
        field("confirmName", "Type the trainee name", "", "text", [], true),
      async (p) => {
        await mutate("deleteTrainee", payload(p));
        selected = null;
        view = "trainees";
        render();
      },
      "Delete trainee",
    );
    return true;
  }
  if (action === "sync") {
    const r = await mutate("sync");
    toast(`${r.added} missing rows added. Existing work retained.`);
    return true;
  }
  if (action === "reminders") {
    const r = await mutate("reminders");
    toast(`${r.count} reminders sent; ${r.failed} failed. See Email delivery.`);
    return true;
  }
  if (action === "emailVerify") {
    await api("emailVerify");
    toast("SMTP connection verified. No email was sent.");
    return true;
  }
  if (action === "retryEmail") {
    const r = S.outbox.find((r) => r.id === key);
    if (
      !confirm(
        r.status === "Delivery uncertain"
          ? "Check your sent email first. Confirm this message was NOT delivered and retry?"
          : "Retry sending this failed email?",
      )
    )
      return true;
    await mutate("retryEmail", {
      id: key,
      confirmedNotSent: r.status === "Delivery uncertain",
    });
    return true;
  }
  if (action === "setupCheck") {
    const r = await api("setupCheck");
    modal(
      "Setup check",
      `<p>Trainees: ${r.trainees}</p><p>${esc(r.scheduler)}</p><p>Email: ${r.email.configured ? "Configured" : "SMTP setup needed"}</p><p>Missing checklists: ${r.missing.map(esc).join(", ") || "None"}</p>`,
      async () => {},
      "Close",
    );
    return true;
  }
  if (["templateAdd", "templateEdit", "templateDelete"].includes(action)) {
    if (!templateData) templateData = await api("templates");
    const index = action === "templateAdd" ? null : Number(key);
    if (action === "templateDelete") {
      if (
        confirm(
          "Delete this template row? Existing trainee rows remain; future generation uses the updated template.",
        )
      ) {
        await api("deleteTemplateRow", { table: templateTable, index });
        templateData = await api("templates");
        await refresh();
      }
      return true;
    }
    const headers = {
      Checklist_Template: ["Module", "Topic", "Phase", "Designation", "Type"],
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
    const row = index === null ? {} : templateData[templateTable][index];
    modal(
      "Edit " + templateTable,
      headers[templateTable]
        .map((k) =>
          field(
            k,
            k,
            row[k] || "",
            k === "Phase" || k === "Type" || k === "Department"
              ? "select"
              : "textarea",
            k === "Phase"
              ? S.stages
              : k === "Type"
                ? ["Theory", "Practical"]
                : k === "Department"
                  ? ["HR", "Sales", "Operations"]
                  : [],
          ),
        )
        .join(""),
      async (values) => {
        await api("saveTemplateRow", { table: templateTable, index, values });
        templateData = await api("templates");
        await refresh();
      },
    );
    return true;
  }
  return false;
}
