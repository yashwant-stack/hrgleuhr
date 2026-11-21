import {appUrl} from './app-url.js';
import {isSystemAdmin,canManageUsers} from './system-admin.js';
import {completeAssetAllotment,finalEmailDelivered} from './onboarding-completion.js';
import {issuedCertificates,issuedCertificate} from './certificate-records.js';
import {materialSharing} from './material-sharing.js';
import {addDesignation, designationOptions} from './designations.js';
import {welcomeDocuments} from './designation-documents.js';
import {deliverTicketMail,escalateOverdueTickets} from './ticket-mail.js';
import {saveAssessment,emailAssessment} from './transition-assessment.js';
import {flowStatus,flowRecord,flowCriteria,flowAction,requireFlow,flowConfirmation,resetFlow,flowSteps,flowPassScore} from './training-flow.js';
import {managementCc} from './management-mail.js';
import {handoverSummary} from './handover-summary.js';
import {lifecycleAction,lifecycleSettings,lifecycleView,acknowledgementAction,issueAcknowledgement,requestCompletionFeedback,phaseMissing,finalMissing,phasePlan} from './lifecycle.js';
import {completeLearningDelivery} from './learning-delivery.js';
import {saveFinalFeedback} from './final-feedback.js';
import {mailJobActive,recoverMailJobs} from './mail-queue.js';
import {deliverLifecycleMail} from './lifecycle-mail.js';
import {ticketAction} from './tickets.js';
import {mentorPlan,mentorHistoryText} from './mentor-plan.js';
import {canonicalPhase,orderedPhases} from './training-phases.js';
import {clinics,departments} from './people-options.js';
import {matchesDesignation} from './training-workflow.js';
import {curriculumFor,curriculumView,curriculumText} from './designation-curricula.js';
import {letterPdf} from './letter-pdf.js';
import {certificatePdf} from './certificate-pdf.js';
import {activeTraining,phaseQuestions,phaseScore,mentorReady,practicalMentorProgress,phaseDepartment} from './phase-training.js';
import {journeyStatus,journeyMutationStep,journeySteps} from "./journey.js";
import {communicationService} from "./communications.js";
import { materials, materialApplies, materialForPhase, materialPhases, materialContent, materialFile, normalizePhone } from "./training-materials.js";
import http from "node:http";
import {
  syncTrainee,
  summary,
  dayNumber,
  localDate,
  ratingMap,
  listValues,
} from "./training-workflow.js";
import { createMailer } from "./mailer.js";
import { workflowService } from "./workflow-service.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, randomInt } from "node:crypto";
import { openStore, id, now, passwordHash, passwordMatches } from "./store.js";
const root = path.dirname(fileURLToPath(import.meta.url));
const training = JSON.parse(
  fs.readFileSync(path.join(root, "seed/training.json")),
);
const academy = JSON.parse(
  fs.readFileSync(path.join(root, "seed/academy.json")),
);
const stages = orderedPhases(training.Lists.map((x) => x.Stages).filter(Boolean));
const designations = training.Lists.map((x) => x.Designation).filter(Boolean);
const ratings = Object.fromEntries(
  training.Lists.filter((x) => x.Rating).map((x) => [
    x.Rating,
    Number(x["Points (out of 10)"]),
  ]),
);
const deptPhase = {
  HR: "Onboarding",
  Sales: "Sales Training",
  Operations: "Operations Training",
};
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { status });
};
const text = (v, max = 1000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
function required(v, label, max = 200) {
  const r = text(v, max);
  if (!r) fail(label + " is required");
  return r;
}
function email(v) {
  const r = required(v, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)) fail("Enter a valid email");
  return r;
}
function date(v) {
  const s = required(v, "Date");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    fail("Invalid date");
  return s;
}
function score(v, max = 10, min = 0) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max)
    fail(`Score must be between ${min} and ${max}`);
  return n;
}
function safeUser(u) {
  const { password, ...rest } = u;
  return {...rest,systemAdmin:isSystemAdmin(u)};
}
function admin(u) {
  if (u.role !== "admin") fail("HR/admin access required", 403);
}
function access(u, t) {
  return u.role === "admin" || t.ownerId === u.id || t.ownerEmail === u.email;
}
function applicable(list, desig, custom) {
  if (!list || list === "All") return true;
  let d = desig;
  for (let i = 0; i < 5 && Object.hasOwn(custom, d); i++) d = custom[d];
  if (d === "All" || d === "Other") return true;
  return list
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(d.toLowerCase());
}
export function createApp({
  dataDir = process.env.DATA_DIR || path.join(root, "data"),
  mailer = createMailer(),
  scheduler = true,
  store: providedStore,
  runtime = {},
  hosted = false,
} = {}) {
  const store = providedStore || openStore(dataDir),
    sessions = runtime.sessions || new Map(),
    attempts = runtime.attempts || new Map(),
    tests = runtime.tests || new Map();
  // Repair legacy global removals once; future removals are trainee-specific.
  store.transaction(db=>{if(!db.traineeMaterialRemovalMigration){db.restoredLibraryMaterialIds=[...(db.archivedMaterialIds||[])];db.archivedMaterialIds=[];db.traineeMaterialRemovalMigration=now();}});
  const materialCatalog=()=>[...materials,...(store.data.uploadedMaterials||[])];
  const allMaterials=()=>materialCatalog().filter(m=>!store.data.archivedMaterialIds?.includes(m.id));
  const readMaterial=m=>m.uploaded ? store.getMaterial(m.id) : materialFile(m);
  const audit = (db, u, action, traineeId, detail = "") => {
    db.audit.push({
      id: id(),
      at: now(),
      actor: u.email,
      action,
      traineeId,
      detail,
    });
  };
  const trainee = (u, p) => {
    const t = store.data.trainees.find((t) => t.id === p.traineeId);
    if (!t) fail("Trainee not found", 404);
    if (!access(u, t) && !t.lifecycle?.plan?.phases.some(ph=>[ph.trainerId,ph.mentorId].includes(u.id))) fail("This trainee is not assigned to you", 403);
    return t;
  };
  store.transaction(db=>{recoverMailJobs(db);for(const t of db.trainees)if(t.status!=='Completed')t.lifecycleRequired??=true;for(const n of db.lifecycleNotifications||[])if(n.status==='Sending'&&!mailJobActive(db,n.id))n.status='Delivery uncertain';for(const message of db.outbox||[])if(message.status==='Sending'&&!mailJobActive(db,message.id)){message.status='Delivery uncertain';message.error='The previous send was interrupted. Check the sent mailbox before retrying.';}});
  const workflow = workflowService({ store, mailer, audit, trainee });
  const communications = communicationService({store,mailer,audit,trainee,welcomeAttachments:async(t,p)=>{
    const attachments=[];
    for(const mid of [...new Set(p.materialIds||[])]){
      const m=allMaterials().find(m=>m.id===mid);if(!m||!materialApplies(m,t,store.data))fail('Select only documents for this designation');
      attachments.push({filename:m.originalName||m.title+'.'+m.format.toLowerCase(),base64:(await readMaterial(m)).toString('base64')});
    }
    if(p.includeTrainingPlan){
      const rows=store.data.trainingTemplates.Checklist_Template.filter(r=>matchesDesignation(r.Designation,t.designation,store.data));
      const plan=t.lifecycle?.plan,course=curriculumFor(t.designation,store.data);const body=(plan?`KRA:\n${plan.kra}\n\nKPI:\n${plan.kpi}\n\nTraining schedule:\n${plan.phases.map(ph=>ph.phase+': '+ph.start+' to '+ph.end).join('\n')}\n\nGuidelines:\n${plan.guidelines}\n\nHR contact: ${plan.hrContact}\n\n`:'')+(course?curriculumText(course):rows.map(r=>`${r.Phase||r.Module} | ${r.Module}\n- ${r.Topic}`).join('\n\n'));
      attachments.push({filename:'Designation-training-plan.pdf',base64:(await letterPdf({subject:'Training plan - '+t.designation,body,unicode:true,name:t.name,designation:t.designation,clinic:t.branch,department:t.department})).toString('base64')});
    }
    return attachments;
  }});
  const sessionUser = (req) => {
    const token = req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("gleuhr_session="))
      ?.slice(15);
    const s = sessions.get(token);
    if (!s || s.until < Date.now()) {
      sessions.delete(token);
      fail("Please sign in", 401);
    }
    const u = store.data.users.find((x) => x.id === s.uid && x.active);
    if (!u) fail("Please sign in", 401);
    return u;
  };
  function login(res, u) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, { uid: u.id, until: Date.now() + 12 * 3600000 });
    res.setHeader(
      "Set-Cookie",
      `gleuhr_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${hosted ? "; Secure" : ""}`,
    );
    return safeUser(u);
  }
  const bank = () => [...academy.questions, ...store.data.customQuestions];
  function snapshot(u) {
    const ts = store.data.trainees.filter((t) => access(u, t)||t.lifecycle?.plan?.phases.some(ph=>[ph.trainerId,ph.mentorId].includes(u.id)));
    const ids = new Set(ts.map((t) => t.id));
    return {
      user: {...safeUser(u),canManageUsers:canManageUsers(store.data,u)},
      tickets: u.role==="admin"?(store.data.tickets||[]).filter(t=>isSystemAdmin(u)||t.creatorId===u.id||t.assigneeId===u.id):[],
      mentorAssignments:store.data.trainees.filter(t=>t.mentor?.userId===u.id&&canonicalPhase(t.mentor.phase)===canonicalPhase(t.stage)).map(t=>({id:t.id,name:t.name,designation:t.designation,stage:t.stage,branch:t.branch,trainerName:t.trainerName,mentor:t.mentor,flowEnabled:t.flowEnabled,trainingFlowStatus:flowStatus(t,store.data),progress:practicalMentorProgress(t,store.data)})),
      clinics,departments,
      lifecycleSettings:store.data.lifecycleSettings||{},
      lifecycleNotifications:(store.data.lifecycleNotifications||[]).filter(n=>u.role==='admin'||String(n.to).split(/[,;]\s*/).includes(u.email)).map(({body,...n})=>n),
      designationPlans:store.data.designationPlans||{},
      unlockRequests:ts.flatMap(t=>(t.unlockRequests||[]).map(r=>({...r,traineeId:t.id,traineeName:t.name}))),
      users: store.data.users
        .filter((x) => u.role === "admin" || x.active)
        .map(safeUser),
      trainees: ts.map((t) => ({
        ...t,
        journey:journeyStatus(t,store.data.records,store.data),
        materialSharingStates:Object.fromEntries((t.approvedMaterials||[]).map(a=>[a.id,materialSharing(t,a.id)])),
        trainingFlowStatus:flowStatus(t,store.data),flowRecord:flowRecord(t),evaluationPassScore:flowPassScore(t),flowCriteria:{TheoryEvaluation:flowCriteria(t,store.data,"TheoryEvaluation"),PracticalEvaluation:flowCriteria(t,store.data,"PracticalEvaluation")},
        lifecycle:lifecycleView(t,store.data),
        communications: communications.view(t),
        issuedCertificates:issuedCertificates(t),
        welcomeDocuments: welcomeDocuments(store.data,t.designation),
        curriculum:curriculumView(t,store.data),
        finalReadiness: communications.readiness(t),
        practicalMentor:practicalMentorProgress(t,store.data),
        mentorReady:mentorReady(t,store.data),
        mentorPlan:mentorPlan(t,store.data),
        handoverSummary:handoverSummary(t,store.data),
        letterMaterialIds:allMaterials().filter(m=>materialApplies(m,t,store.data)).map(m=>m.id),
        removedMaterials:materialCatalog().filter(m=>t.removedMaterialIds?.includes(m.id)&&materialForPhase(m,{...t,removedMaterialIds:[]},store.data)).map(({id,title})=>({id,title})),
        materialIds: allMaterials().filter(m => materialForPhase(m,t,store.data)).map(m=>m.id),
        summary: summary(t),
        activeTraining:activeTraining(t,store.data),
        phaseScore:phaseScore(t,store.data.records,store.data),
        testModules:[...new Map(phaseQuestions(t,store.data,academy).map(q=>[String(q.moduleId),{id:q.moduleId,title:q.moduleTitle||q.moduleId}])).values()],
        feedback: summary(t).feedback,
        checklist: t.checklist.map((r) => ({
          ...r,
          trainingDay: r.covered ? dayNumber(r.coveredAt, t.joiningDate) : null,
        })),
      })),
      records: store.data.records.filter((r) => ids.has(r.traineeId)),
      outbox: store.data.outbox.filter(
        (r) => u.role === "admin" || r.to === u.email,
      ),
      audit: store.data.audit.filter(
        (r) => u.role === "admin" || ids.has(r.traineeId),
      ),
      stages,
      designations: [
        ...new Set([
          ...designations,
          ...Object.keys(store.data.customDesignations),
        ]),
      ],
      ratings,
      ...workflow.snapshot(),
      materials: allMaterials().filter(m => u.role === "admin" || ts.some(t=>materialApplies(m,t,store.data))).map(({filename,aliases,...m})=>({...m,phases:materialPhases(m)})),
      archivedMaterials: u.role === "admin" ? materialCatalog().filter(m=>store.data.archivedMaterialIds?.includes(m.id)).map(({id,title})=>({id,title})) : [],
      aiEnabled: !!process.env.GEMINI_API_KEY,
      resources: [...academy.resources, ...store.data.resources],
      academy: {
        ...academy,
        questions: undefined,
        resources: undefined,
        modules: academy.modules.map(({ quizQuestions, ...m }) => m),
      },
      questionCount: bank().length,
    };
  }
  async function action(u, name, p) {
    if (name === "state") return snapshot(u);
    if(name==='curriculumDownload'){
      const t=trainee(u,p),course=curriculumFor(t.designation,store.data);if(!course)fail('No supplied curriculum for this designation',404);
      return {filename:course.key+'-training-plan.pdf',contentType:'application/pdf',base64:(await letterPdf({subject:'Training plan - '+course.designation,body:curriculumText(course),unicode:true,name:t.name,designation:t.designation})).toString('base64')};
    }
    if (name === 'createDesignation') {
      admin(u);
      return store.transaction(db => {
        const result = addDesignation(db, p.name, p.baseDesignation || 'All');
        if (result.created) audit(db, u, 'Designation added', null, result.designation);
        return { ...result, designations: designationOptions(db) };
      });
    }
    if(name==='testEmail'){
      admin(u);if(p.confirm!==true)fail('Confirm test email');
      if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.to||''))fail('Enter a valid test recipient');
      if(store.data.outbox.some(m=>m.kind==='diagnostic'&&Date.now()-Date.parse(m.at)<60000))fail('Wait one minute before another test');
      const bytes=await certificatePdf({subject:'TEST — Sample certificate',name:'Sample trainee',designation:'Delivery test',certificate:{id:'TEST-ONLY',phase:'Sample training',score:8,by:'Gleuhr HR',at:now()}});
      const msg={id:id(),kind:'diagnostic',to:p.to,subject:'[TEST] Gleuhr email delivery & PDF attachment',body:'Dear team,\n\nThis is an authorised email delivery test from the Gleuhr HR portal. The sample certificate attached contains no real trainee records.\n\nPlease confirm that you can see this formatted email and open the PDF attachment.\n\nHR Team, Gleuhr',status:'Sending',at:now(),sentBy:u.email};
      store.transaction(db=>db.outbox.push(msg));
      try{if(!mailer.deferred)await mailer.verify();const result=await mailer.send({...msg,attachments:[{filename:'TEST-Sample-certificate.pdf',contentType:'application/pdf',content:bytes}]});if(result?.queued){store.transaction(()=>{msg.status='Queued';});return {ok:true,message:'Test email queued. Track its status in Email delivery.'};}store.transaction(()=>{msg.status='Sent';msg.sentAt=now();msg.messageId=result.messageId;msg.accepted=result.accepted;});return {ok:true,message:'Email server accepted the test. Confirm receipt in the inbox.',messageId:result.messageId};}
      catch(e){store.transaction(()=>{msg.status=e.deliveryState==='uncertain'?'Delivery uncertain':'Failed';msg.error=String(e.message).slice(0,500);});fail('Email test failed: '+String(e.message).slice(0,250),502);}
    }

    const origin=hosted?appUrl():'http://localhost:'+(process.env.PORT||3000);
    if(name==='completionFeedback'){const t=trainee(u,p);if(typeof p.enabled!=='boolean')fail('Choose a feedback preference');return store.transaction(db=>{t.completionFeedbackEnabled=p.enabled;t.version++;audit(db,u,'Completion feedback preference changed',t.id,String(p.enabled));return {ok:true};});}
    if(name==='finalFeedback'){const t=trainee(u,p);return store.transaction(db=>saveFinalFeedback(db,u,t,p,origin));}
    if(name==='emailTransitionAssessment'){const t=trainee(u,p);return store.transaction(db=>emailAssessment(db,u,t,p,origin));}
    if(name==='completeAssetAllotment'){const t=trainee(u,p);return store.transaction(db=>completeAssetAllotment(db,u,t,p));}
    if(name==='saveTransitionAssessment'){const t=trainee(u,p);return store.transaction(db=>saveAssessment(db,u,t,p,origin));}
    if(name==='lifecycleReadNotifications')return store.transaction(db=>{for(const n of db.lifecycleNotifications||[])if(u.role==='admin'||String(n.to).split(/[,;]\s*/).includes(u.email)){n.readBy??=[];if(!n.readBy.includes(u.id))n.readBy.push(u.id);}return {ok:true};});
    if(name==='lifecycleSettings')return store.transaction(db=>lifecycleSettings(db,u,p));
    if(name==='lifecycleDeliver'){admin(u);if(p.messageId){store.transaction(db=>{const n=db.lifecycleNotifications?.find(n=>n.id===p.messageId);if(!n||n.status!=='Delivery uncertain'||!['sent','not-sent'].includes(p.result)||!p.note)fail('Review delivery and record evidence first');n.review={by:u.email,at:now(),note:text(p.note)};n.status=p.result==='sent'?'Sent':'Pending';if(p.result==='sent'){n.sentAt=now();const t=db.trainees.find(t=>t.id===n.traineeId);if(n.kind==='welcome')t.lifecycle.welcomeSentAt=n.sentAt;if(n.kind==='final')finalEmailDelivered(db,t,n.sentAt);}});}await deliverLifecycleMail({store,mailer,traineeId:p.traineeId});return {ok:true};}
    if(name==='lifecycleCertificate'){const t=trainee(u,p);if(!t.lifecycle?.finalCertificate)fail('Final certificate is not issued');return {filename:'Training-completion-certificate.pdf',contentType:'application/pdf',base64:(await letterPdf({subject:'Final training completion certificate',body:'All mandatory training and acknowledgements completed.\n\n'+t.lifecycle.finalCertificate.scores.map(e=>e.phase+': '+e.score+'/10').join('\n')+'\n\nHR Head: '+t.lifecycle.finalSignoff.by,name:t.name,designation:t.designation,clinic:t.branch,department:t.department})).toString('base64')};}
    if(name.startsWith('lifecycle')){const t=trainee(u,p);if(t.flowEnabled&&name!=='lifecycleAssets'&&!(name==='lifecycleRequestAck'&&p.kind==='asset'))fail('Use the training stages for this trainee',409);if(['lifecycleCertify','lifecycleSignoff'].includes(name)&&!practicalMentorProgress(t,store.data).ready)fail('Assigned mentor must complete the practical tasks first',409);if(name==='lifecycleEvaluation'&&journeyStatus(t,store.data.records,store.data).Test.blockedBy)fail('Complete Start and Learn before assigning evaluations',409);return store.transaction(db=>lifecycleAction(db,u,t,name,p,origin,allMaterials().filter(m=>materialApplies(m,t,db))));}
    if(name==='retryTicketEmail'){admin(u);const ticket=store.data.tickets?.find(t=>t.id===p.ticketId);if(!ticket||![ticket.creatorId,ticket.assigneeId].includes(u.id))fail('Ticket access required',403);if(ticket.emailStatus!=='Failed')fail('Only confirmed failed emails can be retried',409);await deliverTicketMail({store,mailer,ticketId:ticket.id,origin});return {ok:true,emailStatus:ticket.emailStatus};}
    if(["createTicket","startTicket","resolveTicket","confirmTicket","reopenTicket","commentTicket"].includes(name)){const ticket=store.transaction(db=>ticketAction(db,u,name,p));if(name==='createTicket')await deliverTicketMail({store,mailer,ticketId:ticket.id,origin});return ticket;}
    if(name==='notifications')return store.data.trainees.filter(t=>access(u,t)).flatMap(t=>(t.unlockRequests||[]).map(r=>({...r,traineeId:t.id,traineeName:t.name})));
    if(['enableTrainingFlow','flowRetest','flowChecklist','flowEvaluation','flowComplete','flowResendAcknowledgement'].includes(name)){const t=trainee(u,p);if(!access(u,t))fail('Trainer access required',403);if(p.version!==undefined&&p.version!==t.version)fail('Record changed. Refresh first.',409);return store.transaction(db=>flowAction(db,t,u,name,p,origin));}
    if(name==='requestUnlock'){
      const t=trainee(u,p),reason=required(p.reason,'Reason for correction',2000);
      if(!(p.step?.startsWith('Flow:')?flowStatus(t,store.data).find(s=>s.key===p.step.slice(5))?.complete:journeySteps.includes(p.step)&&journeyStatus(t,store.data.records,store.data)[p.step].complete))fail('Choose a completed step');
      if(t.unlockRequests?.some(r=>r.phase===t.stage&&r.step===p.step&&r.status==='Pending'))fail('A request is already awaiting admin approval',409);
      return store.transaction(db=>{const request={id:id(),phase:t.stage,step:p.step,reason,requestedBy:u.email,requestedAt:now(),status:'Pending'};(t.unlockRequests??=[]).push(request);db.lifecycleNotifications??=[];db.lifecycleNotifications.push({id:id(),key:'correction:'+request.id,kind:'correction',traineeId:t.id,to:db.users.filter(x=>x.active&&x.role==='admin').map(x=>x.email).join(', '),title:'Correction approval requested — '+t.name,body:`Trainee: ${t.name}\nPhase: ${t.stage}\nStep: ${p.step}\n\nRequested by: ${u.email}\n\nReason\n${reason}\n\nReview this request in portal Notifications. Training remains locked until an administrator approves.`,portalUrl:origin+'/?correction='+encodeURIComponent(request.id),status:'Pending',at:now(),readBy:[]});t.version++;audit(db,u,'Correction approval requested',t.id,p.step+': '+reason);return {ok:true};});
    }
    if(name==='reviewUnlock'){
      admin(u);const t=trainee(u,p),request=t.unlockRequests?.find(r=>r.id===p.requestId);
      if(!request||request.status!=='Pending')fail('Request is no longer pending',409);
      if(!['Approved','Rejected'].includes(p.decision))fail('Choose approve or reject');
      if(request.phase!==t.stage)fail('Training phase changed; this old request cannot unlock the new phase',409);
      return store.transaction(db=>{if(request.step==='Practice'){request.originalStep='Practice';request.step='Test';}request.status=p.decision;request.reviewedBy=u.email;request.reviewedAt=now();request.reviewNote=text(p.note,2000);
        if(p.decision==='Approved'&&request.step.startsWith('Flow:'))resetFlow(t,request.step.slice(5));
        if(p.decision==='Approved'&&!request.step.startsWith('Flow:')){t.journeySteps??={};for(const step of journeySteps.slice(journeySteps.indexOf(request.step)))t.journeySteps[step]={complete:false,at:now(),by:u.email,requestId:request.id};if(request.step==='Learn'&&t.phaseSaves)delete t.phaseSaves.checklist;if(['Learn','Practice','Test'].includes(request.step)&&t.phaseSaves)delete t.phaseSaves.scores;}
        t.version++;audit(db,u,'Correction request '+p.decision.toLowerCase(),t.id,request.step+': '+request.reason);return {ok:true};});
    }
    if(name==='prepareCertificateShare'){
      const t=trainee(u,p);if(!access(u,t))fail('Only HR or the current trainer can share the certificate',403);
      if(p.version!==undefined&&p.version!==t.version)fail('Record changed. Refresh and try again.',409);
      const originalVersion=t.version,c=issuedCertificate(t,p.certificateId);if(!c)fail(p.certificateId?'Choose an issued training certificate':'Issue the training certificate first',p.certificateId?404:400);
      if(!['email','whatsapp'].includes(p.channel))fail('Choose Email or WhatsApp');
      const next=p.recipient==='next'?store.data.users.find(x=>x.active&&x.id===p.userId):null;
      if(!['trainee','next'].includes(p.recipient)||p.recipient==='next'&&!next)fail('Choose the trainee or an active next trainer');
      const email=p.recipient==='trainee'?t.email:next.email,phone=normalizePhone(p.phone||(p.recipient==='trainee'?t.phone:''));
      if(p.channel==='email'&&!email)fail('Add the recipient email before sending');
      if(p.channel==='whatsapp'&&!phone)fail('Enter a WhatsApp number with country code');
      const kind='certificate:'+c.id+':'+(next?.id||'trainee'),old=t.communications?.[kind];
      if(old&&store.data.outbox.some(m=>m.communicationId===old.id&&['Queued','Sending','Delivery uncertain'].includes(m.status)))fail('Review the previous email delivery before proceeding',409);
      if(old?.sentAt)return {ok:true,kind,alreadySent:true};
      const subject='Training certificate — '+t.name+' — '+c.phase;
      const body='Certificate of Training\n\nPresented to '+t.name+' ('+t.designation+')\nTraining phase: '+c.phase+'\nScore: '+(c.score==null?'Not assessed':Number(c.score).toFixed(1)+' / 10')+'\nNext training: '+(c.nextTraining||'To be assigned')+'\nIssued by: '+c.by+'\nIssue date: '+c.at+'\nCertificate ID: '+c.id+'\n\n'+(c.note||'');
      const bytes=await certificatePdf({subject,name:t.name,designation:t.designation,clinic:t.branch,department:t.department,certificate:c}),attachmentId='upload-'+id();
      await store.putMaterial(attachmentId,bytes);
      if(trainee(u,p).version!==originalVersion)fail('Record changed. Refresh and try again.',409);
      return store.transaction(db=>{t.communications??={};t.communications[kind]={...old,id:old?.id||id(),kind,recipientName:next?.name||t.name,certificateId:c.id,revision:old?.revision||1,to:email||'',cc:managementCc(store.data.lifecycleSettings,kind,email),phone,subject,body,attachments:[{id:attachmentId,filename:'Training-certificate.pdf',contentType:'application/pdf',bytes:bytes.length}],updatedAt:now(),updatedBy:u.email};t.version++;audit(db,u,'Certificate prepared for sharing',t.id,(next?.name||t.name)+' · '+p.channel);return {ok:true,kind};});
    }
    if(name==='mentorTask'){
      const t=store.data.trainees.find(t=>t.id===p.traineeId);
      if(!t||t.mentor?.userId!==u.id||canonicalPhase(t.mentor.phase)!==canonicalPhase(t.stage))fail('Only the assigned current-phase mentor can complete these tasks',403);
      if(t.flowEnabled){const mentorStage=flowStatus(t,store.data).find(s=>s.key==='Mentor');requireFlow(t,store.data,mentorStage.complete?'Practical':'Mentor');}
      if(!t.flowEnabled&&journeyStatus(t,store.data.records,store.data).Learn.complete)fail('Learning is locked. Request a correction before changing tasks',409);
      const task=practicalMentorProgress(t,store.data).tasks.find(x=>x.id===p.taskId);
      if(!task||typeof p.complete!=='boolean')fail('Choose a current practical task');
      if(task.complete===p.complete)return {ok:true};
      const evidence=task.evidenceRequired&&p.complete?required(p.evidence,'Observed evidence / trainer comment',4000):'';
      return store.transaction(db=>{t.mentor.tasks??=[];let row=t.mentor.tasks.find(x=>x.topicId===task.id);if(!row){row={topicId:task.id,title:task.title};t.mentor.tasks.push(row);}row.complete=p.complete;row.evidence=evidence;row.completedAt=p.complete?now():null;row.by=u.email;const checklistRow=t.checklist.find(r=>r.id===task.id);if(checklistRow){checklistRow.covered=p.complete;checklistRow.coveredAt=row.completedAt;checklistRow.assessor=u.email;checklistRow.remarks=evidence;checklistRow.at=now();}if(t.flowEnabled&&p.complete)flowConfirmation(db,t,'Practical task completed — '+t.name,task.title+'\nMentor: '+u.email+'\nPhase: '+t.stage,origin);t.version++;audit(db,u,'Mentor practical task updated',t.id,task.title+': '+(p.complete?'Completed':'Pending'));return {ok:true};});
    }
    if(name==='assignMentor'){
      if(communications.locked())fail('Email sending is in progress. Please try again shortly.',409);
      const t=trainee(u,p);if(t.flowEnabled)requireFlow(t,store.data,'Mentor');if(!t.flowEnabled&&journeyStatus(t,store.data.records,store.data).Learn.complete)fail('Request a learning correction before changing the mentor',409);if(!access(u,t))fail('Only the current trainer or HR can assign the mentor',403);if(!t.mentor&&!mentorReady(t,store.data))fail('Complete practical checklist and assigned modules before assigning a mentor',409);
      const person=store.data.users.find(x=>x.id===p.mentorId&&x.active);if(!person)fail('Select an active mentor');
      const focus=required(p.focus,'Practical guidance plan',4000),startDate=p.startDate?date(p.startDate):localDate();
      if(t.mentor?.id&&store.data.outbox.some(m=>m.communicationId===t.communications?.['mentor:'+t.mentor.id]?.id&&['Queued','Sending','Delivery uncertain'].includes(m.status)))fail('Review the previous mentor email delivery before changing the assignment.',409);
      const unchanged=t.mentor?.id&&t.mentor.userId===person.id&&t.mentor.focus===focus&&t.mentor.startDate===startDate&&t.mentor.phase===t.stage;
      if(!unchanged)store.transaction(db=>{
        if(t.mentor)(t.mentorHistory??=[]).push(t.mentor);
        t.mentor={id:id(),designation:t.designation,userId:person.id,name:person.name,email:person.email,phase:t.stage,focus,startDate,tasks:practicalMentorProgress(t,db).tasks.map(x=>({topicId:x.id,title:x.title,complete:false})),by:u.email,at:now()};
        const kind='mentor:'+t.mentor.id,score=phaseScore(t,db.records,db);
        t.communications??={};t.communications[kind]={id:id(),kind,portalUrl:origin+'/?view=mentoring',revision:1,to:person.email,cc:'',phone:'',subject:`Mentor assignment — ${t.name}`,body:`Dear ${person.name},\n\nYou have been assigned as the practical training and knowledge mentor for ${t.name}.\n\nDesignation: ${t.designation}\nClinic: ${t.branch||'—'}\nDepartment: ${t.department||'—'}\nTraining phase: ${t.stage}\nGuidance starts: ${startDate}\nCurrent score: ${score==null?'Not assessed':score.toFixed(1)+' / 10'}\n\nPractical guidance plan:\n${focus}\n\n${mentorHistoryText(t,db)}\n\nPlease guide the trainee through practical tasks, reinforce their knowledge and support their initial working days. Open My mentor tasks in the portal and confirm each task after completion. The next training step stays blocked until all practical tasks are complete.\n\nPortal: ${origin}/?view=mentoring\n\nAssigned by: ${u.email}\nHR Team, Gleuhr`,attachments:[],updatedAt:now(),updatedBy:u.email};
        t.version++;audit(db,u,'Mentor assigned',t.id,person.name+' · '+focus);
      });
      try{const delivery=await communications.run(u,'communicationSend',{traineeId:t.id,kind:'mentor:'+t.mentor.id});return {ok:true,emailSent:!delivery.queued,queued:!!delivery.queued};}
      catch(e){return {ok:true,emailSent:false,emailError:'Mentor assigned, but email was not confirmed: '+e.message};}
    }

    if(communications.locked() && !["communicationAttachment"].includes(name))fail("Email delivery is in progress. Please try again shortly.",409);
    const journeyTraineeId=p.traineeId||(name==='submitTest'?tests.get(p.testId)?.traineeId:null);
    if(journeyTraineeId){
      const t=trainee(u,{traineeId:journeyTraineeId});
      if(['certificate','draftHandover','activateHandover','sendHandover'].includes(name)&&!practicalMentorProgress(t,store.data).ready)fail('Complete the current phase practical tasks with the assigned mentor before proceeding',409);
      if(t.lifecycleRequired&&!t.lifecycle?.plan&&(name==='editTrainee'&&p.status==='Completed'||!t.flowEnabled&&name.startsWith('communication')&&p.kind==='final'))fail('Create and approve the mandatory training plan in Lifecycle first',409);
      if(t.lifecycle?.plan&&!t.flowEnabled){
        if(name.startsWith('communication')&&p.kind==='final')fail('Use Lifecycle final HR sign-off and automatic onboarding email',409);
        const plan=t.lifecycle.plan,ph=phasePlan(t),incoming=t.handovers.filter(h=>h.stage===t.stage&&h.status!=='Draft').at(-1);
        if(incoming&&!incoming.acknowledgement&&!['materialContent'].includes(name))fail('Receiving trainer must acknowledge the handover in Lifecycle before this phase begins',409);
        if(name==='editTrainee'&&['ownerId','ownerEmail','designation','joiningDate','trainerName'].some(k=>p[k]!==undefined&&p[k]!==t[k]))fail('Request an approved training plan correction before changing trainer, designation or joining date',409);
        if(!plan.approved&&!(name==='journeyStep'&&p.step==='Start')&&!(name.startsWith('communication')&&p.kind==='welcome'))fail('Training plan is locked pending authorised correction and reapproval',409);
        if(name==='journeyStep'&&p.complete&&['Test','Finish'].includes(p.step)&&phaseMissing(t).length)fail('Pending: '+phaseMissing(t).join(', '),409);
        
        if(['certificate','draftHandover','activateHandover','sendHandover'].includes(name)&&!t.lifecycle.certifications.some(c=>c.planRevision===plan.revision&&c.phase===canonicalPhase(t.stage)))fail('Assigned trainer must certify this phase first',409);
        if(['draftHandover','activateHandover'].includes(name)){const h=name==='activateHandover'?t.handovers.find(h=>h.id===p.handoverId):p;const next=plan.phases[plan.phases.findIndex(x=>x.phase===canonicalPhase(t.stage))+1];if(!next||!h||canonicalPhase(h.stage)!==next.phase||h.ownerId!==next.trainerId)fail('Hand over to the next phase and trainer in the approved plan',409);}
        if(name==='completeMaterial'&&u.id!==ph?.trainerId)fail('Only the assigned phase trainer confirms module completion',403);
      }
      if(name==='activateHandover'&&!t.email)fail('Add the trainee email before handover so they can receive the feedback request',400);
      if(t.flowEnabled&&name==='journeyStep')fail('Use the training stages to complete this step',409);
      if(t.flowEnabled){
        if(p.kind==='welcome'&&name.startsWith('communication')&&!['communicationSend','communicationShare','communicationAttachment','communicationPreview','communicationResolve'].includes(name))requireFlow(t,store.data,'Start');
        const learning=['approveMaterial','completeMaterial','archiveMaterial','materialShareStatus','resourceShare','sendLearningEmail'];
        if(learning.includes(name)){const next=flowStatus(t,store.data).find(s=>!s.complete)?.key;requireFlow(t,store.data,next==='Practical'?'Practical':'Content');}
        if(['certificate','draftHandover','activateHandover','sendHandover'].includes(name))requireFlow(t,store.data,'Handover');
        if(['checklist','saveTrainingRows','assessment','score','startTest','submitTest','addChecklist','archiveEntry','restoreEntry'].includes(name))fail('Use the current training stage to update these records',409);
      }
      if(name==='journeyStep'){
        if(!journeySteps.includes(p.step)||typeof p.complete!=='boolean')fail('Choose a valid step');
        const blocked=journeyStatus(t,store.data.records,store.data)[p.step].blockedBy;
        if(blocked)fail('Complete '+blocked+' before entering '+p.step+'.',409);
        if(p.complete&&!journeyStatus(t,store.data.records,store.data)[p.step].ready)fail(journeyStatus(t,store.data.records,store.data)[p.step].requirement,409);
        if(!p.complete){admin(u);fail('Submit a correction request with a reason and approve it from notifications.',409);}
        if(p.version!==undefined&&p.version!==t.version)fail('Record changed. Refresh and try again.',409);
        return store.transaction(db=>{t.journeySteps??={};t.journeySteps[p.step]={complete:p.complete,at:now(),by:u.email};t.version++;audit(db,u,p.complete?'Journey step completed and locked':'Journey step reopened',t.id,p.step);return {ok:true};});
      }
      const step=journeyMutationStep(name,p,t,store.data.records);
      const accessStep=step||(['materialContent','materialShareStatus','resourceShare','sendLearningEmail'].includes(name)?'Learn':name==='communicationAttachment'?(p.kind==='welcome'?'Start':p.kind==='final'?'Finish':'Handover'):null);
      const previousHandover=name.startsWith('communication')&&p.kind?.startsWith('handover:')&&t.handovers.some(h=>'handover:'+h.id===p.kind&&h.fromStage&&h.fromStage!==t.stage);
      const attachmentCertificateId=t.communications?.[p.kind]?.certificateId;
      const certificateDocument=name==='communicationAttachment'&&attachmentCertificateId&&issuedCertificate(t,attachmentCertificateId)&&p.kind?.startsWith('certificate:'+attachmentCertificateId+':');
      const blocked=!t.flowEnabled&&!previousHandover&&!certificateDocument&&accessStep&&journeyStatus(t,store.data.records,store.data)[accessStep].blockedBy;
      if(blocked)fail('Complete '+blocked+' before entering '+accessStep+'.',409);
      if(!t.flowEnabled&&!previousHandover&&step&&journeyStatus(t,store.data.records,store.data)[step].complete)fail(step+' is completed and locked. Ask HR to reopen it before editing.',409);
    }
    if(name==='saveTrainingRows'){
      const t=trainee(u,p);if(t.version!==p.version)fail('Record changed. Refresh before saving.',409);
      if(!['checklist','scores'].includes(p.kind)||!Array.isArray(p.rows))fail('Choose checklist or scores');
      const active=activeTraining(t,store.data)[p.kind].filter(r=>!r.removed);
      if(p.rows.length!==active.length||new Set(p.rows.map(r=>r.id)).size!==active.length||p.rows.some(r=>!active.some(a=>a.id===r.id)))fail('Save all rows from the current phase');
      const missing=p.rows.filter(r=>p.kind==='checklist'?r.covered!==true:r.score===''||r.score==null);
      if(missing.length)fail(missing.length+' required '+(p.kind==='checklist'?'checklist items are not complete':'scores are missing')+'. Complete them before saving.');
      if(p.kind==='scores'&&p.rows.some(r=>!Number.isInteger(Number(r.score))||r.score<1||r.score>10))fail('Scores must be 1 to 10');
      return store.transaction(db=>{for(const input of p.rows){const row=active.find(r=>r.id===input.id);if(p.kind==='checklist'){row.covered=true;row.contentShared=!!input.contentShared;row.coveredAt??=now();}else row.score=Number(input.score);row.assessor=u.email;row.at=now();}t.phaseSaves??={};t.phaseSaves[p.kind]={at:now(),by:u.email,phase:t.stage};const step=p.kind==='checklist'?'Learn':'Test';if(t.journeySteps?.[step]?.requestId)delete t.journeySteps[step];if(step==='Test'&&t.journeySteps?.Practice?.requestId)delete t.journeySteps.Practice;t.version++;audit(db,u,p.kind+' saved',t.id,t.stage);return {ok:true};});
    }
    if(communications.handles.has(name))return communications.run(u,name,p);
    if(name === "archiveMaterial") {
      if(!p.traineeId)fail('Select a trainee. Modules can only be removed for that trainee.');
      const t=trainee(u,p),m=materialCatalog().find(m=>m.id===p.materialId);
      if(!m)fail('Module not found',404);
      if(typeof p.removed!=='boolean')fail('Choose remove or restore');
      if(!materialForPhase(m,{...t,removedMaterialIds:[]},store.data))fail('Module does not belong to this designation and phase',403);
      return store.transaction(db=>{
        t.removedMaterialIds=(t.removedMaterialIds||[]).filter(x=>x!==m.id);
        if(p.removed){t.removedMaterialIds.push(m.id);t.approvedMaterials=(t.approvedMaterials||[]).filter(x=>x.id!==m.id);t.completedMaterials=(t.completedMaterials||[]).filter(x=>x.id!==m.id);}
        t.version++;
        audit(db,u,p.removed?'Module removed for trainee':'Module restored for trainee',t.id,m.title);
        return {ok:true};
      });
    }
    if(name === "uploadMaterial") {
      if(!['admin','trainer'].includes(u.role))fail('Trainer access required',403);
      const title=required(p.title,'Module title',150),role=required(p.designation,'Designation',100);
      if(!['All',...snapshot(u).designations].includes(role))fail('Choose a valid designation');
      const originalName=required(p.filename,'File name',200).replace(/[\\/\r\n]/g,'_');
      const format=originalName.split('.').pop().toUpperCase();
      if(!['PDF','DOC','DOCX'].includes(format))fail('Upload a PDF, DOC or DOCX file');
      if(typeof p.base64!=='string'||!p.base64.length||p.base64.length>4194304||!/^[A-Za-z0-9+/]+={0,2}$/.test(p.base64))fail('Invalid file or file exceeds 3 MB');
      const bytes=Buffer.from(p.base64,'base64');
      if(!bytes.length||bytes.length>3*1024*1024)fail('File must be between 1 byte and 3 MB');
      const valid=format==='PDF'?bytes.subarray(0,5).toString()==='%PDF-':format==='DOC'?bytes.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1':bytes.subarray(0,2).toString()==='PK'&&bytes.includes(Buffer.from('[Content_Types].xml'))&&bytes.includes(Buffer.from('word/document.xml'));
      if(!valid)fail('File contents do not match the selected document type');
      if(!stages.includes(p.phase))fail('Select a training phase');
      const m={phases:[p.phase],id:'upload-'+id(),title,group:'Uploaded',roles:[role],originalName,format,bytes:bytes.length,uploaded:true,uploadedBy:u.email,uploadedAt:now()};
      await store.putMaterial(m.id,bytes);
      store.transaction(db=>{(db.uploadedMaterials??=[]).push(m);audit(db,u,'Training module uploaded',null,title);});
      return {id:m.id};
    }
    if(name==='sendLearningEmail'){
      const t=trainee(u,p);if(!['admin','trainer'].includes(u.role))fail('Trainer access required',403);
      if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(t.email||''))fail('Add a valid trainee email in Edit details first');
      let title,bytes,filename,material;
      if(p.materialId){material=allMaterials().find(m=>m.id===p.materialId);if(!material||!materialForPhase(material,t,store.data)||!t.approvedMaterials?.some(a=>a.id===material.id))fail('Approve the current phase material for this trainee first',403);title=material.title;bytes=await readMaterial(material);filename=material.originalName||title+'.'+material.format.toLowerCase();}
      else {const r=p.resourceId==='branch-sop'?{title:'Branch operations SOP',contentPreview:JSON.stringify(academy.branch,null,2)}:[...academy.resources,...store.data.resources].find(r=>r.id===p.resourceId);if(!r)fail('Resource not found',404);if(p.reviewed!==true)fail('Review this resource before sending');title=r.title;bytes=await letterPdf({subject:title,body:(r.contentPreview||r.description||'')+(r.url?'\n'+r.url:''),name:t.name,designation:t.designation});filename='Training-resource.pdf';}
      const kind='document:'+(p.materialId||p.resourceId)+(t.flowEnabled?':'+t.stage+':'+(flowStatus(t,store.data).find(s=>!s.complete)?.key||'Content'):''),old=t.communications?.[kind];
      if(old&&store.data.outbox.some(m=>m.communicationId===old.id&&['Queued','Sending','Delivery uncertain'].includes(m.status)))fail('Check Email delivery before retrying this document',409);
      if(old?.sentAt)return {ok:true,alreadySent:true};
      const attachmentId='upload-'+id();await store.putMaterial(attachmentId,bytes);
      store.transaction(()=>{t.communications??={};t.communications[kind]={id:old?.id||id(),kind,documentShare:true,materialId:material?.id,approvalAt:material?t.approvedMaterials.find(a=>a.id===material.id).at:null,phase:t.stage,revision:1,to:t.email,cc:'',phone:t.phone,subject:'Training resource — '+title,body:'Dear '+t.name+',\n\nPlease find your training document attached.\n\nTraining phase: '+t.stage+'\nDocument: '+title+'\nTrainer: '+u.name+'\n\nPlease review the document as part of your training.\n\nHR Team, Gleuhr',attachments:[{id:attachmentId,filename,bytes:bytes.length}],updatedAt:now(),updatedBy:u.email};});
      store.transaction(()=>{t.communications[kind].learningDelivery={materialId:material?.id,resourceId:p.resourceId,title,phase:t.stage,flowStep:t.flowEnabled?flowStatus(t,store.data).find(s=>!s.complete)?.key:undefined,approvalAt:material?t.approvedMaterials.find(a=>a.id===material.id).at:null,by:u.email,origin};});
      const delivery=await communications.run(u,'communicationSend',{traineeId:t.id,kind});
      if(!delivery.queued)store.transaction(db=>completeLearningDelivery(db,t,t.communications[kind]));
      return {ok:true,queued:!!delivery.queued};
    }
    if(name==='resourceShare'){
      const t=trainee(u,p),r=p.resourceId==='branch-sop'?{title:'Branch operations SOP'}:[...academy.resources,...store.data.resources].find(r=>r.id===p.resourceId);
      if(!r)fail('Resource not found',404);
      if(p.confirmed!==true)fail('Confirm the resource has been sent');
      return store.transaction(db=>{t.resourceShares??=[];t.resourceShares.push({resourceId:p.resourceId,at:now(),by:u.email});t.version++;audit(db,u,'Resource sharing confirmed',t.id,r.title);return {ok:true};});
    }
    if (["materialContent", "completeMaterial", "approveMaterial", "materialShareStatus"].includes(name)) {
      if (!["admin", "trainer"].includes(u.role)) fail("Trainer access required",403);
      const m=allMaterials().find(m=>m.id===p.materialId);
      if(!m)fail("Material not found",404);
      const t=p.traineeId ? trainee(u,p) : null;
      if(t ? !materialForPhase(m,t,store.data) : u.role!=="admin")fail("Material is not assigned to this designation",403);
      const approved=t?.approvedMaterials?.some(r=>r.id===m.id);
      if(name === "materialContent") {
        if(t && !approved && p.review !== true)fail("Trainer approval is required for this material",403);
        return {...m,...(m.uploaded ? {blocks:[{title:m.title,text:'Download the original document to review its contents. After reviewing it, approve it for this trainee.'}]} : materialContent(m.id))};
      }
      if(!t)fail("Select a trainee first");
      if(name === "approveMaterial")return store.transaction(db=>{
        if(typeof p.approved !== "boolean")fail("Choose approve or revoke");
        if(p.approved&&approved)return {ok:true};
        t.approvedMaterials=(t.approvedMaterials||[]).filter(r=>r.id!==m.id);
        if(!p.approved)t.completedMaterials=(t.completedMaterials||[]).filter(r=>r.id!==m.id);
        if(p.approved)t.approvedMaterials.push({id:m.id,at:now(),by:u.email});
        t.version++;audit(db,u,p.approved?"Training material approved":"Training material approval revoked",t.id,m.title);
        return {ok:true};
      });
      if(!approved)fail("Trainer approval is required for this material",403);
      if(name==='materialShareStatus'){
        if(!['prepared','confirmed','reset'].includes(p.status))fail('Invalid sharing status');
        if(p.status==='confirmed'&&p.confirmed!==true)fail('Confirm that you have actually sent this document');
        return store.transaction(db=>{
          const approval=t.approvedMaterials.find(a=>a.id===m.id);t.materialShares??=[];
          const latest=materialSharing(t,m.id);
          if(latest?.status===p.status||(p.status==='prepared'&&latest?.status==='confirmed'))return {ok:true};
          t.materialShares.push({id:id(),materialId:m.id,status:p.status,flowStep:t.flowEnabled?flowStatus(t,db).find(s=>!s.complete)?.key:undefined,approvalAt:approval.at,at:now(),by:u.email});
          if(p.status==='confirmed'&&t.flowEnabled)flowConfirmation(db,t,'Training document shared — '+t.name,m.title+'\nPhase: '+t.stage,origin);
          if(p.status==='confirmed'&&t.lifecycle?.plan?.approved&&phasePlan(t)?.moduleIds.includes(m.id))issueAcknowledgement(db,t,'module',t.lifecycle.plan.revision+':'+m.id,'Module receipt: '+m.title,'Please confirm that you received and reviewed '+m.title,origin);
          t.version++;audit(db,u,p.status==='confirmed'?'Document sharing confirmed by trainer':p.status==='reset'?'Document sharing confirmation corrected':'Document sharing prepared',t.id,m.title);
          return {ok:true};
        });
      }

      return store.transaction(db=>{
        t.completedMaterials??=[];const wasComplete=t.completedMaterials.some(r=>r.id===m.id);
        t.completedMaterials=t.completedMaterials.filter(r=>r.id!==m.id);
        if(p.complete===true&&t.flowEnabled&&!wasComplete)flowConfirmation(db,t,'Module completed — '+t.name,m.title+'\nPhase: '+t.stage,origin);
        if(p.complete===true&&!wasComplete)requestCompletionFeedback(db,t,'material:'+m.id+':'+canonicalPhase(t.stage)+':'+t.approvedMaterials.find(a=>a.id===m.id).at,m.title,origin);
        if(p.complete===true)t.completedMaterials.push({id:m.id,at:now(),by:u.email});
        t.version++;audit(db,u,p.complete?"Training material completed":"Training material reopened",t.id,m.title);
        return {ok:true};
      });
    }
    if (workflow.handles.has(name)) {const t=p.traineeId?trainee(u,p):null,phase=t?.stage;const result=await workflow.run(u,name,p);if(t&&name==='activateHandover'&&t.completionFeedbackEnabled!==false)store.transaction(db=>{const h=t.handovers.find(h=>h.id===p.handoverId);issueAcknowledgement(db,t,'handover-feedback',h.id,'How was your training? — '+t.name,`Please rate your completed training from 1 to 5 stars.\nCompleted department / phase: ${h.fromStage||phase}\nTrainer: ${h.previousTrainerName||h.previousTrainerEmail||'Training team'}\nNext department / phase: ${h.stage}\nYour feedback will be notified only to portal administrators.`,origin);});if(t?.flowEnabled&&name==='activateHandover'&&t.stage!==phase)store.transaction(db=>{t.trainingFlow[canonicalPhase(phase)].steps.Handover={complete:true,at:now(),by:u.email};flowConfirmation(db,t,'Training handover — '+t.name,'Completed phase: '+phase+'\nNext phase: '+t.stage+'\nNext trainer: '+t.trainerName,origin);});return result;}
    if (name === "questionBank") {
      admin(u);
      return bank();
    }
    if (name === "startTest") {
      const t=trainee(u,p),pool=phaseQuestions(t,store.data,academy).filter(q=>!p.moduleId||String(q.moduleId)===String(p.moduleId));
      if (!pool.length) fail("No questions for this module");
      const shuffled = pool.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const questions = shuffled.slice(0, p.moduleId ? 10 : 30).map(q=>{
        const choices=q.options.map((text,i)=>({text,correct:i===q.correctIndex}));
        for(let i=choices.length-1;i>0;i--){const j=randomInt(i+1);[choices[i],choices[j]]=[choices[j],choices[i]];}
        return {...q,options:choices.map(c=>c.text),correctIndex:choices.findIndex(c=>c.correct)};
      }),
        test = {
          id: id(),
          uid: u.id,
          traineeId: t.id,
          moduleId: p.moduleId || null,
          phase:t.stage,
          questions,
          createdAt: now(),
          until: Date.now() + 3600000,
        };
      for (const [k, v] of tests) if (v.until < Date.now()) tests.delete(k);
      tests.set(test.id, test);
      return {
        id: test.id,
        questions: questions.map(
          ({ correctIndex, clinicalRationale, ...q }) => q,
        ),
        until: test.until,
      };
    }
    if (name === "submitTest") {
      const test = tests.get(p.testId);
      if (!test || test.uid !== u.id || test.until < Date.now())
        fail("Test expired. Start a new test.");
      if(trainee(u,{traineeId:test.traineeId}).stage!==test.phase)fail('Training phase changed. Start a new test.',409);
      if (
        !Array.isArray(p.answers) ||
        p.answers.length !== test.questions.length ||
        p.answers.some(
          (a, i) =>
            !Number.isInteger(a) ||
            a < 0 ||
            a >= test.questions[i].options.length,
        )
      )
        fail("Answer every question");
      const result = test.questions.map((q, i) => ({
        question: q.question,
        options: q.options,
        answer: p.answers[i],
        correct: q.correctIndex,
        rationale: q.clinicalRationale,
        ok: p.answers[i] === q.correctIndex,
      }));
      const record = {
        id: id(),
        traineeId: test.traineeId,
        kind: "test",
        at: now(),
        by: u.email,
        title: test.moduleId
          ? `Module ${test.moduleId} test`
          : "Academy full test",
        moduleId: test.moduleId,
        phase:test.phase,
        score: Math.round(
          (result.filter((x) => x.ok).length / result.length) * 100,
        ),
        result,
      };
      store.transaction((db) => {
        db.records.push(record);
        audit(db, u, "Test submitted", test.traineeId);
      });
      tests.delete(p.testId);
      return record;
    }
    if (name === "aiChat") {
      trainee(u, p);
      if (!process.env.GEMINI_API_KEY)
        fail(
          "AI is not configured. Use guided role-play or add GEMINI_API_KEY to .env.",
          503,
        );
      const persona = academy.personas.find((x) => x.id === p.personaId);
      if (!persona) fail("Unknown scenario");
      if (
        !Array.isArray(p.messages) ||
        !p.messages.length ||
        p.messages.length > 30
      )
        fail("Invalid conversation");
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-2.5-flash")}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: `This is a fictional sales training role-play. You play the patient, never the counsellor. Stay in character and reply briefly in the user's language. Do not provide medical instructions. Persona: ${JSON.stringify(persona)}`,
                },
              ],
            },
            contents: p.messages.map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              parts: [{ text: text(m.text, 4000) }],
            })),
            generationConfig: { maxOutputTokens: 500 },
          }),
          signal: AbortSignal.timeout(40000),
        },
      );
      if (!response.ok)
        fail(
          "AI provider could not respond. Check your API key, model and quota. Your work has not been scored.",
          502,
        );
      const d = await response.json(),
        reply = d.candidates?.[0]?.content?.parts
          ?.map((x) => x.text || "")
          .join("");
      if (!reply) fail("AI returned no response. Try again.", 502);
      return { reply };
    }
    return store.transaction((db) => {
      if (name === "createUser") {
        admin(u);
        if(!canManageUsers(db,u)) fail("Only the System Admin can manage user access",403);
        const mail = email(p.email);
        if (db.users.some((x) => x.email === mail))
          fail("Email already exists");
        const password = required(p.password, "Password", 200);
        if (password.length < 10)
          fail("Use at least 10 characters for the password");
        const role = p.role === "admin" ? "admin" : "trainer",
          user = {
            id: id(),
            name: required(p.name, "Name"),
            email: mail,
            role,
            branch: text(p.branch),
            active: true,
            password: passwordHash(password),
          };
        db.users.push(user);
        audit(db, u, "User added", null, mail);
        return safeUser(user);
      }
      if (name === "updateUser") {
        admin(u);
        if(!canManageUsers(db,u)) fail("Only the System Admin can manage user access",403);
        const user = db.users.find((x) => x.id === p.id);
        if (!user) fail("User not found");
        if (user.id === u.id && (p.active === false || p.role === "trainer"))
          fail("You cannot remove your own admin access");
        if (
          p.active === false &&
          db.trainees.some(
            (t) => t.ownerId === user.id && t.status === "Active",
          )
        )
          fail("Reassign active trainees before disabling this account");
        if (p.name) user.name = required(p.name, "Name");
        if (["admin", "trainer"].includes(p.role)) user.role = p.role;
        if (typeof p.active === "boolean") user.active = p.active;
        if (p.password) {
          if (p.password.length < 10) fail("Use at least 10 characters");
          user.password = passwordHash(p.password);
          for (const [k, s] of sessions)
            if (s.uid === user.id) sessions.delete(k);
        }
        audit(db, u, "User updated", null, user.email);
        return {};
      }
      if (name === "createTrainee") {
        admin(u);
        let desig = required(p.designation, "Designation");
        const currentDesignations=db.trainingTemplates.Lists.map(r=>r.Designation).filter(Boolean);
        desig=currentDesignations.find(d=>d.toLowerCase()===desig.toLowerCase())||desig;
        const owner = db.users.find((x) => x.id === p.ownerId && x.active);
        if (p.ownerId && !owner) fail("Select an active trainer");
        if (
          db.trainees.some(
            (t) => t.name.toLowerCase() === text(p.name).toLowerCase(),
          )
        )
          fail("A trainee with this name already exists");
        if (["__proto__", "prototype", "constructor"].includes(desig))
          fail("Choose a different designation");
        if (
          !currentDesignations.includes(desig) &&
          !Object.hasOwn(db.customDesignations, desig)
        ) {
          const base = p.baseDesignation || "All";
          if (!["All", ...currentDesignations,...Object.keys(db.customDesignations)].includes(base))
            fail("Select a valid base designation");
          db.customDesignations[desig] = base;
          db.trainingTemplates.Lists.push({
            Designation: desig,
            "Custom Designation": desig,
            "Use Checklist Of": base,
          });
        }
        if(!owner)fail("Assigned trainer is required");
        const t = {
          id: id(),
          code:
            "TR-" +
            String(
              (db.nextTraineeNumber =
                Math.max(
                  db.nextTraineeNumber || 0,
                  ...db.trainees.map(
                    (t) => Number(t.code?.replace("TR-", "")) || 0,
                  ),
                ) + 1),
            ).padStart(3, "0"),
          name: required(p.name, "Name").replace(/^\p{L}/u,c=>c.toLocaleUpperCase()),
          email: p.email ? email(p.email) : "",
          phone: normalizePhone(p.phone),
          branch: required(p.branch, "Clinic name", 200),
          department:required(p.department,"Department",200),
          designation: desig,
          joiningDate: p.joiningDate ? date(p.joiningDate) : localDate(),
          purpose: ["New Joiner","Reskilling","Revaluation"].includes(p.purpose)?p.purpose:"New Joiner",
          ownerId: owner?.id || null,
          ownerEmail: owner?.email || "",
          trainerName: text(owner.name, 200),
          stage: ["Reskilling","Revaluation"].includes(p.purpose)&&["Sales Training","CRM & Tech Training","Operations Training","Induction"].includes(p.trainingPhase)?p.trainingPhase:"Induction",
          status: "Active",
          closedAt: null,
          version: 1,
          phases: [],
          checklist: [],
          scores: [],
          assessments: [],
          feedback: null,
          feedbackRows: [],
          handovers: [],
          completedModules: [],
          certificate: null,
          createdAt: now(),
          lifecycleRequired:true,flowEnabled:p.flowEnabled===true,
        };
        syncTrainee(t, db);
        db.trainees.push(t);
        audit(db, u, "Trainee created", t.id);
        return t;
      }
      if (name === "addQuestion") {
        admin(u);
        const opts = Array.isArray(p.options)
          ? p.options.map((x) => required(x, "Option", 1000))
          : [];
        if (opts.length !== 4) fail("Four options required");
        const correct = Number(p.correctIndex);
        if (!Number.isInteger(correct) || correct < 0 || correct > 3)
          fail("Select correct answer");
        const phase=p.phase||'Sales Training';if(!stages.includes(phase))fail('Select phase');
        const moduleId=p.moduleId==='phase'?'phase-'+(phaseDepartment(phase)||'Review'):Number(p.moduleId);
        if(p.moduleId!=='phase'&&(phase!=='Sales Training'||!academy.modules.some(m=>m.id===moduleId)))fail('Select a module in this phase');
        db.customQuestions.push({
          id: id(),phase,designation:p.designation||'All',moduleTitle:p.moduleId==='phase'?phase:academy.modules.find(m=>m.id===moduleId)?.title,
          moduleId,
          question: required(p.question, "Question", 3000),
          options: opts,
          correctIndex: correct,
          clinicalRationale: required(p.rationale, "Explanation", 4000),
        });
        audit(db, u, "Question added");
        return {};
      }
      if (name === "addResource") {
        admin(u);
        const url = text(p.url, 2000);
        if (url && !/^https?:\/\//.test(url)) fail("Use an http or https URL");
        db.resources.push({
          id: id(),
          title: required(p.title, "Title"),
          description: text(p.description, 4000),
          category: text(p.category) || "Training",
          contentPreview: text(p.content, 20000),
          url,
          lastUpdated: now().slice(0, 10),
        });
        audit(db, u, "Resource added");
        return {};
      }
      const t = trainee(u, p);
      if (p.version !== undefined && p.version !== t.version)
        fail("This record changed. Refresh and try again.", 409);
      if (workflow.locked(t.id))
        fail(
          "An email is being sent for this trainee. Try again shortly.",
          409,
        );
      if (name === "reorderStages") {
        const allowed = listValues(db, "Stages");
        const expected=[...new Set(allowed.map(canonicalPhase))];
        if (!Array.isArray(p.order) || new Set(p.order).size!==p.order.length || p.order.some(x=>!allowed.includes(x)) || new Set(p.order.map(canonicalPhase)).size!==expected.length) fail("Include each phase exactly once");
        t.stageOrder = orderedPhases(p.order);
      } else if (name === "addChecklist") {
        const phase=required(p.phase,"Phase",100);
        if (!listValues(db,"Stages").includes(phase)) fail("Choose a valid phase");
        const topic=required(p.topic,"Topic",1000), module=required(p.module,"Module",200);
        if (!["Theory","Practical"].includes(p.type)) fail("Choose Theory or Practical");
        if(t.checklist.some(r=>r.module===module && r.topic===topic)) fail("This topic already exists, including in Removed items");
        t.checklist.push({id:id(),topic,module,phase,designation:t.designation,type:p.type,covered:false,removed:false,remarks:"",coveredAt:null,assessor:"",custom:true,addedBy:u.email,addedAt:now()});
      } else if (name === "archiveEntry" || name === "restoreEntry") {
        const kinds=["scores","assessments","feedbackRows","handovers","records","certificate"];
        t.archivedEntries ??= [];
        const archived=name==="restoreEntry" ? t.archivedEntries.find(x=>x.id===p.entryId) : null;
        if(name==="restoreEntry" && !archived) fail("Removed entry not found",404);
        const kind=archived?.kind || p.kind;
        if(!kinds.includes(kind)) fail("Invalid entry type");
        if(kind==="certificate") admin(u);
        const collection=kind==="records" ? db.records : kind==="certificate" ? null : t[kind];
        const entry=archived?.entry || (kind==="certificate" ? t.certificate : collection.find(r=>r.id===p.entryId && (kind!=="records" || r.traineeId===t.id)));
        if(!entry) fail("Entry not found",404);
        if(kind==="handovers" && (entry.status==="Sending" || db.outbox.some(r=>r.handoverId===entry.id && ["Sending","Delivery uncertain"].includes(r.status)))) fail("Resolve the email delivery before removing this handover",409);
        if(archived) {
          if(kind==="certificate") { if(t.certificate)fail("A certificate already exists"); t.certificate=entry; }
          else { if(collection.some(r=>r.id===entry.id))fail("Entry already exists"); if(kind==="handovers")entry.status="Draft"; collection.push(entry); }
          t.archivedEntries=t.archivedEntries.filter(x=>x.id!==archived.id);
        } else {
          t.archivedEntries.push({id:id(),kind,entry:structuredClone(entry),at:now(),by:u.email});
          if(kind==="certificate")t.certificate=null;
          else collection.splice(collection.indexOf(entry),1);
        }
        t.feedback=summary(t).feedback;
      } else if (name === "checklist") {
        const r = activeTraining(t,db).checklist.find((x) => x.id === p.itemId);
        if (!r) fail("Topic is not in this designation and training phase");
        if(t.phaseSaves)delete t.phaseSaves.checklist;
        if (typeof p.removed === "boolean") {
          if (p.removed) {
            r.removed = true;
            r.removedAt = now();
            r.removedBy = u.email;
          } else if (r.removed) {
            r.removed = false;
            r.covered = false;
            r.coveredAt = null;
            r.assessor = "";
            r.remarks = "";
            r.removedAt = null;
            r.removedBy = "";
          }
        }
        if (typeof p.covered === "boolean" && p.covered !== r.covered) {
          r.covered = p.covered;
          r.coveredAt = p.covered ? now() : null;
          r.assessor = p.covered ? u.email : "";
        }
        if (p.remarks !== undefined) r.remarks = text(p.remarks, 4000);
      } else if (name === "score") {
        const r = activeTraining(t,db).scores.find((x) => x.id === p.itemId);
        if (!r) fail("Criterion is not in this designation and training phase");
        if(t.phaseSaves)delete t.phaseSaves.scores;
        r.score = score(p.score, 10, 1);
        if(p.remarks!==undefined)r.remarks = text(p.remarks, 4000);
        if (r.score !== null) r.assessor = u.email;
      } else if (name === "assessment") {
        const r = activeTraining(t,db).assessments.find((x) => x.id === p.itemId);
        if (!r) fail("Question not found");
        const currentRatings = ratingMap(db);
        if (p.rating && !Object.hasOwn(currentRatings, p.rating))
          fail("Invalid rating");
        if(Object.hasOwn(p,"answer"))r.answer = text(p.answer, 6000);
        r.rating = p.rating || "";
        r.score = p.rating ? currentRatings[p.rating] : null;
        r.assessor = p.rating ? u.email : "";
        r.at = p.rating ? now() : null;
      } else if (name === "module") {
        if(!phaseQuestions(t,db,academy).some(q=>String(q.moduleId)===String(p.moduleId)))fail('Module is not in this training phase and designation');
        const moduleId = Number(p.moduleId);
        if (!academy.modules.some((m) => m.id === moduleId))
          fail("Unknown module");
        const wasComplete=t.completedModules.some(x=>x.id===moduleId);
        t.completedModules = t.completedModules.filter(
          (x) => x.id !== moduleId,
        );
        if(p.complete&&!wasComplete)requestCompletionFeedback(db,t,'academy:'+moduleId+':'+canonicalPhase(t.stage),academy.modules.find(m=>m.id===moduleId).title,origin);
        if (p.complete)
          t.completedModules.push({ id: moduleId, at: now(), by: u.email });
      } else if (name === "record") {
        const kinds = [
          "eod",
          "coaching",
          "evaluation",
          "roleplay",
          "branch",
          "outcome",
        ];
        if (!kinds.includes(p.kind)) fail("Invalid record");
        const record = {
          id: id(),
          traineeId: t.id,
          kind: p.kind,
          phase:t.stage,
          title: required(p.title, "Title"),
          notes: required(p.notes, "Notes", 20000),
          score: score(p.score, 100),
          at: now(),
          by: u.email,
          due: p.due ? date(p.due) : null,
          status: text(p.status) || "Open",
          transcript: text(p.transcript, 30000),
          personaId: text(p.personaId),
        };
        db.records.push(record);
      } else if (name === "exercise") {
        if(!phaseQuestions(t,db,academy).some(q=>String(q.moduleId)===String(p.moduleId)))fail('Exercise is not in this training phase and designation');
        const m = academy.modules.find((m) => m.id === Number(p.moduleId));
        if (!m) fail("Module not found");
        const steps = m.exerciseScenario.steps;
        if (!Array.isArray(p.choices) || p.choices.length !== steps.length)
          fail("Complete every exercise step");
        const choices = steps.map((s, i) => {
          const c = s.choices.find((c) => c.id === p.choices[i]);
          if (!c) fail("Invalid choice");
          return {
            step: s.patientStatement,
            choice: c.text,
            tier: c.tier,
            feedback: c.clinicalRationale,
          };
        });
        db.records.push({
          id: id(),
          traineeId: t.id,
          kind: "exercise",
          title: m.exerciseScenario.title,
          at: now(),
          by: u.email,
          choices,
          score: Math.round(
            (choices.reduce(
              (s, c) =>
                s + (c.tier === "good" ? 1 : c.tier === "neutral" ? 0.5 : 0),
              0,
            ) /
              choices.length) *
              100,
          ),
        });
      } else if (name === "certificate") {
        admin(u);
        if(!t.flowEnabled&&!journeyStatus(t,db.records,db).Test.complete)fail('Complete and save the current phase tests and scores before issuing a certificate');
        t.certificate = {
          id: id(),
          at: now(),
          by: u.name,
          score: phaseScore(t,db.records,db),
          phase:t.stage,
          nextTraining: p.nextTraining||"To be assigned at handover",
          note: text(p.note, 4000)||"Training completion approved.",
        };
        if(t.flowEnabled)flowConfirmation(db,t,"Training certificate issued — "+t.name,"Phase: "+t.stage+"\nScore: "+t.certificate.score+" / 10\nIssued by: "+u.name,origin);
      } else if (name === "updateRecord") {
        const r = db.records.find(
          (r) => r.id === p.recordId && r.traineeId === t.id,
        );
        if (
          !r ||
          ![
            "eod",
            "coaching",
            "evaluation",
            "branch",
            "outcome",
            "roleplay",
          ].includes(r.kind)
        )
          fail("Record cannot be edited");
        if (!["Open", "In progress", "Completed"].includes(p.status))
          fail("Invalid status");
        r.status = p.status;
        r.updatedAt = now();
      } else fail("Unknown action", 404);
      t.version++;
      if(name==='assessment'&&t.journeySteps?.Test?.requestId)delete t.journeySteps.Test;
      audit(db, u, name, t.id, name==="checklist" ? (t.checklist.find(r=>r.id===p.itemId)?.topic||"")+(p.removed===true?" · removed":p.removed===false?" · restored":p.covered===true?" · covered":p.covered===false?" · reopened":" · updated") : name==="score" ? (t.scores.find(r=>r.id===p.itemId)?.criterion||"")+" · "+(p.score??"not scored") : name==="assessment" ? (t.assessments.find(r=>r.id===p.itemId)?.question||"")+" · "+(p.rating||"Rating cleared") : p.title||p.kind||p.status||"");
      return { ok: true };
    });
  }
  const handler = async (req, res) => {
    const send = (code, data) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const host = req.headers.host;
      if (!hosted && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || ""))
        fail("Use localhost to access this local app", 403);
      if (req.headers.origin && req.headers.origin !== `${hosted ? "https" : "http"}://${host}`)
        fail("Cross-site request blocked", 403);
      const url = new URL(req.url, `http://${host}`);
      if (url.pathname === "/api/health") return send(200, { ok: true });
      if (url.pathname === "/api/session" && req.method === "GET") {
        let user = null;
        try {
          user = safeUser(sessionUser(req));
        } catch {}
        return send(200, { setup: store.data.users.length === 0, user });
      }
      if (url.pathname === "/api/material" && req.method === "GET") {
        const u=sessionUser(req),m=allMaterials().find(m=>m.id===url.searchParams.get("id"));
        if (!["admin", "trainer"].includes(u.role)) fail("Trainer access required",403);
        if(!m)fail("Material not found",404);
        const tid=url.searchParams.get("traineeId");
        const t=tid ? trainee(u,{traineeId:tid}) : null;
        if(t&&journeyStatus(t,store.data.records,store.data).Learn.blockedBy)fail('Complete Start before entering Learn.',409);
        if(t ? !materialForPhase(m,t,store.data) : u.role!=="admin")fail("Material is not assigned to this designation",403);
        if(t && !t.approvedMaterials?.some(r=>r.id===m.id) && url.searchParams.get("review")!=="1")fail("Trainer approval is required for this material",403);
        res.writeHead(200,{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename="${m.id}.${m.format.toLowerCase()}"; filename*=UTF-8''${encodeURIComponent(m.originalName)}`});
        return res.end(await readMaterial(m));
      }
      if (url.pathname.startsWith("/api/")) {
        if (req.method !== "POST") fail("Use POST", 405);
        if (!req.headers["content-type"]?.startsWith("application/json"))
          fail("JSON required", 415);
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4300000) fail("Request too large", 413);
        }
        let p;
        try {
          p = JSON.parse(body);
        } catch {
          fail("Invalid JSON");
        }
        if (!p || typeof p !== "object" || Array.isArray(p))
          fail("Invalid request");
        if(url.pathname==='/api/ack'){const result=store.transaction(db=>acknowledgementAction(db,p));if(result.traineeId)await deliverLifecycleMail({store,mailer,traineeId:result.traineeId});const {traineeId,...safe}=result;return send(200,safe);}
        if (url.pathname === "/api/setup") {
          if (store.data.users.length) fail("Setup already completed", 409);
          const password = required(p.password, "Password", 200);
          if (password.length < 10) fail("Use at least 10 characters");
          const u = {
            id: id(),
            name: required(p.name, "Name"),
            email: email(p.email),
            password: passwordHash(password),
            role: "admin",
            active: true,
            branch: "",
          };
          store.transaction((db) => db.users.push(u));
          return send(200, login(res, u));
        }
        if (url.pathname === "/api/login") {
          const key = hosted ? String(req.headers["x-vercel-forwarded-for"] || req.socket.remoteAddress).split(",")[0] : req.socket.remoteAddress,
            limit = attempts.get(key);
          if (limit?.count >= 15 && limit.until > Date.now())
            fail("Too many attempts. Try again in 15 minutes.", 429);
          const u = store.data.users.find(
            (u) => u.email === text(p.email).toLowerCase() && u.active,
          );
          if (!u || !passwordMatches(text(p.password, 200), u.password)) {
            attempts.set(key, {
              count: (limit?.until > Date.now() ? limit.count : 0) + 1,
              until: Date.now() + 900000,
            });
            fail("Email or password is incorrect", 401);
          }
          attempts.delete(key);
          return send(200, login(res, u));
        }
        const u = sessionUser(req);
        if (url.pathname === "/api/logout") {
          for (const [k, s] of sessions) if (s.uid === u.id) sessions.delete(k);
          res.setHeader(
            "Set-Cookie",
            "gleuhr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return send(200, {});
        }
        if (url.pathname === "/api/action"){
          const result=await action(u,p.action,p.payload||{});
          if(p.action==='lifecycleSettings'){for(const t of store.data.trainees.filter(t=>t.lifecycle?.plan&&t.status!=='Completed').slice(0,5))await deliverLifecycleMail({store,mailer,traineeId:t.id});}
          if(p.payload?.traineeId&&['saveTransitionAssessment','emailTransitionAssessment','finalFeedback','module','certificate','sendLearningEmail','flowChecklist','flowEvaluation','flowComplete','flowResendAcknowledgement','mentorTask','completeMaterial','activateHandover','lifecyclePlan','lifecycleEvaluation','lifecycleResult','lifecycleRequestAck','lifecycleEscalate','lifecycleApproveChange','lifecycleRequestChange','lifecycleFinalMentor','lifecycleAssets','lifecycleSignoff','lifecycleFeedback','materialShareStatus','requestUnlock'].includes(p.action))await deliverLifecycleMail({store,mailer,traineeId:p.payload.traineeId});
          return send(200,p.includeState?{...result,state:snapshot(u)}:result);
        }
        fail("Route not found", 404);
      }
      if (req.method !== "GET") fail("Method not allowed", 405);
      const routes = {
        "/portal-help.js": "portal-help.js",
        "/help-chat.js": "help-chat.js",
        "/help-chat.css": "help-chat.css",
        "/": "index.html",
        "/material-search.js": "material-search.js",
        "/app.js": "app.js",
        "/milestones.js": "milestones.js",
        "/tickets-ui.js": "tickets-ui.js",
        "/lifecycle-ui.js": "lifecycle-ui.js",
        "/curriculum-ui.js": "curriculum-ui.js",
        "/ack.html": "ack.html",
        "/ack.js": "ack.js",
        "/step-help.js": "step-help.js",
        "/ack.css": "ack.css",
        "/assessment-fields.json": "assessment-fields.json",
        "/transition-ui.js": "transition-ui.js",
        "/workflow-ui.js": "workflow-ui.js",
        "/hr-ui.js": "hr-ui.js",
        "/style.css": "style.css",
        "/design.css": "design.css",
        "/atelier.css": "atelier.css",
        "/refined.css": "refined.css",
        "/fonts/manrope-regular.ttf": "fonts/manrope-regular.ttf",
        "/fonts/manrope-semibold.ttf": "fonts/manrope-semibold.ttf",
        "/fonts/manrope-bold.ttf": "fonts/manrope-bold.ttf",
        "/cursors/rose-arrow.svg": "cursors/rose-arrow.svg",
        "/cursors/rose-hand.svg": "cursors/rose-hand.svg",
        "/gleuhr-logo.png": "gleuhr-logo.png",
      };
      const file = routes[url.pathname];
      if (!file) fail("Not found", 404);
      res.writeHead(200, {
        "Content-Type": file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json") ? "application/json" : file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : "text/html; charset=utf-8",
      });
      res.end(fs.readFileSync(path.join(root, "public", file)));
    } catch (e) {
      send(e.status || 500, {
        error: e.status
          ? e.message
          : "Could not save the request. Check the terminal and try again.",
      });
      if (!e.status) console.error(e);
    }
  };
  const server = http.createServer(handler);
  let escalationTimer;
  if (scheduler) server.on("listening", () => {workflow.startScheduler();let busy=false;escalationTimer=setInterval(async()=>{if(busy)return;busy=true;try{await escalateOverdueTickets({store,mailer});}catch(e){console.error("Ticket escalation failed",e.message);}finally{busy=false;}},60000);escalationTimer.unref();});
  server.on("close",()=>clearInterval(escalationTimer));
  server.on("close", () => workflow.stopScheduler());
  return { server, store, workflow, handler };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Gleuhr People & Academy: http://localhost:${port}\nData is saved locally in data/database.json. Press Ctrl+C to stop.`,
    ),
  );
  server.on("error", (e) => {
    console.error(
      e.code === "EADDRINUSE"
        ? `Port ${port} is busy. Change PORT in .env or stop the other server.`
        : e.message,
    );
    process.exitCode = 1;
  });
}
