#!/usr/bin/env node
'use strict';

// Погода Кромки (src/server/weather.js) и её место в игровых расчётах server.js.
// Поле дождя детерминировано и непрерывно, земля мокнет в дождь и сохнет после
// него, грязь зависит от грунта зоны, в укрытии погода не действует. Настоящие
// функции server.js в песочнице: грязь режет бюджет шага пешехода (не седока),
// дождь сокращает обзор врага и сбивает прицел игроку и NPC.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  GROUND_MUD_FACTORS,
  WEATHER_EFFECT_LIMITS,
  WEATHER_STATES,
  createWeather,
  groundMudFactor,
  normalizeWeatherOverride,
  weatherChanged,
  weatherEffects,
  weatherShelteredLocation
} = require('../src/server/weather');
const { npcAttackHitChance } = require('../src/server/enemy-ai');

const root = path.resolve(__dirname, '..');
const graph = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
const locations = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'locations.json'), 'utf8'));
const MINUTE = 60000;
const T0 = Date.UTC(2026, 8, 1);

// --- Поле погоды ---------------------------------------------------------------------------

const weather = createWeather({ seed: 'kromka-1:weather' });
const twin = createWeather({ seed: 'kromka-1:weather' });
const other = createWeather({ seed: 'another-world:weather' });

// Детерминизм: тот же мир и те же часы — та же погода, после перезапуска тоже.
for (const [x, z, t] of [[40, 60, T0], [210, 150, T0 + 777 * MINUTE], [355, 280, T0 + 9 * 1440 * MINUTE]]) {
  assert.deepEqual(weather.sampleAt(x, z, t), twin.sampleAt(x, z, t), 'the same world and clock give the same weather');
}

// Климат: за месяц в случайных точках дождь идёт заметную, но меньшую часть
// времени, ливень редок; у другого зерна мира погода своя.
let rainy = 0;
let storms = 0;
let differs = 0;
let random = 0x2545f491;
const next = () => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return (random >>> 0) / 4294967296; };
const SAMPLES = 3000;
for (let i = 0; i < SAMPLES; i++) {
  const x = next() * 380;
  const z = next() * 300;
  const t = T0 + next() * 30 * 1440 * MINUTE;
  const { rain } = weather.rainAt(x, z, t);
  if (rain >= 0.08) rainy += 1;
  if (rain >= 0.72) storms += 1;
  if (Math.abs(rain - other.rainAt(x, z, t).rain) > 0.05) differs += 1;
}
assert(rainy / SAMPLES > 0.1 && rainy / SAMPLES < 0.28, `rain covers 10–28% of place-time, got ${(rainy / SAMPLES).toFixed(3)}`);
assert(storms / SAMPLES > 0.01 && storms / SAMPLES < 0.09, `downpours are rare, got ${(storms / SAMPLES).toFixed(3)}`);
assert(storms < rainy / 2, 'most rain is not a downpour');
assert(differs / SAMPLES > 0.1, 'another world seed has its own weather');

// Фронт — это пятно на карте, а не зона: у соседних зон (20 км) дождь почти
// всегда одинаков, а за полкарты — нет.
const pairDifference = offset => {
  let sum = 0;
  for (let i = 0; i < 600; i++) {
    const x = next() * 300;
    const z = next() * 260;
    const t = T0 + next() * 20 * 1440 * MINUTE;
    sum += Math.abs(weather.rainAt(x, z, t).rain - weather.rainAt(x + offset, z, t).rain);
  }
  return sum / 600;
};
const neighbour = pairDifference(20);
const far = pairDifference(180);
assert(neighbour < far * 0.6, `neighbouring zones share fronts: ${neighbour.toFixed(3)} vs far ${far.toFixed(3)}`);

// Дождь в точке идёт эпизодами в десятки минут, а не мерцает по минутам.
const episodes = [];
let current = 0;
let flips = 0;
let wasRaining = false;
for (let m = 0; m < 10 * 1440; m++) {
  const raining = weather.rainAt(150, 150, T0 + m * MINUTE).rain >= 0.08;
  if (raining !== wasRaining) flips += 1;
  if (raining) current += 1;
  else if (current) { episodes.push(current); current = 0; }
  wasRaining = raining;
}
assert(episodes.length >= 10, `ten days bring several rains, got ${episodes.length}`);
const meanEpisode = episodes.reduce((sum, value) => sum + value, 0) / episodes.length;
assert(meanEpisode >= 15 && meanEpisode <= 120, `a rain lasts tens of minutes, mean ${meanEpisode.toFixed(1)} min`);
assert(flips <= episodes.length * 2 + 2, 'rain does not flicker on and off');

// --- Земля: мокнет в дождь, сохнет после, грязь держится дольше -----------------------------

// Найти начало сильного дождя в точке и пройти по нему.
let stormStart = -1;
for (let m = 200; m < 20 * 1440 && stormStart < 0; m++) {
  if (weather.rainAt(150, 150, T0 + m * MINUTE).rain >= 0.7
    && weather.rainAt(150, 150, T0 + (m - 90) * MINUTE).rain === 0) stormStart = m;
}
assert(stormStart > 0, 'a strong rain after a dry spell exists in twenty days');
const dryBefore = weather.sampleAt(150, 150, T0 + (stormStart - 60) * MINUTE);
let wettest = dryBefore;
let stormEnd = stormStart;
while (weather.rainAt(150, 150, T0 + stormEnd * MINUTE).rain > 0 && stormEnd < stormStart + 400) stormEnd += 1;
for (let m = stormStart; m <= stormEnd; m += 3) {
  const sample = weather.sampleAt(150, 150, T0 + m * MINUTE);
  if (sample.wetness > wettest.wetness) wettest = sample;
}
assert(wettest.wetness > dryBefore.wetness + 0.3, `rain soaks the ground: ${dryBefore.wetness} -> ${wettest.wetness}`);
const afterRain = weather.sampleAt(150, 150, T0 + (stormEnd + 20) * MINUTE);
const muchLater = weather.sampleAt(150, 150, T0 + (stormEnd + 150) * MINUTE);
if (weather.rainAt(150, 150, T0 + (stormEnd + 60) * MINUTE).rain === 0) {
  assert(afterRain.wetness < wettest.wetness, 'the ground dries once the rain stops');
  assert(afterRain.mud / Math.max(0.001, wettest.mud) > afterRain.wetness / Math.max(0.001, wettest.wetness),
    'mud outlasts the wet sheen');
}
assert(muchLater.wetness <= wettest.wetness, 'hours later the ground is not wetter than in the downpour');

// --- Грунт, укрытия, закрепление ------------------------------------------------------------

const grounds = new Set(graph.zones.map(zone => zone.ground));
for (const ground of grounds) {
  assert(Object.prototype.hasOwnProperty.call(GROUND_MUD_FACTORS, ground), `zone ground ${ground} has a mud factor`);
}
assert(groundMudFactor('river_loam') > groundMudFactor('iron_scree'), 'loam turns to mud, scree does not');
assert(groundMudFactor('city') < groundMudFactor('tract_dust'), 'city streets are paved');
assert(groundMudFactor('unknown-ground') > 0 && groundMudFactor('unknown-ground') <= 1);

const storm = createWeather({ seed: 'kromka-1:weather', override: 'storm' });
const loam = storm.sampleAt(100, 100, T0, { mudFactor: groundMudFactor('river_loam') });
const street = storm.sampleAt(100, 100, T0, { mudFactor: groundMudFactor('city') });
assert.equal(loam.state, 'storm');
assert.equal(loam.forced, true);
assert(loam.mud > street.mud * 2, 'the same downpour makes far less mud on paved streets');
assert.equal(loam.puddles, street.puddles, 'puddles come from soaked soil, not from the ground type');
assert(loam.effects.moveSpeedMultiplier < street.effects.moveSpeedMultiplier, 'mud slows walkers more than streets do');
const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);
near(loam.effects.moveSpeedMultiplier, 1 - WEATHER_EFFECT_LIMITS.mudMovePenalty, 'full loam mud takes the whole walking penalty');
near(loam.effects.hearingMultiplier, 1 - WEATHER_EFFECT_LIMITS.rainHearingPenalty, 'a downpour masks footsteps');
near(loam.effects.visionMultiplier, 1 - WEATHER_EFFECT_LIMITS.rainVisionPenalty, 'a downpour shortens vision');
near(loam.effects.rangedAccuracyMultiplier, 1 - WEATHER_EFFECT_LIMITS.rainRangedPenalty, 'a downpour spoils aim');
for (const value of Object.values(loam.effects)) assert(value > 0.5 && value <= 1, 'weather never cripples a stat');

const sheltered = storm.sampleAt(100, 100, T0, { sheltered: true, mudFactor: 1 });
assert.equal(sheltered.sheltered, true);
assert.deepEqual(sheltered.effects, { moveSpeedMultiplier: 1, hearingMultiplier: 1, visionMultiplier: 1, rangedAccuracyMultiplier: 1 },
  'under a roof the rain outside changes nothing');
const shelteredIds = locations.locations.filter(weatherShelteredLocation).map(row => row.id).sort();
for (const id of ['coreLabSprout', 'coreLabCircuit', 'coreMarket', 'balanceBunker', 'antHive']) {
  assert(shelteredIds.includes(id), `${id} is underground or under a roof`);
}
for (const id of ['settlement', 'secondHaven', 'geckoCanyon', 'solarArray']) {
  assert(!shelteredIds.includes(id), `${id} is open to the sky`);
}

for (const state of WEATHER_STATES) {
  const pinned = createWeather({ override: state === 'clear' ? 'clear' : state }).sampleAt(1, 1, T0);
  assert.equal(pinned.state, state, `override ${state} pins that state`);
}
assert.equal(normalizeWeatherOverride('hail'), null, 'unknown weather is refused');
const live = createWeather({ seed: 'kromka-1:weather', override: 'storm' });
assert.equal(live.setOverride(null), null);
assert.deepEqual(live.sampleAt(40, 60, T0), weather.sampleAt(40, 60, T0), 'clearing the override returns the live field');

const calm = weather.sampleAt(40, 60, T0);
assert.equal(weatherChanged(null, calm), true, 'the first snapshot is always sent');
assert.equal(weatherChanged(calm, { ...calm, wetness: calm.wetness + 0.01 }), false, 'tiny drift is not broadcast');
assert.equal(weatherChanged(calm, { ...calm, wetness: calm.wetness + 0.05 }), true);
assert.equal(weatherChanged(calm, { ...calm, state: calm.state === 'storm' ? 'rain' : 'storm' }), true);
assert.deepEqual(weatherEffects(null), { moveSpeedMultiplier: 1, hearingMultiplier: 1, visionMultiplier: 1, rangedAccuracyMultiplier: 1 });

// --- Настоящие функции server.js ------------------------------------------------------------

const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
function functionSource(name) {
  const start = serverSource.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return serverSource.slice(start, serverSource.indexOf('\n}', start) + 2);
}
const stormEffects = loam.effects;
const stormRoom = { id: 'storm', weather: loam };
const clearRoom = { id: 'clear', weather: createWeather({ override: 'clear' }).sampleAt(40, 60, T0) };
const rooms = new Map([[stormRoom.id, stormRoom], [clearRoom.id, clearRoom]]);

const context = vm.createContext({
  PLAYER_SPEED: 7,
  PLAYER_COLLISION_RADIUS: 0.48,
  SERVER_WEAPONS: { fists: { range: 1 } },
  clamp: (value, min, max) => Math.max(min, Math.min(max, Number(value))),
  rooms,
  playerWorldExtent: () => 140,
  isArtifactStunned: () => false,
  serverArtifactEffects: () => ({ speedPct: 0 }),
  serverClosedLocationMovementBounds: () => null,
  serverPointInsideClosedLocationBounds: () => true,
  isRoomTerrainWalkableWorld: () => true,
  roomStaticCollisionMoveAllowed: () => true,
  roomEnemyCollisionMoveAllowed: () => true,
  enemyVisionRange: () => 10,
  serverSkillNorm: () => 0,
  serverTalentLevel: () => 0,
  targetInsideVisionArc: () => true,
  serverNpcIsNaturalCreature: () => false,
  roomHasHighLineOfSight: () => true,
  worldToTile: () => ({ tx: 0, tz: 0 }),
  roomTileDims: () => ({}),
  isCrouchedTargetHiddenBehindLowCover: () => false,
  serverActorHostileToPlayer: () => true,
  observePlayerThreat: () => {},
  playerThreatScore: () => 1,
  serverCombatWeaponCondition: () => 100,
  serverActiveWeaponSlot: () => 'primary',
  serverStatValue: () => 5,
  serverHasTrait: () => false,
  serverAmbushLevel: () => 0,
  serverWeaponSkillId: () => 'smallGuns',
  serverWeaponStrengthMissing: () => 0,
  sanitizeInjuries: () => ({}),
  serverAutomaticAccuracyPenalty: () => 0,
  serverIsShotgunWeapon: () => false
});
vm.runInContext([
  'clampPlayerVelocity', 'serverApplyMovementProposal', 'enemyCanSeePlayer', 'chooseVisibleEnemyTarget', 'serverHitChance'
].map(functionSource).join('\n') + '\nthis.api = { serverApplyMovementProposal, enemyCanSeePlayer, chooseVisibleEnemyTarget, serverHitChance };', context);
const api = context.api;

// Бюджет шага: пакет через 0,75 с (потолок паузы) — 7 * 0,75 * 1,35 + 0,22 м в ясную.
const step = (roomId, extra = {}) => {
  const player = { x: 0, z: 0, roomId, lastMovementProposalAt: 1000, ...extra };
  api.serverApplyMovementProposal(player, { x: 30, z: 0 }, 1750);
  return player.x;
};
const clearStep = step('clear');
const mudStep = step('storm');
assert(Math.abs(clearStep - (7 * 0.75 * 1.35 + 0.22)) < 1e-6, `a walker in clear weather keeps the full budget, got ${clearStep}`);
assert(Math.abs(mudStep - (7 * stormEffects.moveSpeedMultiplier * 0.75 * 1.35 + 0.22)) < 1e-6,
  `mud cuts the walking budget by the weather multiplier, got ${mudStep}`);
const riderStep = step('storm', { mountedVehicle: { speed: 11 } });
assert(Math.abs(riderStep - (11 * 0.75 * 1.35 + 0.22)) < 1e-6, 'a rider keeps the vehicle budget (vehicles are not slowed yet)');

// Обзор: враг с обзором 10 м видит игрока в 9 м в ясную и не видит в ливень.
const enemy = { x: 0, z: 0 };
const target = { x: 9, z: 0, hp: 100 };
assert.equal(api.enemyCanSeePlayer(clearRoom, enemy, target, 0), true, 'clear weather: seen at 9 m');
assert.equal(api.enemyCanSeePlayer(stormRoom, enemy, target, 0), false, 'downpour: 9 m is past the shortened vision');
assert.equal(api.enemyCanSeePlayer(stormRoom, enemy, { ...target, x: 7 }, 0), true, 'the downpour still shows a player at 7 m');
assert.equal(api.chooseVisibleEnemyTarget(stormRoom, enemy, [target], 0).target, null);
assert.equal(api.chooseVisibleEnemyTarget(clearRoom, enemy, [target], 0).target, target);

// Меткость игрока: тот же выстрел в ливень на множитель погоды хуже.
const rifle = { range: 20, ammoType: 'rifle' };
const shooter = room => ({ roomId: room.id, x: 0, z: 0 });
const clearChance = api.serverHitChance(shooter(clearRoom), { hp: 10 }, 12, rifle, { id: 'single' });
const stormChance = api.serverHitChance(shooter(stormRoom), { hp: 10 }, 12, rifle, { id: 'single' });
assert(Math.abs(stormChance - clearChance * stormEffects.rangedAccuracyMultiplier) < 1e-9,
  `rain lowers a ranged shot: ${clearChance} -> ${stormChance}`);
const clearPunch = api.serverHitChance(shooter(clearRoom), { hp: 10 }, 0.8, { range: 1 }, {});
assert.equal(api.serverHitChance(shooter(stormRoom), { hp: 10 }, 0.8, { range: 1 }, {}), clearPunch, 'melee ignores the rain');

// Меткость NPC — тем же множителем, но только у стрелкового оружия.
const npc = { special: { PE: 5 } };
const npcRifle = { ammoType: 'rifle', range: 20 };
const dryShot = npcAttackHitChance(npc, {}, npcRifle, 10, { attackRange: 20 });
const wetShot = npcAttackHitChance(npc, {}, npcRifle, 10, { attackRange: 20, accuracyMultiplier: stormEffects.rangedAccuracyMultiplier });
assert(Math.abs(wetShot - dryShot * stormEffects.rangedAccuracyMultiplier) < 1e-9, 'NPC shooters miss more in the rain');
assert.equal(npcAttackHitChance(npc, {}, {}, 1, { accuracyMultiplier: 0.5 }), npcAttackHitChance(npc, {}, {}, 1, {}),
  'NPC melee ignores the rain');

console.log(`Weather OK: deterministic field (rain ${(100 * rainy / SAMPLES).toFixed(1)}%, downpour ${(100 * storms / SAMPLES).toFixed(1)}%, `
  + `mean rain ${meanEpisode.toFixed(0)} min), soaking and drying, ${grounds.size} zone grounds, ${shelteredIds.length} sheltered places, `
  + 'mud walking budget, enemy vision and ranged accuracy for players and NPCs.');
