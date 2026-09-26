#!/usr/bin/env node
'use strict';

// Тиры на настоящем сервере: в локации тира 3 рудная жила даёт только руду
// тира 3, кирка ниже тира узла и навык «Рудокоп» ниже 30 получают отказ без
// траты ОД и износа, добыча начисляет опыт профессии по тиру, а враждебный
// налётчик этой локации сильнее своего базового тира и одет в снаряжение T3.
// Старых узлов (лом, вода, пища…) в комнате нет, недостающие семейства тиров
// дополнены узлами тира локации, а карта мира несёт тир каждой зоны и места:
// город — первый, прочие — опасность зоны или явная разметка locationTiers.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const h = require('./check-combat-runtime');
const tiers = require('../src/server/kromka-tiers');

const ROOT = path.resolve(__dirname, '..');
const LOCATION = 'tierArena';
const TIER = 3;
// Город самого опасного сектора: всё равно первый тир и свои узлы у стен.
const CITY = 'balanceBunker';
const NODE_ID = 'depot_scrap_01';
const { config, itemCatalog } = tiers.readTieredCatalogs(path.join(ROOT, 'data'));
const itemTier = id => itemCatalog.items.find(item => item.id === id)?.tier || 0;
const accounts = {};

function arenaWithTier() {
  const arena = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'locations', 'combatRuntimeArena.json'), 'utf8'));
  const depot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'locations', 'oldDepot.json'), 'utf8'));
  const raider = depot.objects.find(row => row.id === 'depot_raider_01');
  assert(raider, 'the depot raider row is gone');
  const objects = arena.objects.map(row => row.id === NODE_ID
    ? { ...row, resourceType: 'ore', tags: [...new Set([...(row.tags || []).filter(tag => tag !== 'scrap'), 'resource', 'ore'])] }
    : row);
  assert(objects.some(row => row.id === NODE_ID && row.resourceType === 'ore'), 'the arena lost its resource node');
  return { ...arena, id: LOCATION, name: 'Tier arena', tier: TIER, objects: [...objects, raider] };
}

function seed(state, tool, professionXp = {}) {
  state.currentLocationId = LOCATION;
  state.serverLocationContext = { locationId: LOCATION };
  state.inventory = { ...(state.inventory || {}), [tool]: 1 };
  state.equipment = { ...(state.equipment || {}), weapon: tool, offhand: '' };
  state.player = {
    ...(state.player || {}),
    x: 1,
    z: 11,
    itemConditions: { ...(state.player?.itemConditions || {}), [tool]: 100 }
  };
  state.professionXp = professionXp;
}

const harvest = account => h.socketAck(account.socket, 'harvestResource', { id: NODE_ID, skillRanks: {}, talentRanks: {} });

(async () => {
  await h.bootstrapCharacters(accounts);
  fs.writeFileSync(path.join(h.DATA_DIR, 'locations', `${LOCATION}.json`), JSON.stringify(arenaWithTier(), null, 2));
  const users = JSON.parse(fs.readFileSync(path.join(h.DATA_DIR, 'users.json'), 'utf8'));
  const savesPath = path.join(h.DATA_DIR, 'saves.json');
  const saves = JSON.parse(fs.readFileSync(savesPath, 'utf8'));
  const stateFor = role => saves.characters[users.users[accounts[role].login].id][accounts[role].characterId].state;
  const miner = tiers.professionXpForLevel(config, tiers.tierRow(config, TIER).level);
  seed(stateFor('target'), 'pickaxe');
  seed(stateFor('harvest'), 'pickaxeT3');
  seed(stateFor('trade'), 'pickaxeT3', { gatherMetal: miner });
  const citizen = stateFor('progression');
  citizen.currentLocationId = CITY;
  citizen.serverLocationContext = { locationId: CITY };
  if (citizen.player) { delete citizen.player.x; delete citizen.player.z; }
  fs.writeFileSync(savesPath, JSON.stringify(saves));

  await h.startServer();
  try {
    for (const role of ['target', 'harvest', 'trade']) {
      await h.connectAndJoin(accounts[role]);
      assert.equal(accounts[role].join.roomId, LOCATION, `${role} did not join the tier arena`);
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
    const cities = map.zones.filter(zone => zone.city);
    assert.equal(cities.length, 7, 'the world map has its seven cities');
    assert(map.zones.some(zone => !zone.city && zone.tier === 5) && map.zones.some(zone => !zone.city && zone.tier === 1),
      'the world map spans the tiers');
    console.log('PASS the world map carries the tier of every zone and place, cities are tier 1');

    // Город: первый тир при опасности сектора 5, узлы всех семейств, у стен.
    await h.connectAndJoin(accounts.progression);
    const city = accounts.progression.join;
    assert.equal(city.roomId.split(':')[0], CITY, 'the citizen joined the city');
    assert.equal(city.worldState?.tier, 1, 'a city is tier 1 whatever its sector danger');
    const cityNodes = city.worldState?.resources || [];
    for (const type of ['ore', 'wood', 'fiber', 'oil']) {
      const rows = cityNodes.filter(row => row.type === type);
      assert(rows.length >= 2 && rows.every(row => row.tier === 1), `the city grows T1 ${type}: ` + JSON.stringify(cityNodes));
    }
    console.log(`PASS the city holds tier 1 nodes of every family (${cityNodes.length})`);

    // Кирка T2 не берёт жилу тира 3: отказ до траты ОД и износа.
    const lowTool = await harvest(accounts.target);
    assert(!lowTool.ok && /тира 3/.test(lowTool.error), 'a T2 pickaxe must not mine T3 ore: ' + JSON.stringify(lowTool).slice(0, 200));
    assert.equal(Number(lowTool.self?.itemConditions?.pickaxe ?? 100), 100, 'a refused hit does not wear the tool');
    console.log('PASS a tool below the node tier is refused');

    // Кирка T3 есть, но «Рудокоп» ниже 30.
    const lowSkill = await harvest(accounts.harvest);
    assert(!lowSkill.ok && /Тир 3 требует навык «Рудокоп» 30/.test(lowSkill.error),
      'mining T3 needs Miner 30: ' + JSON.stringify(lowSkill).slice(0, 200));
    console.log('PASS the profession level gates the node tier');

    // Всё сходится: руда тира 3 и опыт профессии по тиру.
    const mined = await harvest(accounts.trade);
    assert(mined.ok, 'a T3 miner with a T3 pickaxe mines: ' + JSON.stringify(mined).slice(0, 300));
    assert.equal(mined.item.id, 'oreT3', 'the node yields ore of its tier');
    assert.equal(mined.profession?.id, 'gatherMetal');
    assert.equal(mined.profession.gained, tiers.professionXpForWork(config, TIER, mined.item.qty), 'xp follows the node tier');
    const miningView = (mined.self?.professions || []).find(row => row.id === 'gatherMetal');
    assert.equal(miningView?.xp, miner + mined.profession.gained, 'the player sees the profession xp');
    assert.equal(miningView?.maxTier, TIER);
    assert(Number(mined.self?.itemConditions?.pickaxeT3) < 100, 'a successful hit wears the tool');
    console.log('PASS a T3 miner gets T3 ore and tiered profession xp');

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
  console.log('Kromka tiers network OK: node tier from the location, only tiered nodes with every family, tier on the world map and in the room state, tool tier and profession gates, tiered yield and xp, saved professions, tier-scaled raiders.');
})().catch(error => {
  console.error(error);
  console.error(h.serverLogs?.().slice(-3000));
  h.cleanupSync();
  process.exit(1);
});
