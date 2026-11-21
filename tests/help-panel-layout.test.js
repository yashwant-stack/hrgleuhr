import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The help widget is an <aside>; the sidebar's generic `aside` rules (100vh height, green
// gradient) must not apply to it, or a green block appears below every page.
test('help widget container takes no page space and has no sidebar background',()=>{
 const css=fs.readFileSync(new URL('../public/help-chat.css',import.meta.url),'utf8');
 const rule=css.match(/#portal-help\{([^}]*)\}/)?.[1]||'';
 for(const declaration of ['height:0','padding:0','background:none','overflow:visible'])assert.ok(rule.includes(declaration),'missing '+declaration);
});
