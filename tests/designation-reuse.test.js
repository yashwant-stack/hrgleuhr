import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import PDFDocument from 'pdfkit';
import { createApp } from '../server.js';
import { openStore } from '../store.js';
import { prepareJourneyFixture } from './journey-fixture.js';

async function pdf() {
  const doc = new PDFDocument(), chunks = [];
  const ready = new Promise(resolve => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); });
  doc.text('Synthetic training guide. No employee information.'); doc.end(); return ready;
}

test('designation and both document libraries persist for the next trainee without copying personal records', async ctx => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'designation-reuse-'));
  let app, origin, cookie, sent = 0;
  const start = async () => {
    app = createApp({ dataDir: dir, scheduler: false, mailer: { configured: true, from: 'test@example.test', send: async () => { sent++; return { messageId: 'mock' }; } } });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    origin = 'http://127.0.0.1:' + app.server.address().port;
  };
  const call = async (route, body, auth = cookie) => {
    const response = await fetch(origin + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const action = (name, payload = {}, auth = cookie) => { prepareJourneyFixture(app, name, payload); return call('/api/action', { action: name, payload }, auth); };
  const ok = async result => { result = await result; assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  await start();
  ctx.after(async () => { await new Promise(resolve => app.server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  cookie = (await call('/api/setup', { name: 'Test HR', email: 'hr@example.test', password: 'synthetic-test-password' })).cookie;
  const trainer = await ok(action('createUser', { name: 'Test trainer', email: 'trainer@example.test', password: 'synthetic-test-password' }));
  const trainerCookie = (await call('/api/login', { email: trainer.email, password: 'synthetic-test-password' })).cookie;
  assert.equal((await action('createDesignation', { name: 'Forbidden role' }, trainerCookie)).status, 403);
  assert.equal((await action('createDesignation', { name: 'Forbidden role' }, '')).status, 401);
  for (const name of ['', '__proto__', 'constructor', 'ALL', 'Other', 'x'.repeat(101)]) assert.equal((await action('createDesignation', { name })).status, 400);
  assert.equal((await action('createDesignation', { name: 'Unknown base', baseDesignation: 'Not registered' })).status, 400);
  const added = await ok(action('createDesignation', { name: '  Training   Coordinator ', baseDesignation: 'Branch Manager' }));
  assert.equal(added.designation, 'Training Coordinator'); assert.equal(added.created, true);
  const duplicate = await ok(action('createDesignation', { name: 'training coordinator', baseDesignation: 'All' }));
  assert.equal(duplicate.created, false); assert.equal(duplicate.designation, added.designation);
  assert.equal(openStore(dir).data.customDesignations[added.designation], 'Branch Manager');
  const first = await ok(action('createTrainee', { name: 'First synthetic learner', designation: added.designation, ownerId: trainer.id }));
  const bytes = await pdf(), encoded = bytes.toString('base64');
  const module = await ok(action('uploadMaterial', { designation: added.designation, phase: 'Induction', title: 'Reusable module', filename: 'training-guide.pdf', base64: encoded }, trainerCookie));
  await ok(action('approveMaterial', { traineeId: first.id, materialId: module.id, approved: true }, trainerCookie));
  await ok(action('completeMaterial', { traineeId: first.id, materialId: module.id, complete: true }, trainerCookie));
  await ok(action('archiveMaterial', { traineeId: first.id, materialId: module.id, removed: true }, trainerCookie));
  const sentBeforeLetters = sent; // Existing completion-feedback behavior is outside this change.
  const letter = { kind: 'welcome', to: 'first@example.test', phone: '', cc: '', subject: 'Welcome first learner', body: 'Personal letter for the first learner.', attachments: [{ filename: 'welcome-training.pdf', base64: encoded }], includeTrainingPlan: true };
  await ok(action('communicationSave', { ...letter, traineeId: first.id }));
  const stored = openStore(dir).data;
  assert.equal(stored.designationDocuments.length, 1, 'Generated personalised training plan must not be reused');
  const sharedId = stored.designationDocuments[0].id;
  assert.equal(stored.trainees.find(t => t.id === first.id).communications.welcome.attachments.length, 2);
  await new Promise(resolve => app.server.close(resolve)); await start();
  cookie = (await call('/api/login', { email: 'hr@example.test', password: 'synthetic-test-password' })).cookie;
  const second = await ok(action('createTrainee', { name: 'Second synthetic learner', designation: added.designation }));
  const unrelated = await ok(action('createTrainee', { name: 'Different designation learner', designation: 'Doctor' }));
  const otherPhase = await ok(action('createTrainee', { name: 'Sales phase learner', designation: added.designation, purpose: 'Reskilling', trainingPhase: 'Sales Training' }));
  const state = await ok(action('state')), next = state.trainees.find(t => t.id === second.id);
  assert.ok(state.designations.includes(added.designation));
  assert.ok(next.materialIds.includes(module.id));
  assert.deepEqual(next.welcomeDocuments.map(file => file.id), [sharedId]);
  assert.equal(next.communications.welcome, null);
  assert.equal(next.approvedMaterials?.length || 0, 0);
  assert.equal(next.completedMaterials?.length || 0, 0);
  assert.equal(next.materialShares?.length || 0, 0);
  assert.equal(next.removedMaterialIds?.length || 0, 0);
  assert.equal(state.trainees.find(t => t.id === unrelated.id).materialIds.includes(module.id), false);
  assert.equal(state.trainees.find(t => t.id === unrelated.id).welcomeDocuments.length, 0);
  assert.equal(state.trainees.find(t => t.id === otherPhase.id).materialIds.includes(module.id), false);
  const preview = await ok(action('communicationAttachment', { traineeId: second.id, kind: 'welcome', attachmentId: sharedId }));
  assert.deepEqual(Buffer.from(preview.base64, 'base64'), bytes);
  assert.equal((await action('communicationAttachment', { traineeId: unrelated.id, kind: 'welcome', attachmentId: sharedId })).status, 404);
  const secondLetter = { ...letter, to: 'second@example.test', subject: 'Welcome second learner', body: 'Personal letter for the second learner.', includeTrainingPlan: false, attachments: [{ id: sharedId }] };
  assert.equal((await action('communicationSave', { ...secondLetter, traineeId: unrelated.id })).status, 400);
  await ok(action('communicationSave', { ...secondLetter, traineeId: second.id }));
  const nextDraft = (await ok(action('state'))).trainees.find(t => t.id === second.id).communications.welcome;
  assert.equal(nextDraft.body, secondLetter.body); assert.equal(nextDraft.to, secondLetter.to); assert.equal(nextDraft.approved, false);
  assert.equal(nextDraft.attachments[0].id, sharedId);
  await ok(action('communicationSave', { ...secondLetter, traineeId: second.id, attachments: [{ filename: 'welcome-training.pdf', base64: encoded }] }));
  assert.equal(openStore(dir).data.designationDocuments.length, 1, 'Retry/re-upload must not duplicate the shared document');
  await ok(action('communicationSave', { ...secondLetter, traineeId: second.id, attachments: [] }));
  assert.equal(openStore(dir).data.designationDocuments.length, 1, 'Removing from one draft must not remove the designation library');
  assert.equal(sent, sentBeforeLetters);
});

test('welcome defaults preselect reusable files within letter limits and keep extras available', () => {
  const source = fs.readFileSync(new URL('../public/hr-ui.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('function welcomeAttachmentDefaults'), source.indexOf('function communicationDefaults')), context);
  const t = { welcomeDocuments: Array.from({ length: 6 }, (_, index) => ({ id: 'file-' + index, bytes: 600000 })) };
  const defaults = context.welcomeAttachmentDefaults(t);
  assert.equal(defaults.length, 3); assert.equal(context.welcomeAttachmentChoices(t, { attachments: defaults }).length, 6);
  assert.equal(context.welcomeAttachmentDefaults({ welcomeDocuments: t.welcomeDocuments.map(file => ({ ...file, bytes: 100 })) }).length, 4);
});
