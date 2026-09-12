'use strict';
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const items=JSON.parse(read('data/kromka/items.json')).items;
const view=read('unity-client/Assets/Scripts/Game/RoaOffhandWeaponView.cs');
const declared=view.match(/HashSet<string> Supported[\s\S]*?\{([^}]+)\}/);
assert(declared,'Offhand firearm set missing');
const firearms=[...declared[1].matchAll(/"([A-Za-z0-9]+)"/g)].map(m=>m[1]);
assert.deepEqual(firearms.slice().sort(),['pistol','laserPistol','revolver','sawedOffShotgun'].sort());
const physical=items.filter(i=>i.id!=='fists' && i.compatibleSlots?.includes('offhand')).map(i=>i.id).sort();
assert.deepEqual(physical,[...firearms,'knife','medkit'].sort(),'A server-supported offhand item has no renderer');
assert(view.includes('weaponId = CanRender(weaponId) ? weaponId : string.Empty'));
assert(view.includes('return IsSupported(itemId) || itemId == "knife" || itemId == "medkit"'));
assert(!firearms.includes('knife') && !firearms.includes('medkit'),'Non-firearm must not choose dual-gun IK');
for(const id of physical) {
  const file=id==='medkit'?'public/assets/models/items/kromka/item_medkit.glb':`public/assets/models/weapons/weapon_${id}.glb`;
  const bytes=fs.readFileSync(path.join(root,file));
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString().trim());
  assert(gltf.nodes.some(n=>n.name==='socket_grip_r'),`${id}: no physical palm anchor`);
  if(firearms.includes(id))assert(gltf.nodes.some(n=>n.name==='socket_muzzle'),`${id}: no offhand muzzle`);
}
for(const marker of ['holder.SetActive(false)','Mount();','gate.Invalidate()','holder.SetActive(true)','ApplyLeftFingersTo(_bones)'])
  assert(view.includes(marker),`Missing offhand lifecycle/attachment step: ${marker}`);
assert(view.includes('(weaponId != "knife" && _socketMuzzle == null)'));
console.log(`Offhand model coverage PASS: ${physical.join(', ')}; authoritative slots, grip/muzzle semantics and staged activation.`);
