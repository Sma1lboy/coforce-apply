// Actual console components; synthetic persistence failures only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const{chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('.'),web='.agents/skills/tracker/web',out=join(root,'harness/out/ux-recovery');
const base='cb343e54a6e7451e05b845b9ab8e0f8cc284de84';mkdirSync(out,{recursive:true});const before=join(out,'baseline');
execFileSync('git',['worktree','add','--detach',before,base],{stdio:'inherit'});symlinkSync(join(root,web,'node_modules'),join(before,web,'node_modules'),'dir');
const{createServer}=await import(pathToFileURL(join(root,web,'node_modules/vite/dist/node/index.js')));
const browser=await chromium.launch(),servers=[];
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/ux-recovery.jsx"></script></body></html>`;
const component=`import React from'react';import{createRoot}from'react-dom/client';import App from './src/App.jsx';import './src/index.css';createRoot(document.getElementById('root')).render(<App/>);`;
const initial=()=>({apps:[{id:'fixture',title:'Backend engineer',company:'Fixture Labs',position:'Backend engineer',url:'https://example.invalid/job',status:'pending',needsFallback:true,history:[],updatedAt:'2026-10-01'}],globalFiles:[],campaign:{jobs:[]},experience:{status:'missing'},prefs:null,instructions:''});
async function open(port,{stateFails=false,prefsFail=false,appsFail=false,hash='discover',hasPrefs=false}={}){
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'}),control={stateFails,prefsFail,appsFail,state:initial(),prefsCalls:0,appsCalls:0};
 if(hasPrefs)control.state.prefs={level:'any',directions:[]};
 await page.route('**/api/**',async route=>{let status=200,body={};const path=new URL(route.request().url()).pathname;
  if(path==='/api/state'){status=control.stateFails?503:200;body=control.state;}
  if(path==='/api/discover')body={new:[],skipped:{tracked:0,blocked:0}};
  if(path==='/api/screened')body={entries:[]};
  if(path==='/api/prefs'){control.prefsCalls++;status=control.prefsFail?503:200;if(status===200)control.state.prefs=route.request().postDataJSON();}
  if(path==='/api/apps'){control.appsCalls++;status=control.appsFail?503:200;if(status===200)control.state.apps=route.request().postDataJSON();}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto(`http://127.0.0.1:${port}/ux-fixture.html#${hash}`);return{page,control};
}
async function shot(page,label,name){await page.screenshot({path:join(out,`${label}-${name}.png`)});}
async function dragCard(page){const card=page.getByText('Backend engineer',{exact:true});const target=page.locator('section').filter({has:page.getByRole('heading',{name:/Applied/})});await card.dragTo(target);}
try{
 for(const[label,path,port]of[['before',before,4539],['after',root,4540]]){
  writeFileSync(join(path,web,'ux-fixture.html'),fixture);writeFileSync(join(path,web,'ux-recovery.jsx'),component);
  const server=await createServer({root:join(path,web),configFile:join(path,web,'vite.config.js'),server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();servers.push(server);
  {
   const{page,control}=await open(port,{prefsFail:true});
   await page.getByRole('heading',{name:label==='before'?'Welcome 👋 — tune your discovery':'Choose the jobs you want to see',exact:true}).waitFor();
   await page.getByRole('button',{name:'Backend',exact:true}).click();
   await page.getByRole('button',{name:label==='before'?'Start discovering →':'Save and discover',exact:true}).click();
   if(label==='before')await page.getByRole('heading',{name:'Welcome 👋 — tune your discovery',exact:true}).waitFor({state:'hidden'});
   else{
    await page.getByRole('alert').filter({hasText:'Could not save your choices'}).waitFor();
    assert.equal(control.prefsCalls,1);assert.equal(control.state.prefs,null,'failed choices never persisted');
   }
   await shot(page,label,'onboarding-save-failed');
   if(label==='after'){
    control.prefsFail=false;await page.getByRole('button',{name:'Save and discover',exact:true}).click();await page.getByRole('heading',{name:'Choose the jobs you want to see',exact:true}).waitFor({state:'hidden'});
    assert.ok(control.state.prefs.directions.includes('backend'),'selections retained for retry');assert.equal(control.prefsCalls,2);await shot(page,label,'onboarding-saved');
   }await page.close();
  }
  {
   const{page,control}=await open(port,{stateFails:true});
   await page.getByText(label==='before'?/console API unreachable/:/Check that the local CoForce server/).waitFor();await shot(page,label,'load-failed');
   if(label==='after'){
    control.stateFails=false;await page.getByRole('button',{name:'Try loading again',exact:true}).click();await page.getByRole('heading',{name:'Choose the jobs you want to see',exact:true}).waitFor();
   }await page.close();
  }
  {
   const{page,control}=await open(port,{hash:'board',hasPrefs:true,appsFail:true});await page.getByText('Backend engineer',{exact:true}).waitFor();await dragCard(page);
   if(label==='after')await page.getByRole('alert').filter({hasText:'Could not save the status'}).waitFor();else await page.waitForTimeout(300);
   assert.equal(control.state.apps[0].status,'pending');await shot(page,label,'board-save-failed');
   if(label==='after'){
    assert.equal(control.appsCalls,1);control.appsFail=false;await dragCard(page);await page.locator('section').filter({has:page.getByRole('heading',{name:/Applied/})}).getByText('Backend engineer',{exact:true}).waitFor();
    assert.equal(control.state.apps[0].status,'applied');await shot(page,label,'board-saved');
   }await page.close();
  }
  if(label==='after'){
   const{page,control}=await open(port,{hasPrefs:true,prefsFail:true});
   await page.getByLabel('Backend',{exact:false}).waitFor();
   await page.getByLabel('Backend',{exact:false}).uncheck();
   await page.getByRole('alert').filter({hasText:'These filters only apply to this view'}).waitFor();await shot(page,label,'filters-save-failed');
   control.prefsFail=false;await page.getByRole('button',{name:'Save filters again',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});await page.close();
  }
 }
 writeFileSync(join(out,'manifest.json'),JSON.stringify({baseline:base,head:process.env.COFORCE_HEAD_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:'Real CoForce App/Discover/Board components with synthetic API fixtures, no user data or live applications'},null,2));
 console.log('PASS: exact before/after; rejected onboarding save preserves selections; retry persists; console load retry clears error; board failure/retry; filters failure/retry');
}finally{await browser.close();for(const s of servers)await s.close();}
