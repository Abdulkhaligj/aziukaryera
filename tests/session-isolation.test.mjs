import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const portal=fs.existsSync(path.join(repo,'student-web'))?path.join(repo,'student-web'):path.resolve(repo,'../esas-sayt-student-web');
const read=name=>fs.readFileSync(path.join(portal,'assets/js',name),'utf8');
const app=read('app.js');
const tick=()=>new Promise(resolve=>setTimeout(resolve,8));
const defer=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function storage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),key:i=>[...values.keys()][i],get length(){return values.size;},values};}
function payload(id='student-A'){
  const empty=['faculties','majors','education','candidates','companies','jobs','applications','saved','invites','events','eventRegistrations','notifications','broadcasts','broadcastReads'];
  return {...Object.fromEntries(empty.map(k=>[k,[]])),ok:true,uid:id,email:id.toLowerCase()+'@example.invalid',profile:{id,role:'student',status:'active',full_name:id+' private fixture',phone:id+' phone'}};
}
function harness(initial='student-A'){
  let user=initial?{id:initial,email:initial.toLowerCase()+'@example.invalid'}:null;
  const callbacks=[],timers=new Map(),documentEvents=new Map(),windowsEvents=new Map(),sessionStorage=storage();
  const state={bootstrap:async()=>payload(user?.id),db:async()=>({data:[],error:null}),invoke:async()=>({data:{ok:true,reply:'Normal answer'},error:null}),signIn:null};
  const query=fn=>{const q={then:(resolve,reject)=>Promise.resolve().then(fn).then(resolve,reject)};for(const name of ['abortSignal','select','order','eq','in','limit','single','maybeSingle','insert','update','delete'])q[name]=()=>q;return q;};
  const sdk={auth:{
    getUser:async()=>({data:{user},error:null}),getSession:async()=>({data:{session:user?{user}:null}}),
    onAuthStateChange:fn=>{callbacks.push(fn);return{data:{subscription:{unsubscribe(){}}}};},
    signOut:async()=>{h.emit('SIGNED_OUT',null);return{error:null};},
    signInWithPassword:async({email})=>{if(state.signIn)await state.signIn.promise;const next={id:'student-'+email[0].toUpperCase(),email};h.emit('SIGNED_IN',next);return{data:{user:next,session:{user:next}},error:null};}
  },from:()=>query(()=>state.db()),rpc:()=>query(async()=>({data:await state.bootstrap(),error:null})),functions:{invoke:(...args)=>state.invoke(...args)}};
  const context=vm.createContext({
    USE_BACKEND:true,CAREER_DEMO_MODE:false,API_URL:'https://fixture.invalid',API_KEY:'public-fixture',
    structuredClone,crypto:{randomUUID},localStorage:storage(),sessionStorage,AbortController,URL,Blob,
    FACULTIES:{},MAJOR_FIELD:{},COMPANIES:[],COMPANY_BY_ID:{},OPPORTUNITIES:[],EVENTS:[],STUDENT_POOL:[],
    window:{ApiClient:{createClient:()=>sdk},location:{origin:'http://127.0.0.1',pathname:'/'},addEventListener:(name,fn)=>windowsEvents.set(name,fn)},
    navigator:{},document:{addEventListener:(name,fn)=>documentEvents.set(name,fn),getElementById:()=>null,querySelector:()=>null},
    UI:{auth:{busy:false},publicView:'landing',booting:false,sessionEpoch:0},Landing:{load:async()=>{}},
    render(){},stopNotificationUpdates(){},resetAuthForm(){context.UI.auth={busy:false};},toast(){},
    setTimeout(fn,ms){if(ms===18000){timers.set(ms,fn);return ms;}if(ms===17500||ms===250)return ms;return setTimeout(fn,ms);},
    clearTimeout(id){if(timers.has(id))timers.delete(id);else clearTimeout(id);},setInterval,clearInterval,
    console:{info(){},warn(){},error(){}},performance
  });
  const run=name=>vm.runInContext(read(name),context,{filename:name});
  run('cv-drafts.js');
  for(const [file,name] of [['backend.js','Backend'],['store.js','Store'],['auth.js','Auth']])vm.runInContext(read(file)+'\nglobalThis.'+name+'='+name+';',context,{filename:file});
  context.Store.load();context.Store.mode='remote';
  run('boot-recovery.js');run('login-recovery.js');run('fast-auth-bootstrap.js');run('backend-compat.js');run('boot-instant.js');run('session.js');
  vm.runInContext(app.slice(app.indexOf('function clearPrivateSessionUI() {'),app.indexOf('function resetAuthForm(')),context);
  vm.runInContext(app.slice(app.indexOf('let notificationPollTimer = null;'),app.indexOf('/** QR kodu modal',app.indexOf('let notificationPollTimer = null;'))),context);
  const h={context,sdk,state,callbacks,timers,documentEvents,sessionStorage,run,
    emit(event,next){user=next;for(const fn of callbacks)fn(event,next?{user:next}:null);},
    async ready(){context.Backend.init();await context.window.CareerSession.verify();await tick();return context.window.CareerSession.capture();},
    async owner(id){h.emit(id?'SIGNED_IN':'SIGNED_OUT',id?{id,email:id.toLowerCase()+'@example.invalid'}:null);await tick();if(id)await context.window.CareerSession.verify();},
    async hydrate(id=initial){await h.ready();const p=payload(id);context.window.CareerSession.markPayload(p,context.window.CareerSession.capture());assert.equal(context.Store.hydrate(p),true);return p;}
  };
  return h;
}

test('effective boot override installs auth listeners and cross-tab signout clears private UI before CV visit',async()=>{
  const h=harness();await h.hydrate();assert.ok(h.callbacks.length>=2);
  assert.equal(h.context.Store.state.student.phone,'student-A phone');
  await h.owner(null);assert.equal(h.context.Store.state.session,null);assert.equal(h.context.Store.state.student,null);
});
test('normal shipped background restore works; delayed old bootstrap cannot hydrate after logout or owner replacement',async()=>{
  const normal=harness();await normal.ready();await normal.context.Auth.restoreRemote();await tick();assert.equal(normal.context.Store.state.session.userId,'student-A');
  for(const next of [null,'student-B']){
    const h=harness();await h.ready();const d=defer();h.state.bootstrap=()=>d.promise;
    await h.context.Auth.restoreRemote();await tick();await h.owner(next);
    d.resolve(payload());await tick();assert.equal(h.context.Store.state.session,null);
  }
});
test('Store rejects raw or wrong-owner bootstrap payloads and accepts a verified matching payload',async()=>{
  const h=harness();await h.ready();assert.equal(h.context.Store.hydrate(payload()),false);
  const wrong=payload('student-B');h.context.window.CareerSession.markPayload(wrong,h.context.window.CareerSession.capture());assert.equal(h.context.Store.hydrate(wrong),false);
  await h.hydrate();assert.equal(h.context.Store.state.session.userId,'student-A');
});
test('late private notification, benefit and feed completions cannot repopulate B or same-owner new generation',async()=>{
  for(const next of ['student-B','student-A']){
    const h=harness();await h.hydrate();const n=defer(),b=defer(),f=defer();
    h.context.Backend.notificationsFeed=()=>n.promise;h.context.Backend.benefits=()=>b.promise;h.context.Backend.feed=()=>f.promise;
    const pending=h.context.refreshNotifications();h.context.loadBenefits();h.context.loadFeed();
    await h.owner(null);await h.owner(next);await h.hydrate(next);
    n.resolve({ok:true,rows:[{id:'private-A'}]});b.resolve({ok:true,claims:[{code:'private-A-code'}],rows:[]});f.resolve({ok:true,rows:[{likedByMe:true,body:'private-A'}]});
    await pending;await tick();assert.equal(h.context.Store.state.notifications.length,0);assert.equal(h.context.UI.benefits,null);assert.equal(h.context.UI.feed,null);
  }
});
test('same-owner current reads work and an old optimistic rollback cannot edit the replacement account',async()=>{
  const h=harness();await h.hydrate();h.context.Backend.notificationsFeed=async()=>({ok:true,rows:[{id:'current-A'}]});await h.context.refreshNotifications();assert.equal(h.context.Store.state.notifications[0].id,'current-A');
  const d=defer();let rollbacks=0;h.context.Store.remote(()=>d.promise,()=>rollbacks++);
  await h.owner('student-B');await h.hydrate('student-B');d.resolve({ok:false,error:'Old A failure'});await tick();assert.equal(rollbacks,0);
});
test('SDK direct response and Backend completion lose private data access when their epoch changes',async()=>{
  const h=harness();await h.hydrate();const d=defer();h.state.db=()=>d.promise;
  const pending=Promise.resolve(h.context.Backend.sb.from('profiles').select('*'));await tick();
  await h.owner('student-B');d.resolve({data:[{phone:'private-A'}],error:null});const result=await pending;assert.equal(result.data,null);assert.equal(result.error.code,'STALE_SESSION');
});
test('valid login still hydrates; login timeout invalidates the pending completion',async()=>{
  const normal=harness(null);const result=await normal.context.Auth.loginRemote('a@example.invalid','Password123');assert.equal(result.ok,true);assert.equal(normal.context.Store.state.session.userId,'student-A');
  const h=harness(null);h.state.signIn=defer();const pending=h.context.Auth.loginRemote('a@example.invalid','Password123');
  h.timers.get(18000)();assert.equal((await pending).ok,false);
  h.state.signIn.resolve();await tick();assert.equal(h.context.Store.state.session,null);
});
test('mentor history uses captured owner; late A reply is discarded and same-owner reply still works',async()=>{
  const h=harness();await h.hydrate();const d=defer();h.context.MentorUI={types:[['karyera','Career']],studentPage:()=>'<div class="mentor-two-col">'};h.context.window.AidaChat={ask:()=>d.promise};h.run('mentor-ai.js');
  h.context.MentorUI.studentPage();h.documentEvents.get('submit')({preventDefault(){},target:{id:'mentor-ai-form',querySelector:()=>({value:'A private question'})}});
  assert.match(h.sessionStorage.getItem('mentor.ai.v2:student-A'),/A private question/);
  await h.owner('student-B');await h.hydrate('student-B');d.resolve({ok:true,reply:'A private answer'});await tick();
  assert.equal(h.sessionStorage.getItem('mentor.ai.v2:student-A'),null);assert.equal(h.sessionStorage.getItem('mentor.ai.v2:student-B'),null);assert.doesNotMatch(h.context.MentorUI.studentPage(),/A private/);
  h.context.window.AidaChat.ask=async()=>({ok:true,reply:'B current answer'});h.documentEvents.get('submit')({preventDefault(){},target:{id:'mentor-ai-form',querySelector:()=>({value:'B current question'})}});await tick();assert.match(h.sessionStorage.getItem('mentor.ai.v2:student-B'),/B current answer/);
});

function widgetDom(context){
  const nodes=new Map();
  function element(){return{children:[],handlers:new Map(),className:'',dataset:{},value:'',hidden:true,disabled:false,
    classList:{add(){},remove(){}},setAttribute(){},focus(){},appendChild(child){this.children.push(child);return child;},replaceChildren(...children){this.children=children;},
    addEventListener(name,fn){this.handlers.set(name,fn);},querySelector(selector){if(selector==='.aida-bubble')return this.children.find(x=>x.className==='aida-bubble');return nodes.get(selector)||null;},
    get textContent(){return(this._text||'')+this.children.map(x=>x.textContent).join('');},set textContent(v){this._text=String(v);this.children=[];}};}
  for(const selector of ['.aida-launch','.aida-panel','.aida-close','.aida-form','#aida-input','.aida-chat','.aida-suggestions','.aida-send'])nodes.set(selector,element());
  context.document.body={appendChild(){}};context.document.createElement=()=>element();
  return {nodes,submit(text){nodes.get('#aida-input').value=text;nodes.get('.aida-form').handlers.get('submit')({preventDefault(){}});}};
}
test('AIDA clears DOM/history and discards late replies; B next request never carries A context',async()=>{
  const h=harness();await h.hydrate();const dom=widgetDom(h.context),calls=[],d=defer();
  h.state.invoke=async(_name,options)=>{calls.push(structuredClone(options.body));return calls.length===1?d.promise:{data:{ok:true,reply:'B answer'}};};
  h.run('aida-widget.js');dom.submit('A private question');await tick();assert.match(dom.nodes.get('.aida-chat').textContent,/A private question/);
  await h.owner(null);await h.owner('student-B');await h.hydrate('student-B');d.resolve({data:{ok:true,reply:'A private answer'}});await tick();
  assert.doesNotMatch(dom.nodes.get('.aida-chat').textContent,/A private/);dom.submit('B question');await tick();
  assert.deepEqual(calls[1].history,[]);assert.match(dom.nodes.get('.aida-chat').textContent,/B answer/);
});

test('real data client preserves fluent queries, functions getter, synchronous public URLs and signed URLs under the lifecycle wrapper',async()=>{
  let require=createRequire(path.join(repo,'package.json'));
  let createClient;
  try{({createClient}=require('@supabase/supabase-js'));}catch{require=createRequire(path.resolve(repo,'../admin-panel/package.json'));({createClient}=require('@supabase/supabase-js'));}
  const calls=[];
  const sdk=createClient('https://fixture.invalid','public-fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input)=>{
    const url=new URL(typeof input==='string'?input:input.url);assert.equal(url.origin,'https://fixture.invalid');calls.push(url.pathname);
    const body=url.pathname.includes('/functions/v1/')?{ok:true}:url.pathname.includes('/object/sign/')?{signedURL:'/fixture-signed-url'}:url.pathname.includes('/rpc/')?{allowed:true}:[{id:'fixture'}];
    return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  }}});
  const h=harness(null);h.context.window.CareerSession.connect(sdk);await tick();await h.context.window.CareerSession.verify();
  const rows=await sdk.from('profiles').select('id').limit(1);assert.equal(rows.error,null);assert.equal(rows.data[0].id,'fixture');
  const rpc=await sdk.rpc('fixture_rpc').abortSignal(new AbortController().signal);assert.equal(rpc.data.allowed,true);
  const before=calls.length,publicUrl=sdk.storage.from('avatars').getPublicUrl('fixture.webp');assert.match(publicUrl.data.publicUrl,/fixture\.webp/);assert.equal(calls.length,before);
  const signed=await sdk.storage.from('avatars').createSignedUrl('fixture.webp',60);assert.equal(signed.error,null);assert.match(signed.data.signedUrl,/fixture-signed-url/);
  const fn=await sdk.functions.invoke('fixture');assert.equal(fn.error,null);assert.equal(fn.data.ok,true);
});

test('retained real SDK write builders and storage clients cannot start work after their owner changes',async()=>{
  let require=createRequire(path.join(repo,'package.json'));let createClient;
  try{({createClient}=require('@supabase/supabase-js'));}catch{require=createRequire(path.resolve(repo,'../admin-panel/package.json'));({createClient}=require('@supabase/supabase-js'));}
  let owner='student-A',emit;const calls=[];
  const sdk=createClient('https://fixture.invalid','public-fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(input,init)=>{
    calls.push({body:init.body,authorization:init.headers.get('authorization')});
    return new Response(JSON.stringify([{id:'normal-write'}]),{status:201,headers:{'content-type':'application/json'}});
  }}});
  sdk.auth.getUser=async()=>({data:{user:{id:owner,email:owner+'@example.invalid'}}});
  sdk.auth.getSession=async()=>({data:{session:{access_token:'fixture-token-'+owner}}});
  sdk.auth.onAuthStateChange=fn=>{emit=fn;return{data:{subscription:{unsubscribe(){}}}};};
  const h=harness(null),session=h.context.window.CareerSession;session.connect(sdk);await tick();await session.verify();
  const query=sdk.from('notes').insert({private_text:'A-only'}),bucket=sdk.storage.from('avatars'),heldUpload=bucket.upload;
  owner='student-B';emit('SIGNED_IN',{user:{id:owner,email:owner+'@example.invalid'}});await session.verify();
  const response=await query;assert.equal(response.error.code,'STALE_SESSION');assert.equal(calls.length,0);
  const chain=await query.select('id').eq('id','fixture');assert.equal(chain.error.code,'STALE_SESSION');assert.equal(calls.length,0);
  const upload=await bucket.upload('a-private.webp',new Blob(['A-only']));assert.equal(upload.error.code,'STALE_SESSION');assert.equal(calls.length,0);
  const alias=await heldUpload('a-private.webp',new Blob(['A-only']));assert.equal(alias.error.code,'STALE_SESSION');assert.equal(calls.length,0);
  assert.equal(bucket.getPublicUrl('a-private.webp').data,null);
  const normal=await sdk.from('notes').insert({private_text:'B-current'});assert.equal(normal.error,null);assert.equal(calls.length,1);assert.match(calls[0].body,/B-current/);
});

test('actual Backend helpers cannot attach A input to B after an awaited SDK session lookup',async()=>{
  const operations=[
    ['saveInterviewSession',{questions:['A-only question'],answers:['A-only answer']}],
    ['saveCVAnalysis',{score:80,feedback:'A-only feedback'}],
    ['addEducation',{school:'A-only school'}],
    ['apply','private-job','A-only note'],
    ['createPost',{body:'A-only post'}]
  ];
  for(const [name,...args] of operations){
    const h=harness();await h.hydrate();const d=defer();let writes=0;
    h.sdk.auth.getSession=()=>d.promise;h.state.db=async()=>{writes++;return{data:{id:'normal-write'},error:null};};
    const pending=h.context.Backend[name](...args);await tick();await h.owner('student-B');
    d.resolve({data:{session:{user:{id:'student-B'}}}});
    assert.equal((await pending).stale,true,name);assert.equal(writes,0,name);
  }
  const normal=harness();await normal.hydrate();let writes=0;normal.state.db=async()=>{writes++;return{data:{id:'normal-write'},error:null};};
  const result=await normal.context.Backend.saveInterviewSession({answers:['current-A']});assert.equal(result.ok,true);assert.equal(writes,1);
});

test('actual failed login and registration submissions keep the auth view, input and visible error',async()=>{
  for(const act of ['login-form','register-form']){
    const h=harness(null);h.context.UI.publicView='auth';
    Object.assign(h.context.UI.auth,{tab:act==='login-form'?'login':'register',email:'a@asoiu.edu.az',password:'Password123',password2:'Password123',name:'Fixture Student',firstName:'Fixture',lastName:'Student',phone:'fixture-phone',terms:true});
    h.sdk.auth.signInWithPassword=async()=>({data:{},error:{message:'Invalid login credentials'}});
    h.sdk.auth.signUp=async()=>({data:{},error:{message:'User already registered'}});
    h.context.captureAuthForm=()=>{};
    const steps=app.indexOf('const AUTH_STEPS = {');
    vm.runInContext(app.slice(steps,app.indexOf('\n};\n',steps)+3).replace('const AUTH_STEPS','var AUTH_STEPS'),h.context);
    h.context.validateAuthPane=()=>true;h.context.UI.auth.step=h.context.AUTH_STEPS.learner.length;
    const start=app.lastIndexOf("document.addEventListener('submit', e => {");
    vm.runInContext(app.slice(start,app.indexOf("document.addEventListener('input'",start)),h.context);
    h.documentEvents.get('submit')({target:{dataset:{act},querySelector:()=>null},preventDefault(){}});await tick();
    assert.equal(h.context.UI.publicView,'auth',act);assert.equal(h.context.UI.auth.busy,false,act);
    assert.equal(h.context.UI.auth.email,'a@asoiu.edu.az',act);assert.equal(h.context.UI.auth.tab,act==='login-form'?'login':'register');
    assert.match(h.context.UI.auth.error,act==='login-form'?/şifrə yanlışdır/:/hesab artıq mövcuddur/);
  }
});
