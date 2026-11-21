import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/material-search.js',import.meta.url),'utf8'),context);
const find=context.searchMaterials;
const catalog=JSON.parse(fs.readFileSync(new URL('../seed/materials.json',import.meta.url)));
test('partial words, misspellings and reordered keywords find real catalog modules',()=>{
 assert.ok(find(catalog,'handbok').some(r=>r.material.group==='HR'));
 assert.ok(find(catalog,'salse').some(r=>r.material.group==='sales'));
 assert.ok(find(catalog,'recption').some(r=>r.material.roles.includes('Receptionist')));
 assert.ok(find(catalog,'desk front').some(r=>r.material.group==='FDM'));
 assert.ok(find(catalog,'crm').length);
 assert.ok(find(catalog,'pdf').every(r=>r.material.format==='PDF'));
});
test('exact titles rank first, query need not use case or punctuation, new uploads are searchable',()=>{
 const uploaded={id:'new',title:'New Diet Plan',roles:['Counsellor'],group:'Uploaded',format:'PDF'};
 const hits=find([...catalog,uploaded],'NEW diet-plan');assert.equal(hits[0].material.id,'new');
 assert.equal(find([uploaded],'deit')[0].material.id,'new');
 assert.equal(find([uploaded],'unrelatedxyz').length,0);
 assert.equal(find(catalog,'  ').length,catalog.length);
});
test('search cannot introduce results outside the supplied designation/permission scope',()=>{
 const scope=catalog.filter(m=>m.group==='HR');assert.equal(find(scope,'crm').length,0);
 assert.ok(find(scope,'hand').every(r=>scope.includes(r.material)));
});
