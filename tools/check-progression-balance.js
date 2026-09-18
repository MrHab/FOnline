const fs = require('fs');
const path = require('path');

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

function buyPrice(stockPrice, barter, merchant) {
  const discount = Math.min(0.48, skillNorm(barter) * 0.24 + Number(merchant || 0) * 0.05);
  return Math.max(1, Math.ceil(Number(stockPrice || 1) * (1 - discount)));
}

function sellPrice({ stockEntry = null, base = 1, cha = 5, barter = 20, merchant = 0, traderTrait = false }) {
  const sellMul = 1 +
    (Number(cha || 5) - 5) * 0.04 +
    (traderTrait ? 0.15 : 0) +
    skillNorm(barter) * 0.30 +
    Number(merchant || 0) * 0.08;
  let price = Math.max(1, Math.floor(Number(base || 1) * sellMul));
  if (stockEntry) {
    price = Math.min(price, Math.max(1, Math.floor(buyPrice(stockEntry.price, barter, merchant) * 0.85)));
  }
  return price;
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

// Trade offers come from the authored trader shelves (data/traders.json); the
// resale base is 45% of the catalog base price, as in SERVER_TRADE_SELL_PRICE_BASE.
const stock = Object.entries(traderData.profiles || {}).flatMap(([trader, profile]) =>
  (Array.isArray(profile?.stock) ? profile.stock : []).map(entry => ({ trader, id: entry.id, price: entry.price })));
if (!stock.length) fail('Trader profiles have no stock to audit for arbitrage');
const sellOverrides = Object.fromEntries((itemCatalog.items || [])
  .filter(item => item.id !== 'silver' && Number(item.basePrice || 0) > 0)
  .map(item => [item.id, Math.max(1, Math.floor(Number(item.basePrice) * 0.45))]));
const serverSource = read('server.js');

const tradeBuilds = [
  { name: 'start', cha: 5, barter: 20, merchant: 0, traderTrait: false },
  { name: 'mid', cha: 8, barter: 60, merchant: 1, traderTrait: false },
  { name: 'maxNoTrait', cha: 15, barter: 100, merchant: 3, traderTrait: false },
  { name: 'maxTrait', cha: 15, barter: 100, merchant: 3, traderTrait: true }
];

const arbitrage = [];
for (const build of tradeBuilds) {
  for (const entry of stock) {
    const fallbackBase = Math.max(1, Math.floor(Number(entry.price || 1) * 0.45));
    const base = sellOverrides[entry.id] || fallbackBase;
    const buy = buyPrice(entry.price, build.barter, build.merchant);
    const sell = sellPrice({ stockEntry: entry, base, ...build });
    if (sell > buy) arbitrage.push({ build: build.name, trader: entry.trader, id: entry.id, buy, sell, diff: sell - buy });
  }
}
if (arbitrage.length) fail('Trade arbitrage detected: vendor item can be resold for profit', arbitrage.slice(0, 20));

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

console.log(`Progression balance OK: ${tradeBuilds.length} trade builds, ${stock.length} stock item(s), lock ${Math.round(lockLow * 100)}-${Math.round(lockHigh * 100)}%, terminal ${Math.round(terminalLow * 100)}-${Math.round(terminalHigh * 100)}%, stealth ${Math.round(stealthStart * 100)}-${Math.round(stealthMax * 100)}%, medkit max ${medkitMax}, harvest ${Math.round(harvestLow * 100)}-${Math.round(harvestHigh * 100)}%, rocket radius max ${rocketRadiusMax.toFixed(2)}m`);
