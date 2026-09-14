'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function inventory() {
  const metas = new Map();
  for (const dir of ['unity-client/Assets', 'public/assets/models']) {
    for (const file of files(path.join(root, dir)).filter(f => f.endsWith('.meta'))) {
      const guid = fs.readFileSync(file, 'utf8').match(/^guid:\s*(\w+)/m)?.[1];
      if (guid && fs.existsSync(file.slice(0, -5))) metas.set(guid, path.relative(root, file.slice(0,-5)).replaceAll('\\','/'));
    }
  }
  const scenes = files(path.join(root,'unity-client/Assets/Scenes/Kromka/Locations')).filter(f => f.endsWith('.unity'));
  const missing = new Map(); let instances = 0;
  for (const scene of scenes) {
    const text = fs.readFileSync(scene,'utf8');
    const blocks = text.split(/(?=^--- !u!)/m);
    for (const block of blocks) {
      const source = block.match(/m_SourcePrefab: \{fileID: \d+, guid: (\w+)/);
      if (!source) continue;
      instances++;
      if (metas.has(source[1])) continue;
      const guid = source[1], instanceId = block.match(/^--- !u!1001 &(\d+)/)?.[1];
      const refs = blocks.filter(b => b.includes(`m_PrefabInstance: {fileID: ${instanceId}}`));
      const gameObjects = refs.filter(b => /^--- !u!1 /m.test(b)).map(b => b.match(/^--- !u!1 &(\d+)/)[1]);
      const components = blocks.filter(b => gameObjects.some(id => b.includes(`m_GameObject: {fileID: ${id}}`)));
      const name = block.match(/propertyPath: m_Name\r?\n\s+value: (.*)/)?.[1] || '';
      const fields = components.join('\n').split(/\r?\n/).filter(l => /^  _(stableObjectId|serverArchetypeId|role|objectId):/.test(l));
      if (!missing.has(guid)) missing.set(guid, {guid, instances:[], sourceIds:[]});
      const row=missing.get(guid);
      row.instances.push({scene:path.basename(scene),name,fields});
      for (const ref of refs) {
        const type=ref.match(/^--- !u!(\d+)/)?.[1], id=ref.match(/m_CorrespondingSourceObject: \{fileID: (\d+)/)?.[1];
        if(id&&!row.sourceIds.some(r=>r.type===type&&r.id===id))row.sourceIds.push({type,id});
      }
    }
  }
  return { scenes:scenes.length, instances, missing:[...missing.values()], metas };
}
function validateRecovery(result) {
  const manifest = require('./data/local-prefab-recovery.json');
  const guids = new Set();
  for (const row of manifest.prefabs) {
    assert(!guids.has(row.guid), `Duplicate recovery GUID: ${row.guid}`);
    guids.add(row.guid);
    const expected = `unity-client/Assets/Prefabs/Kromka/RecoveredEnvironment/${row.key}.prefab`;
    assert.equal(result.metas.get(row.guid), expected, `Missing or misplaced recovered prefab ${row.key}`);
    const yaml = fs.readFileSync(path.join(root, expected), 'utf8').replaceAll('\r\n', '\n');
    assert(yaml.includes(`--- !u!1 &${row.rootGameObjectId}\n`), `${row.key}: root GameObject ID changed`);
    assert(yaml.includes(`--- !u!4 &${row.rootTransformId}\n`), `${row.key}: root Transform ID changed`);
    assert(!yaml.includes('m_SourcePrefab:'), `${row.key}: must be a native prefab, not a retired model variant`);
    assert(yaml.includes('MeshRenderer:'), `${row.key}: restored prefab has no visual geometry`);
    const anchors = new Set([...yaml.matchAll(/^--- !u!\d+ &(-?\d+)/gm)].map(m => m[1]));
    for (const match of yaml.matchAll(/\{fileID: (-?\d+)\}/g))
      assert(match[1] === '0' || anchors.has(match[1]), `${row.key}: dangling internal fileID ${match[1]}`);
    for (const part of row.parts) assert(fs.existsSync(path.join(root, 'unity-client', part.asset)), `${row.key}: missing source ${part.asset}`);
  }
  // Scene overrides can target the old root IDs only; deleting or renumbering them loses added gameplay components.
  for (const scene of files(path.join(root, 'unity-client/Assets/Scenes/Kromka/Locations')).filter(f => f.endsWith('.unity'))) {
    const yaml = fs.readFileSync(scene, 'utf8');
    for (const match of yaml.matchAll(/(?:target|m_CorrespondingSourceObject): \{fileID: (-?\d+), guid: (\w+)/g)) {
      const row = manifest.prefabs.find(p => p.guid === match[2]);
      if (row) assert([row.rootGameObjectId, row.rootTransformId].includes(match[1]), `${path.basename(scene)}: unsupported recovered prefab sub-object ${match[1]}`);
    }
  }
  console.log(`Recovery integrity: ${guids.size} native prefabs, root IDs and scene override targets intact`);
}
if(require.main===module){
  const result=inventory();
  if(process.argv.includes('--report')){
    const output=path.join(root,'Build/LocalPrefabRepair');fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'missing-before.json'),JSON.stringify({...result,metas:undefined},null,2)+'\n');
  }
  console.log(`Local prefab references: ${result.scenes} scenes, ${result.instances} instances, ${result.missing.length} unresolved GUIDs`);
  for(const m of result.missing)console.log(m.guid,m.instances.length,m.instances[0].name,JSON.stringify(m.sourceIds),m.instances[0].fields.join(' '));
  if(result.missing.length)process.exitCode=1;
  else validateRecovery(result);
}
module.exports={inventory,validateRecovery};
