const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const locationsDir = path.join(dataDir, 'locations');
const globalMapPath = path.join(dataDir, 'global-map.json');
const simPath = path.join(dataDir, 'wasteland-sim.json');

const RESOURCE_KEYS = [
  'water',
  'ore',
  'scrap',
  'oil',
  'chemicals',
  'medicine',
  'electronics',
  'ammoParts',
  'food',
  'ammo9',
  'ammo556',
  'energyCell',
  'weaponParts'
];

const FACTIONS = {
  old_klim: {
    id: 'old_klim',
    name: 'Караванный двор Старого Клима',
    color: '#93d982',
    relations: { raiders: -100, mutants: -80, wild: -55, neutral: 20, caravans: 70, scrap_union: 35, relay_order: 55 }
  },
  caravans: {
    id: 'caravans',
    name: 'Вольные караваны',
    color: '#efd078',
    relations: { old_klim: 70, raiders: -100, mutants: -80, wild: -45, neutral: 20, scrap_union: 55, relay_order: 55 }
  },
  scrap_union: {
    id: 'scrap_union',
    name: 'Союз Свалочного поста',
    color: '#d7a95e',
    relations: { old_klim: 35, caravans: 55, relay_order: 25, raiders: -95, mutants: -75, wild: -50, neutral: 20 }
  },
  relay_order: {
    id: 'relay_order',
    name: 'Техники Ретранслятора',
    color: '#7fcfff',
    relations: { old_klim: 55, caravans: 55, scrap_union: 25, raiders: -90, mutants: -80, wild: -45, neutral: 25 }
  },
  raiders: {
    id: 'raiders',
    name: 'Рейдеры',
    color: '#ff7b53',
    relations: { old_klim: -100, caravans: -100, scrap_union: -95, relay_order: -90, mutants: -70, wild: -40, neutral: -70 }
  },
  mutants: {
    id: 'mutants',
    name: 'Супермутанты',
    color: '#c681ff',
    relations: { old_klim: -80, caravans: -80, scrap_union: -75, relay_order: -80, raiders: -70, wild: -55, neutral: -70 }
  },
  wild: {
    id: 'wild',
    name: 'Дикие твари пустоши',
    color: '#b88cff',
    relations: { old_klim: -55, caravans: -45, scrap_union: -50, relay_order: -45, raiders: -40, mutants: -55, neutral: -35 }
  },
  neutral: {
    id: 'neutral',
    name: 'Нейтральные жители пустоши',
    color: '#9fd7ff',
    relations: { old_klim: 20, caravans: 20, scrap_union: 20, relay_order: 25, raiders: -70, mutants: -70, wild: -35 }
  }
};

function readJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function stock(values = {}) {
  const out = {};
  RESOURCE_KEYS.forEach(key => { out[key] = Math.max(0, Number(values[key] || 0)); });
  return out;
}

function workers(rows = []) {
  return rows.map(row => ({ role: row[0], label: row[1], count: row[2] }));
}

function workSummary(rows = []) {
  return rows.map(row => `${row[1]}: ${row[2]}`).join(', ');
}

function site(row) {
  const workerRows = row.workers || [];
  const isCapital = !!row.capital;
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    x: row.x,
    y: row.y,
    owner: row.owner,
    pvpMode: row.pvpMode || (isCapital ? 'peaceful' : 'pvp'),
    locationId: row.locationId || row.id,
    note: row.note || '',
    traderProfiles: row.traderProfiles || [],
    stockpile: stock(row.stockpile),
    output: row.output || {},
    production: row.production || {},
    security: row.security ?? 35,
    prosperity: row.prosperity ?? 25,
    danger: row.danger ?? 1,
    resourceRichness: row.resourceRichness ?? 0,
    resourceDepletion: row.resourceDepletion ?? 0,
    workforce: row.workforce ?? 0,
    resourceActivity: row.resourceActivity ?? 0,
    protectionLevel: row.protectionLevel ?? 0,
    protectedBySiteId: row.protectedBySiteId || '',
    raidUntil: 0,
    lastRaidHour: -999,
    lastRaidFaction: '',
    controlPressure: 0,
    activeConflict: null,
    threatSuppressedUntil: 0,
    workers: workers(workerRows),
    workSummary: workSummary(workerRows)
  };
}

function party(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    faction: row.faction,
    state: row.state || (row.kind === 'patrol' ? 'moving' : row.kind === 'caravan' ? 'moving' : 'roaming'),
    homeSiteId: row.homeSiteId,
    destinationSiteId: row.destinationSiteId || row.route?.[0] || row.homeSiteId,
    route: row.route || [row.homeSiteId],
    routeIndex: 0,
    x: row.x,
    y: row.y,
    speedKmh: row.speedKmh,
    strength: row.strength,
    members: row.members,
    cargo: {},
    cargoCapacity: row.cargoCapacity || 0,
    collectScale: row.collectScale || 1,
    preferredResources: row.preferredResources || [],
    supplyRole: row.supplyRole || '',
    respawnHours: row.respawnHours || 20,
    inventory: row.inventory || [],
    stoppedByRaid: false,
    activeBattleZoneId: '',
    nextRespawnHour: 0
  };
}

const SITES = [
  site({
    id: 'settlement',
    type: 'settlement',
    name: 'Караванная стоянка Старого Клима',
    x: 195,
    y: 690,
    owner: 'old_klim',
    pvpMode: 'peaceful',
    locationId: 'settlement',
    capital: true,
    traderProfiles: ['oldKlim', 'guardKlimPatrol'],
    stockpile: { water: 90, food: 50, medicine: 28, scrap: 45, ore: 20, ammoParts: 30, ammo9: 220, ammo556: 90 },
    security: 88,
    prosperity: 58,
    workers: [['trader', 'торговец', 1], ['guard', 'охрана Старого Клима', 9], ['worker', 'местные жители', 16]],
    note: 'Столица караванного двора. Безопасная зона, торговля, склад и доска заданий.'
  }),
  site({
    id: 'scrapTown',
    type: 'settlement',
    name: 'Свалочный пост',
    x: 735,
    y: 690,
    owner: 'scrap_union',
    pvpMode: 'peaceful',
    locationId: 'scrapTown',
    capital: true,
    traderProfiles: ['scrap'],
    stockpile: { water: 45, food: 30, scrap: 120, ore: 75, oil: 20, ammoParts: 80, weaponParts: 12, ammo9: 180, ammo556: 110 },
    security: 82,
    prosperity: 52,
    workers: [['trader', 'торговец ломом', 1], ['worker', 'сборщики металлолома', 18], ['guard', 'ополчение', 8]],
    note: 'Столица Свалочного союза. Мастерские, запчасти, ремонт и торговля ломом.'
  }),
  site({
    id: 'relayStation',
    type: 'settlement',
    name: 'Станция Ретранслятор',
    x: 705,
    y: 195,
    owner: 'relay_order',
    pvpMode: 'peaceful',
    locationId: 'relayStation',
    capital: true,
    traderProfiles: ['relay'],
    stockpile: { water: 50, medicine: 18, oil: 80, chemicals: 55, electronics: 75, energyCell: 180, scrap: 38, ammoParts: 30 },
    security: 84,
    prosperity: 56,
    workers: [['trader', 'техник-торговец', 1], ['mechanic', 'ремонтники антенн', 12], ['guard', 'охрана станции', 7]],
    note: 'Столица техников Ретранслятора. Электроника, энергия, связь и редкая химия.'
  }),

  site({
    id: 'dryWaterPump',
    type: 'resource',
    name: 'Старая водяная помпа',
    x: 255,
    y: 630,
    owner: 'old_klim',
    locationId: 'resourceDryWaterPump',
    output: { water: 18, chemicals: 3 },
    stockpile: { water: 42, chemicals: 8, scrap: 6 },
    resourceRichness: 72,
    workforce: 58,
    security: 55,
    danger: 1,
    workers: [['worker', 'водоносы', 6], ['guard', 'караул', 3]],
    note: 'Главный источник воды Старого Клима. Без него караваны быстро теряют темп.'
  }),
  site({
    id: 'oldKlimFarm',
    type: 'resource',
    name: 'Сухая ферма Старого Клима',
    x: 210,
    y: 765,
    owner: 'old_klim',
    locationId: 'resourceOldKlimFarm',
    output: { food: 16, medicine: 4, water: 4 },
    stockpile: { food: 36, medicine: 8, water: 18 },
    resourceRichness: 64,
    workforce: 50,
    security: 48,
    danger: 1,
    workers: [['worker', 'фермеры', 6], ['guard', 'караул', 2]],
    note: 'Огород, теплица и лекарственные травы. Поддерживает население столицы.'
  }),
  site({
    id: 'klimQuarry',
    type: 'resource',
    name: 'Каменоломня Старого Клима',
    x: 330,
    y: 705,
    owner: 'old_klim',
    locationId: 'resourceKlimQuarry',
    output: { ore: 12, scrap: 6 },
    stockpile: { ore: 24, scrap: 14 },
    resourceRichness: 62,
    workforce: 42,
    security: 45,
    danger: 2,
    workers: [['worker', 'добытчики', 5], ['guard', 'караул', 2]],
    note: 'Небольшая добыча руды и каменного лома для патронной мастерской.'
  }),
  site({
    id: 'roadOutpost',
    type: 'outpost',
    name: 'Дорожный аванпост Старого Клима',
    x: 330,
    y: 630,
    owner: 'old_klim',
    locationId: 'roadOutpost',
    stockpile: { water: 18, ammo9: 60, ammo556: 24, medicine: 6 },
    production: { ammo9: 8 },
    security: 64,
    prosperity: 32,
    workers: [['guard', 'дорожный патруль', 8], ['quartermaster', 'интендант', 1], ['medic', 'фельдшер', 1]],
    note: 'Защищает дорогу к воде, ферме и мастерской.'
  }),
  site({
    id: 'klimAmmoWorks',
    type: 'production',
    name: 'Патронная мастерская Старого Клима',
    x: 285,
    y: 735,
    owner: 'old_klim',
    locationId: 'klimAmmoWorks',
    stockpile: { scrap: 24, ore: 14, ammoParts: 18, water: 8 },
    production: { ammo9: 26, ammo556: 10 },
    security: 52,
    prosperity: 34,
    workers: [['craftsman', 'оружейники', 5], ['hauler', 'грузчики', 2], ['guard', 'караульные', 3]],
    note: 'Производит базовые патроны для патрулей и караванов Старого Клима.'
  }),

  site({
    id: 'scrapFields',
    type: 'resource',
    name: 'Поля металлолома',
    x: 660,
    y: 720,
    owner: 'scrap_union',
    locationId: 'resourceScrapFields',
    output: { scrap: 18, ammoParts: 5 },
    stockpile: { scrap: 46, ammoParts: 12 },
    resourceRichness: 82,
    workforce: 60,
    security: 48,
    danger: 2,
    workers: [['worker', 'сборщики лома', 8], ['guard', 'сторожа', 2]],
    note: 'Крупные поля металлолома. Кормят мастерские Свалочного поста.'
  }),
  site({
    id: 'ironMine',
    type: 'resource',
    name: 'Заброшенный рудник',
    x: 795,
    y: 615,
    owner: 'scrap_union',
    pvpMode: 'pvpFullDrop',
    locationId: 'resourceIronMine',
    output: { ore: 18, scrap: 5 },
    stockpile: { ore: 42, scrap: 14 },
    resourceRichness: 88,
    workforce: 44,
    security: 44,
    danger: 3,
    workers: [['worker', 'шахтёры', 5], ['guard', 'охрана рудника', 3]],
    note: 'Опасный рудник на востоке. Главный источник руды для Свалочного союза.'
  }),
  site({
    id: 'tireDepot',
    type: 'resource',
    name: 'Склад старых покрышек',
    x: 615,
    y: 780,
    owner: 'scrap_union',
    locationId: 'resourceTireDepot',
    output: { oil: 7, scrap: 9, chemicals: 2 },
    stockpile: { oil: 18, scrap: 22, chemicals: 4 },
    resourceRichness: 58,
    workforce: 38,
    security: 42,
    danger: 2,
    workers: [['worker', 'утилизаторы', 4], ['guard', 'сторожа', 2]],
    note: 'Разбор покрышек и старой техники. Даёт немного нефти, химии и много лома.'
  }),
  site({
    id: 'scrapOutpost',
    type: 'outpost',
    name: 'Сторожевой пост Свалочного союза',
    x: 810,
    y: 735,
    owner: 'scrap_union',
    locationId: 'scrapOutpost',
    stockpile: { scrap: 26, ore: 12, ammo9: 45, water: 8 },
    production: { ammoParts: 6 },
    security: 60,
    prosperity: 30,
    workers: [['guard', 'ополчение Свалочного союза', 7], ['quartermaster', 'снабженец', 1], ['mechanic', 'полевой механик', 1]],
    note: 'Военный узел Свалочного союза между рудником, ломом и литейной.'
  }),
  site({
    id: 'scrapFoundry',
    type: 'production',
    name: 'Литейная Свалочного поста',
    x: 705,
    y: 615,
    owner: 'scrap_union',
    locationId: 'scrapFoundry',
    stockpile: { scrap: 52, ore: 28, ammoParts: 12 },
    production: { weaponParts: 3, ammoParts: 10 },
    security: 50,
    prosperity: 42,
    workers: [['worker', 'литейщики', 8], ['mechanic', 'механики пресса', 2], ['guard', 'сторожа', 3]],
    note: 'Переплавляет лом и руду в детали оружия и патронов.'
  }),

  site({
    id: 'oilPump',
    type: 'resource',
    name: 'Старая нефтяная качалка',
    x: 630,
    y: 315,
    owner: 'relay_order',
    pvpMode: 'pvpFullDrop',
    locationId: 'resourceOilPump',
    output: { oil: 16, scrap: 2 },
    stockpile: { oil: 34, scrap: 8 },
    resourceRichness: 76,
    workforce: 44,
    security: 50,
    danger: 3,
    workers: [['worker', 'буровики', 5], ['guard', 'охрана качалки', 3]],
    note: 'Источник нефти для Ретранслятора. Частая цель рейдеров и мутантов.'
  }),
  site({
    id: 'chemSpring',
    type: 'resource',
    name: 'Химический родник',
    x: 600,
    y: 225,
    owner: 'relay_order',
    locationId: 'resourceChemSpring',
    output: { chemicals: 12, water: 6 },
    stockpile: { chemicals: 28, water: 14 },
    resourceRichness: 68,
    workforce: 40,
    security: 42,
    danger: 2,
    workers: [['worker', 'химики', 4], ['guard', 'охрана родника', 2]],
    note: 'Ядовитый родник. Даёт химикаты и немного очищаемой воды.'
  }),
  site({
    id: 'siliconRidge',
    type: 'resource',
    name: 'Кремниевая гряда',
    x: 795,
    y: 165,
    owner: 'relay_order',
    locationId: 'resourceSiliconRidge',
    output: { electronics: 10, ore: 6, scrap: 3 },
    stockpile: { electronics: 24, ore: 12, scrap: 10 },
    resourceRichness: 70,
    workforce: 38,
    security: 45,
    danger: 2,
    workers: [['worker', 'сборщики плат', 4], ['guard', 'охранники гряды', 2]],
    note: 'Радиомусор, кремний и редкая электроника для станции.'
  }),
  site({
    id: 'relayOutpost',
    type: 'outpost',
    name: 'Узел охраны Ретранслятора',
    x: 735,
    y: 330,
    owner: 'relay_order',
    locationId: 'relayOutpost',
    stockpile: { electronics: 14, energyCell: 34, water: 8, medicine: 4 },
    production: { energyCell: 4, electronics: 2 },
    security: 62,
    prosperity: 32,
    workers: [['guard', 'охранники Ретранслятора', 6], ['quartermaster', 'интендант узла', 1], ['mechanic', 'техник связи', 1]],
    note: 'Военный узел между столицей, нефтью и мастерской.'
  }),
  site({
    id: 'relayWorkshop',
    type: 'production',
    name: 'Техмастерская Ретранслятора',
    x: 780,
    y: 255,
    owner: 'relay_order',
    locationId: 'relayWorkshop',
    stockpile: { electronics: 32, chemicals: 18, scrap: 14, oil: 10 },
    production: { electronics: 4, energyCell: 12 },
    security: 52,
    prosperity: 44,
    workers: [['mechanic', 'техники', 7], ['hauler', 'грузчики', 2], ['guard', 'охранники', 3]],
    note: 'Собирает электронику, энергоячейки и ремонтные комплекты.'
  }),
  site({
    id: 'solarArray',
    type: 'production',
    name: 'Солнечная станция Ретранслятора',
    x: 675,
    y: 105,
    owner: 'relay_order',
    locationId: 'solarArray',
    stockpile: { electronics: 18, energyCell: 42, scrap: 8 },
    production: { energyCell: 16, electronics: 2 },
    security: 46,
    prosperity: 36,
    workers: [['mechanic', 'энергетики', 4], ['guard', 'охрана станции', 2]],
    note: 'Старая солнечная ферма. Даёт энергоячейки, но плохо защищена.'
  }),

  site({
    id: 'oldDepot',
    type: 'pointOfInterest',
    name: 'Старый военный склад',
    x: 510,
    y: 510,
    owner: 'raiders',
    pvpMode: 'pvpFullDrop',
    locationId: 'oldDepot',
    stockpile: { ammoParts: 34, ammo9: 80, ammo556: 36, medicine: 5, scrap: 20 },
    security: 50,
    prosperity: 10,
    danger: 4,
    workers: [['boss', 'главарь', 1], ['raider', 'рейдеры', 9], ['looter', 'мародёры', 3]],
    note: 'Фиксированное логово рейдеров. Обновляется после зачистки раз в игровые сутки.'
  }),
  site({
    id: 'mutantCrater',
    type: 'pointOfInterest',
    name: 'Кратер супермутантов',
    x: 465,
    y: 330,
    owner: 'mutants',
    pvpMode: 'pvpFullDrop',
    locationId: 'mutantCrater',
    stockpile: { scrap: 18, ammo556: 18, medicine: 4 },
    security: 48,
    prosperity: 8,
    danger: 5,
    workers: [['mutant', 'супермутанты', 7]],
    note: 'Фиксированное логово супермутантов. Давит на северные дороги.'
  }),
  site({
    id: 'radscorpionNestSite',
    type: 'pointOfInterest',
    name: 'Гнездо радскорпионов',
    x: 390,
    y: 210,
    owner: 'wild',
    pvpMode: 'pvpFullDrop',
    locationId: 'radscorpionNest',
    stockpile: { chemicals: 12, medicine: 2 },
    security: 42,
    prosperity: 5,
    danger: 4,
    workers: [['wild_creature', 'радскорпионы', 6]],
    note: 'Фиксированное логово радскорпионов у каменной гряды.'
  }),
  site({
    id: 'geckoCanyon',
    type: 'pointOfInterest',
    name: 'Каньон гекконов',
    x: 315,
    y: 390,
    owner: 'wild',
    pvpMode: 'pvpFullDrop',
    locationId: 'geckoCanyon',
    stockpile: { food: 8, chemicals: 4 },
    security: 38,
    prosperity: 5,
    danger: 3,
    workers: [['wild_creature', 'гекконы', 7]],
    note: 'Фиксированное логово гекконов на подходе к воде.'
  }),
  site({
    id: 'antHive',
    type: 'pointOfInterest',
    name: 'Муравьиный улей',
    x: 570,
    y: 450,
    owner: 'wild',
    pvpMode: 'pvpFullDrop',
    locationId: 'antHive',
    stockpile: { food: 10, chemicals: 6 },
    security: 40,
    prosperity: 5,
    danger: 4,
    workers: [['wild_creature', 'мутировавшие муравьи', 8]],
    note: 'Фиксированное логово муравьёв между фракционными дорогами.'
  })
];

const PARTIES = [
  party({
    id: 'klim_supply_caravan',
    name: 'Снабженческий караван Старого Клима',
    kind: 'caravan',
    faction: 'old_klim',
    homeSiteId: 'settlement',
    destinationSiteId: 'dryWaterPump',
    route: ['dryWaterPump', 'roadOutpost', 'klimAmmoWorks', 'oldKlimFarm', 'settlement'],
    x: 195,
    y: 690,
    speedKmh: 24,
    strength: 60,
    members: 5,
    cargoCapacity: 85,
    collectScale: 1.1,
    preferredResources: ['water', 'food', 'medicine', 'ammo9', 'ammo556'],
    supplyRole: 'mixed',
    inventory: [{ id: 'water', qty: 8 }, { id: 'ammo556', qty: 24 }]
  }),
  party({
    id: 'klim_water_caravan',
    name: 'Водовоз Старого Клима',
    kind: 'caravan',
    faction: 'old_klim',
    homeSiteId: 'settlement',
    destinationSiteId: 'dryWaterPump',
    route: ['settlement', 'dryWaterPump', 'roadOutpost', 'oldKlimFarm', 'settlement'],
    x: 195,
    y: 690,
    speedKmh: 22,
    strength: 48,
    members: 4,
    cargoCapacity: 65,
    collectScale: 1.2,
    preferredResources: ['water', 'chemicals', 'food'],
    supplyRole: 'water',
    respawnHours: 14,
    inventory: [{ id: 'water', qty: 10 }, { id: 'ammo9', qty: 24 }]
  }),
  party({
    id: 'klim_heavy_caravan',
    name: 'Тяжёлый караван Старого Клима',
    kind: 'caravan',
    faction: 'old_klim',
    homeSiteId: 'settlement',
    destinationSiteId: 'klimQuarry',
    route: ['settlement', 'klimQuarry', 'klimAmmoWorks', 'roadOutpost', 'scrapTown', 'settlement'],
    x: 195,
    y: 690,
    speedKmh: 20,
    strength: 72,
    members: 6,
    cargoCapacity: 100,
    collectScale: 1.15,
    preferredResources: ['ore', 'scrap', 'ammoParts', 'weaponParts'],
    supplyRole: 'heavy',
    respawnHours: 20,
    inventory: [{ id: 'water', qty: 8 }, { id: 'ammo556', qty: 36 }]
  }),
  party({
    id: 'klim_road_patrol',
    name: 'Патруль Старого Клима',
    kind: 'patrol',
    faction: 'old_klim',
    homeSiteId: 'settlement',
    destinationSiteId: 'roadOutpost',
    route: ['settlement', 'roadOutpost', 'dryWaterPump', 'geckoCanyon', 'klimQuarry', 'settlement'],
    x: 195,
    y: 690,
    speedKmh: 28,
    strength: 74,
    members: 5,
    respawnHours: 12
  }),
  party({
    id: 'scrap_salvage_caravan',
    name: 'Караван лома Свалочного поста',
    kind: 'caravan',
    faction: 'scrap_union',
    homeSiteId: 'scrapTown',
    destinationSiteId: 'scrapFields',
    route: ['scrapFields', 'scrapFoundry', 'ironMine', 'scrapOutpost', 'tireDepot', 'scrapTown'],
    x: 735,
    y: 690,
    speedKmh: 21,
    strength: 56,
    members: 5,
    cargoCapacity: 95,
    collectScale: 1.15,
    preferredResources: ['scrap', 'ore', 'ammoParts', 'weaponParts', 'oil'],
    supplyRole: 'scrap',
    inventory: [{ id: 'water', qty: 4 }, { id: 'ammo9', qty: 24 }]
  }),
  party({
    id: 'scrap_militia_patrol',
    name: 'Ополчение Свалочного поста',
    kind: 'patrol',
    faction: 'scrap_union',
    homeSiteId: 'scrapTown',
    destinationSiteId: 'scrapOutpost',
    route: ['scrapTown', 'scrapOutpost', 'ironMine', 'scrapFoundry', 'scrapFields', 'scrapTown'],
    x: 735,
    y: 690,
    speedKmh: 26,
    strength: 66,
    members: 5,
    respawnHours: 14
  }),
  party({
    id: 'relay_tech_caravan',
    name: 'Техкараван Ретранслятора',
    kind: 'caravan',
    faction: 'relay_order',
    homeSiteId: 'relayStation',
    destinationSiteId: 'oilPump',
    route: ['oilPump', 'relayOutpost', 'relayWorkshop', 'siliconRidge', 'solarArray', 'chemSpring', 'relayStation'],
    x: 705,
    y: 195,
    speedKmh: 22,
    strength: 58,
    members: 5,
    cargoCapacity: 80,
    collectScale: 1.1,
    preferredResources: ['oil', 'electronics', 'chemicals', 'energyCell'],
    supplyRole: 'tech',
    inventory: [{ id: 'energyCell', qty: 20 }, { id: 'repairKit', qty: 1 }]
  }),
  party({
    id: 'relay_guard_patrol',
    name: 'Охрана Ретранслятора',
    kind: 'patrol',
    faction: 'relay_order',
    homeSiteId: 'relayStation',
    destinationSiteId: 'relayOutpost',
    route: ['relayStation', 'relayOutpost', 'oilPump', 'mutantCrater', 'siliconRidge', 'relayStation'],
    x: 705,
    y: 195,
    speedKmh: 27,
    strength: 68,
    members: 5,
    respawnHours: 14
  }),
  party({
    id: 'free_oil_caravan',
    name: 'Вольный нефтяной караван',
    kind: 'caravan',
    faction: 'caravans',
    homeSiteId: 'relayStation',
    destinationSiteId: 'scrapTown',
    route: ['relayStation', 'oilPump', 'scrapTown', 'settlement', 'relayStation'],
    x: 705,
    y: 195,
    speedKmh: 23,
    strength: 54,
    members: 5,
    cargoCapacity: 75,
    collectScale: 1.05,
    preferredResources: ['oil', 'scrap', 'water', 'electronics'],
    supplyRole: 'trade',
    inventory: [{ id: 'water', qty: 5 }, { id: 'ammo9', qty: 30 }]
  }),
  party({
    id: 'raider_road_band',
    name: 'Дорожная банда рейдеров',
    kind: 'raider',
    faction: 'raiders',
    state: 'hunting',
    homeSiteId: 'oldDepot',
    destinationSiteId: 'roadOutpost',
    route: ['oldDepot', 'roadOutpost', 'scrapFields', 'klimAmmoWorks', 'scrapOutpost', 'oldDepot'],
    x: 510,
    y: 510,
    speedKmh: 30,
    strength: 64,
    members: 6,
    respawnHours: 30
  }),
  party({
    id: 'mutant_roamers',
    name: 'Бродячие супермутанты',
    kind: 'monster',
    faction: 'mutants',
    homeSiteId: 'mutantCrater',
    destinationSiteId: 'siliconRidge',
    route: ['mutantCrater', 'siliconRidge', 'relayOutpost', 'oilPump', 'mutantCrater', 'ironMine'],
    x: 465,
    y: 330,
    speedKmh: 22,
    strength: 50,
    members: 5,
    respawnHours: 20
  }),
  party({
    id: 'radscorpion_brood',
    name: 'Выводок радскорпионов',
    kind: 'monster',
    faction: 'wild',
    homeSiteId: 'radscorpionNestSite',
    destinationSiteId: 'chemSpring',
    route: ['radscorpionNestSite', 'chemSpring', 'geckoCanyon', 'radscorpionNestSite'],
    x: 390,
    y: 210,
    speedKmh: 18,
    strength: 44,
    members: 5,
    respawnHours: 24
  }),
  party({
    id: 'gecko_pack_party',
    name: 'Стая гекконов',
    kind: 'monster',
    faction: 'wild',
    homeSiteId: 'geckoCanyon',
    destinationSiteId: 'dryWaterPump',
    route: ['geckoCanyon', 'dryWaterPump', 'klimQuarry', 'geckoCanyon'],
    x: 315,
    y: 390,
    speedKmh: 24,
    strength: 38,
    members: 6,
    respawnHours: 24
  }),
  party({
    id: 'ant_swarm_party',
    name: 'Рой мутировавших муравьёв',
    kind: 'monster',
    faction: 'wild',
    homeSiteId: 'antHive',
    destinationSiteId: 'tireDepot',
    route: ['antHive', 'scrapFields', 'tireDepot', 'antHive', 'oldDepot'],
    x: 570,
    y: 450,
    speedKmh: 25,
    strength: 42,
    members: 7,
    respawnHours: 24
  })
];

function nearestSiteOwner(x, y) {
  let best = SITES[0];
  let bestScore = Infinity;
  SITES.forEach(site => {
    if (!site.owner || site.owner === 'neutral') return;
    const weight = site.type === 'settlement' ? 0.72 : site.type === 'outpost' ? 0.9 : site.type === 'production' ? 1 : site.type === 'resource' ? 1.12 : 1.25;
    const score = Math.hypot(x - site.x, y - site.y) * weight - Number(site.security || 0) * 0.18;
    if (score < bestScore) {
      best = site;
      bestScore = score;
    }
  });
  return best;
}

const COASTLINE = [
  { x: 0.105, y: 0.00 }, { x: 0.070, y: 0.08 }, { x: 0.082, y: 0.16 }, { x: 0.055, y: 0.25 },
  { x: 0.106, y: 0.36 }, { x: 0.090, y: 0.48 }, { x: 0.142, y: 0.62 }, { x: 0.126, y: 0.73 },
  { x: 0.184, y: 0.86 }, { x: 0.154, y: 1.00 }
];

function coastX(ny) {
  if (ny <= COASTLINE[0].y) return COASTLINE[0].x;
  for (let i = 0; i < COASTLINE.length - 1; i++) {
    const a = COASTLINE[i];
    const b = COASTLINE[i + 1];
    if (ny <= b.y) {
      const t = (ny - a.y) / Math.max(0.0001, b.y - a.y);
      return a.x + (b.x - a.x) * t;
    }
  }
  return COASTLINE[COASTLINE.length - 1].x;
}

function terrainForCell(cx, cy, owner) {
  if (owner === 'old_klim') return cy > 21 ? 'низины Старого Клима' : 'старые караванные дороги';
  if (owner === 'scrap_union') return cy > 22 ? 'свалочные поля' : 'ржавые дороги Свалочного союза';
  if (owner === 'relay_order') return cy < 8 ? 'северные техпустоши' : 'зона Ретранслятора';
  if (owner === 'raiders') return 'разбитые дороги рейдеров';
  if (owner === 'mutants') return 'опасная центральная пустошь';
  if (owner === 'wild') return 'дикие охотничьи земли';
  return 'пустошь';
}

function fillForOwner(owner, isWater = false) {
  if (isWater) return 'rgba(42,90,96,0.56)';
  if (owner === 'old_klim') return 'rgba(79,128,63,0.30)';
  if (owner === 'scrap_union') return 'rgba(149,105,48,0.30)';
  if (owner === 'relay_order') return 'rgba(68,116,132,0.30)';
  if (owner === 'raiders') return 'rgba(144,58,42,0.30)';
  if (owner === 'mutants') return 'rgba(110,74,145,0.30)';
  if (owner === 'wild') return 'rgba(96,88,56,0.30)';
  return 'rgba(126,94,50,0.22)';
}

function randomLocationsForOwner(owner) {
  if (owner === 'scrap_union' || owner === 'raiders') return [{ id: 'randomRuinedRoad', weight: 4 }, { id: 'randomDryBasin', weight: 2 }];
  if (owner === 'relay_order' || owner === 'mutants') return [{ id: 'randomDryBasin', weight: 4 }, { id: 'randomRuinedRoad', weight: 2 }];
  return [{ id: 'randomAshGrove', weight: 3 }, { id: 'randomDryBasin', weight: 3 }, { id: 'randomRuinedRoad', weight: 2 }];
}

function buildCells() {
  const cells = {};
  const cols = 30;
  const rows = 30;
  const cellPoints = 30;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx + 0.5) * cellPoints;
      const y = (cy + 0.5) * cellPoints;
      const water = (x / (cols * cellPoints)) <= coastX(y / (rows * cellPoints));
      const source = nearestSiteOwner(x, y);
      const owner = source.owner || 'neutral';
      const nearCapital = ['settlement', 'scrapTown', 'relayStation'].some(id => {
        const cap = SITES.find(site => site.id === id);
        return cap && Math.hypot(x - cap.x, y - cap.y) <= 58;
      });
      cells[`${cx}:${cy}`] = water
        ? {
            terrain: 'океан',
            territoryOwner: owner,
            pvpMode: 'peaceful',
            chance: 0,
            difficulty: 0,
            texture: 'water',
            fill: fillForOwner(owner, true),
            encounters: [],
            randomLocations: []
          }
        : {
            terrain: terrainForCell(cx, cy, owner),
            territoryOwner: owner,
            sourceSiteId: source.id,
            pvpMode: nearCapital ? 'peaceful' : ['raiders', 'mutants', 'wild'].includes(owner) ? 'pvpFullDrop' : 'pvp',
            chance: 0,
            difficulty: owner === 'raiders' || owner === 'mutants' ? 4 : owner === 'wild' ? 3 : nearCapital ? 1 : 2,
            texture: owner === 'scrap_union' ? 'scrap_field' : owner === 'relay_order' ? 'rocky_hills' : owner === 'old_klim' ? 'green_lowland' : owner === 'wild' ? 'dry_lake' : owner === 'raiders' ? 'old_road' : owner === 'mutants' ? 'rocky_hills' : 'wasteland_dust',
            fill: fillForOwner(owner),
            encounters: [],
            randomLocations: randomLocationsForOwner(owner)
          };
    }
  }
  return cells;
}

function buildGlobalMap() {
  return {
    schema: 'realm.globalMap.v1',
    version: 1,
    grid: { cols: 30, rows: 30, cellPoints: 30, cellKm: 10 },
    nodes: [
      {
        id: 'settlement',
        x: 195,
        y: 690,
        kind: 'settlement',
        locationId: 'settlement',
        locationCount: 1,
        model: 'oldKlimYard',
        modelScale: 1,
        rotationY: 0,
        note: 'Караванная стоянка Старого Клима. Столица фракции, мирная зона, торговля и снабжение.',
        pvpMode: 'peaceful',
        capital: true,
        capitalFaction: 'old_klim'
      },
      {
        id: 'scrapTown',
        x: 735,
        y: 690,
        kind: 'settlement',
        locationId: 'scrapTown',
        locationCount: 1,
        model: 'scrapTown',
        modelScale: 1,
        rotationY: 0,
        note: 'Свалочный пост. Столица Свалочного союза, мастерские, лом и оружейные детали.',
        pvpMode: 'peaceful',
        capital: true,
        capitalFaction: 'scrap_union'
      },
      {
        id: 'relayStation',
        x: 705,
        y: 195,
        kind: 'settlement',
        locationId: 'relayStation',
        locationCount: 1,
        model: 'relayStation',
        modelScale: 1,
        rotationY: 0,
        note: 'Станция Ретранслятор. Столица техников, электроника, нефть, химия и энергоячейки.',
        pvpMode: 'peaceful',
        capital: true,
        capitalFaction: 'relay_order'
      }
    ],
    objects: [
      { id: 'road_sign_klim', kind: 'landmark', x: 315, y: 660, model: 'highwaySign', modelScale: 1, rotationY: -14, note: 'Старая трасса к Старому Климу.' },
      { id: 'wreck_central', kind: 'landmark', x: 450, y: 570, model: 'carWreck', modelScale: 1.1, rotationY: 28, note: 'Разбитый транспорт у центральной дороги.' },
      { id: 'cargo_scrap_route', kind: 'landmark', x: 645, y: 660, model: 'cargoStack', modelScale: 0.9, rotationY: 12, note: 'Грузовой привал на дороге к Свалочному посту.' },
      { id: 'relay_pole_chain', kind: 'landmark', x: 660, y: 255, model: 'utilityPole', modelScale: 1, rotationY: 0, note: 'Старая линия связи Ретранслятора.' },
      { id: 'old_billboard_center', kind: 'landmark', x: 525, y: 405, model: 'ruinedBillboard', modelScale: 1, rotationY: 18, note: 'Выцветший довоенный щит.' }
    ],
    encounters: [
      { id: 'ghoul_pack', title: 'Стая гулей', text: 'Из низины тянет гнилью. Впереди движение между камнями.', kind: 'hostile', locationId: '' },
      { id: 'radscorpion_nest', title: 'Гнездо радскорпионов', text: 'Песок шевелится у старых костей. Радскорпионы перекрыли проход.', kind: 'hostile', locationId: '' },
      { id: 'mutant_ant_swarm', title: 'Рой мутировавших муравьёв', text: 'Из трещин в земле вылезает крупный муравьиный рой.', kind: 'hostile', locationId: '' },
      { id: 'super_mutant_lair', title: 'Логово супермутантов', text: 'В руинах слышны тяжелые шаги. Супермутанты заняли точку и тащат туда добычу.', kind: 'hostile', locationId: '' },
      { id: 'gecko_pack', title: 'Гекконы пустоши', text: 'На горячих камнях мелькают большие мутировавшие ящерицы.', kind: 'hostile', locationId: '' },
      { id: 'fire_gecko_ambush', title: 'Огненные гекконы', text: 'Воздух дрожит от жара. Впереди рыщут огненные гекконы.', kind: 'hostile', locationId: '' },
      { id: 'peaceful_caravan', title: 'Мирный караван', text: 'На старой трассе остановился караванщик с охраной.', kind: 'caravan', locationId: '' },
      { id: 'caravan_patrol_vs_ghouls', title: 'Патруль против гулей', text: 'Патруль Старого Клима отбивается от гулей.', kind: 'battle', locationId: '' },
      { id: 'raider_ambush', title: 'Засада рейдеров', text: 'Свежие следы засады пересекают дорогу. Рейдеры ждут добычу.', kind: 'hostile', locationId: '' },
      { id: 'raiders_vs_patrol', title: 'Рейдеры против патруля', text: 'Патруль Старого Клима перестреливается с бандой рейдеров.', kind: 'battle', locationId: '' },
      { id: 'ants_vs_geckos', title: 'Муравьи против гекконов', text: 'Две стаи мутантов сцепились у сухого русла.', kind: 'battle', locationId: '' },
      { id: 'radscorpions_vs_patrol', title: 'Патруль против радскорпионов', text: 'Охрана Старого Клима держит круговую оборону.', kind: 'battle', locationId: '' }
    ],
    randomLocations: [
      { id: 'randomAshGrove', weight: 4 },
      { id: 'randomDryBasin', weight: 3 },
      { id: 'randomRuinedRoad', weight: 3 }
    ],
    cells: buildCells()
  };
}

function baseLocation(id, name, opts = {}) {
  const width = opts.width || 76;
  const depth = opts.depth || 76;
  return {
    schema: 'realm.location.v1',
    version: 1,
    id,
    name,
    seed: opts.seed || 20260710,
    safe: !!opts.safe,
    pvpMode: opts.pvpMode || 'pvp',
    kind: opts.kind || 'resource',
    randomTemplate: false,
    noRespawn: true,
    enemyCap: 0,
    spawnCount: 0,
    ground: opts.ground || { preset: 'scrapDust', label: 'Пыльная пустошь' },
    map: { width, depth, origin: 'center' },
    grid: { snap: true, step: 2 },
    spawn: { tx: 19, tz: 24 },
    entryFromWorld: { tx: 19, tz: 24 },
    worldZones: [{ id: 'world_exit_edges', label: 'Уйти на глобальную карту', tx: 19, tz: 2, radius: 4 }],
    containers: opts.containers || [],
    objects: opts.objects || []
  };
}

function obj(id, model, name, x, z, opts = {}) {
  const fileName = opts.file || `${model.replace(/[A-Z]/g, m => '_' + m.toLowerCase()).replace(/^_/, '')}.glb`;
  return {
    id,
    model,
    name,
    url: `/assets/models/wasteland/${fileName}`,
    position: { x, y: 0, z },
    rotation: { x: 0, y: opts.ry || 0, z: 0 },
    scale: opts.scale || { x: 1, y: 1, z: 1 },
    collision: opts.collision || 'none',
    tags: opts.tags || [],
    ...(opts.resourceType ? { resourceType: opts.resourceType, hp: opts.hp || 6, maxHp: opts.maxHp || opts.hp || 6 } : {}),
    ...(opts.vision ? { vision: { mode: opts.vision } } : {})
  };
}

function productionTradeMachine(id, name, x, z, siteId, traderProfile, caps, buyInterests, stock) {
  const row = obj(id, 'tradeMachine', name, x, z, {
    file: 'trade_machine.glb',
    collision: 'solid',
    tags: ['interactive', 'tradeMachine', 'vendingMachine', 'production-market'],
    vision: 'cover',
    ry: Math.PI
  });
  row.interactive = {
    kind: 'tradeMachine',
    role: 'productionTradeMachine',
    siteId,
    traderProfile,
    caps,
    buyInterests,
    stock
  };
  return row;
}

function writeLocationFiles() {
  const files = [
    baseLocation('resourceOldKlimFarm', 'Сухая ферма Старого Клима', {
      kind: 'resource',
      ground: { preset: 'greenLowland', label: 'Зелёная низина' },
      objects: [
        obj('farm_patch_01', 'gardenPatch', 'Сухой огород', -6, -7, { file: 'garden_patch.glb', collision: 'resource', tags: ['resource', 'food'], resourceType: 'food', hp: 6 }),
        obj('farm_patch_02', 'gardenPatch', 'Лекарственные травы', 8, -5, { file: 'garden_patch.glb', collision: 'resource', tags: ['resource', 'medicine'], resourceType: 'medicine', hp: 5, ry: 0.4 }),
        obj('farm_water_01', 'waterTank', 'Бак с водой', -12, 8, { file: 'water_tank.glb', collision: 'resource', tags: ['resource', 'water'], resourceType: 'water', hp: 7, vision: 'cover' }),
        obj('farm_pen_01', 'brahminPen', 'Загон брамина', 10, 10, { file: 'brahmin_pen.glb', collision: 'cover', tags: ['cover'], vision: 'cover' })
      ]
    }),
    baseLocation('resourceKlimQuarry', 'Каменоломня Старого Клима', {
      kind: 'resource',
      pvpMode: 'pvp',
      ground: { preset: 'dryBasin', label: 'Сухая каменная низина' },
      objects: [
        obj('quarry_ore_01', 'oreOutcrop', 'Рудная жила', -10, -8, { file: 'ore_outcrop.glb', collision: 'resource', tags: ['resource', 'ore'], resourceType: 'ore', hp: 7, vision: 'cover' }),
        obj('quarry_ore_02', 'oreOutcrop', 'Каменная жила', 9, -12, { file: 'ore_outcrop.glb', collision: 'resource', tags: ['resource', 'ore'], resourceType: 'ore', hp: 6, ry: -0.4, vision: 'cover' }),
        obj('quarry_scrap_01', 'scrapHeap', 'Ржавый лом', 8, 9, { file: 'scrap_heap.glb', collision: 'resource', tags: ['resource', 'scrap'], resourceType: 'scrap', hp: 5 })
      ]
    }),
    baseLocation('klimAmmoWorks', 'Патронная мастерская Старого Клима', {
      kind: 'production',
      ground: { preset: 'scrapDust', label: 'Пыльная мастерская' },
      containers: [{ id: 'klim_ammo_crate', tx: 16, tz: 18, name: 'Ящик мастерской', tier: 'ammo', locked: true, lockDifficulty: 'medium' }],
      objects: [
        obj('klim_workbench_01', 'workshopBench', 'Оружейный верстак', -4, -6, { file: 'workshop_bench.glb', collision: 'solid', tags: ['cover', 'workshop'], vision: 'cover' }),
        productionTradeMachine('klim_ammo_trade_machine', 'Автомат снабжения патронной мастерской', 4, 6, 'klimAmmoWorks', 'klimAmmoWorksMachine', 180, ['ammo', 'materials', 'weapons', 'tools'], [
          { id: 'ammo9', price: 3, qty: 120 }, { id: 'ammo556', price: 5, qty: 80 }, { id: 'ammoParts', price: 4, qty: 24 },
          { id: 'repairKit', price: 22, qty: 4 }, { id: 'pistol', price: 58, qty: 2 }, { id: 'rifle', price: 88, qty: 1 }
        ]),
        obj('klim_armory_01', 'armoryRack', 'Стойка с деталями', 8, -4, { file: 'armory_rack.glb', collision: 'solid', tags: ['cover', 'workshop'], vision: 'cover' }),
        obj('klim_cargo_01', 'cargoStack', 'Ящики патронов', -9, 7, { file: 'cargo_stack.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('klim_barricade_01', 'roadblockBarricade', 'Баррикада мастерской', 10, 10, { file: 'roadblock_barricade.glb', collision: 'cover', tags: ['cover'], vision: 'cover', ry: 0.5 })
      ]
    }),
    baseLocation('resourceTireDepot', 'Склад старых покрышек', {
      kind: 'resource',
      ground: { preset: 'scrapDust', label: 'Ржавая свалка' },
      objects: [
        obj('tire_depot_01', 'tireStack', 'Старые покрышки', -7, -7, { file: 'tire_stack.glb', collision: 'resource', tags: ['resource', 'oil'], resourceType: 'oil', hp: 6, vision: 'cover' }),
        obj('tire_scrap_01', 'scrapHeap', 'Разобранный кузов', 9, -5, { file: 'scrap_heap.glb', collision: 'resource', tags: ['resource', 'scrap'], resourceType: 'scrap', hp: 5 }),
        obj('tire_barrels_01', 'barrelCluster', 'Бочки с реагентами', -10, 9, { file: 'barrel_cluster.glb', collision: 'cover', tags: ['cover', 'chemicals'], vision: 'cover' })
      ]
    }),
    baseLocation('scrapFoundry', 'Литейная Свалочного поста', {
      kind: 'production',
      ground: { preset: 'scrapDust', label: 'Горячая свалка' },
      containers: [{ id: 'foundry_parts_crate', tx: 18, tz: 17, name: 'Ящик литейной', tier: 'tools' }],
      objects: [
        obj('foundry_workbench_01', 'workshopBench', 'Пресс литейной', -5, -5, { file: 'workshop_bench.glb', collision: 'solid', tags: ['cover', 'workshop'], vision: 'cover' }),
        productionTradeMachine('scrap_foundry_trade_machine', 'Автомат снабжения литейной', 2, 7, 'scrapFoundry', 'scrapFoundryMachine', 170, ['materials', 'tools', 'weapons', 'armor'], [
          { id: 'scrap', price: 4, qty: 24 }, { id: 'ammoParts', price: 4, qty: 24 }, { id: 'weaponParts', price: 14, qty: 8 },
          { id: 'repairKit', price: 20, qty: 5 }, { id: 'rifle', price: 84, qty: 2 }, { id: 'metalArmor', price: 38, qty: 1 }
        ]),
        obj('foundry_scrap_01', 'scrapHeap', 'Куча металлолома', 8, -6, { file: 'scrap_heap.glb', collision: 'resource', tags: ['resource', 'scrap'], resourceType: 'scrap', hp: 6 }),
        obj('foundry_storage_01', 'storageLeanTo', 'Складской навес', -10, 9, { file: 'storage_lean_to.glb', collision: 'solid', tags: ['cover'], vision: 'block' }),
        obj('foundry_barrels_01', 'barrelCluster', 'Топливные бочки', 11, 8, { file: 'barrel_cluster.glb', collision: 'cover', tags: ['cover'], vision: 'cover' })
      ]
    }),
    baseLocation('resourceChemSpring', 'Химический родник', {
      kind: 'resource',
      ground: { preset: 'dryBasin', label: 'Ядовитая низина' },
      objects: [
        obj('chem_tank_01', 'waterTank', 'Химический бак', -7, -7, { file: 'water_tank.glb', collision: 'resource', tags: ['resource', 'chemicals'], resourceType: 'chemicals', hp: 7, vision: 'cover' }),
        obj('chem_barrels_01', 'barrelCluster', 'Бочки с химией', 8, -4, { file: 'barrel_cluster.glb', collision: 'cover', tags: ['cover', 'chemicals'], vision: 'cover' }),
        obj('chem_scrap_01', 'scrapHeap', 'Сломанный фильтр', 5, 10, { file: 'scrap_heap.glb', collision: 'resource', tags: ['resource', 'scrap'], resourceType: 'scrap', hp: 5 })
      ]
    }),
    baseLocation('resourceSiliconRidge', 'Кремниевая гряда', {
      kind: 'resource',
      ground: { preset: 'rockyHills', label: 'Каменистая гряда' },
      objects: [
        obj('silicon_ore_01', 'oreOutcrop', 'Кремниевая жила', -9, -7, { file: 'ore_outcrop.glb', collision: 'resource', tags: ['resource', 'ore'], resourceType: 'ore', hp: 6, vision: 'cover' }),
        obj('silicon_relay_01', 'relayAntenna', 'Разобранная антенна', 8, -8, { file: 'relay_antenna.glb', collision: 'cover', tags: ['cover', 'electronics'], vision: 'cover', scale: { x: 0.8, y: 0.8, z: 0.8 } }),
        obj('silicon_scrap_01', 'scrapHeap', 'Электронный лом', 5, 9, { file: 'scrap_heap.glb', collision: 'resource', tags: ['resource', 'scrap'], resourceType: 'scrap', hp: 5 })
      ]
    }),
    baseLocation('relayWorkshop', 'Техмастерская Ретранслятора', {
      kind: 'production',
      ground: { preset: 'scrapDust', label: 'Техническая площадка' },
      containers: [{ id: 'relay_workshop_tools', tx: 17, tz: 18, name: 'Ящик техников', tier: 'tools' }],
      objects: [
        obj('relay_workbench_01', 'workshopBench', 'Технический верстак', -5, -6, { file: 'workshop_bench.glb', collision: 'solid', tags: ['cover', 'workshop'], vision: 'cover' }),
        productionTradeMachine('relay_workshop_trade_machine', 'Автомат снабжения техмастерской', 3, 9, 'relayWorkshop', 'relayWorkshopMachine', 190, ['materials', 'ammo', 'tools', 'weapons'], [
          { id: 'electronics', price: 9, qty: 18 }, { id: 'energyCell', price: 5, qty: 72 }, { id: 'napalm', price: 7, qty: 36 },
          { id: 'repairKit', price: 24, qty: 5 }, { id: 'laserPistol', price: 92, qty: 2 }, { id: 'plasmaRifle', price: 180, qty: 1 }
        ]),
        obj('relay_pole_01', 'utilityPole', 'Мачта питания', 8, -7, { file: 'utility_pole.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('relay_cargo_01', 'cargoStack', 'Ящики электроники', -9, 8, { file: 'cargo_stack.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('relay_antenna_01', 'relayAntenna', 'Малая антенна', 9, 8, { file: 'relay_antenna.glb', collision: 'cover', tags: ['cover'], vision: 'cover', scale: { x: 0.75, y: 0.75, z: 0.75 } })
      ]
    }),
    baseLocation('solarArray', 'Солнечная станция Ретранслятора', {
      kind: 'production',
      ground: { preset: 'saltFlat', label: 'Светлый солончак' },
      objects: [
        obj('solar_pole_01', 'utilityPole', 'Опора станции', -9, -8, { file: 'utility_pole.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('solar_pole_02', 'utilityPole', 'Опора станции', 8, -8, { file: 'utility_pole.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('solar_workbench_01', 'workshopBench', 'Инверторный щит', 0, 7, { file: 'workshop_bench.glb', collision: 'solid', tags: ['cover', 'workshop'], vision: 'cover' }),
        productionTradeMachine('solar_array_trade_machine', 'Автомат снабжения солнечной станции', 8, 7, 'solarArray', 'solarArrayMachine', 130, ['materials', 'ammo', 'tools'], [
          { id: 'energyCell', price: 4, qty: 96 }, { id: 'electronics', price: 8, qty: 14 },
          { id: 'repairKit', price: 22, qty: 4 }, { id: 'laserPistol', price: 90, qty: 1 }
        ])
      ]
    }),
    baseLocation('mutantCrater', 'Кратер супермутантов', {
      kind: 'lair',
      pvpMode: 'pvpFullDrop',
      ground: { preset: 'dryBasin', label: 'Опасная низина' },
      objects: [
        obj('mutant_crater_wall_01', 'lowRuinedWall', 'Разбитая стена', -8, -8, { file: 'low_ruined_wall.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('mutant_crater_cargo_01', 'cargoStack', 'Украденный груз', 7, -6, { file: 'cargo_stack.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('mutant_crater_fire_01', 'campfireRest', 'Кострище мутантов', 2, 8, { file: 'campfire_rest.glb', collision: 'none', tags: ['camp'] })
      ]
    }),
    baseLocation('radscorpionNest', 'Гнездо радскорпионов', {
      kind: 'lair',
      pvpMode: 'pvpFullDrop',
      ground: { preset: 'rockyHills', label: 'Каменистая нора' },
      objects: [
        obj('scorpion_rocks_01', 'rubbleRock', 'Каменная осыпь', -7, -7, { file: 'rubble_rock.glb', collision: 'none', tags: ['rock'] }),
        obj('scorpion_rocks_02', 'oreOutcrop', 'Сухая гряда', 8, -6, { file: 'ore_outcrop.glb', collision: 'cover', tags: ['cover'], vision: 'cover' }),
        obj('scorpion_bones_01', 'perimeterDebris', 'Кости у норы', 2, 8, { file: 'perimeter_debris.glb', collision: 'none', tags: ['debris'] })
      ]
    }),
    baseLocation('geckoCanyon', 'Каньон гекконов', {
      kind: 'lair',
      pvpMode: 'pvpFullDrop',
      ground: { preset: 'dryBasin', label: 'Горячий каньон' },
      objects: [
        obj('gecko_rock_01', 'rubbleRock', 'Тёплые камни', -9, -6, { file: 'rubble_rock.glb', collision: 'none', tags: ['rock'] }),
        obj('gecko_tree_01', 'deadwood', 'Сухой ствол', 8, -8, { file: 'deadwood.glb', collision: 'none', tags: ['debris'] }),
        obj('gecko_bush_01', 'dryBush', 'Сухой куст', 2, 9, { file: 'dry_bush.glb', collision: 'none', tags: ['bush'] })
      ]
    }),
    baseLocation('antHive', 'Муравьиный улей', {
      kind: 'lair',
      pvpMode: 'pvpFullDrop',
      ground: { preset: 'dryBasin', label: 'Сухие туннели' },
      objects: [
        obj('ant_mound_01', 'rubbleRock', 'Муравьиный холм', -5, -6, { file: 'rubble_rock.glb', collision: 'cover', tags: ['cover'], vision: 'cover', scale: { x: 1.4, y: 0.8, z: 1.4 } }),
        obj('ant_debris_01', 'perimeterDebris', 'Разбросанные кости', 8, -4, { file: 'perimeter_debris.glb', collision: 'none', tags: ['debris'] }),
        obj('ant_deadwood_01', 'deadwood', 'Сухие ветки', 2, 9, { file: 'deadwood.glb', collision: 'none', tags: ['debris'] })
      ]
    })
  ];

  files.forEach(loc => writeJson(path.join(locationsDir, `${loc.id}.json`), loc));
}

function buildSimState() {
  const now = Date.now();
  const sites = Object.fromEntries(SITES.map(row => [row.id, row]));
  const parties = Object.fromEntries(PARTIES.map(row => [row.id, row]));
  return {
    schema: 'realm.wastelandSim.v1',
    version: 1,
    worldHour: 0,
    lastTickAt: now,
    updatedAt: now,
    factions: FACTIONS,
    sites,
    parties,
    events: [
      {
        id: `world_rebalanced_${now}`,
        type: 'world_rebalanced',
        title: 'Глобальная карта переработана',
        text: 'Столицы фракций разнесены, ресурсные точки, аванпосты и логова закреплены на карте.',
        hour: 0,
        createdAt: now,
        details: { patch: 'living_wasteland_strategy_layer' }
      }
    ],
    worldTasks: [],
    worldZones: [],
    stats: {
      caravansArrived: 0,
      caravansLost: 0,
      battlesResolved: 0,
      resourceRaids: 0,
      resourceRaidsRepelled: 0,
      worldTasksCreated: 0,
      worldTasksCompleted: 0,
      worldTasksResolved: 0,
      resourcesDelivered: {},
      encountersResolved: 0
    }
  };
}

writeLocationFiles();
require('./upgrade-crafting-stations');
writeJson(globalMapPath, buildGlobalMap());
writeJson(simPath, buildSimState());

const owners = SITES.reduce((acc, site) => {
  acc[site.owner] = acc[site.owner] || { sites: 0, production: 0, resource: 0, outpost: 0, pointOfInterest: 0 };
  acc[site.owner].sites += 1;
  acc[site.owner][site.type] = (acc[site.owner][site.type] || 0) + 1;
  return acc;
}, {});

console.log(`Global map rebalanced: ${SITES.length} sites, ${PARTIES.length} parties, ${Object.keys(buildCells()).length} cells.`);
console.log(JSON.stringify(owners, null, 2));
