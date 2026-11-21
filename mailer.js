import {trainingEmail} from './training-email.js';
import nodemailer from "nodemailer";
import {
  original,
  summary,
  localDate,
  trainingDays,
  diffDays,
} from "./training-workflow.js";
const escape = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// Retry only failures proven to occur before message DATA was submitted.
export function smtpFailure(error) {
  const command=String(error.command||'').toUpperCase();
  const beforeData=['EHLO','HELO','STARTTLS','MAIL FROM','RCPT TO'].includes(command)||command.startsWith('AUTH')||error.code==='EAUTH'||error.code==='EDNS'||['CONNECT_TIMEOUT','GREETING_TIMEOUT'].includes(error.timeoutType)||error.errno==='ECONNREFUSED';
  const notSent=error.deliveryState==='not-sent'||beforeData;
  return {notSent,retryable:notSent&&error.code!=='EAUTH'&&(!error.responseCode||error.responseCode<500)};
}
export function createMailer(env = process.env, {transportFactory=nodemailer.createTransport,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const missing = ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS"].filter(key => !env[key]);
  const setupError = () => `SMTP is not configured for ${env.SMTP_USER || env.SMTP_FROM || "mizraem@gleuhr.com"}. Add ${missing.join(", ")} ${env.VERCEL ? "in Vercel Production environment variables, then redeploy" : "to .env, then restart"}.`;
  const configured = !!(
    env.SMTP_HOST &&
    env.SMTP_FROM &&
    env.SMTP_USER &&
    env.SMTP_PASS
  );
  const port = Number(env.SMTP_PORT) || 587;
  const transport = configured
    ? transportFactory({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 20000,
        disableFileAccess: true,
        disableUrlAccess: true,
      })
    : null;
  return {
    configured,
    from: env.SMTP_FROM || "mizraem@gleuhr.com",
    async send(message) {
      if (!transport)
        throw Error(
          setupError(),
        );
      const mail = {
        from: env.SMTP_FROM,
        to: message.to,
        cc: message.cc || undefined,
        subject: message.subject,
        text: message.body,
        html: message.html || trainingEmail({title:message.subject,body:message.body,url:'https://hrgleuhr.vercel.app'}),
        attachments: (message.attachments||[]).filter(a=>Buffer.isBuffer(a.content)).map(a=>({filename:a.filename,content:a.content,contentType:a.contentType})),
        messageId: `<${message.id}@${(env.SMTP_FROM.match(/@([a-z0-9.-]+)/i)||[])[1]||"gleuhr.com"}>`,
      };
      for(let attempt=0;attempt<2;attempt++){
        try{
          const result=await transport.sendMail(mail);
          if(result.rejected?.length||Array.isArray(result.accepted)&&!result.accepted.length){
            throw Object.assign(Error(result.accepted?.length?'Some recipients were rejected. Review delivery before resending.':'SMTP rejected the recipients. Correct the recipient address before retrying.'),{deliveryState:result.accepted?.length?'uncertain':'not-sent',responseCode:550});
          }
          return {messageId:result.messageId,accepted:result.accepted,attempts:attempt+1};
        }catch(error){
          const failure=smtpFailure(error);
          error.deliveryState=failure.notSent?'not-sent':'uncertain';
          if(attempt===0&&failure.retryable){await pause(750);continue;}
          console.warn('SMTP delivery failed',{code:error.code||'SMTP_FAILURE',command:String(error.command||'unknown').split(' ')[0],responseCode:error.responseCode||null,deliveryState:error.deliveryState,attempts:attempt+1});
          throw error;
        }
      }
    },
    async verify() {
      if (!transport) throw Error(setupError());
      await transport.verify();
      return true;
    },
  };
}
export function emailContent(
  t,
  h,
  { reminder = false, baseUrl = "http://localhost:3000" } = {},
) {
  const final = h.stage === "Onboard Final Email",
    s = summary(t),
    fmt = (n) => (n === null ? "Not scored" : n.toFixed(1) + " / 10");
  const phase = original.PHASES.find((p) => p.stage === h.stage);
  const guide =
    h.stage === "Asset Allotment"
      ? "Tick each asset as it is handed over and record serial numbers/details in Remarks. Mark unneeded items N/A, then hand over to the next owner."
      : h.stage === "Assessment"
        ? "Ask each HR, Sales and Operations question, record the trainee answer and select Excellent / Good / Average. Then hand over."
        : h.stage === "Final Feedback"
          ? "Fill Overall Rating, Final Recommendation, Strengths, Areas to Improve and Comments. Then hand over for Final Review & Confirmation."
          : phase
            ? "Cover the assigned Theory and Practical topics, enter scores (1–10), rate assessment answers and hand over to the next person."
            : "Review the full results and feedback. Mark this Final Review handover Completed to close training.";
  const modules = [
    ...new Set(t.checklist.filter((r) => !r.removed).map((r) => r.module)),
  ].map((m) => {
    const rows = t.checklist.filter((r) => !r.removed && r.module === m);
    return `${m}: ${rows.filter((r) => r.covered).length} / ${rows.length}`;
  });
  const feedback = s.feedback
    ? `Final feedback\nRecommendation: ${s.feedback.recommendation || "-"}\nRating: ${s.feedback.rating || "-"}\nBy: ${s.feedback.by || "-"}\nStrengths: ${s.feedback.strengths || ""}\nAreas to improve: ${s.feedback.improve || ""}\nComments: ${s.feedback.comments || ""}`
    : "";
  const body = final
    ? `Hi ${h.ownerName || "Team"},\n\nWe are happy to confirm that ${t.name} has completed the training programme and is now onboarded with ${original.COMPANY}.\n\nName: ${t.name}\nDesignation: ${t.designation}\nDepartment / Clinic: ${t.branch}\nJoining date: ${t.joiningDate || "-"}\nTraining completed on: ${localDate()}\nTraining duration: ${trainingDays(t) ?? diffDays(localDate(),t.joiningDate) ?? "-"} days\nTrainer: ${t.trainerName || "-"}\n\n${h.note || ""}\n\nWelcome to the team, and all the best in your role.\n- HR Team, ${original.COMPANY}`
    : `Hi ${h.ownerName || "Team"},\n\n${reminder ? "Reminder: the trainee below is still waiting for you to continue the next step of training." : "A trainee has been handed over to you for the next step of training."}\nTrainee: ${t.name}\nNext step: ${h.stage}\nNote: ${h.note || ""}\n\n${guide}\n\nScore summary\n${s.categories
        .filter((x) => x.score !== null)
        .map((x) => x.category + ": " + fmt(x.score))
        .join("\n")}\n${s.qa
        .filter((x) => x.score !== null)
        .map((x) => "Q&A " + x.department + ": " + fmt(x.score))
        .join(
          "\n",
        )}\nOverall: ${fmt(s.overallScore)}\n\n${feedback}\n\nTraining covered\n${modules.join("\n")}\n\nDetailed scores\n${t.scores.map((r) => `${r.category} | ${r.criterion} | ${r.score ?? "-"} | ${r.remarks}`).join("\n")}\n\nOpen the training website: ${baseUrl}\nSign in with your trainer account and select ${t.name}. The website must be reachable from your computer.\n\n- HR Team, ${original.COMPANY}`;
  return {
    to: h.email,
    cc:
      final && t.email && t.email.toLowerCase() !== h.email.toLowerCase()
        ? t.email
        : undefined,
    subject: final
      ? `Onboarding complete: ${t.name} - ${original.COMPANY}`
      : reminder
        ? `Reminder: ${t.name} is waiting for "${h.stage}"`
        : `Trainee handover: ${t.name} → ${h.stage}`,
    body,
    html: trainingEmail({title:final?'Training completed':reminder?'Training reminder':'Training handover',body,url:baseUrl}),
  };
}
