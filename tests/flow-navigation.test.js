import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
import {trainingPurpose} from '../training-purpose.js';
import {flowStatus} from '../training-flow.js';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function isFinalFeedback('),source.indexOf('function evaluationAverage('));
for(const purpose of ['New Joiner','Reskilling','Revaluation','Reskilling / Upskilling','Re-evaluation / PIP'])test('roadmap labels follow actual steps for '+purpose,()=>{
 const c=vm.createContext({selectedFlowStep:null,trainingPurpose,esc:x=>x,uiIcon:x=>x,button:(label,action,extra)=>`<button ${extra}>${label}</button>`});vm.runInContext(code,c);
 const t={purpose,stage:'Induction',designation:'Branch Manager',checklist:[],assessments:[],scores:[]};t.trainingFlowStatus=flowStatus(t,{});
 const html=c.flowNav(t);assert.match(html,/<button [^>]*data-step="TheoryEvaluation"[^>]*>[\s\S]*?<strong>Theory test<\/strong>/);
 if(purpose!=='New Joiner')assert.doesNotMatch(html,/data-step="Start"/);
 if(purpose==='Revaluation')assert.match(html,/^<nav[^>]*><button[^>]*data-step="TheoryEvaluation"/);
});

test('focused roadmaps exclude new joiner stages and old onboarding plans',()=>{
 const c=vm.createContext({trainingPurpose,esc:x=>x,S:{stages:['Induction','Asset Allotment','Sales Training','Onboard Final Email']}});
 vm.runInContext(source.slice(source.indexOf('const canonicalPhase='),source.indexOf('function mentorEmailStatus('))+source.slice(source.indexOf('function trainingPhaseProgress('),source.indexOf('function removeEntryButton(')),c);
 for(const purpose of ['Reskilling','Revaluation','Reskilling / Upskilling']){
  const html=c.trainingPhaseProgress({purpose,stage:'Induction',lifecycle:{plan:{phases:[{phase:'Induction'},{phase:'Asset Allotment'},{phase:'Onboard Final Email'}]}}});
  assert.match(html,/HR policies &amp; workplace standards|HR policies & workplace standards/);assert.doesNotMatch(html,/Onboarding|Asset Allotment|Onboard Final Email/);
 }
 assert.match(c.trainingPhaseProgress({purpose:'New Joiner',stage:'Induction'}),/Induction & Onboarding/);
});
test('final feedback has no learning roadmap or theory steps',()=>{
 const c=vm.createContext({selectedFlowStep:null});vm.runInContext(code,c);
 assert.equal(c.flowNav({stage:'Final Feedback',trainingFlowStatus:[]}), '');assert.equal(c.flowNav({stage:'Final Review & Confirmation',trainingFlowStatus:[]}), '');
});
