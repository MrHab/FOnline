const fs = require('fs');
const path = require('path');
const { normalizeItemCatalog, itemCatalogIndexes } = require('../src/server/kromka-items');
const { loadWorldEconomy } = require('../src/server/world-economy');
const { harvestBonusChance } = require('../src/server/harvest-bonus');
const { buildStartingLoadout } = require('../src/server/starting-loadout');

const root = path.resolve(__dirname, '..');
const progressionCatalog = JSON.parse(fs.readFileSync(
  path.join(root, 'data', 'kromka', 'character-progression.json'), 'utf8'
));
const itemCatalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'items.json'), 'utf8'));
const traderData = JSON.parse(fs.readFileSync(path.join(root, 'data', 'traders.json'), 'utf8'));

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message, details = null) {
  if (details) console.error(details);
  throw new Error(message);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, Number(v || 0)));
}

function skillNorm(percent) {
  return clamp((Number(percent || 20) - 20) / 80, 0, 1);
}

const SECURITY_DIFFICULTY_TIERS = {
  veryEasy: { required: 25, difficulty: 10 },
  easy: { required: 40, difficulty: 25 },
  medium: { required: 55, difficulty: 45 },
  hard: { required: 75, difficulty: 65 },
  veryHard: { required: 90, difficulty: 80 }
};

function securityDifficulty(value = 'medium') {
  if (typeof value === 'string' && SECURITY_DIFFICULTY_TIERS[value]) return SECURITY_DIFFICULTY_TIERS[value].difficulty;
  const n = clamp(Number(value || 0), 0, 100);
  if (n <= 20) return SECURITY_DIFFICULTY_TIERS.veryEasy.difficulty;
  if (n <= 40) return SECURITY_DIFFICULTY_TIERS.easy.difficulty;
  if (n <= 60) return SECURITY_DIFFICULTY_TIERS.medium.difficulty;
  if (n <= 80) return SECURITY_DIFFICULTY_TIERS.hard.difficulty;
  return SECURITY_DIFFICULTY_TIERS.veryHard.difficulty;
}

function serverDeclaration(source, head) {
  const start = source.indexOf(`\n${head}`);
  if (start < 0) fail(`server.js has no ${head.trim()}`);
  const end = head.startsWith('function ') ? source.indexOf('\n}', start) + 2 : source.indexOf(';\n', start) + 1;
  return source.slice(start + 1, end);
}

// Цены торговли с NPC — настоящие функции server.js в песочнице: прежняя копия
// формулы в этой проверке отстала от сервера (без надбавки за интерес, без
// доли жителя, только «у того же торговца») и не заметила заработка на перепродаже.
function serverTradePricing(source, itemIndexes, worldEconomy) {
  const stubs = {
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    SERVER_ITEM_BASE_PRICES: itemIndexes.basePrices,
    SERVER_ITEM_CATEGORIES: itemIndexes.categories,
    SERVER_ITEM_IDS: new Set(Object.keys(itemIndexes.byId)),
    WORLD_ECONOMY: worldEconomy,
    serverSkillNorm: (p, id) => id === 'barter' ? skillNorm(p.barter) : 0,
    serverTalentLevel: (p, id) => id === 'merchant' ? Number(p.merchant || 0) : 0,
    serverStatValue: (p, key) => key === 'cha' ? Number(p.cha || 5) : 5,
    serverHasTrait: (p, id) => id === 'traderStart' && p.traderTrait === true,
    serverResidentTradePct: p => clamp(p.resident, 0, 0.2),
    // Окно торговли личного торговца: без симуляции узла, полка — его стопки.
    ensureServerFriendlyNpcSocialState: () => true,
    serverRefreshPersonalNpcTradeStock: actor => actor.traderStock,
    serverNpcInventoryCaps: () => 500,
    WASTELAND_SIM: {}
  };
  const declarations = [
    'const SERVER_TRADE_SELL_SHARE_PCT =', 'const SERVER_TRADE_SELL_PRICE_BASE =', 'const SERVER_TRADE_MAX_BUY_DISCOUNT =',
    'const SERVER_TRADE_SHELF_FLOOR_SHARE =', 'function serverBaseItemId(', 'function serverTradeItemCategory(',
    'function serverTradeShelfFloor(', 'function serverTradeShelfPrice(', 'function serverTradeBuyPrice(',
    'function serverTradeSellCeiling(', 'function serverNpcTradeRefusedCategories(', 'function serverTradeSellPrice(',
    'function serverNpcTradeResalePrice(', 'function serverNpcTradeMarket('
  ].map(head => serverDeclaration(source, head));
  return new Function(...Object.keys(stubs), `${declarations.join('\n')}
return { serverTradeShelfFloor, serverTradeShelfPrice, serverTradeBuyPrice, serverTradeSellCeiling, serverTradeSellPrice,
  serverNpcTradeResalePrice, serverNpcTradeMarket };`)(...Object.values(stubs));
}

function securityLockChance({ skill = 20, agi = 5, luck = 5, quickHands = 0, difficulty = 40 }) {
  const diff = securityDifficulty(difficulty);
  return clamp(
    0.18 +
      skillNorm(skill) * 0.55 +
      (Number(agi || 5) - 5) * 0.025 +
      (Number(luck || 5) - 5) * 0.012 +
      Number(quickHands || 0) * 0.025 -
      diff * 0.006,
    0.03,
    0.92
  );
}

function terminalChance({ science = 20, repair = 20, int = 5, engineer = 0, energyTech = 0, difficulty = 45 }) {
  const diff = securityDifficulty(difficulty);
  return clamp(
    0.14 +
      skillNorm(science) * 0.58 +
      skillNorm(repair) * 0.12 +
      (Number(int || 5) - 5) * 0.03 +
      Number(engineer || 0) * 0.035 +
      Number(energyTech || 0) * 0.02 -
      diff * 0.0065,
    0.02,
    0.90
  );
}

function firstAidAmount(itemBase, firstAid, fieldMedic) {
  return clamp(Number(itemBase || 0) + Number(fieldMedic || 0) * 8 + Math.round(skillNorm(firstAid) * 24), 1, 95);
}

function doctorChance({ doctor = 20, int = 5, surgeon = 0 }) {
  return clamp(0.35 + skillNorm(doctor) * 0.55 + Math.max(0, Number(int || 5) - 5) * 0.025 + Number(surgeon || 0) * 0.08, 0.35, 0.98);
}

function explosiveRadius({ throwing = 20, grenadier = 0, base = 4.2 }) {
  return Math.max(1.5, Number(base || 4.2)) + skillNorm(throwing) * 0.45 + Number(grenadier || 0) * 0.2;
}

// Сбор — настоящая функция server.js в песочнице: она читает персонажа и отдаёт
// его числа формуле из src/server/harvest-bonus.js. Заглушки различают «сырое» и
// действующее значение, чтобы обход serverStatValue (перки «+1») был заметен.
function serverHarvestChance(source) {
  const stubs = {
    harvestBonusChance,
    serverStatValue: (p, key) => Number(p.effective?.[key] ?? 5),
    serverSkillNorm: (p, id) => skillNorm(p.skills?.[id]),
    serverTalentLevel: (p, id) => Number(p.talentRanks?.[id] || 0)
  };
  return new Function(...Object.keys(stubs), `${serverDeclaration(source, 'function serverHarvestBonusChance(')}
return serverHarvestBonusChance;`)(...Object.values(stubs));
}

function crouchDetectionMultiplier({ stealth = 20, ghost = 0 }) {
  const reduction = skillNorm(stealth) * 0.44 + Number(ghost || 0) * 0.11;
  return Math.max(0.35, 1 - reduction);
}

// Торговля с NPC (экономика v3, библия 14.5: марки приходят только из карманов
// NPC и наград). Настоящие функции цен сервера на всех профилях торговцев,
// предметах каталога и сборках персонажа:
// - никакая скупка не дороже самой дешёвой покупки того же предмета в мире — ни у
//   того же торговца, ни у другого, ни на колебаниях рынка узла, ни на чужой
//   перепродаже, ни через второго персонажа с другим навыком;
// - Влияние, «Барыга», Бартер, «Торговец» и житель не удешевляют продажу и не
//   дорожат покупку, а скупка новичка остаётся ниже потолка — навыку есть куда расти;
// - оружие и броню торговцы не покупают: их скупает только Чёрный рынок.
const serverSource = read('server.js');
const itemIndexes = itemCatalogIndexes(normalizeItemCatalog(itemCatalog));
const worldEconomy = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json'));
const pricing = serverTradePricing(serverSource, itemIndexes, worldEconomy);
const refusedCategories = worldEconomy.worldModel.blackMarket ? worldEconomy.blackMarket.categories : [];
if (!refusedCategories.includes('weapons') || !refusedCategories.includes('armor')) fail('NPC traders must leave weapons and armour to the Black Market');
const tradeItemIds = Object.keys(itemIndexes.byId).filter(id => id !== 'silver' && id !== 'fists');
const allCategories = [...new Set(Object.values(itemIndexes.categories))];
const tradeMarkets = [
  ...Object.entries(traderData.profiles || {}).map(([id, profile]) => ({ name: `profile:${id}`, stock: profile.stock || [], buyInterests: profile.buyInterests || [] })),
  ...fs.readdirSync(path.join(root, 'data', 'locations')).filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(read(path.join('data', 'locations', file))))
    .filter(loc => Array.isArray(loc.trader?.stock) && loc.trader.stock.length)
    .map(loc => ({ name: `location:${loc.id}`, stock: loc.trader.stock, buyInterests: loc.trader.buyInterests || [] })),
  // Торговец без полки, которому интересно всё, и равнодушный ко всему.
  { name: 'stockless:all', stock: [], buyInterests: allCategories },
  { name: 'stockless:none', stock: [], buyInterests: [] }
].map(market => ({
  ...market,
  refusedCategories,
  stock: market.stock.map(row => ({ id: row.id, qty: Math.max(1, Number(row.qty || 1)), price: pricing.serverTradeShelfPrice(row.id, row.price) }))
}));
if (tradeMarkets.filter(market => market.stock.length).length < 4) fail('Trader profiles have no stock to audit for arbitrage');

{
  const window = pricing.serverNpcTradeMarket({ personalTrade: true, traderStock: [], traderBuyInterests: ['weapons', 'armor', 'aid'] });
  if (JSON.stringify(window.refusedCategories) !== JSON.stringify(refusedCategories) || JSON.stringify(window.buyInterests) !== '["aid"]') {
    fail('The trade window must name the refused categories and drop them from the trader interests', window);
  }
}

// Сборки перебираются смешанным основанием: шаг по одной оси — соседняя сборка,
// у которой ровно одна характеристика выше.
const tradeAxes = [['cha', [1, 5, 10, 13, 15]], ['barter', [20, 50, 80, 100]], ['merchant', [0, 1, 2, 3]],
  ['traderTrait', [false, true]], ['resident', [0, 0.08, 0.2]]];
const tradeBuilds = tradeAxes.reduce((builds, [axis, values]) =>
  builds.flatMap(build => values.map(value => ({ ...build, [axis]: value }))), [{}]);
const axisSteps = tradeAxes.map(([axis, values], index) => ({
  axis,
  size: values.length,
  stride: tradeAxes.slice(index + 1).reduce((product, [, next]) => product * next.length, 1)
}));
const cheapSeller = { cha: 1, barter: 20, merchant: 0, traderTrait: false, resident: 0 };
const maxDiscountBuyer = { cha: 15, barter: 100, merchant: 3, traderTrait: true, resident: 0.2 };
const novice = { cha: 5, barter: 20, merchant: 0, traderTrait: false, resident: 0 };

const arbitrage = [];
const inversions = [];
let tradeQuotes = 0;
let skillRoom = 0;
for (const id of tradeItemIds) {
  // Рынок узла, затоваренная полка или дешёвая перепродажа могут опустить цену
  // полки как угодно низко, но сервер читает её не ниже нижней границы.
  const floor = pricing.serverTradeShelfFloor(id);
  if (pricing.serverTradeShelfPrice(id, 1) !== floor || pricing.serverTradeShelfPrice(id, -5) !== floor) {
    fail(`NPC shelf price of ${id} drops below its floor ${floor}`);
  }
  const personal = pricing.serverNpcTradeMarket({ personalTrade: true, traderStock: [{ id, qty: 1, price: 1 }] }).stock[0];
  if (!personal || personal.price !== floor) fail(`serverNpcTradeMarket shows ${id} below its shelf floor`, personal);
  const refused = refusedCategories.includes(itemIndexes.categories[id]);
  const markets = tradeMarkets.concat([
    { name: 'shelf:floor', stock: [{ id, qty: 1, price: floor }], buyInterests: allCategories, refusedCategories },
    { name: 'shelf:max', stock: [{ id, qty: 1, price: 9999 }], buyInterests: allCategories, refusedCategories }
  ]);
  for (const market of markets) {
    if (refused || market.stock.some(row => row.id === id)) continue;
    const resale = pricing.serverNpcTradeResalePrice(id, market, cheapSeller);
    if (resale < floor) fail(`Resale price of ${id} at ${market.name} is below the shelf floor: ${resale} < ${floor}`);
  }
  // Самая дешёвая покупка в мире: полка у нижней границы и наибольшая скидка.
  const cheapestBuy = pricing.serverTradeBuyPrice({ price: floor }, maxDiscountBuyer);
  const buys = tradeBuilds.map(build => pricing.serverTradeBuyPrice({ price: floor }, build));
  let noviceTop = 0;
  let top = 0;
  for (const market of markets) {
    const sells = tradeBuilds.map(build => pricing.serverTradeSellPrice(id, market, build));
    tradeQuotes += sells.length;
    if (refused) {
      if (sells.some(price => price !== 0)) fail(`NPC trader ${market.name} quotes a price for ${id}, which only the Black Market buys`);
      continue;
    }
    sells.forEach((sell, index) => {
      // Продажа хотя бы на марку дешевле покупки; поровну — только когда и то и другое стоит марку.
      if (sell >= cheapestBuy && cheapestBuy > 1) arbitrage.push({ build: tradeBuilds[index], id, market: market.name, cheapestBuy, sell });
      for (const { axis, size, stride } of axisSteps) {
        if (Math.floor(index / stride) % size === size - 1) continue;
        if (sells[index + stride] < sell) inversions.push({ id, market: market.name, axis, from: tradeBuilds[index], sell, next: sells[index + stride] });
        if (buys[index + stride] > buys[index]) inversions.push({ id, axis, from: tradeBuilds[index], buy: buys[index], next: buys[index + stride] });
      }
    });
    top = Math.max(top, ...sells);
    noviceTop = Math.max(noviceTop, pricing.serverTradeSellPrice(id, market, novice));
  }
  if (refused || Number(itemIndexes.basePrices[id] || 0) < 20) continue;
  if (noviceTop >= top) fail(`A novice already sells ${id} at the ceiling ${top}: skill gives nothing`);
  skillRoom++;
}
if (arbitrage.length) fail(`Trade arbitrage detected: ${arbitrage.length} NPC resale quote(s) are not cheaper than the cheapest NPC purchase`, arbitrage.slice(0, 12));
if (inversions.length) fail(`Trade skill inversion: ${inversions.length} step(s) where a better trader sells cheaper or buys dearer`, inversions.slice(0, 12));

// Чёрный рынок платит за снаряжение не больше npcResaleCapShare базы: это должно
// быть дешевле самой низкой цены NPC-торговца при наибольшей скидке.
for (const id of tradeItemIds) {
  const base = Number(itemIndexes.basePrices[id] || 0);
  if (base <= 0 || !worldEconomy.blackMarket.categories.includes(itemIndexes.categories[id])) continue;
  const cheapestNpc = pricing.serverTradeBuyPrice({ price: pricing.serverTradeShelfFloor(id) }, maxDiscountBuyer);
  if (Math.floor(base * worldEconomy.blackMarket.npcResaleCapShare) >= cheapestNpc) {
    fail(`Black market cap for ${id} (${Math.floor(base * worldEconomy.blackMarket.npcResaleCapShare)}) reaches the cheapest NPC price ${cheapestNpc}`);
  }
}

// «Барыга»: описание называет ровно то, что делает сервер, — как «Падальщик» в
// check-loot-perks.js. Надбавка — разница настоящих цен скупки с чертой и без неё,
// марки — разница настоящих наборов снабжения: новый персонаж получает вещи только
// из buildTutorialSupplies (ящик Сборного двора или пропуск обучения), а
// buildStartingLoadout сервер сам не зовёт.
{
  const { buildTutorialSupplies } = require('../src/server/starting-loadout');
  const text = progressionCatalog.startTraits.items.find(row => row.id === 'traderStart').description;
  const indifferent = { stock: [], buyInterests: [], refusedCategories };
  const sells = (prices, id, traderTrait) => prices.serverTradeSellPrice(id, indifferent, { ...novice, traderTrait });
  // Процент меряется на вещи такой цены, что округления до целой марки не видно.
  const dear = serverTradePricing(serverSource,
    { basePrices: { probe: 1e6 }, categories: { probe: 'misc' }, byId: { probe: {} } }, worldEconomy);
  const sellPct = Math.round((sells(dear, 'probe', true) / sells(dear, 'probe', false) - 1) * 1000) / 10;
  if (!(sellPct > 0) || !text.includes(`+${String(sellPct).replace('.', ',')}% к цене продажи`)) {
    fail(`traderStart adds +${sellPct}% to the NPC sell price and must say so: ${text}`);
  }
  // На вещах каталога надбавка та же с точностью до марки: цена скупки целая.
  for (const id of tradeItemIds) {
    if (refusedCategories.includes(itemIndexes.categories[id])) continue;
    const plain = sells(pricing, id, false);
    const gain = sells(pricing, id, true) - plain;
    if (Math.abs(gain - plain * sellPct / 100) > 1) {
      fail(`traderStart promises +${sellPct}% to the sell price, but a novice sells ${id} for ${plain} without the trait and for ${plain + gain} with it`);
    }
  }
  const supplies = traits => Object.fromEntries(buildTutorialSupplies({ traits }).map(row => [row.id, row.qty]));
  const withTrait = supplies(['traderStart']);
  const without = supplies([]);
  const extra = id => Number(withTrait[id] || 0) - Number(without[id] || 0);
  const marks = extra('silver');
  if (!(marks > 0) || !new RegExp(`\\+${marks} мар(?:ка|ки|ок) на старте`).test(text)) {
    fail(`traderStart starts with ${marks} extra marks and must say so: ${text}`);
  }
  const otherItems = Object.keys({ ...withTrait, ...without }).filter(id => id !== 'silver' && extra(id) !== 0);
  if (otherItems.length) fail(`traderStart changes the starting supplies beyond marks (${otherItems.join(', ')}), so its description must name them: ${text}`);
  // Обещанная вещь ищется по точному названию из каталога предметов.
  for (const [id, item] of Object.entries(itemIndexes.byId)) {
    if (!item.name || extra(id) > 0) continue;
    const name = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'iu').test(text)) {
      fail(`traderStart promises «${item.name}», but the starting supplies have no extra ${id}: ${text}`);
    }
  }
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) || []).map(number => Number(number.replace(',', '.')));
  const stray = numbers.filter(number => number !== sellPct && number !== marks);
  if (stray.length) fail(`traderStart names ${stray.join(', ')}, a number the server does not apply: ${text}`);
}

const lockLow = securityLockChance({ skill: 20, agi: 5, luck: 5, quickHands: 0, difficulty: 'hard' });
const lockHigh = securityLockChance({ skill: 100, agi: 15, luck: 15, quickHands: 3, difficulty: 'hard' });
if (lockLow !== 0.03 || lockHigh > 0.92) fail(`Lockpick chance out of balance: low=${lockLow}, high=${lockHigh}`);

const terminalLow = terminalChance({ science: 20, repair: 20, int: 5, engineer: 0, energyTech: 0, difficulty: 'hard' });
const terminalHigh = terminalChance({ science: 100, repair: 100, int: 15, engineer: 2, energyTech: 3, difficulty: 'hard' });
if (terminalLow !== 0.02 || terminalHigh > 0.90) fail(`Terminal chance out of balance: low=${terminalLow}, high=${terminalHigh}`);

const medkitMax = firstAidAmount(35, 100, 2);
const stimMax = firstAidAmount(18, 100, 2);
if (medkitMax > 80 || stimMax > 65) fail(`First aid healing too high: medkit=${medkitMax}, stim=${stimMax}`);

const doctorMax = doctorChance({ doctor: 100, int: 15, surgeon: 2 });
if (doctorMax > 0.98) fail(`Doctor chance too high: ${doctorMax}`);

const rocketRadiusMax = explosiveRadius({ throwing: 100, grenadier: 2 });
if (rocketRadiusMax > 5.2) fail(`Explosive radius too high: ${rocketRadiusMax}`);

// Сбор: шанс второй единицы ресурса. Новичок начинает с базовых 18%, потолок — 78%.
const harvestChance = serverHarvestChance(serverSource);
const gatherNovice = { effective: { int: 5, luck: 5 }, skills: { wanderer: 20, repair: 20 }, talentRanks: {}, traits: [] };
const harvestLow = harvestChance(gatherNovice);
const harvestHigh = harvestChance({
  effective: { int: 15, luck: 15 }, skills: { wanderer: 100, repair: 100 },
  talentRanks: { engineer: 2, recycler: 2 }, traits: ['craftsmanStart']
});
if (harvestLow !== 0.18 || harvestHigh !== 0.78) fail(`Harvest bonus chance out of balance: low=${harvestLow}, high=${harvestHigh}`);
// Каждый источник по отдельности: прибавка к шансу новичка в процентных пунктах.
const gatherGain = build => Math.round((harvestChance({ ...gatherNovice, ...build }) - harvestLow) * 1000) / 10;
for (const [source, build, expected] of [
  ['Intelligence 6', { effective: { int: 6, luck: 5 } }, 2.5],
  ['Luck 6', { effective: { int: 5, luck: 6 } }, 1],
  ['Intelligence and Luck below 5', { effective: { int: 1, luck: 1 } }, 0],
  ['wanderer 100%', { skills: { wanderer: 100, repair: 20 } }, 12],
  ['repair 100%', { skills: { wanderer: 20, repair: 100 } }, 8],
  ['engineer rank 1', { talentRanks: { engineer: 1 } }, 2.5],
  ['recycler rank 1', { talentRanks: { recycler: 1 } }, 2]
]) {
  if (gatherGain(build) !== expected) fail(`Harvest bonus from ${source}: expected +${expected} p.p., got +${gatherGain(build)}`);
}

// «Ремесленник»: описание называет ровно то, что делает сервер, — как «Падальщик»
// в check-loot-perks.js. Прибавка — разница настоящего шанса с чертой и без неё,
// стартовые предметы — разница настоящих наборов нового персонажа.
{
  const text = progressionCatalog.startTraits.items.find(row => row.id === 'craftsmanStart').description;
  const points = gatherGain({ traits: ['craftsmanStart'] });
  if (!(points > 0) || !text.includes(`+${String(points).replace('.', ',')} п.п.`)) {
    fail(`craftsmanStart adds +${points} p.p. to the chance of an extra gathered resource and must say so: ${text}`);
  }
  const startingItems = traits => Object.fromEntries(buildStartingLoadout({ traits }).inventory.map(row => [row.id, row.qty]));
  const withTrait = startingItems(['craftsmanStart']);
  const without = startingItems([]);
  const extra = id => Number(withTrait[id] || 0) - Number(without[id] || 0);
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) || []).map(number => Number(number.replace(',', '.')));
  for (const [id, item] of Object.entries(itemIndexes.byId)) {
    if (!item.name) continue;
    const name = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'iu').test(text);
    if (extra(id) > 0 && (!named || (extra(id) > 1 && !numbers.includes(extra(id))))) {
      fail(`craftsmanStart starts with ${extra(id)} extra ${id} («${item.name}») and must say so: ${text}`);
    }
    if (named && extra(id) <= 0) fail(`craftsmanStart promises «${item.name}», but the starting loadout has no extra ${id}: ${text}`);
  }
  const applied = [points, ...Object.keys(withTrait).map(extra).filter(qty => qty > 0)];
  const stray = numbers.filter(number => !applied.includes(number));
  if (stray.length) fail(`craftsmanStart names ${stray.join(', ')}, a number the server does not apply: ${text}`);
}

if (!serverSource.includes("30 + serverStatValue(p, 'str') * 8")) {
  fail('Carry capacity must use perk-adjusted Strength on the server');
}
if (progressionCatalog.special.max !== 10 || progressionCatalog.special.budget !== 40
  || progressionCatalog.special.effectiveMax !== 15
  || !serverSource.includes('KROMKA_CHARACTER_PROGRESSION_CATALOG.special.max')
  || !serverSource.includes('KROMKA_CHARACTER_PROGRESSION_CATALOG.special.budget')
  || !serverSource.includes('KROMKA_CHARACTER_PROGRESSION_CATALOG.special.effectiveMax')) {
  fail('Server SPECIAL caps are not sourced from the Kromka progression catalog');
}
for (const snippet of ["function serverPlayerMaxHp", "function serverPlayerMaxAp", "serverTalentLevel(p, 'toughness') * 12", "serverTalentLevel(p, 'actionBoy')", '99']) {
  if (!serverSource.includes(snippet)) fail(`Server derived vital formula missing: ${snippet}`);
}

const stealthStart = crouchDetectionMultiplier({ stealth: 20, ghost: 0 });
const stealthMax = crouchDetectionMultiplier({ stealth: 100, ghost: 2 });
if (stealthStart !== 1 || stealthMax < 0.35 || stealthMax > 0.36) fail(`Crouch stealth multiplier out of balance: start=${stealthStart}, max=${stealthMax}`);
for (const snippet of ["serverSkillNorm(p, 'stealth') * 0.44", "serverTalentLevel(p, 'ghost') * 0.11", 'Math.max(0.35, 1 - stealthReduction)']) {
  if (!serverSource.includes(snippet)) fail(`Server stealth formula missing: ${snippet}`);
}
for (const snippet of [
  "const conditionPenalty = w.ammoType && condition !== null ? Math.max(0, 70 - condition) * 0.0025 : 0",
  "const movementPenalty = p.moving && !p.crouching ? 0.035 : 0",
  "injuries.concussion ? 0.10 : 0",
  "serverAutomaticAccuracyPenalty(p, w, client)"
]) {
  if (!serverSource.includes(snippet)) fail(`Combat hit sync formula missing: ${snippet}`);
}

console.log(`Progression balance OK: ${tradeBuilds.length} trade builds × ${tradeItemIds.length} items, ${tradeQuotes} NPC resale quotes below the cheapest NPC purchase and monotonic in skill (${skillRoom} items with room to grow), lock ${Math.round(lockLow * 100)}-${Math.round(lockHigh * 100)}%, terminal ${Math.round(terminalLow * 100)}-${Math.round(terminalHigh * 100)}%, stealth ${Math.round(stealthStart * 100)}-${Math.round(stealthMax * 100)}%, medkit max ${medkitMax}, harvest ${Math.round(harvestLow * 100)}-${Math.round(harvestHigh * 100)}%, rocket radius max ${rocketRadiusMax.toFixed(2)}m`);
