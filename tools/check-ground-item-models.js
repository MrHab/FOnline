#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = path.join(ROOT, 'public', 'assets', 'models', 'items');
const MODEL_FILE = path.join(RUNTIME_DIR, 'ground_item_library.glb');
const MANIFEST_FILE = path.join(RUNTIME_DIR, 'manifest.json');
const ITEMS_SOURCE = path.join(ROOT, 'public', 'js', 'game', '03_items_inventory_core.js');
const RUNTIME_SOURCE = path.join(ROOT, 'public', 'js', 'game', '05e_ground_items_world_sync.js');
const EXPECTED_LIBRARY_IDS = [
  'ammo9', 'ammo556', 'energyCell', 'napalm', 'shotgunShell', 'rocketAmmo',
  'medkit', 'stim', 'doctorBag', 'antibiotics', 'ore', 'wood', 'scrap',
  'oil', 'chemicals', 'medicine', 'electronics', 'ammoParts', 'food',
  'weaponParts', 'silver', 'trophy', 'water', 'repairKit'
];
const WEAPON_IDS = [
  'pistol', 'rifle', 'assaultRifle', 'machineGun', 'laserPistol', 'flamethrower',
  'plasmaRifle', 'shotgun', 'rocketLauncher', 'knife', 'pickaxe', 'axe', 'handPump',
  'revolver', 'sawedOffShotgun', 'smg'
];
const EQUIPMENT_IDS = [
  'leather', 'metalArmor', 'ballisticVest', 'combatArmor', 'hazmatSuit',
  'heavyArmor', 'energySuit', 'weldedHelmet', 'helmet', 'tacticalHelmet', 'assaultHelmet', 'preWarHelmet',
  'boots', 'scoutBoots', 'reinforcedBoots', 'backpack'
];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
}

function parseGlb(file) {
  const data = fs.readFileSync(file);
  assert.strictEqual(data.toString('ascii', 0, 4), 'glTF', 'Неверная сигнатура GLB библиотеки предметов');
  assert.strictEqual(data.readUInt32LE(4), 2, 'Библиотека предметов должна использовать glTF 2');
  let offset = 12;
  let json = null;
  let binary = null;
  while (offset + 8 <= data.length) {
    const length = data.readUInt32LE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8').trim());
    if (type === 'BIN\0') binary = chunk;
    offset += 8 + length;
  }
  assert(json && binary, 'GLB должна содержать JSON и BIN');
  return { data, json, binary };
}

function embeddedImageBytes(parsed, image) {
  const view = parsed.json.bufferViews[image.bufferView];
  assert(view, `Нет bufferView для текстуры ${image.name || image.bufferView}`);
  return parsed.binary.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
}

assert(fs.existsSync(MODEL_FILE), 'Не опубликована runtime-библиотека физических предметов');
assert(fs.existsSync(MANIFEST_FILE), 'Нет манифеста физических предметов');
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const parsed = parseGlb(MODEL_FILE);
assert.strictEqual(manifest.schema, 'realm.ground-item-model-manifest.v1');
assert.strictEqual(manifest.style, 'geometry_b_materials_c');
assert.strictEqual(manifest.sha256, sha256(parsed.data), 'SHA runtime-GLB не совпадает с манифестом');
assert.deepStrictEqual(manifest.itemIds, EXPECTED_LIBRARY_IDS, 'Изменился утверждённый список общей библиотеки');

const nodeNames = new Set((parsed.json.nodes || []).map(node => node.name));
EXPECTED_LIBRARY_IDS.forEach(id => assert(nodeNames.has(`ground_item_${id}`), `Нет модели ground_item_${id}`));
assert.strictEqual((parsed.json.meshes || []).length, 147, 'Неожиданное число мешей в библиотеке');
assert.strictEqual((parsed.json.materials || []).length, 18, 'Неожиданное число B+C материалов');
assert.strictEqual((parsed.json.images || []).length, 54, 'Каждый B+C материал должен иметь 3 встроенные текстуры');
for (const image of parsed.json.images || []) {
  const bytes = embeddedImageBytes(parsed, image);
  assert.strictEqual(bytes.toString('hex', 0, 8), '89504e470d0a1a0a', `${image.name}: ожидалась PNG-текстура`);
  assert.strictEqual(bytes.readUInt32BE(16), 128, `${image.name}: ширина должна быть 128`);
  assert.strictEqual(bytes.readUInt32BE(20), 128, `${image.name}: высота должна быть 128`);
}

let vertices = 0;
let triangles = 0;
for (const mesh of parsed.json.meshes || []) {
  for (const primitive of mesh.primitives || []) {
    vertices += Number(parsed.json.accessors?.[primitive.attributes?.POSITION]?.count || 0);
    triangles += Number(parsed.json.accessors?.[primitive.indices]?.count || 0) / 3;
  }
}
assert.strictEqual(vertices, 23296, 'Изменилась экспортированная геометрия библиотеки');
assert.strictEqual(triangles, 11768, 'Изменилась утверждённая триангуляция библиотеки');

const itemSource = fs.readFileSync(ITEMS_SOURCE, 'utf8');
const authoredIds = [...itemSource.matchAll(/^\s{4}([A-Za-z0-9]+):\s*\{\s*id:\s*'([^']+)'/gm)]
  .filter(match => match[1] === match[2])
  .map(match => match[1]);
const covered = new Set([...EXPECTED_LIBRARY_IDS, ...WEAPON_IDS, ...EQUIPMENT_IDS, 'fists']);
assert.deepStrictEqual(
  [...new Set(authoredIds)].filter(id => !covered.has(id)),
  [],
  'Для части игровых предметов нет физической модели или осознанного исключения'
);

const runtime = fs.readFileSync(RUNTIME_SOURCE, 'utf8');
[
  "const GROUND_ITEM_MODEL_ASSET_VERSION = '7.76.7-ground-items-bc-v1'",
  'loadGroundItemLibrary()',
  'loadWeaponModelTemplate(entry)',
  "loadApprovedEquipmentTemplate(itemId, 'male_medium')",
  'fitGroundItemPhysicalModel(model, itemId, kind)',
  'group.userData.groundItemModelRequestId !== requestId',
  'group.userData.groundItemFallback = body'
].forEach(marker => assert(runtime.includes(marker), `Нет runtime-маркера: ${marker}`));

console.log(
  `Физические предметы OK: ${EXPECTED_LIBRARY_IDS.length} собственных + `
  + `${WEAPON_IDS.length} оружия + ${EQUIPMENT_IDS.length} экипировки; `
  + `${vertices} экспортированных вершин, ${triangles} треугольников`
);
