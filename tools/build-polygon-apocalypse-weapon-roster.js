'use strict';

// Keeps the playable weapon list aligned with the licensed prefabs in the
// PolygonApocalypse package. The old item IDs remain for saved inventories.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const prefabRoot = path.join(root, 'unity-client', 'Assets', 'Synty', 'PolygonApocalypse', 'Prefabs', 'Weapons');
const manifestPath = path.join(root, 'data', 'kromka', 'apocalypse-weapons.json');
const itemsPath = path.join(root, 'data', 'kromka', 'items.json');
const fieldRecipesPath = path.join(root, 'data', 'kromka', 'field-recipes.json');

const existing = Object.freeze({
  SM_Wep_Pistol_01: 'pistol',
  SM_Wep_Revolver_01: 'revolver',
  SM_Wep_SubMGun_01: 'smg',
  SM_Wep_HuntingRifle_01: 'rifle',
  SM_Wep_AssaultRifle_01: 'assaultRifle',
  SM_Wep_MachineGun_01: 'machineGun',
  SM_Wep_Hybrid_01: 'laserPistol',
  SM_Wep_Hybrid_02: 'plasmaRifle',
  SM_Wep_Shotgun_01: 'shotgun',
  SM_Wep_RocketLauncher_01: 'rocketLauncher',
  SM_Wep_Melee_HuntingKnife_01: 'knife',
  SM_Wep_Spade_01: 'pickaxe',
  SM_Wep_FireAxe_01: 'axe',
  SM_Wep_PipeWrench_01: 'handPump',
  SM_Wep_FlameThrower_01: 'flamethrower'
});

const labels = [
  [/Veh_Rocket_Launcher/, 'Транспортная ракетная установка'],
  [/Veh_Saw_Launcher/, 'Транспортная пильная установка'],
  [/Veh_MiniGun/, 'Транспортный миниган'],
  [/Veh_Harpoon/, 'Транспортный гарпун'],
  [/Veh_MachineGun/, 'Транспортный пулемёт'],
  [/Veh_AA/, 'Транспортная зенитная установка'],
  [/AssaultRifle/, 'Штурмовая винтовка'], [/HuntingRifle/, 'Охотничья винтовка'],
  [/SniperRifle_Pneumatic/, 'Пневматическая снайперская винтовка'],
  [/SniperRiflePneumatic/, 'Пневматическая снайперская винтовка'],
  [/SniperRifle/, 'Снайперская винтовка'], [/MachineGun/, 'Пулемёт'],
  [/Minigun/, 'Миниган'], [/SubMGun/, 'Пистолет-пулемёт'],
  [/Shotgun/, 'Дробовик'], [/Revolver/, 'Револьвер'], [/Pistol/, 'Пистолет'],
  [/RocketLauncher/, 'Ракетная установка'], [/SpearGun/, 'Гарпунное ружьё'],
  [/Nailgun/, 'Гвоздомёт'], [/Rifle/, 'Винтовка'], [/Hybrid/, 'Гибридное оружие'],
  [/CrossBow/, 'Арбалет'], [/FlameThrower/, 'Огнемёт'], [/FlareGun/, 'Сигнальный пистолет'],
  [/ChainSaw/, 'Бензопила'], [/Trimmer/, 'Триммер'], [/Grenade/, 'Граната'],
  [/Flashbang/, 'Светошумовая граната'],
  [/Molotov/, 'Коктейль Молотова'], [/Bomb_GasCan/, 'Бомба из канистры'],
  [/Bomb_Propane/, 'Пропановая бомба'], [/NailBomb/, 'Бомба с гвоздями'],
  [/PipeBomb/, 'Трубная бомба'], [/Bomb/, 'Бомба'], [/Shield/, 'Щит'],
  [/Katana/, 'Катана'], [/Machete/, 'Мачете'], [/Knife/, 'Нож'],
  [/WoodAxe/, 'Дровяной топор'], [/Axe/, 'Топор'], [/Hammer/, 'Молот'],
  [/Bat_Metal/, 'Металлическая бита'], [/Bat_Wood/, 'Деревянная бита'],
  [/Baton/, 'Дубинка'], [/Bat/, 'Бита'],
  [/Crowbar/, 'Лом'], [/PipeWrench/, 'Трубный ключ'], [/Wrench/, 'Ключ'],
  [/Butcher/, 'Мясницкий тесак'], [/Cross/, 'Боевой крест'], [/Spade/, 'Лопата'],
  [/Crutch/, 'Костыль'], [/GolfClub/, 'Клюшка'], [/RebarClub/, 'Арматурная дубина'],
  [/Plank/, 'Доска'], [/Pipe/, 'Труба'], [/Spear/, 'Копьё'],
  [/Veh_/, 'Транспортное оружие'], [/AAGun/, 'Зенитная установка']
];

function rigFor(name, group) {
  if (existing[name]) return existing[name];
  if (group === 'Melee') return /Axe|Hammer|Spade|Spear|Plank|Rebar|Pipe|Bat|Club|Cross|Crutch|Baton|Crowbar|Wrench|Butcher|Katana|Machete/.test(name) ? 'axe' : 'knife';
  if (/ChainSaw|Trimmer|Shield/.test(name)) return 'axe';
  if (/Bomb|Grenade|Molotov|Flashbang/.test(name)) return 'pistol';
  if (/RocketLauncher|Rocket_Launcher|Saw_Launcher/.test(name)) return 'rocketLauncher';
  if (/Revolver/.test(name)) return 'revolver';
  if (/Pistol|FlareGun/.test(name)) return 'pistol';
  if (/SubMGun|Nailgun/.test(name)) return 'smg';
  if (/Shotgun/.test(name)) return 'shotgun';
  if (/Mini[Gg]un|MachineGun|AAGun|Veh_AA/.test(name)) return 'machineGun';
  if (/FlameThrower/.test(name)) return 'flamethrower';
  if (/Hybrid/.test(name)) return 'plasmaRifle';
  if (/AssaultRifle/.test(name)) return 'assaultRifle';
  return 'rifle';
}

function itemId(name) {
  const clean = name.replace(/^SM_Wep_/, '').replace(/[^a-zA-Z0-9]+/g, ' ');
  return 'polygon' + clean.split(' ').filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('');
}

function displayName(name) {
  const translated = labels.find(([pattern]) => pattern.test(name));
  const variant = name.match(/_(\d\d)$/)?.[1] || '';
  return (translated ? translated[1] : 'Оружие') + (name.includes('_Clean_') ? ' (чистое)' : '')
    + (variant ? ' ' + variant : '');
}

function isProjectile(name) {
  return /_Ammo_|_Rocket_0\d$|_Spear_0\d$|_Rocket_Fireworks_|_Rocket_IED_/.test(name);
}

function build() {
  const entries = [];
  for (const group of ['Guns', 'Melee', 'Misc', 'Weapons']) {
    const folder = path.join(prefabRoot, group);
    for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.prefab')).sort()) {
      const name = file.slice(0, -7);
      if (isProjectile(name)) continue;
      const rigId = rigFor(name, group);
      const kind = group === 'Weapons' ? 'mounted'
        : /Bomb|Grenade|Molotov|Flashbang/.test(name) ? 'throwable' : 'handheld';
      entries.push({
        itemId: existing[name] || itemId(name),
        name: displayName(name),
        prefab: `Weapons/${group}/${name}`,
        rigId,
        combatId: kind === 'throwable' ? 'rocketLauncher' : rigId,
        kind
      });
    }
  }
  if (new Set(entries.map(row => row.itemId)).size !== entries.length)
    throw new Error('Duplicate PolygonApocalypse weapon item ID');
  if (new Set(entries.map(row => row.name)).size !== entries.length)
    throw new Error('Duplicate PolygonApocalypse weapon display name');

  const original = fs.readFileSync(itemsPath, 'utf8');
  const catalog = JSON.parse(original);
  catalog.items = catalog.items.filter(item => !item.id.startsWith('polygon'));
  for (const row of entries) {
    const legacy = catalog.items.find(item => item.id === row.itemId);
    if (legacy && legacy.category === 'weapons') legacy.name = row.name;
  }
  const templates = Object.fromEntries(catalog.items.map(item => [item.id, item]));
  const newItems = entries.filter(row => !templates[row.itemId]).map(row => {
    const base = templates[row.combatId];
    if (!base) throw new Error(`Missing item template ${row.combatId}`);
    const { harvestTool, ...weaponTemplate } = base;
    return {
      ...weaponTemplate, id: row.itemId, name: row.name, category: 'weapons',
      weight: row.kind === 'throwable' ? 0.65
        : Number((base.weight * (row.kind === 'mounted' ? 1.8 : 1)).toFixed(2)),
      basePrice: row.kind === 'throwable' ? 36
        : Math.round(base.basePrice * (row.kind === 'mounted' ? 1.8 : 1.1)),
      hands: row.kind === 'throwable' ? 1 : base.hands,
      compatibleSlots: row.kind === 'throwable' ? ['weapon'] : base.compatibleSlots,
      modificationSlots: row.kind === 'throwable' ? [] : base.modificationSlots,
      acquisition: ['craft', 'trade', 'loot']
    };
  });
  const itemById = new Map([...catalog.items, ...newItems].map(item => [item.id, item]));
  for (const row of entries) {
    const item = itemById.get(row.itemId);
    row.weight = item.weight;
  }
  const manifest = { schema: 'kromka.apocalypseWeapons.v1', weapons: entries };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  let withoutGenerated = original.replace(/^    \{ "id": "polygon[^\r\n]*\r?\n/gm, '');
  for (const row of entries) {
    if (!Object.values(existing).includes(row.itemId)
        || templates[row.itemId].category !== 'weapons') continue;
    const escaped = row.itemId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const line = new RegExp('(^    \\{ "id": "' + escaped + '", "name": ")[^\"]*', 'm');
    withoutGenerated = withoutGenerated.replace(line, '$1' + row.name);
  }
  withoutGenerated = withoutGenerated.replace(
    /(^    \{ "id": "sawedOffShotgun", "name": ")[^"]*/m,
    '$1Дробовик (обрез) 01');
  for (const [id, name] of Object.entries({
    pickaxe: 'Кирка', axe: 'Топор', handPump: 'Ручной насос'
  })) {
    const line = new RegExp('(^    \\{ "id": "' + id + '", "name": ")[^"]*', 'm');
    withoutGenerated = withoutGenerated.replace(line, '$1' + name);
  }
  const entryLines = newItems.map(item => '    { ' + JSON.stringify(item).slice(1, -1)
    .replace(/":/g, '": ').replace(/,"/g, ', "') + ' },').join('\n');
  const fistLine = /^    \{ "id": "fists"/m;
  if (!fistLine.test(withoutGenerated)) throw new Error('Cannot find fists insertion point');
  fs.writeFileSync(itemsPath, withoutGenerated.replace(fistLine, entryLines + '\n    { "id": "fists"'));
  const fieldCatalog = JSON.parse(fs.readFileSync(fieldRecipesPath, 'utf8'));
  fieldCatalog.recipes = fieldCatalog.recipes.filter(recipe => !recipe.id.startsWith('polygon'));
  for (const recipe of fieldCatalog.recipes) {
    const item = itemById.get(recipe.output.id);
    if (item?.category === 'weapons' && recipe.output.id !== 'fists')
      recipe.name = item.name;
  }
  const recipeByOutput = new Map(fieldCatalog.recipes.map(recipe => [recipe.output.id, recipe]));
  const variantRecipes = entries.filter(row => row.itemId.startsWith('polygon')).map(row => {
    const base = recipeByOutput.get(row.combatId);
    const inputs = base ? { ...base.inputs } : row.kind === 'throwable'
      ? { scrap: 2, chemicals: 1 } : { weaponParts: 3, scrap: 6 };
    return {
      id: row.itemId + 'craft', name: row.name,
      station: 'weapon_bench', inputs,
      silverFee: base?.silverFee ?? 3,
      workSeconds: base?.workSeconds ?? 5,
      output: { id: row.itemId, qty: 1 }
    };
  });
  fieldCatalog.recipes.push(...variantRecipes);
  fs.writeFileSync(fieldRecipesPath, JSON.stringify(fieldCatalog, null, 2) + '\n');
  process.stdout.write(`PolygonApocalypse weapons: ${entries.length} models, ${newItems.length} new items.\n`);
}

if (require.main === module) build();
module.exports = { build, rigFor, itemId, isProjectile };
