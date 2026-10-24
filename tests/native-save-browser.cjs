'use strict';
// Exercise the actual OS save picker and actual files from file://; all data is fictional.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {chromium}=require('playwright-core');
const exec=promisify(execFile);
const app=path.resolve(process.env.DASHBOARD_ROOT||path.join(__dirname,'../src'));
const output=path.resolve(process.env.QA_OUTPUT||path.join(__dirname,'../test-results'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fictional-native-save-'));
const checks=[];
const check=name=>{checks.push(name);console.log('PASS '+name)};
async function waitFor(fn,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out waiting for native save operation');}
async function saveWindow(){return waitFor(async()=>{try{return (await exec('xdotool',['search','--onlyvisible','--name','Save'])).stdout.trim().split('\n').at(-1);}catch{return null;}});}
async function selectPath(file){
  const id=await saveWindow();
  await exec('xdotool',['windowfocus','--sync',id]);
  await exec('xdotool',['key','--clearmodifiers','ctrl+l']);
  await exec('xdotool',['type','--clearmodifiers','--delay','1',file]);
  await exec('xdotool',['key','--clearmodifiers','Return']);
  await new Promise(r=>setTimeout(r,400));
  if(!fs.existsSync(file))await exec('xdotool',['key','--clearmodifiers','alt+s']);
}
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({headless:false,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  let page;
  try{
    const context=await browser.newContext({offline:true,acceptDownloads:true});page=await context.newPage();
    page.on('console',m=>console.log('BROWSER',m.text()));
    let acceptConfirm=true;page.on('dialog',d=>d.type()==='confirm'&&!acceptConfirm?d.dismiss():d.accept());
    await page.goto(pathToFileURL(path.join(app,'Index.html')).href);
    assert.equal(await page.evaluate(()=>location.protocol),'file:');
    assert.equal(await page.evaluate(()=>canPickSaveFile()),true);
    await page.evaluate(()=>{const native=window.showSaveFilePicker;window.showSaveFilePicker=async function(options){try{return await native.call(window,options)}catch(e){console.log('NATIVE PICKER ERROR',e.name,e.message);throw e;}};});
    const original=path.join(temp,'original.json'),copy=path.join(temp,'copy.json'),second=path.join(temp,'second.json');
    const fixture=JSON.parse(fs.readFileSync(path.join(app,'files/sample-data.json')));
    fs.writeFileSync(original,JSON.stringify(fixture));
    await page.locator('#fileInput').setInputFiles(original);
    await page.waitForFunction(()=>data?.students?.length===60);
    await page.evaluate(()=>{data.name='fictional-copy';markDirty();});
    await page.locator('#saveBtn').click();await page.locator('#saveAsBtn').click();await selectPath(copy);
    await waitFor(()=>fs.existsSync(copy));await page.waitForFunction(()=>!saving&&!dirty);
    assert.equal(JSON.parse(fs.readFileSync(copy)).name,'fictional-copy');
    assert.deepEqual(JSON.parse(fs.readFileSync(original)),fixture);
    check('file://・オフラインで実際の保存先選択と別名JSON作成・元ファイル保持');
    await page.evaluate(()=>{data.name='fictional-overwritten';markDirty();});
    await page.locator('#saveBtn').click();await page.locator('#saveOverwriteBtn').click();
    await page.waitForFunction(()=>!saving&&!dirty);
    assert.equal(JSON.parse(fs.readFileSync(copy)).name,'fictional-overwritten');
    check('指定済みの実ファイルへ上書きし書き込み完了後に保存済みとなる');
    const external={...JSON.parse(fs.readFileSync(copy)),name:'fictional-external'};fs.writeFileSync(copy,JSON.stringify(external));
    await page.evaluate(()=>{data.name='fictional-my-edit';markDirty();});
    acceptConfirm=false;await page.locator('#saveBtn').click();await page.locator('#saveOverwriteBtn').click();
    await page.waitForFunction(()=>!saving);
    assert.equal(await page.evaluate(()=>dirty),true);assert.equal(JSON.parse(fs.readFileSync(copy)).name,'fictional-external');
    acceptConfirm=true;await page.locator('#saveOverwriteBtn').click();await page.waitForFunction(()=>!saving&&!dirty);
    assert.equal(JSON.parse(fs.readFileSync(copy)).name,'fictional-my-edit');
    check('外部更新を検出しキャンセル時は実ファイルと作業中データを保持');
    await page.evaluate(()=>{data.name='fictional-cancelled';markDirty();});
    await page.locator('#saveBtn').click();await page.locator('#saveAsBtn').click();
    const id=await saveWindow();await exec('xdotool',['windowfocus','--sync',id]);await exec('xdotool',['key','Escape']);
    await page.waitForFunction(()=>!saving&&document.getElementById('saveResult').textContent.includes('キャンセル'));
    assert.equal(await page.evaluate(()=>dirty),true);assert.equal(await page.evaluate(()=>fileName),'copy.json');
    assert.equal(JSON.parse(fs.readFileSync(copy)).name,'fictional-my-edit');
    check('実際の保存ダイアログをキャンセルしても保存先・データ・未保存状態を保持');
    await page.locator('#saveAsBtn').click();await selectPath(second);await waitFor(()=>fs.existsSync(second));
    await page.waitForFunction(()=>!saving&&!dirty);
    assert.equal(JSON.parse(fs.readFileSync(copy)).name,'fictional-my-edit');
    assert.equal(JSON.parse(fs.readFileSync(second)).name,'fictional-cancelled');
    assert.equal(await page.evaluate(()=>validateDataset(data).length),0);
    check('別の保存先へ切り替えてJSONを保存し、直前のファイルを残す');
    fs.writeFileSync(path.join(output,'native-save-results.json'),JSON.stringify({checks},null,2));
  }catch(error){
    if(page){
      console.log('SAVE STATE',await page.evaluate(()=>({secure:isSecureContext,protocol:location.protocol,result:document.getElementById('saveResult').textContent,saving})).catch(()=>null));
      await page.screenshot({path:path.join(output,'native-save-failure.png')}).catch(()=>{});
    }
    console.log('WINDOWS',await exec('xwininfo',['-root','-tree']).then(r=>r.stdout).catch(e=>e.message));
    throw error;
  }
  finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
