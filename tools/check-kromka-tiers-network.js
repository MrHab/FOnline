#!/usr/bin/env node
'use strict';

// Тиры на настоящем сервере: в локации тира 3 рудная жила даёт только руду
// тира 3, навык «Рудокоп» ниже 30 получает отказ, кирка T1 сбор не начинает,
// кирка T2 (тир ниже) добывает с базовым циклом, а кирка T3 ускоряет его, добыча идёт циклами (как в
// Albion) и начисляет опыт профессии по тиру. Жилу T1 берут голыми руками, и её
// опыт идёт только до уровня, открывающего T2. А враждебный
// налётчик этой локации сильнее своего базового тира и одет в снаряжение T3.
// Старых узлов (лом, вода, пища…) в комнате нет, недостающие семейства тиров
// дополнены узлами тира локации, а карта мира несёт тир каждой зоны и места:
// город — первый, прочие — опасность зоны или явная разметка locationTiers.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const tiers = require('../src/server/kromka-tiers');
const gathering = require('../src/server/gathering');
const zoneGrounds = require('../src/server/zone-grounds');
const GROUNDS = zoneGrounds.normalizeGrounds(require('../data/kromka/grounds.json'));

const ROOT = path.resolve(__dirname, '..');
const LOCATION = 'tierArena';
const TIER = 3;
// Такая же арена тира 1: голые руки и потолок опыта T1.
const LOCATION_T1 = 'tierArenaT1';
const TOOL_GROUPS = new Set(['pickaxe', 'axe', 'sickle', 'handPump', 'skinningKnife']);
// Город фракции: первый тир и узлы семейств своих угодий у стен.
const CITY = 'relayStation';
const NODE_ID = 'depot_scrap_01';
const { config, itemCatalog } = tiers.readTieredCatalogs(path.join(ROOT, 'data'));
const itemTier = id => itemCatalog.items.find(item => item.id === id)?.tier || 0;
const accounts = {};

function arenaWithTier(tier = TIER, id = LOCATION) {
  const arena = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'locations', 'combatRuntimeArena.json'), 'utf8'));
  const depot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'locations', 'oldDepot.json'), 'utf8'));
  const raider = depot.objects.find(row => row.id === 'depot_raider_01');
  assert(raider, 'the depot raider row is gone');
  const objects = arena.objects.map(row => row.id === NODE_ID
    ? { ...row, resourceType: 'ore', tags: [...new Set([...(row.tags || []).filter(tag => tag !== 'scrap'), 'resource', 'ore'])] }
    : row);
  assert(objects.some(row => row.id === NODE_ID && row.resourceType === 'ore'), 'the arena lost its resource node');
  return { ...arena, id, name: `Tier ${tier} arena`, tier, objects: [...objects, raider] };
}

function seed(state, tool, professionXp = {}, location = LOCATION) {
  state.currentLocationId = location;
  state.serverLocationContext = { locationId: location };
  // Голые руки: ни одного инструмента сбора ни в сумке, ни в руках.
  const bag = Object.fromEntries(Object.entries(state.inventory || {}).filter(([id]) =>
    !TOOL_GROUPS.has(itemCatalog.items.find(item => item.id === id)?.tierGroup || id)));
  state.inventory = tool === 'fists' ? bag : { ...bag, [tool]: 1 };
  state.equipment = { ...(state.equipment || {}), weapon: tool, offhand: '' };
  state.player = {
    ...(state.player || {}),
    x: 1,
    z: 11,
    itemConditions: { ...(state.player?.itemConditions || {}), [tool]: 100 }
  };
  state.professionXp = professionXp;
}

const startGather = account => h.socketAck(account.socket, 'startGather', { id: NODE_ID });
const harvest = account => h.socketAck(account.socket, 'harvestResource', { id: NODE_ID, skillRanks: {}, talentRanks: {} });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  await h.bootstrapCharacters(accounts);
  fs.writeFileSync(path.join(h.DATA_DIR, 'locations', `${LOCATION}.json`), JSON.stringify(arenaWithTier(), null, 2));
  fs.writeFileSync(path.join(h.DATA_DIR, 'locations', `${LOCATION_T1}.json`), JSON.stringify(arenaWithTier(1, LOCATION_T1), null, 2));
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const miner = tiers.professionXpForLevel(config, tiers.tierRow(config, TIER).level);
  seed(stateFor('target'), 'pickaxeT1', { gatherMetal: miner });
  seed(stateFor('legacyMix'), 'pickaxe', { gatherMetal: miner });
  seed(stateFor('harvest'), 'pickaxeT3');
  seed(stateFor('trade'), 'pickaxeT3', { gatherMetal: miner });
  const t2Unlock = tiers.professionXpForLevel(config, tiers.tierRow(config, 2).level);
  seed(stateFor('modification'), 'fists', {}, LOCATION_T1);
  seed(stateFor('cadence'), 'fists', { gatherMetal: t2Unlock }, LOCATION_T1);
  const citizen = stateFor('progression');
  citizen.currentLocationId = CITY;
  citizen.serverLocationContext = { locationId: CITY };
  if (citizen.player) { delete citizen.player.x; delete citizen.player.z; }
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    for (const role of ['target', 'harvest', 'trade', 'legacyMix']) {
      await h.connectAndJoin(accounts[role]);
      assert.equal(accounts[role].join.roomId, LOCATION, `${role} did not join the tier arena`);
    }
    for (const role of ['modification', 'cadence']) {
      await h.connectAndJoin(accounts[role]);
      assert.equal(accounts[role].join.roomId, LOCATION_T1, `${role} did not join the T1 arena`);
    }
    const node = (accounts.trade.join.worldState?.resources || []).find(row => row.id === NODE_ID);
    assert(node && node.type === 'ore' && node.tier === TIER, 'the ore node carries the location tier: ' + JSON.stringify(node));
    assert.equal(accounts.trade.join.worldState?.tier, TIER, 'the room state names the location tier');

    // Только семейства тиров, все — тира локации, каждого семейства хватает.
    const resources = accounts.trade.join.worldState?.resources || [];
    const families = new Set(config.families.map(family => family.resourceType).filter(Boolean));
    for (const row of resources) {
      assert(families.has(row.type), `an old resource node is left in the room: ${JSON.stringify(row)}`);
      assert.equal(row.tier, TIER, `a node of the room carries its tier: ${JSON.stringify(row)}`);
    }
    for (const type of ['ore', 'wood', 'fiber', 'oil']) {
      assert(resources.filter(row => row.type === type).length >= 2, `the room has ${type} nodes: `
        + JSON.stringify(resources.map(row => `${row.id}:${row.type}`)));
    }
    console.log('PASS the room holds only tiered nodes of its tier, every family present');

    // Карта мира: тир у каждой зоны и места; город — первый, зона — её опасность.
    const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'kromka', 'zone-graph.json'), 'utf8'));
    const difficulty = new Map(graph.zones.map(zone => [zone.city || zone.id, zone.difficulty]));
    const response = await fetch(`${h.baseUrl()}/api/world-map`);
    const map = (await response.json()).map;
    for (const zone of map.zones) {
      const expected = zone.city ? 1 : config.locationTiers[zone.id] || difficulty.get(zone.id);
      assert.equal(zone.tier, expected, `zone ${zone.id} carries its tier on the world map`);
      for (const place of zone.places) {
        assert.equal(place.tier, config.locationTiers[place.id] || (zone.city ? 1 : difficulty.get(zone.id)),
          `place ${place.id} carries its tier on the world map`);
      }
    }
    // Угодья: у каждой зоны, кроме Ключей, — угодья клина и три семейства.
    for (const zone of map.zones) {
      const expected = GROUNDS.zones[zone.id];
      if (zone.city) continue;
      assert.equal(zone.grounds?.id || '', expected || '', `zone ${zone.id} carries its grounds on the world map`);
      if (expected) assert.deepEqual(zone.grounds.families, [...GROUNDS.grounds[expected].families]);
      assert.equal(zone.hotspot?.family || '', GROUNDS.hotspots[zone.id]?.family || '', `zone ${zone.id} carries its hotspot`);
    }
    const cities = map.zones.filter(zone => zone.city);
    assert.equal(cities.length, 6, 'the world map has its six cities');
    assert(map.zones.some(zone => !zone.city && zone.tier === 5) && map.zones.some(zone => !zone.city && zone.tier === 1),
      'the world map spans the tiers');
    console.log('PASS the world map carries the tier of every zone and place, cities are tier 1');

    // Город: первый тир при любой опасности сектора, узлы семейств угодий, у стен.
    await h.connectAndJoin(accounts.progression);
    const city = accounts.progression.join;
    assert.equal(city.roomId.split(':')[0], CITY, 'the citizen joined the city');
    assert.equal(city.worldState?.tier, 1, 'a city is tier 1 whatever its sector danger');
    const cityNodes = city.worldState?.resources || [];
    // Город растит семейства своих угодий — угодий сектора, где он стоит.
    const cityZone = graph.zones.find(zone => zone.city === CITY);
    const cityGround = zoneGrounds.groundsFor(GROUNDS, { zoneId: cityZone.id });
    for (const type of ['ore', 'wood', 'fiber', 'oil']) {
      const rows = cityNodes.filter(row => row.type === type);
      if (cityGround.families.includes(type)) {
        assert(rows.length >= 2 && rows.every(row => row.tier === 1), `the city grows T1 ${type}: ` + JSON.stringify(cityNodes));
      } else {
        assert.equal(rows.length, 0, `the city grows no ${type}, its grounds lack it: ` + JSON.stringify(cityNodes));
      }
    }
    const { TILES, WALL_HALF } = require('../src/server/city-builder');
    const outside = cityNodes.filter(row => Math.abs(row.tx - TILES / 2) >= WALL_HALF || Math.abs(row.tz - TILES / 2) >= WALL_HALF);
    assert.deepEqual(outside, [], 'every city node stands inside the city wall');
    console.log(`PASS the city holds tier 1 nodes of its grounds' families (${cityGround.id}: ${cityNodes.length})`);

    // Жиле T3 нужна кирка T2 или выше: кирка T1 сбор не начинает.
    const lowTool = await startGather(accounts.target);
    assert.equal(itemTier('pickaxeT1'), 1);
    assert(!lowTool.ok && lowTool.error === `Для добычи руды нужна кирка тира ${TIER - 1} или выше. У вас — тира 1.`,
      'a T3 vein needs at least a T2 pickaxe: ' + JSON.stringify(lowTool).slice(0, 200));
    const lowToolCycle = await harvest(accounts.target);
    assert(!lowToolCycle.ok && lowToolCycle.stop, 'no cycle counts without the right tool: ' + JSON.stringify(lowToolCycle).slice(0, 200));
    // Кирка T2 (тиром ниже жилы) открывает её, но не ускоряет и не изнашивается.
    assert.equal(itemTier('pickaxe'), TIER - 1);
    const belowTool = await startGather(accounts.legacyMix);
    assert(belowTool.ok && belowTool.tool === null && belowTool.cycleMs === gathering.gatherCycleMs(config, TIER, 0),
      'a T2 pickaxe mines a T3 vein at the base pace: ' + JSON.stringify(belowTool).slice(0, 200));
    await h.socketAck(accounts.legacyMix.socket, 'stopGather', {});
    console.log('PASS a T3 vein refuses a T1 pickaxe and takes a T2 one at the base pace');

    // Кирка T3 есть, но «Рудокоп» ниже 30.
    const lowSkill = await startGather(accounts.harvest);
    assert(!lowSkill.ok && /Тир 3 требует навык «Рудокоп» 30/.test(lowSkill.error),
      'mining T3 needs Miner 30: ' + JSON.stringify(lowSkill).slice(0, 200));
    console.log('PASS the profession level gates the node tier');

    // Всё сходится: кирка T3 ускоряет цикл, руда тира 3 и опыт профессии по тиру.
    // Сосед по комнате видит сбор: событие начала и конца и поле снимка.
    const seen = [];
    const onGathering = payload => { if (payload?.id === accounts.trade.socket.id) seen.push(payload); };
    accounts.target.socket.on('playerGathering', onGathering);
    const started = await startGather(accounts.trade);
    assert(started.ok && started.tool?.id === 'pickaxeT3' && started.cycleMs === gathering.gatherCycleMs(config, TIER, TIER),
      'a pickaxe of the node tier speeds the cycle: ' + JSON.stringify(started).slice(0, 200));
    await wait(80);
    assert(seen.length === 1 && seen[0].type === 'ore' && seen[0].cycleMs === started.cycleMs,
      'the room hears that the miner started gathering ore: ' + JSON.stringify(seen));
    await wait(started.cycleMs);
    const mined = await harvest(accounts.trade);
    assert(mined.ok, 'a T3 miner with a T3 pickaxe mines: ' + JSON.stringify(mined).slice(0, 300));
    assert.equal(mined.item.id, 'oreT3', 'the node yields ore of its tier');
    assert.equal(mined.profession?.id, 'gatherMetal');
    assert.equal(mined.profession.gained, tiers.professionXpForWork(config, TIER, mined.item.qty), 'xp follows the node tier');
    const miningView = (mined.self?.professions || []).find(row => row.id === 'gatherMetal');
    assert.equal(miningView?.xp, miner + mined.profession.gained, 'the player sees the profession xp');
    assert.equal(miningView?.maxTier, TIER);
    assert(Number(mined.self?.itemConditions?.pickaxeT3) < 100, 'a gather cycle wears the helping tool');
    console.log('PASS a T3 miner gets T3 ore and tiered profession xp');
    await h.socketAck(accounts.trade.socket, 'stopGather', {});
    await wait(80);
    accounts.target.socket.off('playerGathering', onGathering);
    assert(seen.length === 2 && seen[1].type === '', 'the room hears that the miner stopped: ' + JSON.stringify(seen));
    console.log('PASS the room sees a neighbour start and stop gathering');

    // Жила T1 — голыми руками: без единого инструмента сбор идёт с базовым циклом
    // и учит «Рудокопа» по тиру T1.
    const t1Node = (accounts.modification.join.worldState?.resources || []).find(row => row.id === NODE_ID);
    assert(t1Node && t1Node.tier === 1, 'the T1 arena vein is tier 1: ' + JSON.stringify(t1Node));
    const bareStart = await startGather(accounts.modification);
    assert(bareStart.ok && bareStart.tool === null && bareStart.cycleMs === gathering.gatherCycleMs(config, 1, 0),
      'a T1 vein is gathered bare-handed: ' + JSON.stringify(bareStart).slice(0, 200));
    await wait(bareStart.cycleMs);
    const bareMined = await harvest(accounts.modification);
    assert(bareMined.ok && bareMined.item.id === 'ore', 'bare hands mine T1 ore: ' + JSON.stringify(bareMined).slice(0, 300));
    assert.equal(bareMined.profession?.gained, tiers.professionXpForWork(config, 1, bareMined.item.qty), 'T1 work teaches the Miner');
    assert.equal(bareMined.profession.capped, undefined);
    await h.socketAck(accounts.modification.socket, 'stopGather', {});
    console.log('PASS a T1 vein is mined bare-handed and teaches the profession');

    // Рудокоп, уже открывший T2, на жиле T1 добывает, но опыта T1 больше не получает.
    const capStart = await startGather(accounts.cadence);
    assert(capStart.ok, 'a T2 miner still mines T1: ' + JSON.stringify(capStart).slice(0, 200));
    await wait(capStart.cycleMs);
    const capMined = await harvest(accounts.cadence);
    assert(capMined.ok && capMined.item.id === 'ore', 'the T1 ore is still mined: ' + JSON.stringify(capMined).slice(0, 300));
    assert.equal(capMined.profession?.gained, 0, 'T1 work teaches nothing past the T2 level');
    assert.equal(capMined.profession.capped, true);
    assert.equal(capMined.profession.capTier, 2);
    const capView = (capMined.self?.professions || []).find(row => row.id === 'gatherMetal');
    assert.equal(capView?.xp, t2Unlock, 'the profession stays at the T2 level');
    assert.equal(capView?.maxTier, 2);
    await h.socketAck(accounts.cadence.socket, 'stopGather', {});
    console.log(`PASS T1 work teaches only up to level ${tiers.tierRow(config, 2).level}, where T2 opens`);

    // Налётчик локации тира 3: сила и снаряжение этого тира.
    const enemies = accounts.trade.join.worldState?.enemies || accounts.trade.join.enemies || [];
    const raider = enemies.find(row => row.tier === TIER);
    assert(raider, 'a hostile raider of the tier arena carries its tier: '
      + JSON.stringify(enemies.map(row => ({ id: row.id, tier: row.tier, name: row.name, hostile: row.hostileToPlayer }))));
    const scale = tiers.enemyTierScale(config, 'raider', TIER);
    assert(Number(raider.maxHp) >= Math.floor(55 * scale.hp * 0.8), `the raider is stronger than T1: ${raider.maxHp}`);
    const weapon = raider.equipment?.weapon || '';
    assert(weapon && weapon !== 'fists', 'the raider is armed');
    assert.equal(itemTier(weapon), TIER, `the raider carries a T${TIER} weapon, not ${weapon}`);
    console.log('PASS the hostile raider is scaled to the location tier');
  } finally {
    for (const account of Object.values(accounts)) h.closeSocket(account);
    // Отключение сохраняет персонажа не мгновенно: даём записи дойти до диска.
    await new Promise(resolve => setTimeout(resolve, 2500));
    await h.stopServer();
  }

  const saved = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
  const xp = saved.characters[users.users[accounts.trade.login].id][accounts.trade.characterId].state.professionXp;
  assert(Number(xp?.gatherMetal) > miner, 'profession xp survives the save: ' + JSON.stringify(xp));
  h.cleanupSync();
  console.log('Kromka tiers network OK: node tier from the location, only tiered nodes with every family, tier on the world map and in the room state, profession gate, a tool one tier below the node above T1 and bare hands on T1, timed tiered yield and the xp ladder, saved professions, tier-scaled raiders.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
