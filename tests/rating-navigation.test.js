import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('function normalizeEvaluationRoute('),source.indexOf('function render()'));
const normalize=vm.runInNewContext(fn+';normalizeEvaluationRoute');
const trainee={flowEnabled:true,trainingFlowStatus:[{key:'TheoryEvaluation',blockedBy:null},{key:'PracticalEvaluation',blockedBy:'TheoryEvaluation'}]};
test('restored legacy assessment routes use the flow evaluation and its save endpoint',()=>{
 for(const section of ['Assessment','Tests','Evaluations']){
 const result=normalize(trainee,section,null);assert.equal(result.section,'Training stages');assert.equal(result.selectedStep,'TheoryEvaluation');
 }
 assert.equal(normalize(trainee,'Scores',null).selectedStep,'TheoryEvaluation');
 const practical={...trainee,trainingFlowStatus:[{key:'PracticalEvaluation',blockedBy:null}]};
 assert.equal(normalize(practical,'Scores',null).selectedStep,'PracticalEvaluation');
});
test('legacy trainees and ordinary navigation remain unchanged',()=>{
 assert.equal(normalize({flowEnabled:false},'Assessment',null).section,'Assessment');
 assert.equal(normalize(trainee,'Training stages','Mentor').selectedStep,'Mentor');
});
