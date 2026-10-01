// Fixture-only interaction tests against the real ApplyDialog component.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.'), web = '.agents/skills/tracker/web';
const out = join(root,'harness/out/ux-application');
const base='6c388092b004e12f9a38b4f5958b1a1d46d8a9b4';
mkdirSync(out,{recursive:true});
const before=join(out,'baseline');
execFileSync('git',['worktree','add','--detach',before,base],{stdio:'inherit'});
symlinkSync(join(root,web,'node_modules'),join(before,web,'node_modules'),'dir');
const {createServer,preview}=await import(pathToFileURL(join(root,web,'node_modules/vite/dist/node/index.js')));
const browser=await chromium.launch(), servers=[];
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/ux-fixture.jsx"></script></body></html>`;
const component=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import ApplyDialog from './src/components/ApplyDialog.jsx';import './src/index.css';
function Fixture(){const[job,setJob]=useState(null);return <><main className="p-6"><h1>CoForce application fixture</h1><p>Synthetic job. No agent or employer is contacted.</p><button onClick={()=>setJob({role:'Backend engineer',company:'Fixture Labs',url:'https://example.invalid/jobs/fixture'})}>Prepare fixture application</button></main><ApplyDialog job={job} mode={new URLSearchParams(location.search).get('mode')||'headless'} onClose={()=>setJob(null)} onQueued={()=>{}}/></>};createRoot(document.getElementById('root')).render(<Fixture/>);`;
async function open(port,{mode='headless',status='running',copyFails=true,queueDelay=0,confirmFails=false,cancelFails=false,pollFails=false}={}){
 const page=await browser.newPage({viewport:{width:1100,height:850},reducedMotion:'reduce'});
 const calls=[];const control={status,confirmFails,cancelFails,pollFails};
 await page.addInitScript(fail=>Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>fail?Promise.reject(new Error('Fixture clipboard denied')):Promise.resolve()}}),copyFails);
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;calls.push([req.method(),path]);
  if(path==='/api/queue'){if(queueDelay)await new Promise(r=>setTimeout(r,queueDelay));return route.fulfill({status:200,contentType:'application/json',body:'{}'});}
  if(path==='/api/apply')return route.fulfill({status:200,contentType:'application/json',body:'{"id":"fixture-run"}'});
  if(path.endsWith('/confirm')){if(!control.confirmFails)control.status='submitted';return route.fulfill({status:control.confirmFails?500:204,body:''});}
  if(path.endsWith('/cancel'))return route.fulfill({status:control.cancelFails?500:204,body:''});
  return route.fulfill({status:control.pollFails?503:200,contentType:'application/json',body:JSON.stringify({status:control.status,tail:control.status==='failed'?'Fixture blocker: required answer missing.':'Synthetic fixture progress'})});
 });
 await page.goto(`http://127.0.0.1:${port}/ux-fixture.html?mode=${mode}`);
 await page.getByRole('button',{name:'Prepare fixture application'}).click();
 return {page,calls,control};
}
async function shot(page,label,name){await page.screenshot({path:join(out,`${label}-${name}.png`)});}
try{
 for(const[label,path,port]of[['before',before,4537],['after',root,4538]]){
  writeFileSync(join(path,web,'ux-fixture.html'),fixture);writeFileSync(join(path,web,'ux-fixture.jsx'),component);
  const server=await createServer({root:join(path,web),configFile:join(path,web,'vite.config.js'),server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();servers.push(server);
  {
   const{page}=await open(port,{mode:'manual'});
   await page.getByText(label==='before'?'Command copied to clipboard':'Could not copy automatically. Select and copy the command below.',{exact:true}).waitFor();
   await shot(page,label,'clipboard-failed');await page.close();
  }
  {
   const{page}=await open(port);
   await page.getByText(label==='before'?'Agent is applying — autopilot on':'Preparing your application…',{exact:true}).waitFor();
   await shot(page,label,'preparing');await page.close();
  }
  {
   const{page}=await open(port,{status:'failed'});
   await page.getByText(label==='before'?'Hit turbulence':'Application needs your help',{exact:true}).waitFor({timeout:10000});
   if(label==='after')assert.match(await page.locator('body').innerText(),/Check the log and application site/);
   await shot(page,label,'needs-help');await page.close();
  }
  {
   const{page,calls}=await open(port,{status:'awaiting_confirm'});
   const confirm=page.getByRole('button',{name:label==='before'?'Confirm & submit ⏎':'Confirm and submit',exact:true});await confirm.waitFor({timeout:10000});
   assert.equal(calls.filter(([,p])=>p.endsWith('/confirm')).length,0,'no submission before approval');
   await shot(page,label,'review-submit');
   if(label==='after'){
    await confirm.dblclick();
    await page.getByText('Application submitted',{exact:true}).waitFor({timeout:10000});
    assert.equal(calls.filter(([,p])=>p.endsWith('/confirm')).length,1,'repeated click cannot duplicate submission');
    await shot(page,label,'submitted');
   }await page.close();
  }
  if(label==='after'){
   {
    const{page}=await open(port,{mode:'manual',copyFails:false});await page.getByText('Command copied to clipboard',{exact:true}).waitFor();await page.close();
   }
   {
    const{page,calls}=await open(port,{status:'awaiting_confirm',confirmFails:true});
    await page.getByRole('button',{name:'Confirm and submit',exact:true}).click({timeout:10000});
    await page.getByRole('alert').filter({hasText:'Submission status is uncertain'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Submitting…',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Confirm and submit',exact:true}).count(),0);
    await shot(page,label,'uncertain-submission');assert.equal(calls.filter(([,p])=>p.endsWith('/confirm')).length,1);await page.close();
   }
   {
    const{page,control}=await open(port,{cancelFails:true});await page.getByText('Preparing your application…',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Stop preparation',exact:true}).click();await page.getByRole('alert').filter({hasText:'Could not stop preparation'}).waitFor();
    await shot(page,label,'stop-failed');control.cancelFails=false;await page.getByRole('button',{name:'Stop preparation',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.close();
   }
   {
    const{page,calls}=await open(port,{queueDelay:600});await page.getByRole('button',{name:'Stop preparation',exact:true}).click();
    await page.waitForTimeout(900);assert.equal(calls.filter(([,p])=>p==='/api/apply').length,0,'closing queued dialog never starts hidden application');await page.close();
   }
   {
    const{page,control}=await open(port,{pollFails:true});await page.getByRole('alert').filter({hasText:'Cannot check application status'}).waitFor({timeout:10000});
    await shot(page,label,'status-unavailable');control.pollFails=false;control.status='awaiting_confirm';await page.getByRole('button',{name:'Confirm and submit',exact:true}).waitFor({timeout:10000});await page.close();
   }
  }
 }
 const production = await preview({root:join(root,web),configFile:join(root,web,'vite.config.js'),preview:{host:'127.0.0.1',port:4541,strictPort:true}});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({apps:[],globalFiles:[],campaign:{jobs:[]},prefs:{level:'any',directions:[]},experience:{status:'missing'}})}));
  await page.goto('http://127.0.0.1:4541/#board');
  await page.getByRole('heading',{name:/Applied/}).waitFor();
  await page.screenshot({path:join(out,'after-production-build.png')});
  assert.deepEqual(errors,[],'split production bundle starts without runtime errors');await page.close();
 } finally { await new Promise(resolve=>production.httpServer.close(resolve)); }
 const{applicationSteps}=await import(pathToFileURL(join(root,web,'src/lib/apply-feedback.js')));
 assert.equal(applicationSteps('failed',{queued:true,prepared:false})[1][1],'todo');
 assert.equal(applicationSteps('error',{queued:false,prepared:false})[0][1],'todo');
 assert.equal(applicationSteps('awaiting_confirm',{queued:true,prepared:true})[1][1],'done');
 writeFileSync(join(out,'manifest.json'),JSON.stringify({baseline:base,head:process.env.COFORCE_HEAD_SHA||execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:'Real ApplyDialog rendered with synthetic fetch and clipboard responses only. No employer, agent CLI, application or personal data used.'},null,2));
 console.log('PASS: exact before/after screenshots; clipboard success/failure; preparing/failed/review/submitted; no premature or duplicate submit; uncertain confirm; cancel recovery; close during queue; poll recovery; truthful completed steps');
}finally{await browser.close();for(const s of servers)await s.close();}
