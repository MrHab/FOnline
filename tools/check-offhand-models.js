'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const items=JSON.parse(read('data/kromka/items.json')).items;
const packWeapons=JSON.parse(read('data/kromka/apocalypse-weapons.json')).weapons;
const packById=new Map(packWeapons.map(row=>[row.itemId,row]));
const view=read('unity-client/Assets/Scripts/Game/RoaOffhandWeaponView.cs');
const declared=view.match(/HashSet<string> Supported[\s\S]*?\{([^}]+)\}/);
assert(declared,'Offhand firearm set missing');
const firearms=[...declared[1].matchAll(/"([A-Za-z0-9]+)"/g)].map(m=>m[1]);
assert.deepEqual(firearms.slice().sort(),['pistol','laserPistol','revolver','sawedOffShotgun'].sort());
const physical=items.filter(i=>i.id!=='fists' && i.compatibleSlots?.includes('offhand')).map(i=>i.id).sort();
const packOffhand=physical.filter(id=>id.startsWith('polygon'));
assert.deepEqual(physical,[...firearms,'knife','medkit',...packOffhand].sort(),'A server-supported offhand item has no renderer');
for(const id of packOffhand) {
  const row=packById.get(id);
  assert(row && (firearms.includes(row.rigId) || row.rigId==='knife'),`${id}: unsupported offhand grip`);
  assert(fs.existsSync(path.join(root,'unity-client/Assets/Synty/PolygonApocalypse/Prefabs',`${row.prefab}.prefab`)),`${id}: pack prefab missing`);
}
assert(view.includes('weaponId = CanRender(weaponId) ? weaponId : string.Empty'));
assert(!firearms.includes('knife') && !firearms.includes('medkit'),'Non-firearm must not choose dual-gun IK');
for(const id of physical) {
  const rigId=packById.get(id)?.rigId||id;
  const file=id==='medkit'?'public/assets/models/items/kromka/item_medkit.glb':`public/assets/models/weapons/weapon_${rigId}.glb`;
  const bytes=fs.readFileSync(path.join(root,file));
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());
  assert(gltf.nodes.some(n=>n.name==='socket_grip_r'),`${id}: no physical palm anchor`);
  if(firearms.includes(rigId))assert(gltf.nodes.some(n=>n.name==='socket_muzzle'),`${id}: no offhand muzzle`);
}
console.log(`Offhand model coverage PASS: ${physical.join(', ')}; authoritative slots, grip/muzzle semantics and staged activation.`);
