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
const CATALOG_MODEL_DIR = path.join(RUNTIME_DIR, 'kromka');
const KROMKA_ITEMS_FILE = path.join(ROOT, 'data', 'kromka', 'items.json');
const UNITY_ITEM_CATALOG_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaItemModelCatalog.cs');
const UNITY_GROUND_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGroundItems.cs');
const UNITY_OVERLAY_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaWorldOverlayCanvas.cs');
const UNITY_INTERACTION_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaInteraction.cs');
const UNITY_INVENTORY_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaInventory.cs');
const UNITY_MOBILE_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaMobileControls.cs');
const UNITY_BOOTSTRAP_SOURCE = path.join(ROOT, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaGameBootstrap.cs');
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
  'boots', 'scoutBoots', 'reinforcedBoots', 'assaultBoots', 'backpack'
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

// Строковый список C#-коллекции: от объявления до первой закрывающей скобки.
function unityList(source, declaration) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `Нет Unity-таблицы ${declaration}`);
  const open = source.indexOf('{', start);
  return Array.from(source.slice(open, source.indexOf('}', open)).matchAll(/"(\w+)"/g), match => match[1]);
}

// Пары C#-словаря { "ключ", "значение" } до конца инициализатора.
function unityPairs(source, declaration) {
  const start = source.indexOf(declaration);
  assert(start >= 0, `Нет Unity-таблицы ${declaration}`);
  return new Map(Array.from(
    source.slice(start, source.indexOf('};', start)).matchAll(/\{\s*"(\w+)",\s*"([^"]+)"\s*\}/g),
    match => [match[1], match[2]]
  ));
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

// Unity выбирает модель наземного предмета по своим таблицам: общая библиотека
// (с псевдонимами компонентов), GLB оружия, экипировка male_medium и
// собственные GLB каталога RoaItemModelCatalog.
const unityGround = fs.readFileSync(UNITY_GROUND_SOURCE, 'utf8');
const unityLibraryIds = unityList(unityGround, 'LibraryItems =');
const unityLibraryAliases = unityPairs(unityGround, 'LibraryAliases =');
const unityWeaponIds = unityList(unityGround, 'WeaponItems =');
const unityEquipmentModels = unityPairs(unityGround, 'EquipmentModels =');
assert.deepStrictEqual(
  unityLibraryIds.filter(id => !unityLibraryAliases.has(id)).sort(),
  [...EXPECTED_LIBRARY_IDS].sort(),
  'Unity-таблица библиотеки разошлась с утверждённой GLB-библиотекой'
);
for (const [alias, target] of unityLibraryAliases) {
  assert(unityLibraryIds.includes(alias) && EXPECTED_LIBRARY_IDS.includes(target),
    `Unity-псевдоним ${alias} → ${target} не ведёт в библиотеку предметов`);
}
assert.deepStrictEqual([...unityWeaponIds].sort(), [...WEAPON_IDS].sort(),
  'Unity поднимает с земли не тот набор оружия');
WEAPON_IDS.forEach(id => assert(fs.existsSync(path.join(ROOT, 'public', 'assets', 'models', 'weapons', `weapon_${id}.glb`)),
  `Нет GLB оружия weapon_${id}.glb`));
assert.deepStrictEqual([...unityEquipmentModels.keys()].sort(), [...EQUIPMENT_IDS].sort(),
  'Unity поднимает с земли не тот набор экипировки');
for (const [itemId, url] of unityEquipmentModels) {
  assert(fs.existsSync(path.join(ROOT, 'public', url.replace(/^\//, ''))), `${itemId}: нет GLB экипировки ${url}`);
}
const unityCatalogIds = unityList(fs.readFileSync(UNITY_ITEM_CATALOG_SOURCE, 'utf8'), 'HashSet<string> Items =');
unityCatalogIds.forEach(id => assert(fs.existsSync(path.join(CATALOG_MODEL_DIR, `item_${id}.glb`)),
  `Нет GLB каталога предметов item_${id}.glb`));

const kromkaItems = JSON.parse(fs.readFileSync(KROMKA_ITEMS_FILE, 'utf8')).items || [];
const authoredIds = kromkaItems.map(item => String(item?.id || ''));
const covered = new Set([
  ...EXPECTED_LIBRARY_IDS, ...WEAPON_IDS, ...EQUIPMENT_IDS, 'fists',
  ...unityLibraryAliases.keys(), ...unityCatalogIds
]);
assert.deepStrictEqual(
  [...new Set(authoredIds)].filter(id => !covered.has(id)),
  [],
  'Для части игровых предметов нет физической модели или осознанного исключения'
);

[
  'private void BeginVisualLoad(GroundItem item)',
  'private static void ScheduleVisualRetry(GroundItem item)',
  'ModelCache.Remove(url)',
  'item.VisualRetryAt = Time.unscaledTime + delay',
  'VisualRequestIsCurrent(item, itemId, request)',
  'public bool HasPickupCandidate()',
  'public void ApplyDropAck(JObject ack)',
  'if (Interaction == null && Input.GetKeyDown(PickupKey))',
  'public bool RequestPickupNearest(System.Action<JObject> completed = null)',
  'public int LoadedVisualCountForItem(string itemId)'
].forEach(marker => assert(unityGround.includes(marker), `Нет Unity runtime-маркера физического лута: ${marker}`));

const unityOverlay = fs.readFileSync(UNITY_OVERLAY_SOURCE, 'utf8');
assert(unityGround.includes('public void CollectOverlayLabels(')
  && unityGround.includes('public bool TryGetOverlayStatus(')
  && unityGround.includes('public bool CanvasDriven { get; set; }'),
  'Unity ground items no longer publish visible pickup labels and status to the shared Canvas');
assert(unityOverlay.includes('RoaItemData.Name(row.ItemId)')
  && unityOverlay.includes('bool nearest = i == 0;')
  && unityOverlay.includes('"[E] ПОДНЯТЬ · "')
  && unityOverlay.includes('TryResolveLocalRect('),
  'Unity world overlay lost localized nearest-item action or collision-free placement');
const unityInteraction = fs.readFileSync(UNITY_INTERACTION_SOURCE, 'utf8');
assert(unityInteraction.includes('GetComponent<RoaGroundItems>()')
  && unityInteraction.includes('private bool TryPickupGroundBeforeInteract()')
  && (unityInteraction.match(/if \(!TryPickupGroundBeforeInteract\(\)\) Interact\(\);/g) || []).length === 2
  && unityInteraction.includes('return groundItems.RequestPickupNearest();'),
  'Общая клавиша E снова отдаёт приоритет NPC и делает предмет у его ног неподбираемым');

const unityInventory = fs.readFileSync(UNITY_INVENTORY_SOURCE, 'utf8');
assert(unityInventory.includes('public bool SubmitDropItem(string itemRuntimeId, int qty, Action<JObject> completed = null)'),
  'Unity-инвентарь больше не открывает авторитетный путь drop');
assert(unityInventory.includes('GetComponent<RoaGroundItems>()')
  && unityInventory.includes('groundItems?.ApplyDropAck(ack);'),
  'Клиент, выбросивший предмет, снова ждёт необязательное комнатное событие вместо авторитетного ACK');
const unityMobile = fs.readFileSync(UNITY_MOBILE_SOURCE, 'utf8');
assert(unityMobile.includes('_groundItems?.RequestPickupNearest()'),
  'Мобильное действие Unity больше не подбирает предмет с земли');
const unityBootstrap = fs.readFileSync(UNITY_BOOTSTRAP_SOURCE, 'utf8');
assert(unityBootstrap.includes('MobileControls.Configure(Combat, Interaction, Inventory, Pipboy, Enemies, GlobalMap, GroundItems);'),
  'Bootstrap Unity больше не передаёт GroundItems мобильному управлению');
assert(unityBootstrap.includes('gameObject.AddComponent<RoaWorldOverlayCanvas>()')
  && unityBootstrap.includes('worldOverlay.Configure(GroundItems, Enemies, movementFxCamera);')
  && unityBootstrap.includes('GroundItems.CanvasDriven = true;'),
  'Bootstrap Unity больше не заменяет IMGUI-подписи лута общим Canvas');
assert(unityBootstrap.includes('Interaction.GroundItems = GroundItems;'),
  'Bootstrap Unity больше не связывает единый приоритет E с наземными предметами');
assert(unityBootstrap.includes('Inventory.GroundItems = GroundItems;'),
  'Bootstrap Unity больше не передаёт наземные предметы авторитетному drop-пути инвентаря');

console.log(
  `Физические предметы OK: ${EXPECTED_LIBRARY_IDS.length} собственных + `
  + `${WEAPON_IDS.length} оружия + ${EQUIPMENT_IDS.length} экипировки + `
  + `${unityCatalogIds.length} GLB Unity-каталога покрывают ${authoredIds.length} предметов Кромки; `
  + `${vertices} экспортированных вершин, ${triangles} треугольников; Canvas-подписи локализованы и не перекрываются`
);
