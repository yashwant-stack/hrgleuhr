const cloudHosted = !["localhost", "127.0.0.1"].includes(location.hostname);
const $ = (id) => document.getElementById(id);
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const dt = (x) =>
  x
    ? new Date(x).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const today = () => new Date().toLocaleDateString("en-CA");
const selectedTrainees = new Set();
let S = null,
  view = new URLSearchParams(location.search).get("view")==="mentoring"?"mentoring":"dashboard",
  selected = null,
  section = "Progress report",
  moduleId = null,
  search = "",
  materialSearch = "",
  status = "",
  test = null,
  roleplay = null,
  modalSave = null,
  toastTimer;
let pendingTrainee=new URLSearchParams(location.search).get('trainee');
let pendingCorrection=new URLSearchParams(location.search).get('correction');
let selectedFlowStep=null;
let navigationReady=false, navigationRestoring=false, navigationUndo=false, navigationIndex=0;
function navigationRoute(){return {view,selected,section,moduleId,flowStep:selectedFlowStep};}
function applyNavigationRoute(route){
  view=route.view||'dashboard';selected=route.selected||null;
  if(selected&&!S.trainees.some(t=>t.id===selected))selected=null;
  section=route.section||'Welcome letter';moduleId=route.moduleId||null;selectedFlowStep=route.flowStep||null;
  test=null;roleplay=null;search='';status='';
}
function initialiseNavigation(){
  if(navigationReady)return;
  if(pendingTrainee){
    const target=S.trainees.find(t=>t.id===pendingTrainee);
    if(target){pendingTrainee=null;view='trainees';selected=target.id;section='Training stages';selectedFlowStep=target.trainingFlowStatus?.find(s=>!s.complete&&!s.notRequired)?.key||null;}
    else toast('This trainee is not assigned to this account. Sign in with the receiving trainer account.');
    history.replaceState({hrPortal:true,userId:S.user.id,index:0,route:navigationRoute()},'');navigationIndex=0;navigationReady=true;return;
  }
  const saved=history.state;
  if(saved?.hrPortal&&saved.userId===S.user.id){applyNavigationRoute(saved.route);navigationIndex=saved.index;}
  else {navigationIndex=0;history.replaceState({hrPortal:true,userId:S.user.id,index:0,route:navigationRoute()},'');}
  navigationReady=true;
}
function rememberNavigation(){
  if(navigationRestoring||!navigationReady||test)return;
  const route=navigationRoute(),previous=history.state;
  if(previous?.userId===S.user.id&&JSON.stringify(previous.route)===JSON.stringify(route))return;
  navigationIndex++;
  history.pushState({hrPortal:true,userId:S.user.id,index:navigationIndex,route},'');
}
function goPortalBack(){
  if($('modal')?.open){if(!modalSubmitting)$('modal').close();return;}
  if(navigationIndex>0)history.back();
  else if(view!=='dashboard'||selected){view='dashboard';selected=null;moduleId=null;render();}
}
window.addEventListener('popstate',event=>{
  if(navigationUndo){navigationUndo=false;return;}
  const next=event.state;
  if(!S||!next?.hrPortal||next.userId!==S.user.id)return;
  if(modalSubmitting||inlineSaving||((test||roleplay||hasTrainingDrafts())&&!confirm('Leave without saving pending changes?'))){navigationUndo=true;history.go(navigationIndex-next.index);return;}
  trainingDrafts={};$('modal')?.close();navigationIndex=next.index;navigationRestoring=true;
  try{applyNavigationRoute(next.route);render();}finally{navigationRestoring=false;}
});
let trainingDrafts={};
const draftKey=t=>t.id+'|'+t.stage;
function trainingRows(t,kind){return (t.activeTraining?.[kind]||t[kind]||[]).map(r=>({...r,...trainingDrafts[draftKey(t)]?.[kind]?.[r.id]}));}
function hasTrainingDrafts(){return Object.keys(trainingDrafts).length>0;}
function draftNotice(t,kind){const pending=trainingRows(t,kind).filter(r=>!r.removed&&(kind==='checklist'?!r.covered:r.score==null||r.score==='')).length;return `<div class="training-save-bar"><span class="pending-training-rows" role="status">${pending?pending+' required items pending':'All required items filled'} · ${t.stage}</span>${button('Save '+(kind==='checklist'?'checklist':'scores'),'saveTrainingRows',`data-kind="${kind}"`,'primary')}</div>`;}
const current = () => S?.trainees.find((t) => t.id === selected);
const isAdmin = () => S?.user.role === "admin";
const owner = (t) =>
  S.users.find((u) => u.id === t.ownerId)?.name || t.ownerEmail || "Unassigned";
const items = (t) => (t.activeTraining?.checklist||t.checklist||[]).filter((x) => !x.removed);
const percent = (t) =>
  items(t).length
    ? Math.round(
        (items(t).filter((x) => x.covered).length / items(t).length) * 100,
      )
    : 0;
const average = (a) =>
  a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "—";
const scoreAvg = t => t.phaseScore==null?'—':Number(t.phaseScore).toFixed(1);
const days = (t) => t.summary?.trainingDays ?? "—";
const records = (t, kind) =>
  S.records
    .filter((r) => r.traineeId === t.id && (!kind || r.kind === kind)&&(!['test','evaluation','exercise'].includes(kind)||canonicalPhase(r.phase)===canonicalPhase(t.stage)))
    .slice()
    .reverse();
function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.display = "none"), 5000);
}
async function request(url, data) {
  const r = await fetch(url, {
    method: data ? "POST" : "GET",
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const json = await r.json();
  if (!r.ok) {
    if (r.status === 401 && S) {
      S = null;
      auth(false);
    }
    throw Object.assign(Error(json.error || "Request failed"), {status:r.status});
  }
  return json;
}
const api = (action, payload = {}, includeState = false) =>
  request("/api/action", { action, payload, includeState });
async function refresh(nextState) {
  const previous=S?.trainees.find(t=>t.id===selected);
  S = nextState || await api("state");
  if(previous&&S.trainees.find(t=>t.id===selected)?.stage!==previous.stage){selectedFlowStep=null;section="Training stages";}
  if (selected && !current()) selected = null;
  initialiseNavigation();
  render();
  queueMilestone(previous,S.trainees.find(t=>t.id===selected));
  if(pendingCorrection){
    const requestId=pendingCorrection;pendingCorrection=null;
    if(isAdmin())await handle('reviewUnlock',{dataset:{id:requestId}});
    else toast('Sign in with an administrator account to approve this correction request.');
  }
}
async function mutate(action, payload = {}) {
  const result = await api(action, payload, true);
  await refresh(result.state);
  return result;
}
let flowSaving=false;
function flowEditSnapshot(t){
  if(!t)return null;
  // Delivery receipts and unrelated acknowledgements do not edit these inputs.
  const value={id:t.id,stage:t.stage,designation:t.designation,purpose:t.purpose,ownerId:t.ownerId,email:t.email,status:t.status,flowEnabled:t.flowEnabled,flowRecord:t.flowRecord,flowCriteria:t.flowCriteria,activeTraining:t.activeTraining,practicalMentor:t.practicalMentor,materialIds:t.materialIds,approvedMaterials:t.approvedMaterials,materialSharingStates:t.materialSharingStates,certificate:t.certificate};
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  return JSON.stringify(stable(value));
}
function showFlowConflict(next,before,p){
  S=next;if(selected&&!current())selected=null;initialiseNavigation();render();
  if(selected!==before.id||current()?.stage!==before.stage||selectedFlowStep!==p.step)return;
  for(const el of document.querySelectorAll('[data-flow-rating]')){const row=p.ratings?.find(r=>r.id===el.dataset.flowRating);if(row)el.value=String(row.score||'');}
  for(const el of document.querySelectorAll('[data-flow-check]')){const row=p.rows?.find(r=>r.id===el.dataset.flowCheck);if(row)el.checked=row.complete;}
  if(p.ratings)updateEvaluationAverage();
  if(p.rows){const save=document.querySelector('[data-action="flowSaveChecklist"]');if(save){save.disabled=false;save.textContent='Save checklist & notify trainee';}const complete=document.querySelector('[data-action="flowComplete"]');if(complete)complete.disabled=true;}
}
async function mutateFlow(action,p){
  if(flowSaving)throw Error('A training update is already saving.');
  const before=current(),baseline=flowEditSnapshot(before);
  flowSaving=true;
  try{
    let result;
    try{result=await api(action,p,true);}
    catch(error){
      if(error.status!==409||!error.message.startsWith('Record changed'))throw error;
      const next=await api('state'),updated=next.trainees.find(t=>t.id===p.traineeId);
      if(!updated||flowEditSnapshot(updated)!==baseline){showFlowConflict(next,before,p);throw Error(!updated?'This trainee is no longer available in your workspace.':updated.stage!==before.stage?'Training phase changed. The latest phase is loaded; review it before continuing.':'Training was updated elsewhere. Latest details are loaded; review your entries before saving again.');}
      S=next;
      // Retry once, and only when the editable training data is unchanged.
      try{result=await api(action,{...p,version:updated.version},true);}
      catch(retryError){if(retryError.status===409){showFlowConflict(await api('state'),before,p);throw Error('Training changed again. Your entries are kept; review the latest details and save again.');}throw retryError;}
    }
    await refresh(result.state);return result;
  }finally{flowSaving=false;}
}
function button(label, action, extra = "", cls = "") {
  return `<button type="button" data-action="${action}" ${extra} class="${cls}">${label}</button>`;
}
function options(values, value = "", blank = "Select…") {
  return (
    (blank !== null ? `<option value="">${esc(blank)}</option>` : "") +
    values
      .map((v) => {
        const [id, label] = Array.isArray(v) ? v : [v, v];
        return `<option value="${esc(id)}" ${String(id) === String(value) ? "selected" : ""}>${esc(label)}</option>`;
      })
      .join("")
  );
}
function field(
  key,
  label,
  value = "",
  type = "text",
  opts = [],
  required = false,
) {
  return (
    `<label for="f-${key}">${esc(label)}</label>` +
    (type === "textarea"
      ? `<textarea id="f-${key}" name="${key}" ${required ? "required" : ""}>${esc(value)}</textarea>`
      : type === "select"
        ? `<select id="f-${key}" name="${key}" ${required ? "required" : ""}>${options(opts, value)}</select>`
        : `<input id="f-${key}" name="${key}" value="${esc(value)}" type="${type}" ${required ? "required" : ""} ${type === "number" ? 'min="0" max="100" step="0.1"' : ""} ${type === "password" ? 'minlength="10" autocomplete="new-password"' : ""}>`)
  );
}
function modal(title, html, save, label = "Save") {
  $("modalTitle").textContent = title;
  $("modalFields").innerHTML = html;
  $("modalError").textContent = "";
  $("modalSubmit").textContent = label;
  // The dialog is reused: closing an inline editor must not disable the next form.
  $("modalSubmit").disabled = false;
  $("closeModal").disabled = false;
  modalSave = save;
  $("modal").showModal();
  $("modalFields").scrollTop = 0;
}
function designationPicker(value = '') {
  const names = S.designations.filter(d => !['All', 'Other'].includes(d));
  return field('designation', 'Designation', value, 'select', names, true) +
    '<button type="button" id="addDesignation" class="quiet designation-add" aria-expanded="false" aria-controls="designationEditor">+ Add designation</button>' +
    '<fieldset id="designationEditor" class="designation-editor" hidden disabled><legend>New designation</legend>' +
    '<label for="newDesignationName">Designation name</label><input id="newDesignationName" maxlength="100" required autocomplete="off">' +
    '<label for="newDesignationBase">Use training checklist from</label><select id="newDesignationBase">' + options([['All', 'General training only'], ...names], 'All', null) + '</select>' +
    '<p class="muted">Saved designations are available for future trainees too.</p><p id="designationError" class="error" role="alert"></p>' +
    '<div class="actions"><button type="button" id="saveDesignation" class="primary">Save designation</button><button type="button" id="cancelDesignation">Cancel</button></div></fieldset>';
}
function bindDesignationPicker() {
  const editor = $('designationEditor'), add = $('addDesignation'), select = $('f-designation');
  const setOpen = open => {
    editor.hidden = !open; editor.disabled = !open;
    add.setAttribute('aria-expanded', String(open)); add.hidden = open;
    $('modalSubmit').disabled = open;
    if (open) $('newDesignationName').focus();
  };
  add.onclick = () => setOpen(true);
  $('cancelDesignation').onclick = () => { setOpen(false); select.focus(); };
  $('saveDesignation').onclick = async () => {
    const input = $('newDesignationName');
    if (!input.reportValidity() || modalSubmitting) return;
    modalSubmitting = true; $('closeModal').disabled = true;
    const save = $('saveDesignation'); save.disabled = true; $('cancelDesignation').disabled = true;
    $('designationError').textContent = ''; save.textContent = 'Saving…';
    try {
      const result = await api('createDesignation', { name: input.value, baseDesignation: $('newDesignationBase').value });
      S.designations = result.designations;
      select.innerHTML = options(S.designations.filter(d => !['All', 'Other'].includes(d)), result.designation);
      setOpen(false); input.value = ''; select.focus();
      toast(result.created ? 'Designation saved for current and future trainees.' : 'Existing designation selected.');
    } catch (error) { $('designationError').textContent = error.message; }
    finally { modalSubmitting = false; $('closeModal').disabled = false; save.disabled = false; $('cancelDesignation').disabled = false; save.textContent = 'Save designation'; }
  };
}
$("closeModal").onclick = () => {if(!modalSubmitting)$("modal").close();};
$("modal").addEventListener("cancel",e=>{if(modalSubmitting)e.preventDefault();});
$("modalFields").addEventListener("click",async e=>{
 const emailAction=e.target.closest('[data-action="notificationEmailRetry"],[data-action="notificationEmailReview"]');if(emailAction){emailAction.disabled=true;try{await handle(emailAction.dataset.action,emailAction);if(emailAction.dataset.action==='notificationEmailRetry')await handle('unlockNotifications',emailAction);}catch(error){$('modalError').textContent=error.message;}finally{emailAction.disabled=false;}return;}
 const review=e.target.closest('[data-action="reviewUnlock"],[data-action="viewTraineeFeedback"],[data-action="certificateShare"],[data-action="openAssignedWork"]');if(review){if(review.disabled||modalSubmitting)return;review.disabled=true;try{await handle(review.dataset.action,review);}catch(error){$('modalError').textContent=error.message;}finally{review.disabled=false;}return;}

 const restore=e.target.closest('[data-action="restoreLibraryMaterial"]');
 if(restore){restore.disabled=true;try{await mutate('archiveMaterial',payload({materialId:restore.dataset.id,removed:false}));$('modal').close();toast('Module restored. Trainer approval is required.');}catch(error){$('modalError').textContent=error.message;restore.disabled=false;}return;}

 const b=e.target.closest('[data-action="revokeMaterial"]');if(!b)return;
 b.disabled=true;
 try{await mutate('approveMaterial',{traineeId:current().id,materialId:b.dataset.id,approved:false});$("modal").close();toast('Approval revoked');}catch(error){$("modalError").textContent=error.message;}finally{b.disabled=false;}
});
let modalSubmitting=false;
$("modalForm").onsubmit = async (e) => {
  e.preventDefault();
  if(modalSubmitting)return;
  modalSubmitting=true;const values=Object.fromEntries(new FormData(e.target)),label=$('modalSubmit').textContent;
  $('modalSubmit').disabled=true;$('modalSubmit').textContent='Saving…';$('closeModal').disabled=true;
  try {
    await modalSave(values);
    $("modal").close();
    toast("Saved.");
  } catch (e) {
    $("modalError").textContent = e.message;
  } finally {
    modalSubmitting=false;$("modalSubmit").disabled = false;$("modalSubmit").textContent=label;$("closeModal").disabled=false;
  }
};
function auth(setup) {
  $("app").innerHTML =
    `<div class="hr-auth"><header class="hr-auth-header"><div class="hr-brand"><span class="hr-logo-window"><img src="/gleuhr-logo.png" alt="Gleuhr" width="1930" height="1934"></span><span class="hr-portal-label">HR PORTAL</span></div><span class="hr-header-label">PEOPLE OPERATIONS</span></header><main class="hr-auth-main"><section class="hr-intro"><span class="hr-eyebrow">ONE WORKSPACE. YOUR PEOPLE.</span><h2>Manage people.<br><span>Move forward.</span></h2><p>Your central workspace for onboarding, training and team development.</p><div class="hr-capabilities"><div>${uiIcon('trainees')}<span><strong>People & onboarding</strong><small>Keep every employee journey organised.</small></span></div><div>${uiIcon('materials')}<span><strong>Training & approvals</strong><small>The right resources. Clear accountability.</small></span></div><div>${uiIcon('reports')}<span><strong>Progress & handovers</strong><small>Stay connected at every stage.</small></span></div></div><div class="hr-flow" aria-hidden="true"><span>ONBOARD</span><i></i><span>DEVELOP</span><i></i><span>GROW</span></div></section><section class="hr-login-panel"><div class="hr-login-top"><span>${uiIcon('users')}</span><span>TEAM ACCESS</span></div><div class="login"><h1>${setup ? "Set up HR Portal" : "Sign in to HR Portal"}</h1><p class="muted">${setup ? "Create your HR administrator account to get started." : "Enter your work email and password to access your workspace."}</p><form id="loginForm">${setup ? field("name", "Your name", "", "text", [], true) : ""}${field("email", "Work email", "", "email", [], true)}${field("password", setup ? "Password (at least 10 characters)" : "Password", "", "password", [], true)}<button type="button" id="togglePassword" class="quiet" aria-controls="f-password" aria-pressed="false">Show password</button><p id="loginError" class="error" role="alert"></p><button class="primary">${setup ? "Create workspace" : "Sign in"}${uiIcon('arrow')}</button></form><div class="hr-access-note">${uiIcon('help')}<p>Need access to the portal?<br><strong>Contact your HR administrator.</strong></p></div></div><div class="hr-login-footer">${uiIcon('check')}<span>${cloudHosted ? "Authorised team access" : "Local team workspace"}</span></div></section></main><footer class="hr-auth-footer"><span>© ${new Date().getFullYear()} Gleuhr · HR Portal</span><span>People. Processes. Progress.</span></footer></div>`;
  $("f-email").autocomplete = "username";
  $("f-email").placeholder = "you@gleuhr.com";
  $("f-password").placeholder = "Enter your password";
  $("f-password").autocomplete = setup ? "new-password" : "current-password";
  $("togglePassword").onclick = () => {
    const show = $("f-password").type === "password";
    $("f-password").type = show ? "text" : "password";
    $("togglePassword").textContent = show ? "Hide password" : "Show password";
    $("togglePassword").setAttribute("aria-pressed", String(show));
  };
  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button.primary");
    b.disabled = true;
    try {
      await request(
        setup ? "/api/setup" : "/api/login",
        Object.fromEntries(new FormData(e.target)),
      );
      await refresh();
    } catch (e) {
      $("loginError").textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
}
function uiIcon(name) {
  const paths={dashboard:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',trainees:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',materials:'<path d="M7 3h8l4 4v14H7zM14 3v5h5M10 12h6m-6 4h6M4 7v14"/>',academy:'<path d="m2 9 10-6 10 6-10 6zM6 12v6c4 3 8 3 12 0v-6M22 9v8"/>',resources:'<path d="M3 5h6l2 3h10v12H3z"/>',reports:'<path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/>',outbox:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/>',users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m4-12v6m-3-3h6"/>',questions:'<path d="M5 3h14v18H5zM9 8h6m-6 4h6m-6 4h3"/>',audit:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',templates:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',system:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01"/>',check:'<path d="m5 12 4 4L19 6"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>'};
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.materials}</svg>`;
}
function scoreThresholdPanel(){
 const t=current(),rows=t?[t]:S.trainees,scored=rows.filter(t=>t.phaseScore!=null),value=scored.length?Number(average(scored.map(t=>t.phaseScore))):null;
 const threshold=t?.evaluationPassScore||7.5;
 const band=value===null?'Not assessed':value>=threshold?'Strong':value>=6?'Needs coaching':'Needs improvement';
 return `<section class="score-threshold" aria-label="Score and thresholds"><div><small>${t?esc(t.name):'Workspace average'}</small><strong>${value===null?'—':value.toFixed(1)} / 10 <span>${band}</span></strong></div><div><progress max="10" value="${value??0}" aria-label="Current score out of ten"></progress><small>Target ≥ ${threshold} · Below target requires review / retest</small></div>${t?`<span>${percent(t)}% checklist complete</span>`:`<span>${scored.length} trainees scored</span>`}${button('Live score ↗','liveScore','','quiet')}</section>`;
}
function materialSharing(t,m){return t?.materialSharingStates?.[m.id]||null;}
function materialRecipients(m) {
  return (S?.trainees||[]).flatMap(t=>{
    const share=materialSharing(t,m);
    return share?.status==='confirmed'?[{trainee:t,share}]:[];
  }).sort((a,b)=>a.trainee.name.localeCompare(b.trainee.name));
}
function materialRecipientsSummary(m) {
  const recipients=materialRecipients(m);
  return `<div class="material-recipients ${recipients.length?'is-shared':''}"><strong>Shared with</strong><p>${recipients.length?recipients.slice(0,3).map(r=>esc(r.trainee.name)).join(', ')+(recipients.length>3?` +${recipients.length-3} more`:''):'No confirmed shares yet'}</p>${button(`View shared with (${recipients.length})`,'viewMaterialRecipients',`data-id="${esc(m.id)}"`)}</div>`;
}
function materialRecipientsDetails(m) {
  const recipients=materialRecipients(m);
  return `<p><strong>${esc(m.title)}</strong></p><p class="muted">Trainer-confirmed sharing records for trainees you can access.</p>${recipients.length?recipients.map(({trainee:t,share})=>`<article class="material-recipient"><strong>${esc(t.name)}</strong><p>${esc(t.designation||'')}</p><span class="badge shared-confirmed">Shared · ${dt(share.at)}</span><p class="muted">Confirmed by ${esc(share.by)}</p></article>`).join(''):empty('No confirmed shares yet. Opening WhatsApp does not confirm that a document was sent.')}`;
}
function materialStatus(t,m){const share=materialSharing(t,m),done=t?.completedMaterials?.some(a=>a.id===m.id);return `<div class="material-state"><span class="badge ${share?.status==='confirmed'?'shared-confirmed':''}">${share?.status==='confirmed'?'✓ Shared — trainer confirmed':share?.status==='prepared'?'Sharing prepared — not confirmed':'No sharing confirmation'}</span>${share&&share.status!=='reset'?`<small>${dt(share.at)} · ${esc(share.by)}</small>`:''}${done?'<span class="badge shared-confirmed">✓ Learning complete</span>':''}</div>`;}
function shell(content) {
  rememberNavigation();
  const links = [
    ["dashboard", "Dashboard"],
    ["trainees", "Trainees"],
    ["materials", "Modules & handbooks"],
    ["academy", "Sales Academy"],
    ["tests", "Test centre"],
    ["resources", "Resources & SOPs"],
    ["reports", "Progress & insights"],
    ["audit", "Activity log"],
    ["outbox", "Email delivery"],
    ["mentoring", "My mentor tasks"],
    ...(isAdmin()
      ? [
          ["users", "Users & trainers"],
          ["hrconnect", "HR head connect"],
          ["mgmtconnect", "MGMT connect"],
          ["tickets", "Tickets ("+(S.tickets||[]).filter(t=>t.status!=="Closed").length+")"],

          ["templates", "Training templates"],

        ]
      : []),

  ];
  const initials=S.user.name.trim().split(/\s+/).slice(0,2).map(n=>n[0]).join('');
  $("app").innerHTML =
    `<div class="shell" data-view="${esc(view)}"><aside><a class="brand portal-brand" href="/" aria-label="Gleuhr HR Portal"><span class="portal-logo"><img src="/gleuhr-logo.png" alt="Gleuhr" width="1930" height="1934"></span><span>HR PORTAL</span></a><div class="nav-caption">WORKSPACE</div><nav aria-label="Main navigation">${links.map(([id,label])=>(id==='users'?'<div class="nav-caption">MANAGEMENT</div>':'')+button(uiIcon(id)+`<span>${esc(label)}</span>`,'nav',`data-view="${id}" ${view===id?'aria-current="page"':''}`,view===id?'active':'')).join('')}</nav><div class="aside-note"><span class="workspace-dot"></span>${cloudHosted?'Team workspace':'Local workspace'}<small>People. Progress. Possibility.</small></div></aside><main><header><div class="breadcrumb">${button('← Back','historyBack',navigationIndex>0?'':'disabled','portal-back')}Workspace <span>/</span> <strong>${esc(links.find(x=>x[0]===view)?.[1]||'Training')}</strong></div><div class="account"><span class="avatar">${esc(initials)}</span><span class="account-name"><strong>${esc(S.user.name)}</strong><small>${S.user.systemAdmin?'System Admin':isAdmin()?'HR administrator':'Trainer'}</small></span>${isAdmin()&&(S.unlockRequests||[]).some(r=>r.status==='Pending')?button('Approve corrections ('+S.unlockRequests.filter(r=>r.status==='Pending').length+')','unlockNotifications','','primary'):''}${button('Notifications ('+((S.unlockRequests||[]).filter(r=>r.status==='Pending').length+(S.lifecycleNotifications||[]).filter(n=>!n.readBy?.includes(S.user.id)).length)+')','unlockNotifications')}${button('Sign out','logout','','quiet')}</div></header><div class="page-content">${view==='tickets'||(['dashboard','trainees'].includes(view)&&!selected)?'':scoreThresholdPanel()}${['materials','academy'].includes(view)?journeyLockBanner(current()):''}${content}</div><div class="footer"><strong>gleuhr</strong><span>People & Academy · ${cloudHosted?'Team workspace':'Local workspace'}</span><span>Made for meaningful progress.</span></div></main></div>`;

}
function heading(title, desc = "", actions = "") {
  return `<div class="row page-heading"><div><div class="eyebrow">PEOPLE & DEVELOPMENT</div><h1>${esc(title)}</h1>${desc ? `<p class="muted">${esc(desc)}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
}
let dashboardFilter={range:'all',from:'',to:'',clinic:'',department:'',purpose:''};
const trainingPurpose=t=>({'New Hire Onboarding':'New Joiner','Reskilling / Upskilling':'Reskilling','Re-evaluation / PIP':'Revaluation'})[t.purpose]||t.purpose;
function dashboardTrainees(){
 const f=dashboardFilter;let from=f.from,to=f.to;const now=new Date(),end=activityDate(now);
 if(f.range==='today')from=to=end;
 if(f.range==='week'){const start=new Date(now);start.setDate(start.getDate()-6);from=activityDate(start);to=end;}
 if(f.range==='month'){from=end.slice(0,8)+'01';to=end;}
 if(f.range==='all')from=to='';
 return S.trainees.filter(t=>(!f.clinic||t.branch===f.clinic)&&(!f.department||t.department===f.department)&&(!f.purpose||trainingPurpose(t)===f.purpose)&&(!from&&!to||[t.createdAt,...S.audit.filter(a=>a.traineeId===t.id).map(a=>a.at)].filter(Boolean).some(at=>{const date=activityDate(at);return (!from||date>=from)&&(!to||date<=to);})));}
function dashboardFilters(){const f=dashboardFilter;return `<div class="dashboard-filters" aria-label="Training status filters"><label>Period<select id="dashRange">${options([['all','All time'],['today','Today'],['week','Last 7 days'],['month','This month'],['custom','Custom']],f.range)}</select></label><div class="dashboard-custom-dates" ${f.range==='custom'?'':'hidden'}><label>From<input id="dashFrom" type="date" value="${f.from}"></label><label>To<input id="dashTo" type="date" value="${f.to}"></label></div><label>Clinic<select id="dashClinic">${options([...new Set(S.trainees.map(t=>t.branch).filter(Boolean))],f.clinic,'All clinics')}</select></label><label>Department<select id="dashDepartment">${options([...new Set(S.trainees.map(t=>t.department).filter(Boolean))],f.department,'All departments')}</select></label><label>Type<select id="dashPurpose">${options(['New Joiner','Reskilling','Revaluation'],f.purpose,'All types')}</select></label>${button('Apply','dashboardFilter','','primary')}${button('Reset','dashboardClear','','quiet')}</div>`;}
function stats() {
  const ts = dashboardTrainees();
  const closed = ts.filter((t) => t.status === "Completed");
  return `<div class="stats">${[
    ["Trainees", ts.length, "In your workspace"],
    [
      "In training",
      ts.filter((t) => t.status === "Active").length,
      "Active journeys",
    ],
    ["Completed", closed.length, "Training closed"],
    [
      "Avg. days to close",
      average(
        closed.map((t) => t.summary.trainingDays).filter((x) => x !== null),
      ),
      "Completed trainees",
    ],
  ]
    .map(
      ([label, n, note],i) =>
        `<div class="stat stat-${i}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${uiIcon(["trainees","academy","check","audit"][i])}</span></div><strong>${n}</strong><small>${note}</small></div>`,
    )
    .join("")}</div>`;
}
function traineeTable(ts) {
  const visible=new Set(ts.map(t=>t.id));
  for(const id of selectedTrainees)if(!visible.has(id))selectedTrainees.delete(id);
  const controls=`<div class="directory-toolbar"><div><span class="directory-dot"></span><strong>${ts.length} trainee${ts.length===1?'':'s'}</strong><span class="directory-hint">Select a name to view their journey</span></div>${isAdmin()?`<div class="bulk-trainee-actions"><span id="traineeSelectionCount">${selectedTrainees.size} selected</span>${button('Delete selected','deleteSelectedTrainees',selectedTrainees.size?'':'disabled','danger')}</div>`:''}</div>`;
  return `<div class="people-directory">${controls}`+(ts.length
    ? `<div class="table directory-table"><table><thead><tr>${isAdmin()?`<th class="trainee-select"><input type="checkbox" data-select-trainees="all" aria-label="Select all visible trainees" ${ts.every(t=>selectedTrainees.has(t.id))?'checked':''}></th>`:''}<th>Trainee</th><th>Training phase</th><th>Progress</th><th>Live score</th><th>Training days</th><th>Status</th></tr></thead><tbody>${ts.map((t,i)=>{const progress=percent(t),value=scoreAvg(t),n=Number(value),rated=value!=='—'&&Number.isFinite(n),tone=rated?(n>=8?'good':n>=6?'coaching':'low'):'unrated',initials=String(t.name).trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('');return `<tr>${isAdmin()?`<td class="trainee-select"><input type="checkbox" data-select-trainee="${esc(t.id)}" aria-label="Select ${esc(t.name)}" ${selectedTrainees.has(t.id)?'checked':''}></td>`:''}<td data-label="Trainee"><div class="person-identity"><span class="person-monogram tone-${i%3}" aria-hidden="true">${esc(initials)}</span><div>${button(esc(t.name),"open",`data-id="${t.id}"`,"link person-name")}<small>${esc(t.designation)}</small><span class="person-clinic">${esc(t.branch||'Clinic not set')}</span></div></div><div class="person-contact">${whatsAppLink(t)}</div></td><td data-label="Training phase"><span class="phase-chip"><span></span>${esc(trainingPhaseLabel(t.stage,t))}</span><small class="directory-trainer">Trainer · ${esc(owner(t))}</small></td><td data-label="Progress"><div class="directory-progress ${progress===100?'is-complete':''}"><div><strong>${progress}%</strong><span>${progress===100?'Complete':progress?'In progress':'Not started'}</span></div><div class="bar" role="progressbar" aria-label="${esc(t.name)} checklist progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div></div></td><td data-label="Live score"><span class="directory-score ${tone}"><strong>${rated?esc(value):'—'}</strong>${rated?'<small>/ 10</small>':''}</span><small class="score-caption">${rated?(n>=8?'On target':n>=6?'Needs coaching':'Needs improvement'):'Awaiting evaluation'}</small></td><td data-label="Training days"><span class="directory-days">${days(t)}<small>day${days(t)===1?'':'s'}</small></span></td><td data-label="Status"><span class="directory-status ${t.status==='Active'||t.status==='Completed'?'positive':'neutral'}"><i></i>${esc(t.status)}</span></td></tr>`;}).join('')}</tbody></table></div>`
    : '<div class="empty">No trainees here yet. HR/admin can add the first trainee.</div>')+'</div>';
}
function workspaceHero(){
 const trainees=dashboardTrainees(),progress=trainees.length?Math.round(trainees.reduce((n,t)=>n+percent(t),0)/trainees.length):0;
 const name=String(S.user.name||'').trim().split(/\s+/)[0];
 return `<section class="workspace-hero"><div class="hero-copy"><div class="hero-kicker"><span></span> YOUR PEOPLE. THEIR POTENTIAL.</div><h1>${view==='dashboard'?`A little guidance.<br><em>A lot of growth.</em>`:'People at the heart<br><em>of every milestone.</em>'}</h1><p>${view==='dashboard'?`Welcome back${name?', '+esc(name):''}. Let's move your team forward.`:'One clear view of every trainee, every stage and every next step.'}</p><div class="actions">${isAdmin()?button('+ Add new trainee','addTrainee','','primary'):button('View trainees','nav','data-view="trainees"','primary')}${button('Training insights '+uiIcon('arrow'),'nav','data-view="reports"','hero-secondary')}</div></div><div class="hero-progress" aria-label="Average checklist progress ${progress}%"><svg viewBox="0 0 180 180" aria-hidden="true"><circle class="orbit-track" cx="90" cy="90" r="74"/><circle class="orbit-value" cx="90" cy="90" r="74" pathLength="100" stroke-dasharray="${progress} 100"/></svg><div><span>LEARNING IN MOTION</span><strong>${progress}<small>%</small></strong></div><div class="orbit-caption"><p>Average checklist progress</p><span class="orbit-label">${trainees.length} trainee${trainees.length===1?'':'s'} · Every step matters</span></div></div></section>`;
}
function overview() {
  const ts = dashboardTrainees().filter(
    (t) =>
      (!search ||
        `${t.name} ${t.branch} ${t.designation}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!status || t.status === status),
  );
  return (
    workspaceHero()+scoreThresholdPanel()+
    dashboardFilters()+stats() +
    (view==='dashboard'?trainingInsights(dashboardTrainees())+lifecycleDashboard(dashboardTrainees()):'')+
    `<div class="directory-heading"><div><h2>Training directory</h2><p class="muted">A clear view of your team's progress.</p></div><span class="count-pill">${S.trainees.length} people</span></div><div class="filters"><input id="search" aria-label="Search trainees" placeholder="Search name, clinic or designation" value="${esc(search)}"><select id="status" aria-label="Status">${options(["Active", "Completed", "On Hold", "Dropped"], status, "All statuses")}</select>${button("Refresh", "refresh")}</div><div id="traineeTable">${traineeTable(ts)}</div>`
  );
}
function isFinalFeedback(t){return ['Final Feedback','Final Review & Confirmation','Final Feedback & Confirmation'].includes(t?.stage);}
function isAdministrative(t){return isFinalFeedback(t)||['Onboard Final Email','Asset Allotment'].includes(t?.stage);}
function flowNav(t){
 if(isAdministrative(t))return '';
 selectedFlowStep??=t.trainingFlowStatus.find(s=>!s.complete)?.key;
 const presentation={Start:['outbox','Start'],Educate:['academy','Educate'],Content:['materials','Content'],TheoryEvaluation:['reports','Theory test'],TheoryAcknowledgement:['check','Theory ack'],Mentor:['users','Mentor'],Practical:['templates','Practical'],PracticalEvaluation:['reports','Practical test'],PracticalAcknowledgement:['check','Practical ack'],Handover:['arrow','Handover']};
 const visible=t.trainingFlowStatus.filter(s=>!s.notRequired&&!(s.key==='Start'&&['Reskilling','Revaluation'].includes(trainingPurpose(t))));let number=0;
 return `<nav class="flow-roadmap" aria-label="Training stages">${visible.map(s=>{const [icon,label]=presentation[s.key],position=s.key==='Start'?'Welcome':++number;const status=s.complete?'Completed · Locked':s.blockedBy?'Locked':'Current step';return button(`<span class="flow-step-icon">${uiIcon(s.complete?'check':icon)}</span><strong>${label}</strong><small>${position} · ${s.complete?'Done':s.blockedBy?'Locked':'Current'}</small>`,'flowOpen',`data-step="${s.key}" data-step-help="${s.key}" data-step-status="${esc(status)}" aria-label="${esc(position+'. '+s.label+' — '+status)}" aria-current="${selectedFlowStep===s.key?'step':'false'}" ${s.blockedBy?'disabled':''}`,s.complete?'flow-done':selectedFlowStep===s.key?'flow-current':'');}).join('')}</nav>`;
}
function evaluationAverage(values){
 const rated=values.filter(v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=1&&Number(v)<=10).map(Number);
 return {count:rated.length,average:rated.length?rated.reduce((a,b)=>a+b,0)/rated.length:null};
}
function evaluationAverageCard(t,step){
 const criteria=t.flowCriteria[step]||[],record=t.flowRecord.evaluations?.[step],saved=record?.ratings?.length?record:null,stats=evaluationAverage(criteria.map(c=>saved?.ratings.find(r=>r.id===c.id)?.score));
 return `<div class="evaluation-average" role="region" aria-label="Live evaluation average"><div><small>LIVE LATEST EVALUATION AVERAGE</small><strong data-evaluation-average>${stats.average===null?'—':stats.average.toFixed(1)} <span>/ 10</span></strong></div><div><p data-evaluation-count>${stats.count} of ${criteria.length} rated</p><p data-evaluation-state>${saved?'Saved evaluation':'Rate an item to see the average'}</p><small>Only rated items count · Target ${t.evaluationPassScore||7.5} / 10</small></div><progress data-evaluation-progress max="10" value="${stats.average??0}" aria-label="Evaluation average out of ten"></progress><output class="sr-only" data-evaluation-announcement aria-live="polite"></output></div>`;
}
function updateEvaluationAverage(){
 const fields=[...document.querySelectorAll('[data-flow-rating]')],card=document.querySelector('.evaluation-average');if(!card)return;
 const stats=evaluationAverage(fields.map(el=>el.value)),saved=current()?.flowRecord.evaluations?.[selectedFlowStep];
 const dirty=fields.some(el=>String(saved?.ratings.find(r=>r.id===el.dataset.flowRating)?.score??'')!==el.value);
 const display=stats.average===null?'—':stats.average.toFixed(1);
 card.querySelector('[data-evaluation-average]').innerHTML=display+' <span>/ 10</span>';
 card.querySelector('[data-evaluation-count]').textContent=stats.count+' of '+fields.length+' rated';
 card.querySelector('[data-evaluation-state]').textContent=dirty?'Unsaved preview · Save evaluation to update dashboard':saved?'Saved evaluation':'Rate an item to see the average';
 card.querySelector('[data-evaluation-progress]').value=stats.average??0;
 card.querySelector('[data-evaluation-announcement]').textContent='Average '+display+' out of 10; '+stats.count+' of '+fields.length+' rated.';
 card.classList.toggle('is-unsaved',dirty);
 const complete=document.querySelector('[data-action="flowComplete"]');if(complete)complete.disabled=dirty||!current()?.trainingFlowStatus.find(s=>s.key===selectedFlowStep)?.ready;
}
function flowPanel(t){
 if(isFinalFeedback(t))return finalFeedbackPanel(t);
 if(t.stage==='Asset Allotment')return assetAllotmentPanel(t);
 if(t.stage==='Onboard Final Email')return t.lifecycle?.plan&&!t.flowEnabled?lifecycleWelcome(t,true):communicationView(t,'final');
 const states=t.trainingFlowStatus.filter(s=>!s.notRequired&&!(s.key==='Start'&&['Reskilling','Revaluation'].includes(trainingPurpose(t)))),step=states.find(s=>s.key===selectedFlowStep)||states.find(s=>!s.complete)||states[0];selectedFlowStep=step.key;
 if(!t.flowEnabled)return `<div class="card"><h2>Theory to practical, one step at a time</h2><p>Start the nine-stage workflow for ${esc(t.name)}. Existing training records remain available. New completions send a confirmation link to the trainee.</p>${button('Start training workflow','flowEnable','','primary')}</div>`;
 let body='',disabled=step.complete?'disabled':'';
 const purposeNote=trainingPurpose(t)==='Revaluation'?'Revaluation · Assess current competency first. Below 8/10, complete refresher learning before practical reassessment.':trainingPurpose(t)==='Reskilling'?'Reskilling · Focused learning and practical training for this department.':'New Joiner · Welcome, onboarding and department training.';
 if(step.key==='Start')body=communicationView(t,'welcome');
 else if(['Educate','Practical'].includes(step.key)){
 const rows=(t.activeTraining?.checklist||t.checklist||[]).filter(r=>!r.removed&&(step.key==='Practical'?r.type==='Practical':r.type!=='Practical'));
 body=rows.map(r=>`<label class="flow-check"><input type="checkbox" data-flow-check="${esc(r.id)}" ${r.covered?'checked':''} ${disabled}><span>${esc(r.topic)}${r.curriculumId?curriculumTaskDetails(r):''}</span><small>${r.covered?'Saved':''}</small></label>`).join('')||'<p>No checklist items for this stage.</p>';
 if(rows.length&&!step.complete)body+=button(rows.every(r=>r.covered)?'Checklist saved':'Save checklist & notify trainee','flowSaveChecklist',rows.every(r=>r.covered)?'disabled':'','primary');
 const saved=t.flowRecord.checklistSaves?.[step.key];
 const ack=saved&&t.lifecycle?.acknowledgements?.find(a=>a.kind==='flow-update'&&a.ref===saved.ref);
 const previousAcks=(t.lifecycle?.acknowledgements||[]).filter(a=>a.kind==='flow-update'&&a.phase===t.stage&&a.title?.startsWith(step.label+' checklist updated')).slice(-3);
 if(!saved&&previousAcks.length)body+=`<div class="notice success">${previousAcks.map(a=>'✓ Checklist acknowledged by '+esc(a.name)+' · '+esc(new Date(a.at).toLocaleString())).join('<br>')}</div>`;
 body+=`<div class="notice ${ack?'success':''}" data-checklist-confirmation>${saved?`Checklist saved · ${esc(new Date(saved.at).toLocaleString())}<br>${ack?'✓ Trainee acknowledged · '+esc(ack.name)+' · '+esc(new Date(ack.at).toLocaleString()):'Trainee acknowledgement pending. Check Email delivery for send status.'}`:rows.every(r=>r.covered)?'Checklist is saved. Complete the remaining stage requirements below.':'Tick the completed items, then save once to notify the trainee.'}</div>`;
 if(step.key==='Practical')body=mentorProgressView(t)+`<h3>Practical content sharing</h3>`+materialsView(t);
 }else if(step.key==='Content')body=materialsView(t);
 else if(step.key.endsWith('Evaluation')){const saved=t.flowRecord.evaluations?.[step.key];body=evaluationAverageCard(t,step.key)+(t.flowCriteria[step.key]||[]).map((r,i)=>`<div class="flow-rating"><div><small>ASSESSMENT ${i+1}</small><h3>${esc(r.title)}</h3>${r.guidance?`<p class="muted">Expected answer / evidence: ${esc(r.guidance)}</p>`:''}</div><label>Score / 10<select data-flow-rating="${esc(r.id)}" ${disabled}>${options(Array.from({length:10},(_,i)=>[String(i+1),String(i+1)]),saved?.ratings.find(x=>x.id===r.id)?.score??'')}</select></label></div>`).join('');if(!step.complete)body+=button('Save evaluation & notify trainee','flowSaveEvaluation',t.flowCriteria[step.key]?.length?'':'disabled','primary');
 const history=t.flowRecord.evaluationHistory?.[step.key]||[];
 if(saved?.score!=null&&saved.score<(t.evaluationPassScore||7.5))body+=`<div class="notice"><strong>Below minimum score · ${saved.score.toFixed(1)} / ${t.evaluationPassScore||7.5}</strong><p>${step.complete?'Request admin correction approval before starting a retest.':'Start a fresh evaluation. The previous result stays in attempt history.'}</p>${!step.complete?button('Retest / Reset ratings','flowRetest','','primary'):''}</div>`;
 if(history.length)body+=`<details class="card"><summary>Previous attempts (${history.length})</summary>${history.map((a,i)=>`<p>Attempt ${i+1} · ${Number(a.score).toFixed(1)} / 10 · ${esc(a.by)} · ${dt(a.at)}</p>`).join('')}</details>`;
 }
 else if(step.key.endsWith('Acknowledgement'))body=`<div class="card ${step.complete?'success':''}"><h3>${step.complete?'✓ Acknowledged by trainee':'Waiting for trainee confirmation'}</h3>${step.acknowledgement?`<p><strong>${esc(step.acknowledgement.name||t.name)}</strong> · ${esc(step.acknowledgement.by||t.email)}</p><p>Confirmed on ${esc(new Date(step.acknowledgement.at).toLocaleString())}</p><p>The next training step is now available.</p>`:`<p>${esc(t.email||'Add the trainee email in Edit details.')} receives a secure link to acknowledge this evaluation. This panel checks for confirmation automatically.</p>`}${!step.complete&&step.emailDelivery?`<p class="notice">Email: ${esc(step.emailDelivery.status==='Sent'?'Accepted by email server (inbox delivery not confirmed)':step.emailDelivery.status)} · ${esc(step.emailDelivery.to)}${step.emailDelivery.error?'<br>'+esc(step.emailDelivery.error):''}</p>`:''}${button('Refresh confirmation','refresh')}${!step.complete?button('Retry email / renew expired link','flowRetryAck'):''}</div>`;
 else if(step.key==='Mentor')body=mentorProgressView(t)+`<div class="card"><h3>${t.mentor?esc(t.mentor.name):'Assign a practical mentor'}</h3><p>The mentor receives the practical guidance plan and completes their assigned tasks in My mentor tasks.</p>${!step.complete&&t.practicalMentor?.required?button(t.mentor?'Update mentor':'Assign mentor & email','assignMentor','','primary'):''}${t.mentor?.id?mentorEmailStatus(t):''}</div>`;
 else if(step.key==='Handover')body=certificate(t)+workflowHandovers(t);
 return `<div class="notice">${esc(purposeNote)}</div><div class="flow-heading"><div><small>${step.key==='Start'?'START':'STEP '+(states.filter(s=>s.key!=='Start').findIndex(s=>s.key===step.key)+1)+' OF '+states.filter(s=>s.key!=='Start').length} · ${esc(trainingPhaseLabel(t.stage,t))}</small><h2>${esc(step.label)}</h2><p>${step.complete?'Completed and locked.':step.blockedBy?'Complete the earlier steps first.':'Save your work, then complete this stage.'}</p></div>${step.complete?button(step.key.endsWith('Evaluation')&&t.flowRecord.evaluations?.[step.key]?.score<(t.evaluationPassScore||7.5)?'Request retest':'Request correction','journeyUnlock',`data-step="Flow:${step.key}"`,'primary correction-button'):''}</div><div class="flow-body ${step.complete?'flow-readonly':''}">${body}</div>${!step.complete&&!step.key.endsWith('Acknowledgement')&&step.key!=='Handover'?`<div class="flow-footer"><span>${step.ready?'All requirements complete':esc(step.missing?.join(' ')||'Complete all items above to continue')}</span>${button('Complete stage & notify trainee','flowComplete',`${step.ready?'':'disabled'}`,'primary')}</div>`:''}`;
}

const journeyGroups = [
 {name:'Start',sections:['Welcome letter'],description:'Welcome letter'},
 {name:'Learn',sections:['Modules & handbooks','Checklist','Academy'],description:'Modules & checklist'},
 {name:'Test',sections:['Assessment','Scores'],description:'Assessment ratings & scores'},
 {name:'Finish',sections:['Certificate','Feedback'],description:'Certificate & feedback'},
 {name:'Handover',sections:['Handover'],description:'Transfer & email'}
];
const supportingSections=['Progress report','Activity history','Handover history','Coaching','Branch operations','Outcomes','Removed items'];
function journeyNav(){
 if(isAdministrative(current()))return "";
 if(current()?.trainingFlowStatus)return flowNav(current());
 const group=journeyGroups.find(g=>g.sections.includes(section));const t=current();
 return `<nav class="journey-nav" aria-label="Trainee journey">${journeyGroups.map((g,i)=>t?.journey?.[g.name]?.notRequired?'':button(`<span class="journey-number">${t?.journey?.[g.name]?.complete?'✓':i+1}</span><span><strong>${g.name}</strong><small>${t?.journey?.[g.name]?.blockedBy?'Complete '+t.journey[g.name].blockedBy+' first':t?.journey?.[g.name]?.complete?'Completed · Locked':g.description}</small></span>`,'section',`data-section="${g.sections[0]}" aria-pressed="${g===group}" ${t?.journey?.[g.name]?.blockedBy?'disabled':''}`,(g===group?'active ':'')+(t?.journey?.[g.name]?.blockedBy?'journey-blocked':t?.journey?.[g.name]?.complete?'journey-complete':''))).join('')}</nav>${group?`<div class="tabs journey-tabs" aria-label="${group.name} sections">${group.sections.map(s=>button(uiIcon(sectionIcons[s])+`<span>${s==='Assessment'?'Assessment ratings':s}</span>`,'section',`data-section="${s}" aria-pressed="${section===s}"`,section===s?'active':'')).join('')}</div>`:''}`;
}
function activeJourneyStep(){if(section==='Training stages'||current()?.flowEnabled)return null;return view==='materials'||view==='academy'?'Learn':journeyGroups.find(g=>g.sections.includes(section))?.name;}
function journeyLockBanner(t){
 const step=activeJourneyStep();if(!step||!t)return '';
 const complete=t.journey?.[step]?.complete;
 return `<div class="journey-lock-bar ${complete?'is-complete':''}"><span>${complete?'✓ '+step+' completed · Locked. Records remain available to view.':step+' in progress · '+esc(t.journey?.[step]?.requirement||'')}</span>${complete?(button('Request correction','journeyUnlock',`data-step="${step}"`,'primary correction-button')):button('Mark step complete','journeyComplete',`data-step="${step}" ${t.journey?.[step]?.ready?'':'disabled'}`)}</div>`;
}
function lockJourneyControls(){
 const t=current(),step=activeJourneyStep();if(!t?.journey?.[step]?.complete)return;
 const root=document.querySelector('.trainee-workspace')||(view==='materials'||view==='academy'?document.querySelector('.page-content'):null);if(!root)return;
 const allowed=new Set(['journeyUnlock','readMaterial','reviewMaterial','viewMaterialRecipients','previewMaterial','print','communicationPreview','communicationRevise','communicationAttachment','communicationSend','communicationResend','communicationShare','certificateShare','shareMaterial','confirmMaterialShare','clearMaterialSearch','module','modules']);
 root.querySelectorAll('button[data-action]').forEach(b=>{if(!allowed.has(b.dataset.action)){b.disabled=true;b.title='Completed step — unlock before editing';}});
 root.querySelectorAll('input:not([type="search"]),select,textarea,button[type="submit"],form button:not([type])').forEach(el=>{el.disabled=true;});
}
function testsWorkspace(){
 const t=current();if(t?.flowEnabled){section='Training stages';return heading('Training evaluations','Theory and practical evaluations, with trainee confirmation.')+selectTrainee()+flowNav(t)+flowPanel(t);}if(!['Scores','Assessment'].includes(section))section='Assessment';
 return heading('Test centre','Assessment ratings and scores.')+selectTrainee()+(!t?empty('Select a trainee to rate assessments and save scores.'):`<div class="tabs">${['Assessment','Scores'].map(s=>button(s==='Assessment'?'Assessment ratings':s,'section',`data-section="${s}" aria-pressed="${section===s}"`,section===s?'active':'')).join('')}</div><section class="trainee-workspace" data-section="${section}">${journeyLockBanner(t)}${['Checklist','Modules & handbooks'].includes(section)?mentorProgressView(t):''}${section==='Training stages'?'':sectionOverview(t)}${detailContent(t)}</section>${transitionPanel(t)}`);
}
const sectionIcons = { "Progress report":"reports","Welcome letter":"outbox","Final onboarding":"check","Activity history":"audit", 'Modules & handbooks':'materials', Summary:'reports', 'Removed items':'resources', Checklist:'check', Scores:'reports', Assessment:'questions', Feedback:'outbox', Handover:'arrow', Academy:'academy', Tests:'questions', 'Role-play':'users', EOD:'audit', Coaching:'users', Evaluations:'reports', 'Branch operations':'system', Outcomes:'check', Certificate:'academy' };
const canonicalPhase=phase=>phase==='Onboarding'?'Induction':['Final Review & Confirmation','Final Feedback & Confirmation'].includes(phase)?'Final Feedback':phase;
function orderPhases(phases){const unique=[...new Set(phases.map(canonicalPhase))];return [...unique.filter(p=>!['Final Feedback','Onboard Final Email','Asset Allotment'].includes(p)),...['Final Feedback','Onboard Final Email','Asset Allotment'].filter(p=>unique.includes(p))];}
const trainingPhaseLabel=(phase,t)=>canonicalPhase(phase)==='Induction'?(t&&['Reskilling','Revaluation'].includes(trainingPurpose(t))?'HR policies & workplace standards':'Induction & Onboarding'):canonicalPhase(phase)==='Final Feedback'?'Final Feedback & Confirmation':phase;
function orderedStages(t) { return orderPhases([...(t.stageOrder||[]),...S.stages]).filter(s=>S.stages.map(canonicalPhase).includes(s)); }
function mentorEmailStatus(t){
 const kind='mentor:'+t.mentor.id,d=t.communications?.[kind];
 if(canonicalPhase(t.mentor.phase)!==canonicalPhase(t.stage))return `<p class="notice">Training phase changed. Send the current practical plan and history to the mentor.</p>${button('Update plan & email mentor','assignMentor','','primary')}`;
 if(['Queued','Sending'].includes(d?.status))return `<p class="notice">Mentor email ${esc(d.status.toLowerCase())}. You can continue working.</p>`;
 if(d?.sentAt)return `<p class="notice">✓ Accepted by email server · ${esc(t.mentor.email)} · ${new Date(d.sentAt).toLocaleString('en-IN')}<br><small>Inbox delivery is not confirmed. Check Spam/Junk if missing.</small></p>${button('Send mentor email again','communicationResend',`data-kind="${kind}"`)}`;
 const uncertain=(S.outbox||[]).find(m=>m.communicationId===d?.id&&m.status==='Delivery uncertain');
 return `<p class="notice">${d?.status==='Delivery uncertain'?'Email delivery needs review. Check the sent mailbox before retrying.':'Mentor email not sent.'}${d?.lastError?'<br><small>'+esc(d.lastError)+'</small>':''}</p>${d?.status==='Delivery uncertain'?(isAdmin()&&uncertain?button('Review email delivery','communicationResolve',`data-kind="${kind}" data-id="${uncertain.id}"`):''):button('Send mentor email','communicationSend',`data-kind="${kind}"`,'primary')}`;
}
function trainingPhaseProgress(t){
 const focused=['Reskilling','Revaluation'].includes(trainingPurpose(t));
 const skills=['Induction','CRM & Tech Training','Sales Training','Operations Training'];
 const phases=focused?[...new Set([...(t.phaseHistory||[]).map(p=>p.phase),t.stage].map(canonicalPhase))].filter(p=>skills.includes(p)||p===canonicalPhase(t.stage)):(t.lifecycle?.plan?orderPhases([...t.lifecycle.plan.phases.map(p=>p.phase),'Final Feedback','Onboard Final Email','Asset Allotment']):orderedStages(t));
 return `<div class="phase-arrow" aria-label="Training phase progress">${phases.map((phase,i)=>{
  const active=canonicalPhase(phase)===canonicalPhase(t.stage);
  const done=active?!!t.journey?.Finish?.complete:!!(t.phaseHistory?.some(p=>canonicalPhase(p.phase)===phase)||t.handovers?.some(h=>canonicalPhase(h.stage)===phase&&h.status==='Completed'));
  return `<span class="${active?'is-current ':''}${done?'done':''}" ${active?'aria-current="step"':''}><strong>${done?'✓ ':''}${esc(trainingPhaseLabel(phase,t))}</strong>${done?'<small>Completed</small>':''}${active?'<small>Current phase</small>':''}</span>${i<phases.length-1?'<b aria-hidden="true">→</b>':''}`;
 }).join('')}</div>`;
}

function removeEntryButton(kind,id) { return button("Remove","archiveEntry",`data-kind="${kind}" data-id="${esc(id)}"`,"danger"); }
function detail() {
  const t = current();
  if (!t) return overview();
  return (
    heading(
      t.name,
      `${t.code} · ${t.designation} · ${t.branch}`,
      button("← All trainees", "back") +
        button("Trainee feedback ("+(t.handoverFeedback?.length||0)+")", "viewTraineeFeedback", `data-trainee="${esc(t.id)}"`) +
        ((t.issuedCertificates||[]).length?button("Certificates ("+t.issuedCertificates.length+")", "certificateHistory"):"") +
        (isAdmin()
          ? button("Edit details", "editTrainee") +
            button("Delete trainee", "deleteTrainee", "", "danger")
          : "") +
        whatsAppLink(t),
    ) +
    `<div class="profile profile-facts"><div><small>JOINED</small><strong>${dt(t.joiningDate)}</strong></div><div><small>TRAINING DAY</small><strong>${days(t)}</strong></div><div><small>YOUR TRAINER</small><strong>${esc(t.trainerName || "—")}</strong></div><div><small>STATUS</small><strong class="profile-status">${esc(t.status)}</strong></div><div><small>CHECKLIST</small><strong>${percent(t)}% <span>completed</span></strong><progress max="100" value="${percent(t)}" aria-label="Checklist progress"></progress></div>${profileProgress(t)}</div>${curriculumSummary(t)}<div class="phase-caption"><span>${trainingPurpose(t)==='Reskilling'?'RESKILLING ROADMAP':trainingPurpose(t)==='Revaluation'?'REVALUATION ROADMAP':'TRAINING ROADMAP'}</span><strong>${esc(trainingPhaseLabel(t.stage,t))}</strong></div>${trainingPhaseProgress(t)}${journeyNav()}<section class="trainee-workspace" data-section="${esc(section)}">${journeyLockBanner(t)}${['Checklist','Modules & handbooks'].includes(section)?mentorProgressView(t):''}${section==='Training stages'?'':sectionOverview(t)}${detailContent(t)}</section>${transitionPanel(t)}`
  );
}
function sectionOverview(t) {
  if(t.lifecycleRequired&&['Lifecycle','Welcome letter','Final onboarding'].includes(section))return '';
  const content={
    "Progress report":["Performance & progress","Scores, evaluations, feedback and training history in one profile.","reports",`${percent(t)}% covered`,`${scoreAvg(t)} / 10 score`],
    "Welcome letter":["A welcome, approved by HR","Generate a letter and optionally attach documents before approval.","outbox",t.communications?.welcome?.status||"Not created","Optional communication"],
    "Final onboarding":["Review. Approve. Onboard.","Inform Management after satisfactory feedback and final approval.","check",t.communications?.final?.status||"Not created","HR approval required"],
    "Activity history":["Every update, in context","Filter this trainee’s recorded activity by date.","audit",`${S.audit.filter(a=>a.traineeId===t.id).length} activities`,"India time"],
    'Modules & handbooks':['Your learning library','Role-specific resources, reviewed and ready for your next step.','materials',`${t.approvedMaterials?.filter(m=>t.materialIds?.includes(m.id)).length||0} approved`,`${t.materialIds?.length||0} eligible documents`],
    Summary:['The journey so far','A complete view of progress, strengths and the next milestone.','reports',`${percent(t)}% covered`,t.stage],
    'Removed items':['Review & restore','Keep the checklist relevant. Restore a topic whenever it is needed.','resources',`${t.checklist.filter(r=>r.removed).length+(t.archivedEntries?.length||0)} removed`,'Checklist management'],
    Checklist:['One milestone at a time','Turn everyday learning into clear, measurable progress.','check',`${items(t).filter(r=>r.covered).length} / ${items(t).length} covered`,`${percent(t)}% complete`],
    Scores:['Skills in focus','Capture performance and recognise the areas ready to grow.','reports',`${(t.activeTraining?.scores||[]).filter(r=>r.score!=null).length} scored`,`${t.activeTraining?.scores.length||0} criteria`],
    Assessment:['Assessment ratings','Rate the current phase assessment.','questions',`${(t.activeTraining?.assessments||[]).filter(r=>r.score!=null).length} rated`,`${t.activeTraining?.assessments.length||0} questions`],
    Feedback:['Feedback that moves you forward','Bring strengths, opportunities and next steps together.','outbox',`${t.feedbackRows?.length||0} feedback rows`,'Trainer review'],
    Handover:['A confident next step','Transfer the right context to the right trainer and phase.','arrow',`${t.handovers.length} handovers`,t.stage],
    Academy:['Grow your clinical confidence','Learn the principles behind thoughtful patient conversations.','academy',`${t.completedModules.length} completed`,`${S.academy.modules.length} modules`],
    Tests:['Ready to put it to the test?','Check understanding and revisit the concepts that need practice.','questions',`${records(t,'test').length} tests recorded`,'Academy assessments'],
    'Role-play':['Practise the conversation','Build confidence through realistic scenarios and coaching.','users',`${records(t,'roleplay').length} sessions recorded`,'Guided practice'],
    EOD:['Make every day count','Reflect on today’s learning, progress and next steps.','audit',`${records(t,'eod').length} daily records`,'Daily reflection'],
    Coaching:['Small guidance. Lasting growth.','Keep coaching focused, actionable and connected to progress.','users',`${records(t,'coaching').length} coaching records`,'Personal development'],
    Evaluations:['See the progress clearly','Record observations and turn them into useful next steps.','reports',`${records(t,'evaluation').length} evaluations`,'Performance review'],
    'Branch operations':['Bring learning to the floor','Track operations, ownership and follow-through in one place.','system',`${records(t,'branch').length} records`,'Clinic operations'],
    Outcomes:['From learning to impact','Capture the outcomes that show how far the journey has come.','check',`${records(t,'outcome').length} outcomes`,'Progress in practice'],
    Certificate:['Celebrate the milestone','Recognise completed learning with a trainer-reviewed certificate.','academy',t.certificate?'Certificate issued':'Not yet issued','Training recognition']
  };
  const [title,description,icon,metric,detail]=content[section]||[section,'Track progress and take the next step.','materials',t.status,t.stage];
  return `<div class="section-overview"><div class="section-symbol">${uiIcon(icon)}</div><div class="section-copy"><span class="eyebrow">${esc(section)}</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div><div class="section-metric"><strong>${esc(metric)}</strong><span>${esc(detail)}</span></div></div>`;
}
function detailContent(t) {
  if(isAdministrative(t)&&['Training stages','Welcome letter','Feedback','Assessment','Final onboarding'].includes(section))return flowPanel(t);
  if(section==='Training plan')return curriculumPanel(t);
  if(section==='Training stages')return flowPanel(t);
  if(section==='Lifecycle')return lifecyclePanel(t);
  if(t.lifecycleRequired&&section==='Final onboarding')return lifecycleWelcome(t,true);
  if(t.lifecycle?.plan&&section==='Assessment'){lifecycleTab='evaluation';return lifecyclePanel(t);}
  if(section==="Progress report")return profileReport(t);
  if(section==="Welcome letter"){if(t.flowEnabled){selectedFlowStep="Start";return flowPanel(t);}return communicationView(t,"welcome");}
  if(section==="Final onboarding")return communicationView(t,"final");
  if(section==="Activity history")return activityView(t);
  if(section==='Mentor')return mentorProgressView(t)+`<div class="card"><h2>Practical training & initial-days mentor</h2><p>Mandatory practical guidance for the current training phase.</p>${t.mentor?`<h3>${esc(t.mentor.name)}</h3><p>${esc(t.mentor.email)} · Since ${dt(t.mentor.startDate)}</p><p class="prewrap">${esc(t.mentor.focus)}</p>`:'<p>No mentor assigned yet.</p>'}${t.mentor?.id?mentorEmailStatus(t):t.mentor?button('Send mentor email','notifyMentor','','primary'):''}${t.mentorReady||t.mentor?button(t.mentor?'Update mentor plan':'Assign mentor','assignMentor','','primary'):'<p>Complete practical training and modules first.</p>'}</div>`;
  if (section === "Modules & handbooks") return materialsView(t);
  if (section === "Summary") return workflowSummary(t);
  if (section === "Removed items") return workflowRemoved(t);
  if (section === "Checklist")
    return `<div class="row"><p class="muted">${items(t).filter((x) => x.covered).length} / ${items(t).length} covered · ${percent(t)}%</p>${button("+ Add to checklist","addChecklist","","primary")}<div class="filters"><input id="topicSearch" placeholder="Find a topic" aria-label="Find topic"><select id="topicType" aria-label="Topic type">${options(["Theory", "Practical", "Removed"], "", "All types")}</select></div></div><div id="topicList">${checklist(t)}</div>${draftNotice(t,'checklist')}`;
  if (section === "Scores")
    return (draftNotice(t,'scores')+
      trainingRows(t,'scores')
        .map((r) =>
          item(
            r.criterion,
            r.category,
            r.score === null ? "Not scored" : `${r.score} / 10`,
            `<label class="inline-score">Score<select data-inline="score" data-id="${r.id}" aria-label="Score: ${esc(r.criterion)}">${options(Array.from({length:10},(_,i)=>[String(i+1),i===0?"1 — Lowest":i===9?"10 — Highest":String(i+1)]),r.score??"","Not scored")}</select></label>` + removeEntryButton("scores",r.id),
          ),
        )
        .join("") + draftNotice(t,'scores')
    );
  if (section === "Assessment") return assessmentCards(t);
  if (section === "Feedback") return workflowFeedback(t);
  if (["Handover","Handover history"].includes(section)) return workflowHandovers(t);
  if (section === "Academy") return moduleId ? lesson(t) : academyView(t);
  if (section === "Tests")
    return `<div class="card"><h2>Test centre</h2><p>Questions match ${esc(t.stage)} and ${esc(t.designation)}. Results are saved to this phase.</p><div class="actions"><select id="testModule" aria-label="Test module">${options(
      (t.testModules||[]).map((m) => [m.id, m.title]),
      "",
      "Current phase test",
    )}</select>${button("Start test", "startTest", "", "primary")}</div></div>${recordList(t, "test")}`;
  if (section === "Role-play") return roleplayView(t);
  if (section === "Certificate") return certificate(t);
  const kind = {
    EOD: "eod",
    Coaching: "coaching",
    Evaluations: "evaluation",
    "Branch operations": "branch",
    Outcomes: "outcome",
  }[section];
  return `<div class="row"><h2>${esc(section)}</h2>${button("+ Add record", "addRecord", `data-kind="${kind}"`, "primary")}</div>${section === "Branch operations" ? '<p class="muted">Track daily operations, issues, owners and follow-up dates. Source SOPs are in Resources & SOPs.</p>' : ""}${recordList(t, kind)}`;
}
function empty(s) {
  return `<div class="empty"><span class="empty-symbol">${uiIcon("resources")}</span><p>${esc(s)}</p></div>`;
}
function item(title, sub, body, actions = "", cls = "") {
  return `<article class="item ${cls}"><div><small>${esc(sub)}</small><h3>${esc(title)}</h3><pre>${esc(body)}</pre></div><div class="actions">${actions}</div></article>`;
}
function checklist(t) {
  const q = $("topicSearch")?.value?.toLowerCase() || "",
    type = $("topicType")?.value || "";
  return (
    trainingRows(t,'checklist')
      .filter(
        (r) =>
          (type === "Removed" ? r.removed : !r.removed) &&
          (!type || type === "Removed" || r.type === type) &&
          `${r.module} ${r.topic}`.toLowerCase().includes(q),
      )
      .map((r) =>
        item(
          r.topic,
          `${r.module} · ${r.type}`,
          r.covered
            ? `✓ Covered on ${dt(r.coveredAt)} · Training day ${r.trainingDay ?? "—"}${r.remarks ? "\n" + r.remarks : ""}`
            : r.remarks || "To be covered",
          r.removed
            ? button("Restore", "restore", `data-id="${r.id}"`)
            : `<label class="inline-complete"><input type="checkbox" data-inline="checklist" data-id="${r.id}" aria-label="Complete: ${esc(r.topic)}" ${r.covered?"checked":""}>Complete</label>` +
                button("Remove", "remove", `data-id="${r.id}"`),
          r.removed ? "removed" : r.covered ? "done" : "",
        ),
      )
      .join("") || empty("No matching topics.")
  );
}
function recordList(t, kind) {
  const rs = records(t, kind);
  return rs.length
    ? rs
        .map((r) =>
          item(
            r.title,
            `${dt(r.at)} · ${r.by}`,
            `${r.score !== null && r.score !== undefined ? "Score: " + r.score + "%\n" : ""}${r.status ? "Status: " + r.status + "\n" : ""}${r.due ? "Follow-up: " + dt(r.due) + "\n" : ""}${r.notes || ""}`,
            button("View", "record", `data-id="${r.id}"`) + removeEntryButton("records",r.id) +
              (!["test", "exercise"].includes(r.kind)
                ? button("Update status", "recordStatus", `data-id="${r.id}"`)
                : ""),
          ),
        )
        .join("")
    : empty("No records yet.");
}
function assessmentCards(t){
 const rows=t.activeTraining?.assessments||t.assessments,rated=rows.filter(r=>r.rating),average=rated.length?rated.reduce((sum,r)=>sum+Number(r.score||0),0)/rated.length:null;
 if(!rows.length)return empty('Assessment questions appear as training progresses.');
 return `<div class="assessment-summary"><div><span class="assessment-kicker">ASSESSMENT SNAPSHOT</span><strong>${rated.length}<small> / ${rows.length} rated</small></strong></div><div class="assessment-completion"><div><span>Evaluation progress</span><b>${Math.round(rated.length/rows.length*100)}%</b></div><progress value="${rated.length}" max="${rows.length}" aria-label="Assessment completion"></progress></div><div class="assessment-average"><span>Average rating</span><strong>${average==null?'—':average.toFixed(1)}<small> / 10</small></strong></div></div><div class="assessment-list">${rows.map((r,i)=>{const value=r.rating?Number(r.score):null,tone=value==null?'pending':value>=8?'excellent':value>=6?'good':'developing';return `<article class="assessment-card tone-${tone}"><div class="assessment-number">${String(i+1).padStart(2,'0')}</div><div class="assessment-question"><div class="assessment-meta"><span>${esc(r.department)}</span><span class="assessment-rating-badge">${r.rating?'● '+esc(r.rating):'○ Awaiting rating'}</span></div><h3>${esc(r.question)}</h3><div class="assessment-scale" aria-label="${value==null?'Not assessed':value+' out of 10'}">${Array.from({length:10},(_,n)=>`<i class="${value!=null&&n<value?'filled':''}"></i>`).join('')}<span>${value==null?'Not rated':value+' / 10'}</span></div></div><div class="assessment-controls"><label>Trainer rating<select data-inline="assessment" data-id="${r.id}" aria-label="Rating: ${esc(r.question)}">${options(Object.keys(S.ratings),r.rating,'Select rating')}</select></label>${removeEntryButton('assessments',r.id)}</div></article>`;}).join('')}</div>`;
}
function selectTrainee() {
  return `<div class="filters"><select id="academyTrainee" aria-label="Select trainee">${options(
    S.trainees.map((t) => [t.id, `${t.name} · ${t.branch}`]),
    selected,
    "Select trainee to save progress",
  )}</select></div>`;
}
function whatsAppLink(t) {
  if(!/^[1-9]\d{7,14}$/.test(t.phone||''))return '';
  return `<a class="whatsapp-link" href="https://wa.me/${t.phone}" target="_self" rel="noopener noreferrer" aria-label="WhatsApp ${esc(t.name)}">WhatsApp ↗</a>`;
}
function materialDownload(m,t,review=false) {
  return `/api/material?id=${encodeURIComponent(m.id)}${t ? '&traineeId='+encodeURIComponent(t.id) : ''}${review ? '&review=1' : ''}`;
}
function materialsView(t,standalone=false) {
  return `${standalone?heading('Modules & handbooks','A curated space for learning. Reviewed by your trainers.',button('+ Add module','addMaterial','','primary'))+selectTrainee():`<div class="module-toolbar"><div><h2>Learning library</h2><p class="muted">The right resources for every role.</p></div>${button('+ Add module','addMaterial','','primary')}</div>`}${standalone&&t?curriculumSummary(t):''}<div class="material-search"><label for="materialSearch">Search modules & handbooks</label><div class="actions"><input id="materialSearch" type="search" maxlength="150" autocomplete="off" placeholder="Try sales, handbok, CRM, front desk…" value="${esc(materialSearch)}" aria-describedby="materialSearchHelp"><button type="button" data-action="clearMaterialSearch">Clear</button></div><p id="materialSearchHelp" class="muted">Search by title, keyword, designation or file type. Partial words and small spelling mistakes work too.</p></div>${t?button("Removed modules ("+(t.removedMaterials?.length||0)+")","removedModules"):""}<div id="materialResults" tabindex="0" role="region" aria-label="Module results">${materialResults(t)}</div>`;
}
function materialResults(t) {
  if(!t && !isAdmin())return empty('Select an assigned trainee to review their materials.');
  const available=(S.materials||[]).filter(m=>!t || t.materialIds?.includes(m.id));
  const candidates=searchMaterials(available,materialSearch).map(r=>r.material);
  const approved=m=>t?.approvedMaterials?.find(r=>r.id===m.id);
  const card=(m)=>{const done=t?.completedMaterials?.some(r=>r.id===m.id);return `<article class="card material-card ${materialSharing(t,m)?.status==='confirmed'?'is-shared':''}"><div class="document-top"><span class="document-icon">${uiIcon('materials')}<small>${esc(m.format)}</small></span><span class="document-group">${esc(m.group)}</span></div><h3>${esc(m.title)}</h3><p>${esc(m.roles.join(', '))}</p>${materialRecipientsSummary(m)}<div class="actions">${button('View','previewMaterial',`data-id="${m.id}"`)}${t?`${button('Share','shareMaterial',`data-id="${m.id}"`,'primary')}${approved(m)&&materialSharing(t,m)?.status!=='confirmed'?button('Confirm shared','confirmMaterialShare',`data-id="${m.id}"`):''}<label class="inline-complete"><input type="checkbox" data-inline="completeMaterial" data-id="${m.id}" aria-label="Complete module: ${esc(m.title)}" ${done?'checked':''}>Completed</label>${button('Remove','archiveMaterial',`data-id="${m.id}"`,'danger')}`:''}</div></article>`;};

  const searching=materialSearch.trim().length>0;
  return (searching?`<p role="status">${candidates.length} matching documents</p>`:'')+(t?`<p class="notice">${esc(t.name)} · ${esc(t.designation)} · ${esc(trainingPhaseLabel(t.stage,t))}</p>`:'<p class="notice">Select a trainee to share materials and record completion.</p>')+`<div class="grid">${candidates.map(card).join('')||empty('No matching modules. Try a shorter keyword.')}</div>`;
}

function moduleWhatsAppLinks(m,t) {
  if(!/^[1-9]\d{7,14}$/.test(t?.phone||''))return '<span class="muted">Add a WhatsApp number in Edit details to open chat.</span>';
  return button('WhatsApp · share document','shareMaterial',`data-id="${m.id}"`,'whatsapp-link');
}
async function shareMaterial(id,channel) {
 if(!channel){modal('Share training document',field('channel','Send via','email','select',[['email','Email'],['whatsapp','WhatsApp']],true),p=>{setTimeout(()=>shareMaterial(id,p.channel).catch(e=>toast(e.message)),0);},'Continue');return;}
  const t=current(),m=S.materials.find(m=>m.id===id);
  if(!t || !m)return;
  if(channel==='whatsapp'&&!/^[1-9]\d{7,14}$/.test(t.phone||''))throw Error("Add the trainee's WhatsApp number in Edit details first");
  if(!t.approvedMaterials?.some(a=>a.id===id))await mutate('approveMaterial',{traineeId:t.id,materialId:id,approved:true});
  if(channel==='email'){modal('Email training document',`<p>${esc(m.title)} → ${esc(t.email||'Add email in Edit details')}</p>`,()=>mutate('sendLearningEmail',{traineeId:t.id,materialId:id}),'Send email');return;}
  const response=await fetch(materialDownload(m,t));
  if(!response.ok)throw Error('Document cannot be shared. Check trainer approval and reload.');
  const mime={DOC:'application/msword',PDF:'application/pdf',DOCX:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',XLSX:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',PPTX:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}[m.format]||'application/octet-stream';
  const file=new File([await response.blob()],m.originalName||`${m.title}.${m.format.toLowerCase()}`,{type:mime});
  const native=!!(navigator.share && navigator.canShare?.({files:[file]}));
  const message=`Hi ${t.name}, your trainer has approved "${m.title}". Please read the attached document.`;
  const whatsapp=`https://wa.me/${t.phone}?text=${encodeURIComponent(message)}`;
  await mutate('materialShareStatus',{traineeId:t.id,materialId:id,status:'prepared'});
  modal('Share approved document',`<p><strong>${esc(m.title)}</strong> → ${esc(t.name)} (${esc(t.phone)})</p>${native?'<p><button type="button" id="shareMaterialFile" class="primary">Share document…</button></p><p>Choose WhatsApp, select this trainee and press Send.</p>':'<p>This browser cannot attach files directly to WhatsApp. Download the original, open the trainee’s chat, then attach the downloaded document and press Send.</p>'}<p><a href="${materialDownload(m,t)}" target="_blank" rel="noopener">Download document</a></p><p><a class="whatsapp-link" href="${esc(whatsapp)}" target="_blank" rel="noopener noreferrer">Open trainee’s WhatsApp ↗</a></p><p><a href="https://web.whatsapp.com/send?phone=${t.phone}&text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Open WhatsApp Web instead</a></p><p id="fileShareStatus" role="status"></p><p class="muted">No message is sent automatically. No public document link is created.</p>`,async p=>{if(p.sent==='on')await mutate('materialShareStatus',{traineeId:t.id,materialId:id,status:'confirmed',confirmed:true});},'Save sharing status');
  $('modalFields').insertAdjacentHTML('beforeend','<label class="answer"><input type="checkbox" name="sent">I have sent this document to '+esc(t.name)+'</label>');
  if(native)$('shareMaterialFile').onclick=async()=>{
    try{await navigator.share({files:[file],title:m.title,text:message});$('fileShareStatus').textContent='File handed to the sharing app. Complete sending in WhatsApp.';}
    catch(e){$('fileShareStatus').textContent=e.name==='AbortError'?'Sharing cancelled.':'File sharing is unavailable. Download the document and attach it in the trainee’s chat.';}
  };
}
async function openMaterial(id,review) {
  const t=current(),traineeId=t?.id;
  const m=await api('materialContent',{materialId:id,traineeId,review});
  const approved=t?.approvedMaterials?.some(r=>r.id===id);
  const done=t?.completedMaterials?.some(r=>r.id===id);
  const eligible=S.trainees.filter(x=>x.materialIds?.includes(id));
  const pickTrainee=!t && eligible.length ? field('approvalTrainee','Select trainee to approve this module','','select',eligible.map(x=>[x.id,x.name+' · '+x.designation]),true) : '';
  const body=m.blocks.map(b=>`<section class="material-section"><h3>${esc(b.title)}</h3>${b.rows?`<div class="table"><table><tbody>${b.rows.map(row=>'<tr>'+row.map(cell=>`<td>${esc(cell)}</td>`).join('')+'</tr>').join('')}</tbody></table></div>`:`<div class="material-text">${esc(b.text||'This page contains visual material. Download the original to view it.')}</div>`}</section>`).join('');
  modal(m.title,`<p class="notice">${approved?'Approved for '+esc(t.name):'Trainer review only — not approved for this trainee.'} The text preview does not include all images or formatting.</p>${pickTrainee}<p><a href="${materialDownload(m,t,review)}" target="_blank" rel="noopener">Download original ${esc(m.format)}</a></p>${approved?button('Revoke approval','revokeMaterial',`data-id="${m.id}"`,'danger'):''}<div class="material-preview">${body}</div>`,async(p)=>{
    const targetId=traineeId||p.approvalTrainee;
    if(!targetId)return;
    if(!approved)await mutate('approveMaterial',{traineeId:targetId,materialId:id,approved:true});
    else await mutate('completeMaterial',{traineeId,materialId:id,complete:!done});
  },!t?(eligible.length?'Approve for selected trainee':'Close'):!approved?'Approve for this trainee':done?'Mark incomplete':'Mark completed');
}

function academyView(t) {
  if (moduleId) return lesson(t);
  const modules=t?S.academy.modules.filter(m=>t.testModules?.some(q=>String(q.id)===String(m.id))):[];
  return `${view === "academy" ? heading("Clinical Sales Academy", "Build confidence. Practise with purpose. Grow your expertise.") + selectTrainee() : ""}
  <div class="academy-studio">
    <section class="academy-principles"><div class="academy-section-title"><div><span class="eyebrow">THE FOUNDATION</span><h2>The golden ten</h2><p>Small habits. Meaningful patient conversations.</p></div><span class="academy-count">10 principles</span></div>
    <ol class="principle-grid">${S.academy.principles.map((p,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span><p>${esc(p)}</p></li>`).join('')}</ol></section>
    <section class="academy-week"><div class="academy-section-title"><div><span class="eyebrow">PUT IT INTO PRACTICE</span><h2>Your weekly rhythm</h2></div><span class="muted">One focus, every day</span></div><div class="week-grid">${S.academy.weekPlan.map((w,i)=>`<article><span class="week-number">${String(i+1).padStart(2,'0')}</span><small>${esc(w.day)}</small><h3>${esc(w.focus)}</h3></article>`).join('')}</div></section>
    <section><div class="academy-section-title"><div><span class="eyebrow">KEEP LEARNING</span><h2>Learning modules</h2></div><span class="academy-count">${modules.length} available</span></div>
    <div class="grid academy-modules">${modules.map(m=>`<article class="card"><div class="row"><span class="badge">MODULE ${esc(m.number)}</span><small>${esc(m.durationMinutes)} MIN</small></div><h2>${esc(m.title)}</h2><p class="muted">${esc(m.shortDescription)}</p><div class="actions">${button("Open module →","module",`data-id="${esc(m.id)}"`,'primary')}${t.completedModules.some(x=>x.id===m.id)?'<span class="status">✓ Completed</span>':''}</div></article>`).join('')}</div>${!modules.length?empty(t?'No Academy modules are assigned to this phase and designation.':'Select a trainee above to see their assigned learning modules.'):''}</section>
  </div>`;
}
function list(a) {
  return a?.length
    ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
    : "";
}
function rich(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return `<p>${esc(value)}</p>`;
  if (Array.isArray(value))
    return value
      .map((x) =>
        typeof x === "object"
          ? `<div class="card">${rich(x)}</div>`
          : `<p>${esc(x)}</p>`,
      )
      .join("");
  return Object.entries(value)
    .filter(([k]) => !["id", "avatar", "iconName", "correctIndex"].includes(k))
    .map(
      ([k, v]) =>
        `<div><strong>${esc(k.replace(/([A-Z])/g, " $1"))}</strong>${rich(v)}</div>`,
    )
    .join("");
}
function lesson(t) {
  if(!t||!t.testModules?.some(m=>String(m.id)===String(moduleId)))return empty("This lesson is not part of the current phase and designation.");
  const m = S.academy.modules.find((m) => m.id === moduleId);
  if (!m) return "";
  const done = t?.completedModules.some((x) => x.id === m.id);
  return `<div class="lesson">${button("← All modules", "modules")}<div class="eyebrow" style="margin-top:24px">MODULE ${m.number}</div><h1>${esc(m.title)}</h1><p>${esc(m.objective || m.shortDescription)}</p>${!t ? selectTrainee() : '<p class="muted">Learning record: ' + esc(t.name) + "</p>"}<div class="card"><h2>Learning objectives</h2>${list(m.keyObjectives)}<h2>Core concepts</h2>${list(m.concept)}${list(m.coreConcepts)}</div><details open><summary>Clinical selling protocols</summary>${list(m.clinicalSellingProtocols)}${m.bad ? `<h3>Avoid</h3><p>${esc(m.bad)}</p><h3>Use</h3><p>${esc(m.good)}</p>` : ""}<h3>Do</h3>${list(m.dosAndDonts?.dos)}<h3>Do not</h3>${list(m.dosAndDonts?.donts)}</details>${m.frameworkTable?.length ? `<details><summary>Consultation framework</summary>${rich(m.frameworkTable)}</details>` : ""}${m.frameworks?.length ? `<details><summary>Practical frameworks</summary>${rich(m.frameworks)}</details>` : ""}<details><summary>Scenario exercise: ${esc(m.exerciseScenario?.title)}</summary><p>${esc(m.exerciseScenario?.patientContext)}</p><form id="exerciseForm">${m.exerciseScenario?.steps?.map((s, i) => `<div class="card"><h3>${i + 1}. ${esc(s.patientStatement)}</h3><small>${esc(s.patientEmotion)} · ${esc(s.contextNote)}</small>${s.choices.map((c) => `<label class="answer"><input type="radio" name="step${i}" value="${esc(c.id)}" required>${esc(c.text)}</label>`).join("")}</div>`).join("")}<button class="primary" ${t ? "" : "disabled"}>Save exercise & see feedback</button></form></details><div class="actions">${t ? button(done ? "Mark incomplete" : "Mark module completed", "completeModule", `data-id="${m.id}" data-complete="${!done}"`, "primary") + button("Take module test", "startModuleTest", `data-id="${m.id}"`) : '<p class="notice">Select a trainee to save learning progress and take tests.</p>'}</div></div>`;
}
function testView() {
  return (
    heading(
      "Knowledge check",
      "Answer every question. Results will be saved when you submit.",
    ) +
    `<p class="notice">Keep this page open until you submit. Test expires at ${new Date(test.until).toLocaleTimeString()}.</p><form id="testForm">${test.questions.map((q, i) => `<div class="card"><h3>${i + 1}. ${esc(q.question)}</h3>${q.options.map((o, j) => `<label class="answer"><input type="radio" name="q${i}" value="${j}" required>${esc(o)}</label>`).join("")}</div>`).join("")}<div class="actions"><button class="primary">Submit answers</button>${button("Cancel test", "cancelTest")}</div></form>`
  );
}
function roleplayView(t) {
  if (roleplay)
    return `<div class="card"><div class="row"><h2>${esc(roleplay.persona.name)}</h2>${button("End practice", "endRoleplay")}</div><p class="notice">${roleplay.ai ? "AI practice. Messages are sent to Google Gemini. Use fictional cases only." : "Guided practice using the supplied scenario. Patient prompts are scripted; a trainer records the evaluation."}</p><div class="chat" id="chat">${roleplay.messages.map((m) => `<div class="bubble ${m.role === "user" ? "you" : ""}"><small>${m.role === "user" ? "Counsellor" : "Patient"}</small><br>${esc(m.text)}</div>`).join("")}</div><form id="chatForm"><label for="reply">Your response</label><textarea id="reply" required></textarea><div class="actions"><button class="primary">Send response</button>${button("Save practice & evaluation", "saveRoleplay")}</div></form></div>`;
  return `<h2>Patient conversations</h2><p class="muted">Practise with guided scenarios, or enable optional AI in .env. Trainer feedback and scores are saved with the trainee.</p><div class="grid">${S.academy.personas.map((p) => `<div class="card"><h3>${esc(p.name)}</h3><p>${esc(p.primaryConcern)}</p><small>${esc(p.personality)}</small><p>${esc(p.objections)}</p><div class="actions">${button("Guided practice", "roleplay", `data-id="${p.id}"`)}${S.aiEnabled ? button("AI practice", "roleplayAI", `data-id="${p.id}"`) : ""}</div></div>`).join("")}</div><h2>Previous practice</h2>${recordList(t, "roleplay")}`;
}
function certificate(t) {
  const c=t.certificate,score=c&&Object.hasOwn(c,'score')?c.score:t.summary?.overallScore;
  return `<div class="actions">${c?button('Print / Save PDF','print')+button('Email / WhatsApp certificate','certificateShare','','primary')+(isAdmin()?removeEntryButton('certificate',c.id):''):isAdmin()?button('Issue completion certificate','certificate','','primary'):''}</div>${!c?'<p class="notice">Default certificate preview — no upload required. Issue after reviewing completed training and tests.</p>':''}<div class="certificate"><div class="eyebrow">GLEUHR WELLNESS${c?'':' · DRAFT'}</div><h1>Certificate of Training</h1><p>Presented to</p><h2>${esc(t.name)}</h2><p>${esc(t.designation)} · ${esc(t.branch||'')} · ${esc(t.department||'')}</p><p>Training phase: ${esc(c?.phase||t.stage)}<br>Next training: ${esc(c?.nextTraining||'To be assigned at handover')}</p><p>${c?'For completion of training approved by the training team.':'Prepared for issuance after training completion.'}</p><h3>Training score: ${score==null?'Not assessed':esc(Number(score).toFixed(1))+' / 10'}</h3><p>${esc(c?.note||'')}</p>${c?`<div class="signature">${esc(c.by)} · ${dt(c.at)}</div><small>Certificate ID: ${esc(c.id)}</small>`:''}</div>`;
}
function resourceText(value){
  if(value==null)return '';
  if(Array.isArray(value))return value.map(resourceText).join('\n\n');
  if(typeof value==='object')return Object.entries(value).map(([key,v])=>key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')+':\n'+resourceText(v)).join('\n\n');
  return String(value);
}
function resourceRecipients(id){const ts=S.trainees.filter(t=>t.resourceShares?.some(r=>r.resourceId===id));return ts.length?`<p class="resource-shared">✓ Shared with: ${ts.map(t=>esc(t.name)).join(', ')}</p>`:'';}
function resourcesView() {
  return (
    heading(
      "Resources & SOPs",
      "Original Academy learning material and your team resources.",
      isAdmin() ? button("+ Add resource", "addResource", "", "primary") : "",
    ) +
    `<div class="grid">${S.resources.map((r) => `<article class="card"><small>${esc(r.category)}</small><h2>${esc(r.title)}</h2><p>${esc(r.description)}</p><details><summary>Read material</summary><pre>${esc(r.contentPreview)}</pre>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open resource</a>` : ""}</details>${button('Share with trainee','shareResource',`data-id="${esc(r.id)}"`)}${resourceRecipients(r.id)}</article>`).join("")}</div><h2>Branch operations reference</h2><details class="card"><summary>Read source SOPs and tracker definitions</summary>${rich(S.academy.branch)}</details>${button('Share SOP with trainee','shareResource','data-id="branch-sop"')}${resourceRecipients('branch-sop')}<p class="muted">Built-in resources contain the source text previews. No PDF attachments were supplied for those previews.</p>`
  );
}
function reportsView() {
  const people = S.trainees;
  const section = (eyebrow, title, description, body) => `<section class="report-section"><header class="report-section-head"><div><span class="report-eyebrow">${eyebrow}</span><h2>${title}</h2><p>${description}</p></div></header>${body}</section>`;
  const departments = [["HR", ["Induction", "Onboarding"]], ["Sales", ["Sales Training"]], ["Operations", ["Operations Training"]]];
  const departmentCards = departments.map(([name, phases]) => {
    const rows = people.flatMap(t => t.summary.phases.filter(r => phases.includes(r.phase)));
    const total = rows.reduce((n,r) => n+r.total,0), covered = rows.reduce((n,r) => n+r.covered,0);
    const percent = total ? Math.round(covered/total*100) : 0;
    const ratings = people.flatMap(t => t.assessments.filter(r => r.department === name && r.score !== null).map(r => r.score));
    return `<article class="report-department"><span class="report-eyebrow">Department</span><h3>${name}</h3><div class="report-big">${total ? percent+'<small>%</small>' : '—'}</div><p>Checklist completion</p><progress value="${percent}" max="100" aria-label="${name} checklist completion"></progress><footer><span>${covered} / ${total} topics covered</span><strong>${ratings.length ? average(ratings)+' / 10' : 'Not assessed'}</strong></footer></article>`;
  }).join('');
  const gaps = people.map(t => {
    const low = t.scores.filter(r => r.score !== null && r.score < 7);
    const pending = items(t).filter(i => !i.covered).length;
    return `<article class="report-gap"><div class="report-gap-heading"><span class="report-avatar">${esc(t.name.slice(0,1).toUpperCase())}</span><div><h3>${esc(t.name)}</h3><p>${esc(t.designation)}</p></div>${button("View profile", "open", `data-id="${t.id}"`)}</div><div class="report-gap-counts"><span><strong>${pending}</strong> pending topics</span><span><strong>${low.length}</strong> scores below 7</span></div>${low.length ? `<ul>${low.map(r => `<li><span>${esc(r.criterion)}</span><strong>${esc(r.score)} / 10</strong></li>`).join('')}</ul>` : '<p class="report-quiet">No recorded scores below 7 / 10.</p>'}</article>`;
  }).join('');
  const academyRows = people.map(t => `<tr><td><strong>${esc(t.name)}</strong><small>${esc(t.designation)}</small></td><td>${t.completedModules.length} / ${S.academy.modules.length}</td><td>${records(t,"test").length}</td><td><span class="report-score">${average(records(t,"test").map(r => r.score))}</span></td><td>${records(t,"roleplay").length}</td><td><span class="report-cert ${t.certificate?'issued':''}">${t.certificate?'Issued':'Not issued'}</span></td></tr>`).join('');
  return `<div class="reports-studio">${heading("Progress & insights", "A clear view of learning, performance and the next steps for your team.", button("Download CSV", "csv") + button("Print report", "print"))}${stats()}${section('Training overview','Every journey, at a glance','Progress calculated from saved training records.',`<div class="report-overview">${workflowInsightStats()}</div>`) }${section('Department performance','Where your team stands','Compare checklist coverage and assessment scores across departments.',`<div class="report-departments">${departmentCards}</div>`)}${section('Trainee directory','Individual progress','Open a trainee to review their scores and training history.',traineeTable(people))}${section('Learning activity','Academy performance','Module completion and recorded Academy test results.',`<div class="table report-table"><table><thead><tr><th>Trainee</th><th>Modules</th><th>Tests</th><th>Avg. test %</th><th>Role-plays</th><th>Certificate</th></tr></thead><tbody>${academyRows || '<tr><td colspan="6">No trainee records yet.</td></tr>'}</tbody></table></div>`)}${section('Coaching priorities','Where support is needed','Pending checklist topics and recorded scores below 7 / 10.',`<div class="report-gaps">${gaps || '<p>No trainees to review yet.</p>'}</div>`)}</div>`;
}
function usersView() {
  return (
    heading(
      "Users & trainers",
      "HR/admin can access all trainees. Trainers can access only their current assignments.",
      S.user.canManageUsers?button("+ Add user", "addUser", "", "primary"):"",
    ) +
    S.users
      .map((u) =>
        item(
          u.name,
          `${u.email} · ${u.systemAdmin?'System Admin':u.role}${u.active ? "" : " · Disabled"}`,
          u.branch || "",
          S.user.canManageUsers?button("Edit access", "editUser", `data-id="${u.id}"`):"",
        ),
      )
      .join("")
  );
}
// Old browser-history entries can still point at the retired assessment screen.
// Keep flow trainees on the evaluation endpoint that their current workflow allows.
function normalizeEvaluationRoute(t, section, selectedStep) {
 if (!t?.flowEnabled || !['Assessment','Scores','Tests','Evaluations'].includes(section)) return {section, selectedStep};
 const requested=section==='Scores'?'PracticalEvaluation':'TheoryEvaluation';
 const target=t.trainingFlowStatus.find(s=>s.key===requested);
 const step=target?.blockedBy||requested;
 return {section:'Training stages',selectedStep:step};
}
function render() {
  if(section==='Final onboarding'&&current()?.stage!=='Onboard Final Email')section='Training stages';
  if (!S) return;
  if(['Reskilling','Revaluation'].includes(trainingPurpose(current()||{}))&&(section==='Welcome letter'||selectedFlowStep==='Start')){section=current().flowEnabled?'Training stages':'Checklist';selectedFlowStep=current().trainingFlowStatus?.find(s=>!s.notRequired&&!s.complete)?.key||'Educate';}
  if(['Tests','Evaluations'].includes(section)&&!test)section='Assessment';
  if(view==='tests'&&!current()?.flowEnabled&&!['Assessment','Scores'].includes(section)&&!test)section='Assessment';
  if(['trainees','tests'].includes(view)){const route=normalizeEvaluationRoute(current(),section,selectedFlowStep);section=route.section;selectedFlowStep=route.selectedStep;}
  const routeStep=['trainees','materials','academy','tests'].includes(view)?activeJourneyStep():null;
  const blocked=routeStep&&current()?.journey?.[routeStep]?.blockedBy;
  if(blocked){view='trainees';section=journeyGroups.find(g=>g.name===blocked).sections[0];moduleId=null;test=null;toast('Complete '+blocked+' before entering '+routeStep+'.');}
  if (test) {
    shell(testView());
    bindForms();
    return;
  }
  let content;
  if (selected && view === "trainees") content = detail();
  else if (view === "dashboard" || view === "trainees") content = overview();
  else if (view === "tests") content = testsWorkspace();
  else if (view === "materials") content = materialsView(current(),true);
  else if (view === "academy")
    content = moduleId ? lesson(current()) : academyView(current());
  else if (view === "templates") content = workflowTemplates();
  else if (view === "system") content = overview();
  else if (view === "resources") content = resourcesView();
  else if (view === "reports") content = reportsView();
  else if (view === "outbox") content = workflowOutbox();
  else if (view === "users") content = usersView();
  else if (view === "tickets") content = ticketsView();
  else if(view==='hrconnect'||view==='mgmtconnect')content=connectWorkspace(view==='hrconnect'?'hr':'management');
  else if(view==='mentoring')content=mentorWorkspace();
  else if (view === "questions")
    content =
      heading(
        "Question bank",
        `${S.questionCount} source and custom questions.`,
        button("Back to Test centre", "testWorkspace") + button("+ Add question", "addQuestion", "", "primary"),
      ) + '<div id="questions">Loading questions…</div>';
  else if (view === "audit") content=activityView();
  else content = overview();
  shell(content);
  bindForms();
  bindFinalFeedback();
  if(current()?.journey?.Handover?.blockedBy)document.querySelectorAll('[data-action="handover"],[data-action="selectStage"]').forEach(b=>{b.disabled=true;b.title='Complete '+current().journey.Handover.blockedBy+' first';});
  lockJourneyControls();
  if (view === "templates")
    api("templates")
      .then((data) => {
        templateData = data;
        paintTemplates();
      })
      .catch((e) => toast(e.message));
  if (view === "questions")
    api("questionBank")
      .then((q) => {
        if ($("questions"))
          $("questions").innerHTML = q
            .map(
              (q) =>
                `<details class="card"><summary>${esc(q.question)}</summary>${list(q.options)}<p><strong>Correct:</strong> ${esc(q.options[q.correctIndex])}</p><p>${esc(q.clinicalRationale)}</p></details>`,
            )
            .join("");
      })
      .catch((e) => toast(e.message));
}
function bindForms() {
  if($("dashRange"))$("dashRange").onchange=e=>{document.querySelector(".dashboard-custom-dates").hidden=e.target.value!=="custom";};
  if($('materialSearch'))$('materialSearch').oninput=e=>{
    materialSearch=e.target.value;
    $('materialResults').innerHTML=materialResults(current());$('materialResults').scrollTop=0;
  };
  if ($("search"))
    $("search").oninput = (e) => {
      search = e.target.value;
      const ts = dashboardTrainees().filter(
        (t) =>
          (!search ||
            `${t.name} ${t.branch} ${t.designation}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!status || t.status === status),
      );
      $("traineeTable").innerHTML = traineeTable(ts);
    };
  if ($("status"))
    $("status").onchange = (e) => {
      status = e.target.value;
      render();
    };
  for (const key of ["topicSearch", "topicType"])
    if ($(key))
      $(key).oninput = () => ($("topicList").innerHTML = checklist(current()));
  if ($("academyTrainee"))
    $("academyTrainee").onchange = (e) => {
      selected = e.target.value || null;
      render();
    };
  if ($("testForm"))
    $("testForm").onsubmit = async (e) => {
      e.preventDefault();
      const b = e.submitter;
      b.disabled = true;
      try {
        const fd = new FormData(e.target);
        const answers = test.questions.map((_, i) => Number(fd.get("q" + i)));
        const r = await api("submitTest", { testId: test.id, answers });
        test = null;
        view = "tests";
        section = "Tests";
        await refresh();
        showRecord(r);
        toast(`Test saved: ${r.score}%`);
      } catch (e) {
        toast(e.message);
      } finally {
        b.disabled = false;
      }
    };
  if ($("exerciseForm"))
    $("exerciseForm").onsubmit = async (e) => {
      e.preventDefault();
      if (!current()) return toast("Select a trainee first");
      const b = e.submitter;
      b.disabled = true;
      try {
        const m = S.academy.modules.find((m) => m.id === moduleId),
          fd = new FormData(e.target);
        await mutate("exercise", {
          traineeId: selected,
          moduleId,
          choices: m.exerciseScenario.steps.map((_, i) => fd.get("step" + i)),
        });
        showRecord(records(current(), "exercise")[0]);
      } catch (e) {
        toast(e.message);
      } finally {
        b.disabled = false;
      }
    };
  if ($("chatForm"))
    $("chatForm").onsubmit = async (e) => {
      e.preventDefault();
      const reply = $("reply").value.trim();
      if (!reply) return;
      const b = e.submitter;
      b.disabled = true;
      try {
        const pending = [...roleplay.messages, { role: "user", text: reply }];
        let answer;
        if (roleplay.ai) {
          answer = (
            await api("aiChat", {
              traineeId: selected,
              personaId: roleplay.persona.id,
              messages: pending,
            })
          ).reply;
        } else {
          const beats = roleplay.persona.beats || [];
          answer =
            beats[roleplay.turn + 1]?.patient ||
            "Thank you. The guided scenario is complete. Please save your practice and trainer feedback.";
          roleplay.turn++;
        }
        roleplay.messages = [...pending, { role: "assistant", text: answer }];
        render();
        $("chat").scrollTop = $("chat").scrollHeight;
      } catch (e) {
        toast(e.message);
        b.disabled = false;
      }
    };
}
function showRecord(r) {
  modal(
    r.title,
    `<p>${dt(r.at)} · ${esc(r.by)}</p>${r.score !== null && r.score !== undefined ? `<h2>Score: ${r.score}%</h2>` : ""}<pre>${esc(r.notes || "")}</pre>${r.result ? r.result.map((a, i) => `<div class="card"><h3>${i + 1}. ${esc(a.question)}</h3><p class="${a.ok ? "success" : "error"}">Your answer: ${esc(a.options[a.answer])}</p><p>Correct: ${esc(a.options[a.correct])}</p><p>${esc(a.rationale)}</p></div>`).join("") : ""}${r.choices ? rich(r.choices) : ""}${r.transcript ? `<h3>Conversation</h3><pre>${esc(r.transcript)}</pre>` : ""}`,
    async () => {},
    "Close",
  );
}
function payload(p = {}) {
  return { traineeId: selected, version: current()?.version, ...p };
}
function recordForm(kind, initial = {}) {
  const labels = {
    eod: "End-of-day report",
    coaching: "Coaching session",
    evaluation: "Formal evaluation",
    roleplay: "Role-play evaluation",
    branch: "Branch operations / issue",
    outcome: "Training outcome follow-up",
  };
  modal(
    labels[kind],
    field("title", "Title", initial.title || labels[kind], "text", [], true) +
      field(
        "notes",
        kind === "eod"
          ? "Training covered, progress, blockers and next plan"
          : "Observations, strengths, improvement areas and next action",
        initial.notes || "",
        "textarea",
        [],
        true,
      ) +
      field("score", "Trainer score % (optional)", "", "number") +
      field("due", "Next follow-up", "", "date") +
      field("status", "Status", "Open", "select", [
        "Open",
        "In progress",
        "Completed",
      ]),
    async (p) => {
      await mutate("record", payload({ ...initial, ...p, kind }));
      if (kind === "roleplay") {
        roleplay = null;
        render();
      }
    },
    "Save record",
  );
}
function mentorTaskGate(t){
 const mentor=t.trainingFlowStatus?.find(s=>s.key==='Mentor');
 const state=t.flowEnabled?t.trainingFlowStatus?.find(s=>s.key===(mentor?.complete?'Practical':'Mentor')):null;
 return state?.complete?'Practical training is completed and locked.':state?.blockedBy?'Complete '+(t.trainingFlowStatus.find(s=>s.key===state.blockedBy)?.label||state.blockedBy)+' first.':null;
}
function mentorProgressView(t){
 const p=t.practicalMentor;if(!p?.required)return '';
 const gate=mentorTaskGate(t),isMentor=p.assigned&&t.mentor?.userId===S.user.id;
 const mentorStep=t.trainingFlowStatus?.find(s=>s.key==='Mentor');
 const start=t.flowEnabled&&p.assigned&&!mentorStep?.complete&&!mentorStep?.blockedBy;
 return `<div class="card practical-studio"><div class="practical-hero"><div><span class="practical-eyebrow">LEARN BY DOING</span><h2>Knowledge into practice.</h2><p>Build confidence, one guided task at a time.</p></div><div class="practical-total"><strong>${p.complete}<small> / ${p.total}</small></strong><span>Tasks completed</span></div></div><div class="practical-mentor"><span class="practical-avatar" aria-hidden="true">${uiIcon('users')}</span><div><small>YOUR PRACTICAL MENTOR</small><p>${p.assigned?'Mentor: '+esc(t.mentor.name)+' · '+esc(t.mentor.email||''):'Assign a mentor to guide the practical tasks.'}</p></div><span class="practical-phase">${esc(trainingPhaseLabel(t.stage,t))}</span></div>
 ${start?`<div class="notice"><strong>Mentor assigned · Task confirmation required</strong><p>The assigned mentor can complete tasks here or in My mentor tasks. This stage stays locked until every practical task is confirmed.</p></div>`:''}
 ${p.assigned&&!isMentor?`<p class="notice">Only ${esc(t.mentor.name)} (${esc(t.mentor.email||'')}) can mark these tasks complete. Your panel shows their progress.</p>`:''}
 ${gate&&!start?`<p class="notice">${esc(gate)}</p>`:''}
 <div class="practical-progress"><div><strong>${p.complete===p.total?'All tasks complete':'Your practical progress'}</strong><span>${Math.round(p.complete/p.total*100)}%</span></div><progress max="${p.total}" value="${p.complete}" aria-label="Mentor practical progress"></progress></div><div class="practical-task-list">
 ${p.tasks.map((x,i)=>`<div class="mentor-task-row ${x.complete?'task-done':''}"><span class="practical-task-number" aria-hidden="true">${x.complete?'✓':String(i+1).padStart(2,'0')}</span><div class="practical-task-title"><small>${x.complete?'VERIFIED BY MENTOR':'GUIDED PRACTICE'}</small><strong>${esc(x.title)}</strong>${curriculumTaskDetails(x)}</div>${x.complete?'<span class="badge">Completed</span>':isMentor?button('Mark complete','mentorTask',`data-trainee="${t.id}" data-id="${x.id}" ${gate?'disabled':''}`,'primary'):'<span class="badge">Pending mentor confirmation</span>'}</div>`).join('')}
 </div><div class="practical-footer"><p>${p.complete===p.total?'✓ Practical tasks verified. Continue with the remaining stage requirements.':'Your mentor confirms each task once it is complete.'}</p><div class="actions">${!mentorStep?.complete?button(p.assigned?'Manage mentor':'Assign practical mentor','assignMentor','','primary'):''}${button('My mentor tasks','nav','data-view="mentoring"')}</div></div></div>`;
}
function mentorWorkspace(){return heading('My mentor tasks','Guide the trainee through each practical task, then confirm completion.')+((S.mentorAssignments||[]).map(t=>`<div class="card"><h2>${esc(t.name)}</h2><p>${esc(t.designation)} · ${esc(t.stage)} · ${esc(t.branch||'')}</p><p>Current trainer: ${esc(t.trainerName||'—')}</p><p class="prewrap">${esc(t.mentor.focus)}</p>${mentorTaskGate(t)?`<p class="notice">${esc(mentorTaskGate(t))} Ask the current trainer to start practical training.</p>`:''}<strong>${t.progress.complete} / ${t.progress.total} completed</strong>${t.progress.tasks.map(x=>`<div class="item"><span>${esc(x.title)}${curriculumTaskDetails(x)}</span>${x.complete?'<span class="badge">✓ Completed</span>':button('Mark complete','mentorTask',`data-trainee="${t.id}" data-id="${x.id}" ${mentorTaskGate(t)?'disabled':''}`,'primary')}</div>`).join('')}</div>`).join('')||empty('No practical mentoring assigned.'));}
async function handle(action, b) {
 if(action==='openAssignedWork'){const t=S.trainees.find(t=>t.id===b.dataset.trainee);if(!t)throw Error('This trainee is not assigned to this account.');$('modal').close();selected=t.id;view='trainees';section='Training stages';selectedFlowStep=null;render();return;}
 if(action==='curriculumOpen'){section='Training plan';render();return;}
 if(action==='curriculumDownload'){downloadData(await api('curriculumDownload',payload({})));return;}
 if(action==='certificateHistory'){
  const t=current(),certificates=t.issuedCertificates||[];
  modal('Issued certificates — '+t.name,`<p>Certificates from completed phases remain available after handover. Issuing a certificate does not send an email.</p>${certificates.map(c=>{const d=t.communications?.['certificate:'+c.id+':trainee'];return `<article class="card"><h2>${esc(c.phase)}</h2><p>Issued ${dt(c.at)} · Score: ${c.score==null?'Not assessed':esc(Number(c.score).toFixed(1))+' / 10'}</p><p>${d?.sentAt?'Email accepted by server · '+esc(d.to)+' · '+dt(d.sentAt):d?.status==='Delivery uncertain'?'Email delivery needs review':d?.status==='Failed'?'Email failed: '+esc(d.lastError||'Please retry'):'Not emailed to trainee yet'}</p><div class="actions">${button(d?.sentAt?'Review / send another copy':'Email certificate','certificateShare',`data-certificate="${esc(c.id)}" data-channel="email"`,'primary')}${button('WhatsApp certificate','certificateShare',`data-certificate="${esc(c.id)}" data-channel="whatsapp"`)}</div></article>`;}).join('')||empty('No issued certificates yet.')}`,async()=>{},'Close');return;
 }
 if(action==='certificateShare'){
  const t=current(),certificates=t.issuedCertificates||[t.certificate].filter(Boolean);
  if(!certificates.length)throw Error('Issue a training certificate first.');
  modal('Share training certificate',field('certificateId','Issued certificate',b.dataset.certificate||t.certificate?.id||certificates[0].id,'select',certificates.map(c=>[c.id,c.phase+' · '+dt(c.at)]),true)+field('recipient','Share with','trainee','select',[['trainee',t.name+' · Trainee'],['next','Next trainer']],true)+field('userId','Next trainer (when selected)','','select',S.users.filter(u=>u.active).map(u=>[u.id,u.name+' · '+u.email]))+field('channel','Send via',b.dataset.channel||'email','select',[['email','Email'],['whatsapp','WhatsApp']],true)+field('phone','WhatsApp number with country code (for WhatsApp)','')+'<p>Review the recipient in the next step, then choose Send email. The issued certificate is attached as a PDF.</p>',async p=>{const r=await api('prepareCertificateShare',payload(p));await refresh();setTimeout(()=>handleHR(p.channel==='email'?'communicationSend':'communicationShare',{dataset:{kind:r.kind}}).catch(e=>toast(e.message)),0);},'Review sharing');return;
 }
 if(action==='startPractical'){await mutateFlow('flowComplete',payload({step:'Mentor'}));selectedFlowStep='Practical';section='Training stages';await refresh();toast('Mentor tasks verified. Continue with practical content.');return;}
 if(action==='mentorTask'){const t=S.trainees.find(t=>t.id===b.dataset.trainee)||S.mentorAssignments.find(t=>t.id===b.dataset.trainee),task=(t?.practicalMentor||t?.progress)?.tasks.find(x=>x.id===b.dataset.id);const save=async p=>{await api('mentorTask',{traineeId:b.dataset.trainee,taskId:b.dataset.id,complete:true,...p});await refresh();toast('Practical task completed.');};if(task?.evidenceRequired)modal('Verify practical competency',`<p>${esc(task.title)}</p><p>Verify: ${esc(task.verification||'Observed completion')}</p>`+field('evidence','Observed evidence / trainer comment','','textarea',[],true),save,'Save sign-off');else await save({});return;}

  if(action.startsWith('life'))return handleLifecycle(action,b);
  if(action==='nav'&&b.dataset.view==='tickets'){view='tickets';selected=null;await refresh();return;}
  if(["ticketFilter","refreshTickets","retryTicketEmail","newTicket","viewTicket"].includes(action))return ticketHandle(action,b);
  if(action==='previewMaterial'){const t=current(),m=S.materials.find(m=>m.id===b.dataset.id);modal(m.title,`<p><a href="${materialDownload(m,t,true)}" target="_blank" rel="noopener">View / download ${esc(m.format)}</a></p>`,async()=>{},'Close');return;}

  if(action==='deleteSelectedTrainees'){
    const trainees=S.trainees.filter(t=>selectedTrainees.has(t.id)).map(t=>({traineeId:t.id,version:t.version}));
    if(!isAdmin()||!trainees.length)return;
    modal('Confirm delete',`<p>Delete ${trainees.length} selected trainee${trainees.length===1?'':'s'} and their training records? This cannot be undone.</p>`,async()=>{
      await mutate('deleteTrainees',{trainees,confirmed:true});selectedTrainees.clear();render();
    },'Yes, delete');return;
  }

  if(action==='dashboardFilter'||action==='dashboardClear'){
    dashboardFilter=action==='dashboardClear'?{range:'all',from:'',to:'',clinic:'',department:'',purpose:''}:{range:$('dashRange').value,from:$('dashFrom').value,to:$('dashTo').value,clinic:$('dashClinic').value,department:$('dashDepartment').value,purpose:$('dashPurpose').value};
    if(dashboardFilter.range==='custom'&&(!dashboardFilter.from||!dashboardFilter.to||dashboardFilter.from>dashboardFilter.to))throw Error('Choose a valid custom date range');render();return;
  }

  if(['nav','open','back','section','historyBack'].includes(action)&&hasTrainingDrafts()){
    if(!confirm('Unsaved checklist or scores. Leave without saving?'))return;trainingDrafts={};
  }
  if(action==='saveTrainingRows'){
    const t=current(),kind=b.dataset.kind,rows=trainingRows(t,kind).filter(r=>!r.removed);
    const missing=rows.filter(r=>kind==='checklist'?!r.covered:r.score==null||r.score==='');
    if(missing.length){modal('Required items pending',`<p>Complete these ${missing.length} items before saving:</p><ul>${missing.map(r=>`<li>${esc(r.topic||r.criterion)}</li>`).join('')}</ul>`,async()=>{},'Close');return;}
    await api('saveTrainingRows',payload({kind,rows:rows.map(r=>({id:r.id,covered:r.covered,contentShared:r.contentShared,score:r.score}))}));delete trainingDrafts[draftKey(t)];await refresh();toast('Saved '+kind+' for '+t.stage);return;
  }
  if(action==='liveScore'){
    const t=current();modal('Live training score',t?`<h2>${esc(t.name)}</h2><p>${esc(t.stage)} · ${esc(t.designation)}</p><h2>${t.phaseScore==null?'Not assessed':Number(t.phaseScore).toFixed(1)+' / 10'}</h2><p>Passing score: 75% (7.5 / 10) · Below target requires reset and re-evaluation</p><p>Checklist ${percent(t)}% complete. Scores reflect saved records.</p>`:trainingInsights(),async()=>{},'Close');return;
  }

  if(action==='flowOpen'){selectedFlowStep=b.dataset.step||current().trainingFlowStatus.find(s=>!s.complete)?.key;section='Training stages';render();return;}
  if(action==='flowRetryAck'){await mutateFlow('flowResendAcknowledgement',payload({step:selectedFlowStep}));toast('Acknowledgement email processed. Check Notifications for delivery status.');return;}
  if(action==='flowEnable'){await mutateFlow('enableTrainingFlow',payload());return;}
  if(action==='flowRetest'){modal('Start retest','<p>Reset the current ratings for a fresh evaluation? Your previous score and ratings will remain in attempt history.</p>',()=>mutateFlow('flowRetest',payload({step:selectedFlowStep})),'Start retest');return;}
  if(['flowSaveChecklist','flowSaveEvaluation','flowComplete'].includes(action)){
   const step=selectedFlowStep;
   if(action==='flowComplete'){modal('Complete training stage','<p>This stage will be locked and a confirmation email queued for the trainee.</p>',()=>mutateFlow('flowComplete',payload({step})),'Complete & notify');return;}
   b.disabled=true;b.textContent='Saving…';try{if(action==='flowSaveChecklist')await mutateFlow('flowChecklist',payload({step,rows:[...document.querySelectorAll('[data-flow-check]')].map(x=>({id:x.dataset.flowCheck,complete:x.checked}))}));else await mutateFlow('flowEvaluation',payload({step,ratings:[...document.querySelectorAll('[data-flow-rating]')].map(x=>({id:x.dataset.flowRating,score:Number(x.value)}))}));toast(action==='flowSaveChecklist'?'Checklist saved. Confirmation status is shown below; email status is in Email delivery.':'Evaluation saved. Your average score is updated; email status is in Email delivery.');}finally{b.disabled=false;if(b.isConnected)b.textContent=action==='flowSaveChecklist'?'Save checklist & notify trainee':'Save evaluation & notify trainee';}return;
  }
  const targetStep=action==='section'?journeyGroups.find(g=>g.sections.includes(b.dataset.section))?.name:['handover','handoverEdit','handoverEmail','selectStage'].includes(action)?'Handover':null;
  const oldHandover=action==='handoverEmail'&&current()?.handovers.some(h=>h.id===b.dataset.id&&h.fromStage&&h.fromStage!==current().stage);
  const blocked=!oldHandover&&targetStep&&current()?.journey?.[targetStep]?.blockedBy;
  if(blocked){toast('Complete '+blocked+' before entering '+targetStep+'.');return;}

  if(action==='journeyComplete'){const step=b.dataset.step;modal('Complete & lock '+step,'<p>Confirm this step is complete. Its records will become read-only.</p>',()=>mutate('journeyStep',payload({step,complete:true})),'Complete & lock');return;}
  if(action==='journeyUnlock'){const step=b.dataset.step;modal('Request correction — '+step,field('category','What needs correction?','','select',['Incorrect details','Checklist update','Module sharing / completion','Assessment / score correction','Mentor task correction','Other'],true)+field('reason','Correction details','','textarea',[],true)+'<p>Admins receive an email and portal notification. The step stays locked until approval.</p>',p=>mutate('requestUnlock',payload({step,reason:p.category+': '+p.reason})),'Send correction request');return;}
  if(action==='notificationEmailRetry'||action==='notificationEmailReview'){
   const traineeId=b.dataset.trainee;
   if(action==='notificationEmailRetry'){await api('lifecycleDeliver',{traineeId});await refresh();toast('Email processed. Check Notifications for status.');return;}
   modal('Review email delivery',field('result','Delivery outcome','','select',[['sent','Already sent'],['not-sent','Not sent — retry']],true)+field('note','Evidence from mailbox','','textarea',[],true),async p=>{await api('lifecycleDeliver',{...p,traineeId,messageId:b.dataset.id});await refresh();},'Save review');return;
  }
  if(action==='unlockNotifications'){
    S.unlockRequests=await api('notifications');
    const requests=(S.unlockRequests||[]).slice().reverse(),updates=S.lifecycleNotifications||[],pending=requests.filter(r=>r.status==='Pending').length,unread=updates.filter(n=>!n.readBy?.includes(S.user.id)).length;
    const statusClass=status=>status==='Pending'?'pending':['Approved','Sent','Completed'].includes(status)?'success':['Rejected','Failed','Delivery uncertain'].includes(status)?'attention':'neutral';
    const requestCards=requests.map(r=>`<article class="notification-card ${r.status==='Pending'?'needs-action':''}"><div class="notification-icon">${uiIcon('check')}</div><div class="notification-content"><div class="notification-top"><span class="notification-type">CORRECTION REQUEST</span><span class="notification-badge ${statusClass(r.status)}">${esc(r.status)}</span></div><h3>${esc(r.traineeName)}</h3><p class="notification-phase">${esc(r.phase)} <span>›</span> ${esc(r.step)}</p><p class="notification-reason">${esc(r.reason)}</p><div class="notification-meta"><span>${esc(r.requestedBy)}</span><time>${dt(r.requestedAt)}</time></div>${r.reviewedBy?`<p class="notification-reviewed">Reviewed by ${esc(r.reviewedBy)}</p>`:''}${isAdmin()&&r.status==='Pending'?`<div class="notification-actions">${button('Review & approve →','reviewUnlock',`data-id="${r.id}" data-trainee="${r.traineeId}"`,'primary')}<span>Your approval is required</span></div>`:''}</div></article>`).join('');
    const updateCards=updates.map(n=>`<article class="notification-card"><div class="notification-icon update">${uiIcon('outbox')}</div><div class="notification-content"><div class="notification-top"><span class="notification-type">TRAINING UPDATE${!n.readBy?.includes(S.user.id)?' · NEW':''}</span><span class="notification-badge ${statusClass(n.status)}">${esc(n.status)}</span></div><h3>${esc(n.title)}</h3><div class="notification-meta"><span>${esc(S.trainees.find(t=>t.id===n.traineeId)?.name||'Workspace')}</span><time>${dt(n.at)}</time></div>${n.error?`<p class="notification-reason">${esc(n.error)}</p>`:''}${['training-restart','training-handover'].includes(n.kind)?button('Open assigned training','openAssignedWork',`data-trainee="${esc(n.traineeId)}"`,'primary'):''}${n.kind==='handover-feedback-admin'?button('View trainee feedback','viewTraineeFeedback',`data-trainee="${esc(n.traineeId)}"`,'primary'):''}${isAdmin()&&['Pending','Failed'].includes(n.status)?button('Retry email','notificationEmailRetry',`data-trainee="${n.traineeId}"`):''}${isAdmin()&&n.status==='Delivery uncertain'?button('Review email delivery','notificationEmailReview',`data-trainee="${n.traineeId}" data-id="${n.id}"`):''}</div></article>`).join('');
    modal('Notifications',`<div class="notification-center"><div class="notification-intro"><span class="notification-intro-icon">${uiIcon('outbox')}</span><div><strong>Your workspace, up to date.</strong><p>Training updates and requests that need your attention.</p></div></div><div class="notification-stats"><div><strong>${pending}</strong><span>Awaiting review</span></div><div><strong>${unread}</strong><span>Unread updates</span></div></div><div class="notification-list">${requestCards+updateCards||'<div class="notification-empty"><span>✓</span><h3>You’re all caught up</h3><p>New requests and training updates will appear here.</p></div>'}</div></div>`,async()=>{await api('lifecycleReadNotifications');await refresh();},'Mark updates read & close');return;
  }
  if(action==='reviewUnlock'){
    if(!isAdmin())throw Error('Only an administrator can approve correction requests.');
    S.unlockRequests=await api('notifications');
    const r=S.unlockRequests.find(r=>r.id===b.dataset.id);
    if(!r)throw Error('This correction request is no longer available. Open Notifications to see current requests.');
    if(r.status!=='Pending'){toast('This request has already been '+r.status.toLowerCase()+'.');return;}
    modal('Review correction request',`<h3>${esc(r.traineeName)} · ${esc(r.step)}</h3><p>${esc(r.reason)}</p>`+field('decision','Decision','Approved','select',['Approved','Rejected'],true)+field('note','Review note (optional)','','textarea')+'<p>Approval reopens this step and relocks later steps until corrections are completed.</p>',async p=>{await api('reviewUnlock',{traineeId:r.traineeId,requestId:r.id,...p});await refresh();},'Approve & unlock');
    $('f-decision').onchange=()=>{$('modalSubmit').textContent=$('f-decision').value==='Rejected'?'Reject request':'Approve & unlock';};return;
  }
  if(action==='notifyMentor'){const t=current(),m=t.mentor;modal('Send mentor email',`<p>Send practical training details to ${esc(m.name)} (${esc(m.email)})?</p>`,async()=>{const r=await mutate('assignMentor',payload({mentorId:m.userId,startDate:today(),focus:canonicalPhase(m.phase)===canonicalPhase(t.stage)?m.focus:t.mentorPlan}));if(r.emailError)throw Error(r.emailError);},'Send email');return;}
  if(action==='assignMentor'){
    const t=current();modal('Assign practical mentor',`<p class="notice"><strong>${esc(trainingPhaseLabel(t.stage,t))}</strong> · ${esc(t.designation)}<br>Practical tasks for the current training phase.</p>`+field('mentorId','Mentor',t.mentor?.userId||'','select',S.users.filter(u=>u.active).map(u=>[u.id,u.name+' · '+u.email]),true)+field('startDate','Guidance starts',t.mentor?.startDate||today(),'date',[],true)+field('focus','Practical guidance plan',(t.mentor&&canonicalPhase(t.mentor.phase)===canonicalPhase(t.stage)&&t.mentor.designation===t.designation?t.mentor.focus:t.mentorPlan)||'','textarea',[],true),async p=>{const r=await mutate('assignMentor',payload(p));if(r.emailError)throw Error(r.emailError);},'Assign & send email');return;
  }
  if(await handleTransition(action,b))return;
  if(await handleHR(action,b))return;
  if(action==='testQuestionBank'){view='questions';render();return;}
  if(action==='testWorkspace'){view='tests';section='Assessment';render();return;}
  if(action==='selectStage')return workflowHandle('handover', {dataset:{phase:b.dataset.phase}});
  if(action==='stageOrder') {
    let order=orderedStages(current());
    modal('Reorder training phases','<p>Drag phase buttons on the trainee page, or select a phase here and move it with the buttons. This changes display order only.</p><div id="phaseOrderEditor"></div>',()=>mutate('reorderStages',payload({order})),'Save order');
    const draw=()=>{ $('phaseOrderEditor').innerHTML=order.map((s,i)=>`<div class="phase-order-row"><span>${i+1}. ${esc(s)}</span><button type="button" data-move="-1" data-index="${i}" aria-label="Move ${esc(s)} up" ${i===0?'disabled':''}>↑</button><button type="button" data-move="1" data-index="${i}" aria-label="Move ${esc(s)} down" ${i===order.length-1?'disabled':''}>↓</button></div>`).join(''); };
    $('phaseOrderEditor').onclick=e=>{const b=e.target.closest('[data-move]');if(!b)return;const i=Number(b.dataset.index),j=i+Number(b.dataset.move);if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];draw();}; draw();return;
  }
  if(action==='addChecklist')return modal('Add to checklist',field('topic','Topic','','text',[],true)+field('module','Module / category',current().stage,'text',[],true)+field('phase','Phase',current().stage,'select',S.stages,true)+field('type','Type','Theory','select',['Theory','Practical'],true),p=>mutate('addChecklist',payload(p)),'Add topic');
  if(action==='archiveEntry') {
    if(!confirm('Remove this entry? It will be kept in Removed items for restoration.'))return;
    await mutate('archiveEntry',payload({kind:b.dataset.kind,entryId:b.dataset.id}));toast('Moved to Removed items');return;
  }
  if(action==='restoreEntry') {await mutate('restoreEntry',payload({entryId:b.dataset.id}));toast('Entry restored');return;}
  if(action==='revokeMaterial') {
    if(!confirm('Remove this module assignment and completion for this trainee?'))return;
    await mutate('approveMaterial',payload({materialId:b.dataset.id,approved:false}));toast('Module assignment removed');return;
  }
  if(action==='archiveMaterial') {
    const t=current();
    if(!t)throw Error('Select a trainee first.');
    if(!confirm('Remove this module for '+t.name+' only? Other and new trainees will keep it.'))return;
    await mutate('archiveMaterial',payload({materialId:b.dataset.id,removed:true}));toast('Removed for this trainee only');return;
  }
  if(action==='removedModules') {
    const t=current();
    modal('Removed modules',(t?.removedMaterials||[]).map(m=>`<div class="phase-order-row"><span>${esc(m.title)}</span>${button('Restore for review','restoreLibraryMaterial',`data-id="${m.id}"`)}</div>`).join('')||empty('No removed modules.'),async()=>{},'Done'); return;
  }

  if(action==='clearMaterialSearch'){
    materialSearch='';$('materialSearch').value='';$('materialResults').innerHTML=materialResults(current());$('materialResults').scrollTop=0;$('materialSearch').focus();return;
  }
  if(action === "addMaterial")return modal('Add module',field('title','Module title','','text',[],true)+field('designation','Save for designation',current()?.designation||'','select',[['All','All designations'],...S.designations.filter(d=>!['All','Other'].includes(d))],true)+field('phase','Training phase',current()?.stage||'Induction','select',S.stages,true)+'<p class="notice">This file is saved in the designation’s training library. Current and future trainees with this designation will find it in the selected training phase; no repeat upload is needed.</p><label for="f-document">PDF or Word document (maximum 3 MB)</label><input id="f-document" name="document" type="file" accept=".pdf,.doc,.docx" required><p class="muted">Each trainee keeps their own review, sharing and completion status. Uploaded documents open through Download original.</p>',async p=>{
    const file=p.document;
    if(!file?.size || file.size>3*1024*1024)throw Error('Choose a PDF or Word document up to 3 MB');
    const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Could not read the file'));reader.readAsDataURL(file);});
    await mutate('uploadMaterial',{title:p.title,designation:p.designation,phase:p.phase,filename:file.name,base64});
  },'Upload module');
  if(action==='shareResource'){
    const r=b.dataset.id==='branch-sop'?{id:'branch-sop',title:'Branch operations SOP',contentPreview:resourceText(S.academy.branch)}:S.resources.find(r=>r.id===b.dataset.id);
    modal('Share resource with trainee',field('traineeId','Trainee',selected||'','select',S.trainees.map(t=>[t.id,t.name]),true)+field('channel','Send via','email','select',[['email','Email'],['whatsapp','WhatsApp']],true)+`<p><strong>${esc(r.title)}</strong></p><label class="answer"><input name="reviewed" type="checkbox" required>I have reviewed and approve this resource for the selected trainee.</label>`,async p=>{
      const target=S.trainees.find(t=>t.id===p.traineeId);
      if(p.channel==='email'){await mutate('sendLearningEmail',{traineeId:target.id,resourceId:r.id,reviewed:true});return;}
      if(!target?.phone)throw Error('Add a WhatsApp number in trainee details first.');
      const content=r.title+'\n\n'+(r.contentPreview||r.description||'')+(r.url?'\n'+r.url:'');
      const blob=new Blob([content],{type:'text/plain'}),url=URL.createObjectURL(blob);
      setTimeout(()=>{
        modal('Share with '+target.name,`<p>Download the resource and attach it in the trainee’s chat.</p><a href="${url}" download="resource.txt">Download resource</a><p><a href="https://wa.me/${encodeURIComponent(target.phone)}?text=${encodeURIComponent('Hi '+target.name+', I am sharing '+r.title+(r.url?' '+r.url:''))}" target="_blank" rel="noopener">Open WhatsApp</a></p><label class="answer"><input type="checkbox" name="sent" required>I have sent this resource to ${esc(target.name)}.</label>`,()=>mutate('resourceShare',{traineeId:target.id,resourceId:r.id,confirmed:true}),'Confirm shared');
      },0);
    },'Continue');return;
  }
  if(action==='viewMaterialRecipients'){
    const m=S.materials.find(m=>m.id===b.dataset.id);
    if(m)modal('Shared with',materialRecipientsDetails(m),async()=>{},'Done');
    return;
  }
  if(action==='confirmMaterialShare'){
    const t=current(),m=S.materials.find(m=>m.id===b.dataset.id),shared=materialSharing(t,m)?.status==='confirmed';
    modal(shared?'Correct sharing confirmation':'Confirm document shared',`<p><strong>${esc(m.title)}</strong> → ${esc(t.name)}</p><p>${shared?'Remove the current sharing confirmation? The history remains in Activity log.':'Confirm only after you have sent the actual document. Opening WhatsApp or downloading does not confirm delivery.'}</p><label class="answer"><input type="checkbox" name="confirmed" required>${shared?'I want to correct this status':'I have sent this document to the trainee'}</label>`,p=>mutate('materialShareStatus',{traineeId:t.id,materialId:m.id,status:shared?'reset':'confirmed',confirmed:p.confirmed==='on'}),'Confirm');return;
  }
  if(action === "shareMaterial")return shareMaterial(b.dataset.id);
  if(action === "reviewMaterial" || action === "readMaterial")return openMaterial(b.dataset.id,action === "reviewMaterial");
  if (await workflowHandle(action, b)) return;
  const t = current(),
    key = b.dataset.id;
  if (action === "nav") {
    if (test) {
      if (!confirm("Discard this unsaved test?")) return;
      test = null;
    }
    if (roleplay && !confirm("Leave this unsaved practice?")) return;
    view = b.dataset.view;
    if(view!=="tests")selected = null;
    if(view==="tests")section="Assessment";
    moduleId = null;
    roleplay = null;
    search = "";
    status = "";
    render();
    return;
  }
  if(action === "historyBack"){goPortalBack();return;}
  if (action === "logout") {
    await request("/api/logout", {});
    selectedTrainees.clear();
    S = null;
    navigationReady=false;navigationIndex=0;history.replaceState(null,'');view='dashboard';
    selected = null;
    test = null;
    roleplay = null;
    moduleId = null;
    auth(false);
    return;
  }
  if (action === "refresh") {
    await refresh();
    return;
  }
  if (action === "open") {
    activityFilter.traineeId="";activityFilter.page=0;
    selected = key;
    view = "trainees";
    section = "Training stages";selectedFlowStep=null;
    moduleId = null;
    roleplay = null;
    render();
    return;
  }
  if (action === "back") {
    selected = null;
    moduleId = null;
    roleplay = null;
    render();
    return;
  }
  if (action === "section") {
    if (roleplay && !confirm("Leave this unsaved practice?")) return;
    section = b.dataset.section;
    moduleId = null;
    roleplay = null;
    render();
    return;
  }
  if (action === "addTrainee") {
    modal(
      "Add a trainee",
      `<div class="cols"><div>${field("name", "Full name", "", "text", [], true)}</div><div>${field("email", "Email for confirmations", "", "email", [], true)}</div><div>${field("phone", "WhatsApp number (India: 10 digits; other countries: +country code)", "", "tel")}</div><div>${field("branch", "Clinic name", "", "select",S.clinics,true)+field("department","Department name","","select",S.departments,true)}</div><div>${field("joiningDate", "Joining date", today(), "date", [], true)}</div></div>` +
        designationPicker() +
        field(
          "ownerId",
          "Assigned trainer and name",
          "",
          "select",
          S.users
            .filter((u) => u.active)
            .map((u) => [u.id, u.name + " · " + u.email]),
          true,
        ) +
        field("purpose", "Training purpose", "New Joiner", "select", [
          "New Joiner",
          "Reskilling",
          "Revaluation",
        ])+`<div id="purposePhase" hidden>${field("trainingPhase","Department / skill to train or reassess","Sales Training","select",["Sales Training","CRM & Tech Training","Operations Training","Induction"])}<p>Only this department’s designation-specific content is shown. No welcome letter.</p></div>`,
      async (p) => {
        const r = await mutate("createTrainee", {...p,flowEnabled:true});
        selected = r.id;
        view = "trainees";
        section = "Training stages";selectedFlowStep=null;
        render();
      },
      "Add trainee",
    );
    bindDesignationPicker();
    $('f-purpose').addEventListener('change',()=>{$('purposePhase').hidden=$('f-purpose').value==='New Joiner';});
    $('f-name').addEventListener('input',e=>{const el=e.target,pos=el.selectionStart;el.value=el.value.replace(/^(\s*)(\p{L})/u,(_,space,first)=>space+first.toLocaleUpperCase());el.setSelectionRange(pos,pos);});
    return;
  }
  if(action==='checklist'){const r=t.checklist.find(x=>x.id===key);await mutate('checklist',payload({itemId:key,covered:!r.covered}));return;}
  if (action === "remove" || action === "restore") {
    if (
      action === "remove" &&
      !confirm(
        "Remove this checklist topic? You can restore it from Removed items.",
      )
    )
      return;
    await mutate(
      "checklist",
      payload({ itemId: key, removed: action === "remove" }),
    );
    return;
  }
  if (action === "score") {
    const r = t.scores.find((x) => x.id === key);
    modal(
      r.criterion,
      field("score", "Score (1 = lowest, 10 = highest)",r.score??"","select",Array.from({length:10},(_,i)=>String(i+1))),
      (p) => mutate("score", payload({ itemId: key, ...p })),
    );
    return;
  }
  if (action === "assessment") {
    const r = t.assessments.find((x) => x.id === key);
    modal(
      "Rate assessment",
      `<p>Listen to the trainee’s answer and select a rating. No answer typing is needed.</p><h3>${esc(r.question)}</h3><p class="subtle">Assessor key points: ${esc(r.keyPoints)}</p>` +
        field("rating", "Rating", r.rating, "select", Object.keys(S.ratings)),
      (p) => mutate("assessment", payload({ itemId: key, ...p })),
    );
    return;
  }
  if (action === "module") {
    moduleId = Number(key);
    render();
    return;
  }
  if (action === "modules") {
    moduleId = null;
    render();
    return;
  }
  if (action === "completeModule") {
    await mutate(
      "module",
      payload({
        moduleId: Number(key),
        complete: b.dataset.complete === "true",
      }),
    );
    toast("Learning progress saved");
    return;
  }
  if (action === "startTest" || action === "startModuleTest") {
    if (!selected) return toast("Select a trainee first");
    view = "tests";
    section = "Tests";
    test = await api("startTest", {
      traineeId: selected,
      moduleId:
        action === "startModuleTest"
          ? Number(key)
          : $("testModule").value || null,
    });
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (action === "cancelTest") {
    if (confirm("Discard this test attempt?")) {
      test = null;
      render();
    }
    return;
  }
  if (action === "roleplay" || action === "roleplayAI") {
    const persona = S.academy.personas.find((p) => p.id === key);
    roleplay = {
      persona,
      ai: action === "roleplayAI",
      turn: 0,
      messages: [{ role: "assistant", text: persona.initialMessage }],
    };
    render();
    return;
  }
  if (action === "endRoleplay") {
    if (confirm("Discard this unsaved practice?")) {
      roleplay = null;
      render();
    }
    return;
  }
  if (action === "saveRoleplay") {
    recordForm("roleplay", {
      title: roleplay.persona.name,
      personaId: roleplay.persona.id,
      transcript: roleplay.messages
        .map((m) => (m.role === "user" ? "Counsellor: " : "Patient: ") + m.text)
        .join("\n\n"),
    });
    return;
  }
  if (action === "addRecord") {
    recordForm(b.dataset.kind);
    return;
  }
  if (action === "record") {
    showRecord(S.records.find((r) => r.id === key));
    return;
  }
  if (action === "recordStatus") {
    const r = S.records.find((r) => r.id === key);
    modal(
      "Update record status",
      field(
        "status",
        "Status",
        r.status,
        "select",
        ["Open", "In progress", "Completed"],
        true,
      ),
      (p) => mutate("updateRecord", payload({ recordId: key, ...p })),
    );
    return;
  }
  if (action === "certificate") {
    modal(
      "Issue training certificate",
      `<p>Review ${esc(t.name)}’s learning and test results before approval. This records your training sign-off.</p>` +
        field("nextTraining","Next training phase",orderedStages(t)[orderedStages(t).indexOf(t.stage)+1]||"Training completed","select",[...orderedStages(t),"Training completed"],true)+field("note", "Note (optional)", "", "textarea"),
      (p) => mutate("certificate", payload(p)),
      "Issue certificate",
    );
    return;
  }
  if (action === "print") {
    window.print();
    return;
  }
  if (action === "addResource") {
    modal(
      "Add learning resource",
      field("title", "Title", "", "text", [], true) +
        field("category", "Category") +
        field("description", "Description", "", "textarea") +
        field("url", "Resource URL (optional)", "", "url") +
        field("content", "Text / SOP content", "", "textarea"),
      (p) => mutate("addResource", p),
    );
    return;
  }
  if (action === "addUser") {
    modal(
      "Add user / trainer",
      field("name", "Name", "", "text", [], true) +
        field("email", "Email", "", "email", [], true) +
        field(
          "password",
          "Password (at least 10 characters)",
          "",
          "password",
          [],
          true,
        ) +
        field(
          "role",
          "Access",
          "trainer",
          "select",
          [
            ["trainer", "Trainer — assigned trainees only"],
            ["admin", "HR/admin — all trainees"],
          ],
          true,
        ) +
        field("branch", "Clinic / department"),
      (p) => mutate("createUser", p),
      "Create user",
    );
    return;
  }
  if (action === "editUser") {
    const u = S.users.find((u) => u.id === key);
    modal(
      "Edit user access",
      field("name", "Name", u.name, "text", [], true) +
        field("role", "Role", u.role, "select", ["trainer", "admin"], true) +
        field(
          "password",
          "New password (leave blank to keep)",
          "",
          "password",
        ) +
        `<label class="answer"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Account active</label>`,
      (p) => mutate("updateUser", { id: key, ...p, active: p.active === "on" }),
    );
    return;
  }
  if (action === "addQuestion") {
    modal(
      "Add phase question",
      field("phase","Training phase",current()?.stage||"Sales Training","select",S.stages,true)+field("designation","Designation","All","select",["All",...S.designations],true)+
      field(
        "moduleId",
        "Module",
        "",
        "select",
        [["phase","Current phase question bank"],...S.academy.modules.map((m) => [m.id, m.title])],
        true,
      ) +
        field("question", "Question", "", "textarea", [], true) +
        [0, 1, 2, 3]
          .map((i) => field("o" + i, "Option " + (i + 1), "", "text", [], true))
          .join("") +
        field(
          "correctIndex",
          "Correct option",
          "",
          "select",
          [
            [0, "1"],
            [1, "2"],
            [2, "3"],
            [3, "4"],
          ],
          true,
        ) +
        field("rationale", "Explanation", "", "textarea", [], true),
      (p) => mutate("addQuestion", { ...p, options: [p.o0, p.o1, p.o2, p.o3] }),
    );
    return;
  }
  if (action === "reminders") {
    const r = await mutate("reminders");
    toast(`${r.count} reminder draft(s) prepared`);
    return;
  }
  if (action === "mail" || action === "copyMail" || action === "markOutbox") {
    const r = S.outbox.find((r) => r.id === key);
    if (action === "mail")
      location.href = `mailto:${encodeURIComponent(r.to)}?subject=${encodeURIComponent(r.subject)}&body=${encodeURIComponent(r.body)}`;
    if (action === "copyMail") {
      await navigator.clipboard.writeText(
        `To: ${r.to}\nSubject: ${r.subject}\n\n${r.body}`,
      );
      toast("Email draft copied");
    }
    if (action === "markOutbox") await mutate("markOutbox", { id: key });
    return;
  }
  if (action === "csv") {
    const rows = [
      [
        "ID",
        "Name",
        "Designation",
        "Clinic",
        "Stage",
        "Owner",
        "Status",
        "Checklist %",
        "Score / 10",
        "Training days",
        "Academy modules",
      ],
      ...S.trainees.map((t) => [
        t.code,
        t.name,
        t.designation,
        t.branch,
        t.stage,
        owner(t),
        t.status,
        percent(t),
        scoreAvg(t),
        days(t),
        t.completedModules.length,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }),
    );
    a.download = "gleuhr-training-report.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
}
let phaseDrag=null, suppressPhaseClick=false;
$("app").addEventListener("pointerdown",e=>{
  const b=e.target.closest('[data-phase]');if(!b||e.button!==0||e.pointerType==='touch')return;
  phaseDrag={phase:b.dataset.phase,traineeId:selected,version:current().version,x:e.clientX,y:e.clientY,moved:false,button:b};
  b.setPointerCapture(e.pointerId);
});
$("app").addEventListener("pointermove",e=>{
  if(!phaseDrag)return;
  if(Math.hypot(e.clientX-phaseDrag.x,e.clientY-phaseDrag.y)>6){phaseDrag.moved=true;phaseDrag.button.classList.add('dragging');}
});
$("app").addEventListener("pointercancel",()=>{phaseDrag?.button.classList.remove('dragging');phaseDrag=null;});
$("app").addEventListener("pointerup",async e=>{
  const drag=phaseDrag;phaseDrag=null;if(!drag)return;drag.button.classList.remove('dragging');
  if(!drag.moved)return;suppressPhaseClick=true;setTimeout(()=>{suppressPhaseClick=false;},0);
  const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-phase]');
  if(!target||drag.traineeId!==selected)return;
  const order=orderedStages(current()),from=order.indexOf(drag.phase),to=order.indexOf(target.dataset.phase);
  if(from<0||to<0||from===to)return;order.splice(from,1);order.splice(to,0,drag.phase);
  try{await mutate('reorderStages',{traineeId:drag.traineeId,version:drag.version,order});toast('Phase order saved');}catch(error){toast(error.message);}
});
let inlineSaving=false;
$("app").addEventListener("change",async e=>{
 if(e.target.matches('[data-flow-check]')){const row=e.target.closest('.flow-check');if(row)row.querySelector('small').textContent='Unsaved';const save=document.querySelector('[data-action="flowSaveChecklist"]');if(save){save.disabled=false;save.textContent='Save checklist & notify trainee';}const complete=document.querySelector('[data-action="flowComplete"]');if(complete)complete.disabled=true;return;}
 if(e.target.matches('[data-flow-rating]')){updateEvaluationAverage();return;}
 const el=e.target.closest('[data-inline]');if(!el)return;
 if(inlineSaving){render();return;}
 const action=el.dataset.inline,id=el.dataset.id,p={itemId:id};
 if(['checklist','checklistShared','score'].includes(action)){
   const t=current(),key=draftKey(t),kind=action==='score'?'scores':'checklist';trainingDrafts[key]??={};trainingDrafts[key][kind]??={};trainingDrafts[key][kind][id]??={};
   trainingDrafts[key][kind][id][action==='score'?'score':action==='checklistShared'?'contentShared':'covered']=action==='score'?el.value:el.checked;
   const pending=trainingRows(t,kind).filter(r=>!r.removed&&(kind==='checklist'?!r.covered:r.score==null||r.score==='')).length;
   document.querySelectorAll('.pending-training-rows').forEach(n=>n.textContent=pending?pending+' required items pending · Not saved':'Ready to save');return;
 }

 if(action==='checklist')p.covered=el.checked;
 if(action==='score')p.score=el.value;
 if(action==='assessment')p.rating=el.value;
 if(action==='completeMaterial'){p.materialId=id;delete p.itemId;p.complete=el.checked;}
 const q=$('topicSearch')?.value||'',type=$('topicType')?.value||'';
 inlineSaving=true;document.querySelectorAll('[data-inline]').forEach(x=>x.disabled=true);
 try{if(action==='completeMaterial'&&!current().approvedMaterials?.some(a=>a.id===id))await mutate('approveMaterial',payload({materialId:id,approved:true}));await mutate(action,payload(p));toast('Saved');}catch(error){toast(error.message);await refresh().catch(()=>render());}
 finally{inlineSaving=false;if($('topicSearch')){$('topicSearch').value=q;$('topicType').value=type;$('topicList').innerHTML=checklist(current());}}
});
$("app").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || b.disabled || (suppressPhaseClick && b.dataset.phase)) return;
  b.disabled = true;
  try {
    await handle(b.dataset.action, b);
  } catch (e) {
    toast(e.message);
  } finally {
    b.disabled = false;
  }
});
request("/api/session")
  .then((s) => (s.user ? refresh() : auth(s.setup)))
  .catch((e) => {
    $("app").innerHTML =
      `<div class="login"><h1>Unable to connect</h1><p>${esc(e.message)}</p><p>Check that npm run dev is running, then refresh.</p></div>`;
  });

$('app').addEventListener('click',async e=>{const a=e.target.closest('a[data-track-material]');if(!a)return;e.preventDefault();if(a.dataset.busy)return;a.dataset.busy='true';const target=a.href,t=current();try{await api('materialShareStatus',{traineeId:t.id,materialId:a.dataset.trackMaterial,status:'prepared'});location.assign(target);}catch(error){toast(error.message);delete a.dataset.busy;}});

setInterval(async()=>{if(!S)return;try{S.unlockRequests=await api('notifications');const b=document.querySelector('[data-action=unlockNotifications]');if(b)b.textContent='Notifications ('+(S.unlockRequests.filter(r=>r.status==='Pending').length+(S.lifecycleNotifications||[]).filter(n=>!n.readBy?.includes(S.user.id)).length)+')';}catch{}},30000);

$('app').addEventListener('change',e=>{
 const el=e.target;if(!el.matches('[data-select-trainee],[data-select-trainees]')||!isAdmin())return;
 const boxes=[...document.querySelectorAll('[data-select-trainee]')];
 if(el.hasAttribute('data-select-trainees'))for(const box of boxes){box.checked=el.checked;}
 for(const box of boxes){if(box.checked)selectedTrainees.add(box.dataset.selectTrainee);else selectedTrainees.delete(box.dataset.selectTrainee);}
 const all=document.querySelector('[data-select-trainees]');if(all){all.checked=boxes.length>0&&boxes.every(b=>b.checked);all.indeterminate=selectedTrainees.size>0&&!all.checked;}
 $('traineeSelectionCount').textContent=selectedTrainees.size+' selected';
 document.querySelector('[data-action="deleteSelectedTrainees"]').disabled=!selectedTrainees.size;
});

// Capitalize prose entry while preserving identifiers and credentials.
document.addEventListener('input', event => {
 const el=event.target;
 if(event.isComposing || !(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))return;
 if(el instanceof HTMLInputElement && el.type!=='text')return;
 const key=[el.name,el.id,el.autocomplete,el.placeholder].join(' ');
 if(/email|password|url|link|token|code|search|phone|website|username|smtp/i.test(key))return;
 const next=el.value.replace(/^(\s*)(\p{L})/u,(_,space,letter)=>space+letter.toLocaleUpperCase());
 if(next!==el.value){const start=el.selectionStart,end=el.selectionEnd;el.value=next;el.setSelectionRange(start,end);}
});

document.addEventListener('click',async event=>{if(!event.target.closest('[data-email-test]'))return;modal('Test email delivery',field('to','Test recipient','rahul.verma@gleuhr.com','email',[],true)+'<p>Send a branded test email with a sample PDF attachment.</p>',async p=>{const r=await api('testEmail',{to:p.to,confirm:true});await refresh();toast(r.message);},'Send test email');});

// Keep external mentor/trainee updates visible without overwriting unsaved inputs.
let acknowledgementRefreshing=false;
function hasFlowDraft(){
 const t=current();if(!t)return false;
 const rows=t.activeTraining?.checklist||[];
 if([...document.querySelectorAll('[data-flow-check]')].some(el=>el.checked!==!!rows.find(r=>r.id===el.dataset.flowCheck)?.covered))return true;
 const saved=t.flowRecord?.evaluations?.[selectedFlowStep]?.ratings||[];
 return [...document.querySelectorAll('[data-flow-rating]')].some(el=>String(el.value)!==String(saved.find(r=>r.id===el.dataset.flowRating)?.score??''));
}
async function refreshAcknowledgementStatus(){
 const t=current(),step=selectedFlowStep,snapshot=S;
 if(!['trainees','tests'].includes(view)||document.querySelector('#finalFeedbackForm')||flowSaving||acknowledgementRefreshing||document.hidden||!t?.flowEnabled||section!=='Training stages'||$('modal')?.open||hasFlowDraft()||document.querySelector('[data-action="flowSaveChecklist"]')?.textContent==='Saving…')return;
 acknowledgementRefreshing=true;
 try{const next=await api('state');const updated=next.trainees.find(x=>x.id===t.id);
 if(!flowSaving&&S===snapshot&&selected===t.id&&section==='Training stages'&&selectedFlowStep===step&&!$('modal')?.open&&!hasFlowDraft()&&updated){const changed=JSON.stringify([updated.trainingFlowStatus,updated.practicalMentor,updated.lifecycle?.acknowledgements,updated.flowRecord,updated.flowCriteria,updated.communications])!==JSON.stringify([t.trainingFlowStatus,t.practicalMentor,t.lifecycle?.acknowledgements,t.flowRecord,t.flowCriteria,t.communications]);S=next;if(changed)render();}
 }catch{}finally{acknowledgementRefreshing=false;}
}
setInterval(refreshAcknowledgementStatus,10000);
window.addEventListener('focus',refreshAcknowledgementStatus);

function profileProgress(t){
 if(isAdministrative(t))return '<div><small>CURRENT STEP</small><strong>'+esc(trainingPhaseLabel(t.stage,t))+'</strong><small>'+ (t.stage==='Asset Allotment'?'Final onboarding step':'Review & next responsibility')+'</small></div>';
 const steps=(t.trainingFlowStatus||[]).filter(s=>!s.notRequired),done=steps.filter(s=>s.complete).length;
 return `<div><small>TRAINING PROGRESS · CURRENT DEPARTMENT</small><strong>${steps.length?Math.round(done/steps.length*100):0}% <span>${done}/${steps.length} steps</span></strong><progress max="${steps.length||1}" value="${done}" aria-label="Training stage progress"></progress></div><div><small>LATEST EVALUATION AVERAGE</small><strong>${scoreAvg(t)} <span>/ 10</span></strong><small>Target ≥ 7.5 (75%) · Saved ratings</small></div>`;
}

let emailRefreshing=false;
async function refreshEmailDelivery(){
 if(!S||view!=='outbox'||document.hidden||emailRefreshing||$('modal')?.open||![...S.outbox,...(S.lifecycleNotifications||[])].some(n=>['Queued','Sending'].includes(n.status)))return;
 emailRefreshing=true;const snapshot=S;
 try{const next=await api('state');if(view==='outbox'&&S===snapshot&&!$('modal')?.open){S=next;render();}}catch{}finally{emailRefreshing=false;}
}
setInterval(refreshEmailDelivery,5000);
