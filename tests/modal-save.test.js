import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let modalSubmitting=false;'),source.indexOf('function auth('));
test('closing the designation editor cannot disable a later ticket or delete dialog',()=>{
 const nodes=Object.fromEntries(['modalTitle','modalFields','modalError','modalSubmit','closeModal','designationEditor','addDesignation','f-designation','newDesignationName','cancelDesignation','saveDesignation'].map(id=>[id,{disabled:false,focus(){},setAttribute(){}}]));
 nodes.modal={addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}};
 const context=vm.createContext({$:id=>nodes[id],modalSave:null,modalSubmitting:false});
 vm.runInContext(source.slice(source.indexOf('function modal('),source.indexOf('$("modalFields").addEventListener')),context);
 for(const label of ['Save update','Yes, delete']){
  vm.runInContext('modal("Add trainee", "", ()=>{}); bindDesignationPicker();',context);
  nodes.addDesignation.onclick();assert.equal(nodes.modalSubmit.disabled,true);
  nodes.modal.close(); // X / Escape while the inline designation form is open.
  context.label=label;vm.runInContext('modal("Next action", "", ()=>{}, label)',context);
  assert.equal(nodes.modalSubmit.disabled,false,label+' should be usable');assert.equal(nodes.closeModal.disabled,false);
 }
});
test('Save locks immediately, ignores repeated submits and unlocks after completion',async()=>{
 let release,calls=0;const gate=new Promise(r=>release=r),nodes={modalForm:{},modalSubmit:{textContent:'Update',disabled:false},closeModal:{disabled:false},modalError:{textContent:''},modal:{close(){}}};
 const context=vm.createContext({$:id=>nodes[id],FormData:class{*[Symbol.iterator](){yield ['rating','Good'];}},toast(){},modalSave:async()=>{calls++;await gate;}});vm.runInContext(code,context);
 const e={preventDefault(){},target:{}},pending=nodes.modalForm.onsubmit(e);await nodes.modalForm.onsubmit(e);assert.equal(calls,1);assert.equal(nodes.modalSubmit.disabled,true);assert.equal(nodes.closeModal.disabled,true);assert.equal(nodes.modalSubmit.textContent,'Saving…');release();await pending;assert.equal(nodes.modalSubmit.disabled,false);assert.equal(nodes.modalSubmit.textContent,'Update');
 context.modalSave=async()=>{throw Error('Save failed');};await nodes.modalForm.onsubmit(e);assert.equal(nodes.modalError.textContent,'Save failed');assert.equal(nodes.modalSubmit.disabled,false);
});
