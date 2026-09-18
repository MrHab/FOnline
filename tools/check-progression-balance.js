const fs = require('fs');
const path = require('path');
const { normalizeItemCatalog, itemCatalogIndexes } = require('../src/server/kromka-items');
const { loadWorldEconomy } = require('../src/server/world-economy');

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
function serverTradePricing(source, itemIndexes) {
  const stubs = {
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    SERVER_ITEM_BASE_PRICES: itemIndexes.basePrices,
    SERVER_ITEM_CATEGORIES: itemIndexes.categories,
    SERVER_ITEM_IDS: new Set(Object.keys(itemIndexes.byId)),
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
    'const SERVER_TRADE_SELL_PRICE_BASE =', 'const SERVER_TRADE_MAX_BUY_DISCOUNT =', 'const SERVER_TRADE_SHELF_FLOOR_SHARE =',
    'function serverBaseItemId(', 'function serverTradeItemCategory(', 'function serverTradeShelfFloor(',
    'function serverTradeShelfPrice(', 'function serverTradeBuyPrice(', 'function serverTradeSellCap(',
    'function serverTradeSellPrice(', 'function serverNpcTradeResalePrice(', 'function serverNpcTradeMarket('
  ].map(head => serverDeclaration(source, head));
  return new Function(...Object.keys(stubs), `${declarations.join('\n')}
return { serverTradeShelfFloor, serverTradeShelfPrice, serverTradeBuyPrice, serverTradeSellPrice, serverNpcTradeResalePrice, serverNpcTradeMarket };`)(
    ...Object.values(stubs));
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

function harvestBonusChance({ int = 5, luck = 5, craftsman = false, wanderer = 20, repair = 20, engineer = 0, recycler = 0 }) {
  return clamp(
    0.18 +
      Math.max(0, Number(int || 5) - 5) * 0.025 +
      Math.max(0, Number(luck || 5) - 5) * 0.01 +
      (craftsman ? 0.18 : 0) +
      skillNorm(wanderer) * 0.12 +
      skillNorm(repair) * 0.08 +
      Number(engineer || 0) * 0.025 +
      Number(recycler || 0) * 0.02,
    0.05,
    0.78
  );
}

function crouchDetectionMultiplier({ stealth = 20, ghost = 0 }) {
  const reduction = skillNorm(stealth) * 0.44 + Number(ghost || 0) * 0.11;
  return Math.max(0.35, 1 - reduction);
}

// Перепродажа NPC-торговцам (экономика v3, библия 14.5: марки приходят только из
// карманов NPC и наград). Ни один круг «купить у торговца — продать торговцу» не
// приносит марок: ни у того же торговца, ни у другого, у которого этого товара
// нет, ни на колебаниях рынка узла, ни на чужой перепродаже, ни с жителем-Торговцем.
const serverSource = read('server.js');
const itemIndexes = itemCatalogIndexes(normalizeItemCatalog(itemCatalog));
const pricing = serverTradePricing(serverSource, itemIndexes);
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
  stock: market.stock.map(row => ({ id: row.id, qty: Math.max(1, Number(row.qty || 1)), price: pricing.serverTradeShelfPrice(row.id, row.price) }))
}));
if (tradeMarkets.filter(market => market.stock.length).length < 4) fail('Trader profiles have no stock to audit for arbitrage');

const tradeBuilds = [];
for (const cha of [1, 5, 10, 13, 15]) for (const barter of [20, 50, 80, 100]) for (const merchant of [0, 1, 2, 3])
  for (const traderTrait of [false, true]) for (const resident of [0, 0.08, 0.2])
    tradeBuilds.push({ cha, barter, merchant, traderTrait, resident });
const cheapSeller = { cha: 1, barter: 20, merchant: 0, traderTrait: false, resident: 0 };
const maxDiscountBuyer = { cha: 15, barter: 100, merchant: 3, traderTrait: true, resident: 0.2 };

const arbitrage = [];
let tradeQuotes = 0;
for (const id of tradeItemIds) {
  // Рынок узла, затоваренная полка или дешёвая перепродажа могут опустить цену
  // полки как угодно низко, но сервер читает её не ниже нижней границы.
  const floor = pricing.serverTradeShelfFloor(id);
  if (pricing.serverTradeShelfPrice(id, 1) !== floor || pricing.serverTradeShelfPrice(id, -5) !== floor) {
    fail(`NPC shelf price of ${id} drops below its floor ${floor}`);
  }
  const personal = pricing.serverNpcTradeMarket({ personalTrade: true, traderStock: [{ id, qty: 1, price: 1 }] }).stock[0];
  if (!personal || personal.price !== floor) fail(`serverNpcTradeMarket shows ${id} below its shelf floor`, personal);
  const markets = tradeMarkets.concat([
    { name: 'shelf:floor', stock: [{ id, qty: 1, price: floor }], buyInterests: allCategories },
    { name: 'shelf:max', stock: [{ id, qty: 1, price: 9999 }], buyInterests: allCategories }
  ]);
  for (const market of markets) {
    if (market.stock.some(row => row.id === id)) continue;
    const resale = pricing.serverNpcTradeResalePrice(id, market, cheapSeller);
    if (resale < floor) fail(`Resale price of ${id} at ${market.name} is below the shelf floor: ${resale} < ${floor}`);
  }
  for (const build of tradeBuilds) {
    const cheapestBuy = pricing.serverTradeBuyPrice({ price: floor }, build, true);
    for (const market of markets) {
      const sell = pricing.serverTradeSellPrice(id, market, build);
      tradeQuotes++;
      // Продажа хотя бы на марку дешевле покупки; поровну — только когда и то и другое стоит марку.
      if (sell >= cheapestBuy && cheapestBuy > 1) arbitrage.push({ build, id, market: market.name, cheapestBuy, sell, gain: sell - cheapestBuy });
    }
  }
}
if (arbitrage.length) {
  arbitrage.sort((a, b) => b.gain - a.gain);
  fail(`Trade arbitrage detected: ${arbitrage.length} NPC resale quote(s) are not cheaper than the cheapest NPC purchase`, arbitrage.slice(0, 12));
}

// Чёрный рынок платит за снаряжение не больше npcResaleCapShare базы: это должно
// быть дешевле самой низкой цены NPC-торговца при наибольшей скидке.
const blackMarket = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json')).blackMarket;
for (const id of tradeItemIds) {
  const base = Number(itemIndexes.basePrices[id] || 0);
  if (base <= 0 || !blackMarket.categories.includes(itemIndexes.categories[id])) continue;
  const cheapestNpc = pricing.serverTradeBuyPrice({ price: pricing.serverTradeShelfFloor(id) }, maxDiscountBuyer, true);
  if (Math.floor(base * blackMarket.npcResaleCapShare) >= cheapestNpc) {
    fail(`Black market cap for ${id} (${Math.floor(base * blackMarket.npcResaleCapShare)}) reaches the cheapest NPC price ${cheapestNpc}`);
  }
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

const harvestLow = harvestBonusChance({ int: 5, luck: 5, craftsman: false, wanderer: 20, repair: 20, engineer: 0, recycler: 0 });
const harvestHigh = harvestBonusChance({ int: 15, luck: 15, craftsman: true, wanderer: 100, repair: 100, engineer: 2, recycler: 2 });
if (harvestLow < 0.05 || harvestHigh > 0.78) fail(`Harvest bonus chance out of balance: low=${harvestLow}, high=${harvestHigh}`);
for (const snippet of ["serverSkillNorm(p, 'wanderer') * 0.12", "serverSkillNorm(p, 'repair') * 0.08", "serverTalentLevel(p, 'engineer') * 0.025", "serverTalentLevel(p, 'recycler') * 0.02"]) {
  if (!serverSource.includes(snippet)) fail(`Server harvest formula missing: ${snippet}`);
}
for (const snippet of ["const intVal = serverStatValue(p, 'int')", "const luckVal = serverStatValue(p, 'luck')"]) {
  if (!serverSource.includes(snippet)) fail(`Server harvest SPECIAL formula must include perk-adjusted stats: ${snippet}`);
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

console.log(`Progression balance OK: ${tradeBuilds.length} trade builds × ${tradeItemIds.length} items, ${tradeQuotes} NPC resale quotes cheaper than any NPC purchase, lock ${Math.round(lockLow * 100)}-${Math.round(lockHigh * 100)}%, terminal ${Math.round(terminalLow * 100)}-${Math.round(terminalHigh * 100)}%, stealth ${Math.round(stealthStart * 100)}-${Math.round(stealthMax * 100)}%, medkit max ${medkitMax}, harvest ${Math.round(harvestLow * 100)}-${Math.round(harvestHigh * 100)}%, rocket radius max ${rocketRadiusMax.toFixed(2)}m`);
