'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawn}=require('child_process');
const root=path.resolve(__dirname,'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const host=spawn(process.execPath,['tools/serve-unity-assets.js','--suit-candidate'],{
    cwd:root,windowsHide:true,env:{...process.env,ROA_UNITY_ASSET_PORT:'0'},stdio:['ignore','pipe','pipe']
  });
  let diagnostics='';
  host.stderr.on('data',b=>{diagnostics+=b;});
  try {
    const origin=await new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error('Candidate host startup timeout: '+diagnostics)),15000);
      host.once('error',error=>{clearTimeout(timer);reject(error);});
      host.once('exit',code=>{clearTimeout(timer);reject(new Error('Candidate host exited '+code+': '+diagnostics));});
      host.stdout.on('data',bytes=>{
        output+=bytes;
        const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if(match){clearTimeout(timer);resolve(match[0]);}
      });
    });
    const response=await fetch(origin+'/__roa_probe_catalogs');
    assert.equal(response.status,200);
    const info=await response.json();
    assert.equal(info.mode,'suit-candidate');
    const local=JSON.parse(fs.readFileSync(path.join(root,'unity-client/Logs/UpperSuitCandidate/manifest.json')));
    assert.deepEqual(info.suitCandidate,local);
    for(const row of local.files) for(const file of [row.file,row.file.replace('/models/','/models-lite/')]) {
      const served=await fetch(origin+file+'?v=deliberately-old-compiled-version');
      assert.equal(served.status,200);
      assert.equal(served.headers.get('x-roa-suit-catalog'),local.version);
      assert.equal(served.headers.get('cache-control'),'no-store');
      assert.equal(hash(Buffer.from(await served.arrayBuffer())),row.sha256,file);
    }
    const control='/assets/models/items/kromka/item_medkit.glb';
    assert.equal(hash(Buffer.from(await (await fetch(origin+control)).arrayBuffer())),
      hash(fs.readFileSync(path.join(root,'public'+control))),'Unrelated public model changed');
    assert.equal((await fetch(origin+'/__roa_probe_catalogs',{method:'POST'})).status,405);
    assert.equal((await fetch(origin+'/Logs/UpperSuitCandidate/manifest.json')).status,404);
    console.log(`Candidate host PASS: ${local.version}, 24 immutable original/lite responses, unchanged public fallback, GET/HEAD-only and no general Logs access.`);
  } finally { host.kill(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
