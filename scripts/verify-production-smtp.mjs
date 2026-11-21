import {randomBytes} from 'node:crypto';
import {withCloudStore} from '../cloud-store.js';
const token=randomBytes(32).toString('hex');
await withCloudStore(async(store,runtime)=>{const u=store.data.users.find(u=>u.email==='rahul.verma@gleuhr.com'&&u.active&&u.role==='admin');if(!u)throw Error('Authorized admin not found');runtime.sessions.set(token,{uid:u.id,until:Date.now()+120000});});
try {
 const call=async action=>{const r=await fetch('https://hrgleuhr.vercel.app/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://hrgleuhr.vercel.app',Cookie:'gleuhr_session='+token},body:JSON.stringify({action}),signal:AbortSignal.timeout(60000)});return {status:r.status,body:await r.json()};};
 const state=await call('state');console.log({sender:state.body.email?.from,configured:state.body.email?.configured});
 const result=await call('emailVerify');console.log({verificationStatus:result.status,result:result.body});
}finally{await withCloudStore(async(store,runtime)=>runtime.sessions.delete(token));}
