'use strict';
// Read-only smoke check of the locally generated player, not a deployment.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const receipt = JSON.parse(read('unity-client/Logs/local-webgl-build.json'));
const html = read('public/unity/index.html');
const catalogs = {
  items: 'public/assets/models/items/kromka/manifest.json',
  equipment: 'public/assets/models/equipment/free-v2/manifest.json',
  utilities: 'public/assets/models/equipment/utilities-v1/manifest.json',
  suits: 'public/assets/models/equipment/suits-v2/manifest.json'
};
async function main() {
  assert.equal(receipt.result, 'Succeeded');
  const scripts=path.join(root,'unity-client/Assets/Scripts');
  const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):entry.name.endsWith('.cs')?[path.join(dir,entry.name)]:[]);
  const sourceHash=crypto.createHash('sha256').update(walk(scripts).sort().map(file=>path.relative(scripts,file).replace(/\\/g,'/')+'='+crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')+'\n').join('')).digest('hex');
  assert.equal(receipt.clientSourceHash,sourceHash,'Runtime code changed after the build snapshot; rebuild before claiming current content');
  assert.equal(receipt.clientSourceHashAtFinish,sourceHash,'Runtime source changed during the build');
  for (const [key,file] of Object.entries(catalogs)) assert.equal(receipt[key],JSON.parse(read(file)).version,key+': stale build');
  const weaponVersion=read('unity-client/Assets/Scripts/Game/RoaModelUrl.cs').match(/WeaponCatalogVersion = "([^"]+)"/);
  assert(weaponVersion); assert.equal(receipt.weapons,weaponVersion[1],'weapons: stale build');
  const versions = [...new Set([receipt.items,receipt.equipment,receipt.utilities,receipt.weapons,receipt.suits])];
  const found = new Set();
  const patterns = versions.flatMap(value=>['utf8','utf16le'].map(encoding=>({value,buffer:Buffer.from(value,encoding)})));
  const files = [...html.matchAll(/(?:dataUrl|codeUrl|frameworkUrl):\s*buildUrl\s*\+\s*"\/([^"?]+)(?:\?[^" ]*)?"/g)].map(m=>m[1]);
  assert.equal(files.length,3,'Expected data, framework and WASM URLs');
  assert(html.includes(`?v=${receipt.compression.toLowerCase()}-${receipt.utilities}`),'Compression-specific framework cache revision missing');
  const result=[];
  for (const name of files) {
    assert.equal(path.basename(name),name);
    const file=path.join(root,'public/unity/Build',name);
    const hash=crypto.createHash('sha256');
    const input=fs.createReadStream(file);
    input.on('data',chunk=>hash.update(chunk));
    const stream=receipt.compression==='Gzip' ? input.pipe(zlib.createGunzip())
      : receipt.compression==='Brotli' ? input.pipe(zlib.createBrotliDecompress()) : input;
    let tail=Buffer.alloc(0);
    for await (const chunk of stream) {
      const bytes=Buffer.concat([tail,chunk]);
      for (const pattern of patterns) if(bytes.includes(pattern.buffer)) found.add(pattern.value);
      tail=bytes.subarray(Math.max(0,bytes.length-256));
    }
    result.push({file:name,sha256:hash.digest('hex'),bytes:fs.statSync(file).size});
  }
  assert.deepEqual([...found].sort(),versions.sort(),'Current asset revisions are absent from the compiled player');
  console.log(JSON.stringify({result:receipt.errors ? 'CONTENT_MATCH_WITH_BUILD_ERRORS' : 'PASS',
    buildErrors:receipt.errors, buildWarnings:receipt.warnings,
    buildStartedAt:receipt.startedAt,clientSourceHash:sourceHash,versions,files:result},null,2));
  if (receipt.errors) process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
