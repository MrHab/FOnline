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

const toolNames = Object.freeze({
  pickaxe: 'Лопата «Пласт»',
  axe: 'Топор «Пролом»',
  handPump: 'Ключ «Поток»'
});
const legacyWeaponNames = Object.freeze({
  pistol: 'Пистолет «Искра»',
  revolver: 'Револьвер «Шериф»',
  smg: 'ПП «Шорох»',
  rifle: 'Винтовка «След»',
  assaultRifle: 'Автомат «Рубеж»',
  machineGun: 'Пулемёт «Гром»',
  laserPistol: 'Гибрид «Разряд»',
  plasmaRifle: 'Гибрид «Заря»',
  shotgun: 'Дробовик «Град»',
  rocketLauncher: 'Ракетомёт «Пепел»',
  knife: 'Нож «Тихий»',
  flamethrower: 'Огнемёт «Жар»'
});
const toolDescriptions = Object.freeze({
  pickaxe: 'Тяжёлая лопата вскрывает рудные жилы и завалы.',
  axe: 'Пожарный топор рубит древесину и пробивает преграды.',
  handPump: 'Трубный ключ помогает обслуживать насосы и добывать нефть.'
});
const equipment = Object.freeze({
  leather: ['Куртка «Пыль»', 'Лёгкая одежда следопыта. Бережёт от мелких осколков.', 1],
  metalArmor: ['Панцирь «Лом»', 'Сборная защита из найденных стальных пластин.', 2],
  ballisticVest: ['Жилет «Застава»', 'Бронекомплект для патрулей и охраны караванов.', 3],
  combatArmor: ['Комплект «Штурм»', 'Усиленная форма для боя в городских руинах.', 4],
  hazmatSuit: ['Костюм «Фильтр»', 'Герметичный костюм для заражённых кварталов.', 1],
  heavyArmor: ['Панцирь «Бастион»', 'Тяжёлая защита для передовой.', 5],
  energySuit: ['Костюм «Изолятор»', 'Защитный костюм для работы с разрядами и радиацией.', 2],
  weldedHelmet: ['Шлем «Сварщик»', 'Простая защита головы из металлолома.', 1],
  helmet: ['Шлем «Караул»', 'Полевая защита головы.', 2],
  tacticalHelmet: ['Шлем «Дозор»', 'Закрытый шлем патрульного.', 3],
  assaultHelmet: ['Шлем «Штурм»', 'Усиленный шлем передового отряда.', 4],
  preWarHelmet: ['Шлем «Реликт»', 'Редкая защитная каска прежней армии.', 5],
  boots: ['Ботинки «Тропа»', 'Прочная обувь для переходов по пустоши.', 1],
  scoutBoots: ['Ботинки «След»', 'Лёгкая обувь разведчика.', 2],
  reinforcedBoots: ['Ботинки «Крепь»', 'Усиленная обувь для тяжёлого груза.', 3],
  assaultBoots: ['Ботинки «Натиск»', 'Защитная обувь штурмового отряда.', 4],
  backpack: ['Рюкзак «Странник»', 'Вместительный походный рюкзак увеличивает грузоподъёмность.', 2]
});

function weaponTier(row, base) {
  if (row.kind === 'mounted') return 5;
  if (row.kind === 'throwable') return 2;
  const tiers = { knife: 1, axe: 1, pistol: 1, rifle: 2, revolver: 2,
    sawedOffShotgun: 2, shotgun: 3, assaultRifle: 3, machineGun: 3,
    smg: 3, laserPistol: 4, flamethrower: 4, plasmaRifle: 5,
    rocketLauncher: 5 };
  return tiers[row.combatId] || base?.tier || 2;
}

function weaponDescription(row) {
  const role = row.kind === 'mounted' ? 'Тяжёлая установка'
    : row.kind === 'throwable' ? 'Бросковый боеприпас'
    : row.rigId === 'knife' || row.rigId === 'axe' ? 'Оружие ближнего боя'
    : 'Огнестрельное оружие';
  return `${row.name}. ${role} из уцелевших деталей для службы на Кромке.`;
}

function formatItem(item) {
  return '    { ' + JSON.stringify(item).slice(1, -1)
    .replace(/":/g, '": ').replace(/,"/g, ', "') + ' },';
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
    if (!legacy) continue;
    legacy.name = toolNames[row.itemId] || legacyWeaponNames[row.itemId] || row.name;
    row.name = legacy.name;
    legacy.description = toolDescriptions[row.itemId] || weaponDescription(row);
    legacy.tier = weaponTier(row, legacy);
  }
  for (const item of catalog.items) {
    const authored = equipment[item.id];
    if (authored) [item.name, item.description, item.tier] = authored;
  }
  const sawedOff = catalog.items.find(item => item.id === 'sawedOffShotgun');
  sawedOff.name = 'Дробовик «Коротыш»';
  sawedOff.description = 'Компактный дробовик для боя на короткой дистанции.';
  sawedOff.tier = 2;
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
      acquisition: ['craft', 'trade', 'loot'],
      description: weaponDescription(row),
      tier: weaponTier(row, base)
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
  const updated = new Map(catalog.items.map(item => [item.id, item]));
  withoutGenerated = withoutGenerated.replace(/^    \{ "id": "([^\"]+)"[^\r\n]*\},?$/gm,
    (line, id) => {
      const item = updated.get(id);
      return item && (item.description || equipment[id] || toolNames[id])
        ? formatItem(item) : line;
    });
  const entryLines = newItems.map(formatItem).join('\n');
  const fistLine = /^    \{ "id": "fists"/m;
  if (!fistLine.test(withoutGenerated)) throw new Error('Cannot find fists insertion point');
  fs.writeFileSync(itemsPath, withoutGenerated.replace(fistLine, entryLines + '\n    { "id": "fists"'));
  const fieldCatalog = JSON.parse(fs.readFileSync(fieldRecipesPath, 'utf8'));
  fieldCatalog.recipes = fieldCatalog.recipes.filter(recipe => !recipe.id.startsWith('polygon'));
  for (const recipe of fieldCatalog.recipes) {
    const item = itemById.get(recipe.output.id);
    if (item && ['weapons', 'armor', 'tools'].includes(item.category)
        && recipe.output.id !== 'fists')
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
  const craftPath = path.join(root, 'unity-client', 'Assets', 'Scripts', 'Game', 'RoaCraftingData.cs');
  const craftSource = fs.readFileSync(craftPath, 'utf8');
  fs.writeFileSync(craftPath, craftSource.replace(
    /Recipe\("([^"]+)", "[^"]*", "([^"]+)"/g,
    (match, recipeId, outputId) => {
      const item = itemById.get(outputId);
      return item && ['weapons', 'armor', 'tools'].includes(item.category)
        ? `Recipe("${recipeId}", "${item.name}", "${outputId}"` : match;
    }));
  process.stdout.write(`PolygonApocalypse weapons: ${entries.length} models, ${newItems.length} new items.\n`);
}

if (require.main === module) build();
module.exports = { build, rigFor, itemId, isProjectile };
