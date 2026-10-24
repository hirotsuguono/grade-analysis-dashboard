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
const generated=[];
const checks=[];
const check=name=>{checks.push(name);console.log('PASS '+name)};
async function waitFor(fn,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,150));}throw Error('Timed out waiting for native save operation');}
async function saveWindow(){return waitFor(async()=>{try{return (await exec('xdotool',['search','--onlyvisible','--name','[Ss]ave|保存|Warning: this site can see edits you make'])).stdout.trim().split('\n').at(-1);}catch{return null;}});}
async function selectPath(file){
  const id=await saveWindow();
  await exec('xdotool',['windowfocus','--sync',id]);
  await exec('xdotool',['key','--clearmodifiers','alt+n']);
  await exec('xdotool',['key','--clearmodifiers','ctrl+a']);
  await exec('xdotool',['type','--clearmodifiers','--delay','10',path.basename(file)]);
  const desktop=path.join(temp,'native-save-current.png');
  await exec('import',['-window','root',desktop]);
  const tsv=(await exec('tesseract',[desktop,'stdout','tsv'])).stdout;
  const save=tsv.split('\n').map(line=>line.split('\t')).find(fields=>fields[11]?.trim()==='Save');
  if(!save)throw Error('Native Save button not found');
  await exec('xdotool',['mousemove','--sync',String(Math.round(Number(save[6])+Number(save[8])/2)),String(Math.round(Number(save[7])+Number(save[9])/2))]);
  await exec('xdotool',['click','1']);
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
    const prefix=path.basename(temp);
    const original=path.join(temp,'original.json'),copy=path.join(os.homedir(),prefix+'-copy.json'),second=path.join(os.homedir(),prefix+'-second.json');
    generated.push(copy,second);
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
    assert.equal(await page.evaluate(()=>dirty),true);assert.equal(await page.evaluate(()=>fileName),path.basename(copy));
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
      console.log('SAVE STATE',await page.evaluate(()=>({secure:isSecureContext,protocol:location.protocol,result:document.getElementById('saveResult').textContent,saving,fileName,dirty})).catch(()=>null));
      console.log('TEMP FILES',fs.readdirSync(temp));
      await page.screenshot({path:path.join(output,'native-save-failure.png')}).catch(()=>{});
    }
    console.log('WINDOWS',await exec('xwininfo',['-root','-tree']).then(r=>r.stdout).catch(e=>e.message));
    const desktop=path.join(output,'native-save-desktop.png');
    await exec('import',['-window','root',desktop]).catch(()=>{});
    console.log('NATIVE DIALOG TEXT',await exec('tesseract',[desktop,'stdout']).then(r=>r.stdout).catch(e=>e.message));
    throw error;
  }
  finally{await browser.close();for(const file of generated)fs.rmSync(file,{force:true});fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
