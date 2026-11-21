import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let selectedFlowStep='),source.indexOf('const current ='));
function harness(){
 const entries=[];let index=-1,listener,confirmCalls=0;
 const history={get state(){return entries[index];},replaceState(s){if(index<0)index=0;entries[index]=s;},pushState(s){entries.splice(index+1);entries.push(s);index++;},back(){this.go(-1);},go(delta){index+=delta;listener({state:entries[index]});}};
 const context=vm.createContext({pendingTrainee:null,history,window:{addEventListener:(name,fn)=>listener=fn},S:{user:{id:'u'},trainees:[{id:'t'}]},view:'dashboard',selected:null,section:'Welcome letter',moduleId:null,test:null,roleplay:null,search:'',status:'',modalSubmitting:false,inlineSaving:false,$:()=>({open:false,close(){}}),confirm:()=>{confirmCalls++;return false;},render(){vm.runInContext('rememberNavigation()',context);}});
 vm.runInContext(code,context);vm.runInContext('initialiseNavigation()',context);return {context,history,entries,confirmCalls:()=>confirmCalls};
}
test('Back and Forward restore each trainee panel; data refresh does not add history',()=>{
 const h=harness(),c=h.context;
 vm.runInContext("view='trainees';selected='t';rememberNavigation();section='Checklist';rememberNavigation();rememberNavigation();section='Scores';rememberNavigation()",c);
 assert.equal(h.entries.length,4);h.history.back();assert.equal(c.section,'Checklist');assert.equal(c.selected,'t');h.history.back();assert.equal(c.section,'Welcome letter');h.history.go(1);assert.equal(c.section,'Checklist');assert.equal(h.entries.length,4);
 vm.runInContext('navigationReady=false;view="dashboard";initialiseNavigation()',c);assert.equal(c.section,'Checklist');assert.equal(c.view,'trainees');
});
test('Cancelling navigation during a test keeps the current route without a prompt loop',()=>{
 const h=harness();vm.runInContext("view='tests';rememberNavigation();test={id:'draft'}",h.context);h.history.back();assert.equal(h.history.state.route.view,'tests');assert.equal(h.confirmCalls(),1);assert.ok(h.context.test);
});

test('Training stage selections participate in browser back history',()=>{const h=harness();vm.runInContext("view='trainees';selected='t';section='Training stages';selectedFlowStep='Educate';rememberNavigation();selectedFlowStep='Content';rememberNavigation()",h.context);h.history.back();assert.equal(vm.runInContext('selectedFlowStep',h.context),'Educate');});

test('handover link opens the authorized trainee at the current unfinished step after login',()=>{
 const context=vm.createContext({pendingTrainee:'t',history:{state:null,replaceState(s){this.state=s;}},window:{addEventListener(){}},S:{user:{id:'u'},trainees:[{id:'t',trainingFlowStatus:[{key:'Start',complete:true},{key:'Practical',complete:false}]}]},view:'dashboard',selected:null,section:'Welcome letter',moduleId:null,test:null,roleplay:null,search:'',status:'',toast:()=>{}});
 vm.runInContext(code,context);vm.runInContext('initialiseNavigation()',context);assert.equal(context.view,'trainees');assert.equal(context.selected,'t');assert.equal(context.section,'Training stages');assert.equal(vm.runInContext('selectedFlowStep',context),'Practical');
});
test('a handover link never selects a trainee outside the signed-in account access',()=>{
 let notice='';const context=vm.createContext({pendingTrainee:'hidden',history:{replaceState(){}},window:{addEventListener(){}},S:{user:{id:'u'},trainees:[]},view:'dashboard',selected:null,section:'Welcome letter',moduleId:null,test:null,roleplay:null,search:'',status:'',toast:s=>notice=s});vm.runInContext(code,context);vm.runInContext('initialiseNavigation()',context);assert.equal(context.selected,null);assert.match(notice,/not assigned/);
});
