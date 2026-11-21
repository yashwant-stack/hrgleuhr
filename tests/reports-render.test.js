import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('admin reports render all sections without directory-only selection variables',()=>{
 const start=source.indexOf('function reportsView()'),end=source.indexOf('\nfunction ',start+1);
 const c=vm.createContext({heading:()=>'',button:()=>'',stats:()=>'',workflowInsightStats:()=>'',traineeTable:()=>'',isAdmin:()=>true,S:{trainees:[]}});vm.runInContext(source.slice(start,end),c);const html=c.reportsView();assert.match(html,/Academy performance/);assert.match(html,/Department performance/);assert.match(html,/Coaching priorities/);assert.doesNotMatch(html,/data-select-trainees/);
});
