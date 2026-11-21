import test from 'node:test';import assert from 'node:assert/strict';import {trainingEmail} from '../training-email.js';
test('branded training emails escape dynamic text and omit empty history blocks',()=>{
 const html=trainingEmail({title:'Mentor <script>',body:'Dear <mentor>\n\nTasks\n1. Guide & observe\n\nPrevious records\nNo previous records.\n\nPortal: https://example.test',url:'https://example.test/?view=mentoring',action:'Open tasks'});
 assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;mentor&gt;/);assert.match(html,/Guide &amp; observe/);assert.ok(!html.includes('Previous records'));assert.match(html,/href="https:\/\/example.test\/\?view=mentoring"/);assert.throws(()=>trainingEmail({url:'javascript:alert(1)'}),/Invalid portal/);
});
