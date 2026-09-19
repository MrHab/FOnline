#!/usr/bin/env node
'use strict';

// Реестр префабов набора зон для клиента: Assets/Resources/RealmOfAshes/ZoneKitPrefabs.asset
// (RoaZoneKitCatalog). Собирается из data/zones/kit.json: GUID каждого префаба берётся из
// его .meta, id корневого объекта — из самого префаба. Руками ассет не правят;
// `--check` ничего не пишет и падает, если ассет отстал от набора.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'unity-client', 'Assets');
const prefabDir = path.join(assets, 'Prefabs', 'Kromka', 'RecoveredEnvironment');
const assetFile = path.join(assets, 'Resources', 'RealmOfAshes', 'ZoneKitPrefabs.asset');
const scriptMeta = path.join(assets, 'Scripts', 'World', 'RoaZoneKitCatalog.cs.meta');

const guidOf = metaFile => {
  const match = /^guid:\s*([0-9a-f]{32})\s*$/m.exec(fs.readFileSync(metaFile, 'utf8'));
  if (!match) throw new Error(`no guid in ${metaFile}`);
  return match[1];
};

/** id корневого GameObject префаба: объект, чей Transform не имеет родителя. */
function rootGameObjectId(prefabFile) {
  const text = fs.readFileSync(prefabFile, 'utf8').replace(/\r\n/g, '\n');
  const blocks = text.split(/^--- /m);
  const roots = [];
  for (const block of blocks) {
    if (!/^!u!(4|224) &/.test(block)) continue;
    if (!/^\s+m_Father: \{fileID: 0\}/m.test(block)) continue;
    const owner = /^\s+m_GameObject: \{fileID: (-?\d+)\}/m.exec(block);
    if (owner) roots.push(owner[1]);
  }
  if (roots.length !== 1) throw new Error(`${path.basename(prefabFile)}: expected one root object, found ${roots.length}`);
  return roots[0];
}

function render() {
  const kit = JSON.parse(fs.readFileSync(path.join(root, 'data', 'zones', 'kit.json'), 'utf8'));
  const keys = Object.keys(kit.prefabs).sort();
  const lines = [
    '%YAML 1.1',
    '%TAG !u! tag:unity3d.com,2011:',
    '--- !u!114 &11400000',
    'MonoBehaviour:',
    '  m_ObjectHideFlags: 0',
    '  m_CorrespondingSourceObject: {fileID: 0}',
    '  m_PrefabInstance: {fileID: 0}',
    '  m_PrefabAsset: {fileID: 0}',
    '  m_GameObject: {fileID: 0}',
    '  m_Enabled: 1',
    '  m_EditorHideFlags: 0',
    `  m_Script: {fileID: 11500000, guid: ${guidOf(scriptMeta)}, type: 3}`,
    '  m_Name: ZoneKitPrefabs',
    '  m_EditorClassIdentifier: Assembly-CSharp::RealmOfAshes.World.RoaZoneKitCatalog',
    '  entries:'
  ];
  for (const key of keys) {
    const prefab = path.join(prefabDir, `${key}.prefab`);
    if (!fs.existsSync(prefab)) throw new Error(`kit prefab ${key} is not in RecoveredEnvironment`);
    lines.push(`  - key: ${key}`);
    lines.push(`    prefab: {fileID: ${rootGameObjectId(prefab)}, guid: ${guidOf(`${prefab}.meta`)}, type: 3}`);
  }
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const text = render();
  if (process.argv.includes('--check')) {
    const onDisk = fs.existsSync(assetFile) ? fs.readFileSync(assetFile, 'utf8').replace(/\r\n/g, '\n') : '';
    if (onDisk !== text) {
      console.error('ZoneKitPrefabs.asset is stale: run `node tools/build-zone-kit-asset.js`.');
      process.exit(1);
    }
    console.log('Zone kit asset is up to date.');
  } else {
    fs.writeFileSync(assetFile, text, 'utf8');
    console.log(`ZoneKitPrefabs.asset: ${(text.match(/- key:/g) || []).length} prefabs.`);
  }
}

module.exports = { render, rootGameObjectId };
