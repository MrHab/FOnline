#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWastelandSimulation } = require('../src/server/wasteland-sim');

const worldPartyRendererSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '11e_global_map_tasks_dynamic_render.js'), 'utf8');
const worldPartyStatusSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '12a_global_map_world_status.js'), 'utf8');
const globalMapPlayerModelSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '11a_global_map_player_models.js'), 'utf8');
const globalMapDynamicCacheSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '11b_global_map_static_scene_camera.js'), 'utf8');
const globalMapCanvasSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'game', '12_global_map_canvas_controls.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'realm-of-ashes-autonomy-'));

function testMap() {
  const cells = {};
  for (let cy = 0; cy < 30; cy += 1) {
    for (let cx = 0; cx < 30; cx += 1) {
      cells[`${cx}:${cy}`] = {
        terrain: 'Пустошь',
        texture: 'grass',
        territoryOwner: 'neutral',
        difficulty: 1
      };
    }
  }
  return {
    grid: { cols: 30, rows: 30, cellPoints: 30, cellKm: 10 },
    nodes: [],
    infrastructure: [],
    cells
  };
}

function site(id, x, y, options = {}) {
  return {
    id,
    type: options.type || 'pointOfInterest',
    name: options.name || id,
    x,
    y,
    owner: options.owner || 'neutral',
    locationId: options.locationId || 'randomAshGrove',
    pvpMode: 'pvp',
    security: options.security ?? 30,
    danger: options.danger ?? 1,
    stockpile: { ...(options.stockpile || {}) },
    output: { ...(options.output || {}) },
    ...(options.extra || {})
  };
}

function party(id, kind, faction, x, y, options = {}) {
  return {
    id,
    name: options.name || id,
    kind,
    faction,
    state: options.state || (kind === 'monster' ? 'roaming' : kind === 'raider' ? 'hunting' : 'moving'),
    x,
    y,
    speedKmh: options.speedKmh ?? 40,
    baseSpeedKmh: options.speedKmh ?? 40,
    speedProfileVersion: 2,
    strength: options.strength ?? 60,
    members: options.members ?? 5,
    homeSiteId: options.homeSiteId || '',
    destinationSiteId: options.destinationSiteId || '',
    targetPartyId: options.targetPartyId || '',
    nextDecisionHour: options.nextDecisionHour ?? 999,
    route: options.route || [],
    routeIndex: 0,
    cargo: options.cargo || {},
    playerMembers: [],
    ...(options.extra || {})
  };
}

function simulation(name) {
  const map = testMap();
  const sim = createWastelandSimulation({
    stateFile: path.join(tempRoot, `${name}.json`),
    getGlobalMap: () => map,
    gameDayRealMs: 60 * 60 * 1000
  });
  const state = sim.state();
  state.worldHour = 100;
  state.parties = {};
  state.worldZones = [];
  state.worldTasks = [];
  state.events = [];
  return { sim, state };
}

function pointSegmentDistance(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.000001) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

function assertIntermediateSiteEntry() {
  const { sim, state } = simulation('site-entry');
  state.sites.crossing = site('crossing', 450, 90);
  state.sites.destination = site('destination', 660, 90);
  state.parties.support = party('support', 'support', 'old_klim', 360, 90, {
    speedKmh: 42,
    strength: 24,
    members: 3,
    destinationSiteId: 'destination',
    extra: { supportSiteId: 'destination' }
  });

  sim.tick(Date.now() + 1000, { hours: 1, force: true });

  const support = state.parties.support;
  assert(support, 'support party disappeared before reaching its mission site');
  assert.strictEqual(support.state, 'onsite', 'party did not enter an incidental location whose circle it crossed');
  assert.strictEqual(support.onsiteSiteId, 'crossing', 'party skipped the first touched location circle');
  assert(state.worldZones.some(zone => zone.status === 'active' && zone.details?.onsiteParty && zone.partyId === support.id),
    'entering a site did not create a shared onsite reality');
}

function assertCapturedSiteExitDoesNotRetrigger() {
  const { sim, state } = simulation('captured-site-exit');
  state.sites.target = site('target', 390, 90, { owner: 'old_klim', security: 15 });
  state.parties.monsters = party('monsters', 'monster', 'wild', 360, 90, {
    speedKmh: 48,
    destinationSiteId: 'target',
    strength: 120,
    members: 8
  });

  sim.tick(Date.now() + 1000, { hours: 0.1, force: true });

  const monsters = state.parties.monsters;
  const zone = state.worldZones.find(row => row.id === monsters.onsiteZoneId);
  assert(zone?.details?.simBattle, 'hostile site entry did not start a live site battle');
  const snapshots = (zone.details.actors || []).map(actor => ({
    actorId: actor.id,
    hp: actor.side === 'defender' ? 0 : actor.maxHp,
    maxHp: actor.maxHp,
    dead: actor.side === 'defender'
  }));
  sim.syncBattleZoneActors({ worldZoneId: zone.id, roomId: zone.roomId, actors: snapshots });

  assert.strictEqual(monsters.state, 'onsite', 'winning party returned to the global map before leaving the captured location');
  assert.strictEqual(zone.status, 'active', 'captured location zone closed before the winning actors could walk out');
  assert.strictEqual(zone.details?.departureRequested, true, 'winning party did not request a physical exit after the battle');
  const departure = sim.completeOnsitePartyDeparture({
    worldZoneId: zone.id,
    roomId: zone.roomId,
    reason: 'captured_site_exit',
    actors: snapshots
  });
  assert.strictEqual(departure?.ok, true, 'winning party physical exit was not acknowledged');
  assert.notStrictEqual(monsters.state, 'onsite', 'winning party remained inside the captured location trigger');
  assert.strictEqual(monsters.siteExitIgnoreId, 'target', 'captured location did not receive an exit re-entry guard');
  assert(Math.hypot(monsters.x - state.sites.target.x, monsters.y - state.sites.target.y) > 20,
    'winning party was not placed outside the captured location circle');
  sim.tick(Date.now() + 2000, { hours: 0.01, force: true });
  assert.notStrictEqual(monsters.state, 'onsite', 'winning party immediately fell back into the captured location');
}

function assertCompletedVisitChoosesAnotherLocation() {
  const { sim, state } = simulation('completed-site-visit');
  state.sites.current = site('current', 390, 90, { owner: 'old_klim' });
  state.sites.alternate = site('alternate', 480, 90, { owner: 'old_klim' });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 360, 90, {
    speedKmh: 48,
    destinationSiteId: 'current',
    nextDecisionHour: 999
  });

  sim.tick(Date.now() + 1000, { hours: 0.1, force: true });
  const patrol = state.parties.patrol;
  assert.strictEqual(patrol.state, 'onsite', 'party did not enter the destination before the completed-visit check');
  patrol.onsiteUntilHour = state.worldHour;
  sim.tick(Date.now() + 2000, { hours: 0.01, force: true });

  const departingZone = state.worldZones.find(row => row.id === patrol.onsiteZoneId);
  assert.strictEqual(patrol.state, 'onsite', 'party left the global site before its local actors reached an exit');
  assert.strictEqual(departingZone?.details?.departureRequested, true, 'completed site work did not request a physical local exit');
  const departure = sim.completeOnsitePartyDeparture({
    worldZoneId: departingZone.id,
    roomId: departingZone.roomId,
    reason: 'test_physical_exit',
    actors: (departingZone.details?.actors || []).map((actor, index) => ({
      actorId: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      dead: actor.dead,
      inventory: index === 0 ? [{ id: 'scrap', qty: 3 }] : actor.inventory
    }))
  });

  assert.strictEqual(departure?.ok, true, 'server could not acknowledge the local party exit');
  assert(patrol.actorSnapshots?.some(actor => actor.inventory?.some(row => row.id === 'scrap' && row.qty === 3)),
    'items carried by a local party actor were lost when the party returned to the global map');
  assert.notStrictEqual(patrol.state, 'onsite', 'party stayed inside a completed location visit');
  assert.notStrictEqual(patrol.destinationSiteId, 'current', 'party immediately selected the location it had just left');
  assert.strictEqual(patrol.siteExitIgnoreId, 'current', 'completed visit did not receive a re-entry guard');
  sim.tick(Date.now() + 3000, { hours: 0.01, force: true });
  assert.notStrictEqual(patrol.state, 'onsite', 'party immediately re-entered the location it had just left');
}

function assertStagingCaravanLeavesThroughLocalExit() {
  const { sim, state } = simulation('staging-caravan-local-exit');
  state.sites.staging = site('staging', 390, 90, {
    owner: 'old_klim',
    locationId: 'world_staging'
  });
  state.sites.destination = site('destination', 570, 90, {
    owner: 'old_klim',
    locationId: 'world_destination'
  });
  state.parties.caravan = party('caravan', 'caravan', 'old_klim', 390, 90, {
    state: 'staging',
    speedKmh: 48,
    destinationSiteId: 'destination',
    homeSiteId: 'staging',
    cargo: { water: 20 },
    extra: {
      lastSiteId: 'staging',
      stagingSiteId: 'staging',
      stagingStartedHour: 100,
      stagingUntilHour: 100.05,
      stagingMinPlayers: 5,
      stagingJoinClosed: false
    }
  });

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });
  const caravan = state.parties.caravan;
  const zone = state.worldZones.find(row => row.id === caravan.onsiteZoneId);
  assert.strictEqual(caravan.state, 'onsite', 'legacy/global-only staging caravan did not materialize inside the staging location');
  assert(zone?.details?.onsiteParty, 'staging caravan has no local actor zone');
  const escortTaskId = 'escort_caravan_test';
  caravan.stagingTaskId = escortTaskId;
  state.worldTasks.push({
    id: escortTaskId,
    key: escortTaskId,
    type: 'escort_caravan',
    status: 'active',
    title: 'Test escort',
    siteId: 'staging',
    issuerSiteId: 'staging',
    partyId: caravan.id,
    createdHour: state.worldHour,
    expiresHour: state.worldHour + 24,
    reward: { xp: 1, caps: 1, reputation: 0 },
    details: {}
  });

  const joined = sim.joinWorldParty({
    taskId: escortTaskId,
    partyId: caravan.id,
    playerId: 'escort-player',
    userId: 'escort-account',
    characterId: 'escort-character',
    name: 'Escort',
    factionId: 'old_klim'
  });
  assert.strictEqual(joined?.ok, true,
    'caravan became impossible to join while its actors were visibly waiting inside the location');

  sim.tick(Date.now() + 2000, { hours: 0.05, force: true });
  assert.strictEqual(caravan.state, 'onsite',
    'staging caravan teleported straight onto the global map when its wait ended');
  assert.strictEqual(caravan.stagingJoinClosed, true,
    'staging caravan kept accepting escorts after starting its local exit');
  assert.strictEqual(zone.details?.departureRequested, true,
    'staging caravan did not request a physical local exit');

  sim.tick(Date.now() + 3000, { hours: 0.45, force: true });
  assert.notStrictEqual(caravan.state, 'onsite',
    'staging caravan stayed trapped inside the location after the physical-exit fallback elapsed');
  assert.strictEqual(zone.status, 'resolved',
    'staging caravan local zone stayed active after all actors left');
  assert(Math.hypot(caravan.x - state.sites.staging.x, caravan.y - state.sites.staging.y) > 20,
    'staging caravan returned onto the global map inside the same location trigger');
}

function assertDynamicSupplyCaravanCompletesLinkedOperation() {
  const { sim, state } = simulation('dynamic-supply-caravan-operation');
  state.sites = {
    settlement: site('settlement', 510, 90, {
      type: 'settlement',
      owner: 'old_klim',
      locationId: 'world_supply_destination',
      stockpile: { water: 2, medicine: 0, silver: 500 },
      extra: { prosperity: 45 }
    }),
    supply_source: site('supply_source', 390, 90, {
      type: 'resource',
      owner: 'old_klim',
      locationId: 'world_supply_source',
      stockpile: { water: 78 },
      output: { water: 1 },
      extra: {
        resourceExportProgress: 3,
        lastResourceExportHour: 0
      }
    })
  };
  state.worldTasks = [
    {
      id: 'deliver_water_request',
      key: 'deliver_water_request',
      type: 'deliver_supplies',
      status: 'active',
      title: 'Water delivery request',
      siteId: 'settlement',
      issuerSiteId: 'settlement',
      createdHour: 99,
      expiresHour: 200,
      priority: 3,
      reward: {},
      details: { demand: { water: 60 } }
    },
    {
      id: 'deliver_medicine_request',
      key: 'deliver_medicine_request',
      type: 'deliver_supplies',
      status: 'active',
      title: 'Medicine delivery request',
      siteId: 'settlement',
      issuerSiteId: 'settlement',
      createdHour: 98,
      expiresHour: 200,
      priority: 5,
      reward: {},
      details: { demand: { medicine: 12 } }
    }
  ];

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const caravan = Object.values(state.parties).find(row => row?.resourceExport
    && row.resourceSourceSiteId === 'supply_source');
  assert(caravan, 'resource surplus did not create a dynamic supply caravan');
  assert.strictEqual(caravan.dynamic, true, 'resource export caravan is not marked as dynamic');
  assert.deepStrictEqual(caravan.cargo, { water: 60 },
    'dynamic caravan cargo does not match the requested supply kind and amount');

  const escortTask = state.worldTasks.find(task => task?.type === 'escort_caravan' && task.partyId === caravan.id);
  const waterTask = state.worldTasks.find(task => task?.id === 'deliver_water_request');
  const medicineTask = state.worldTasks.find(task => task?.id === 'deliver_medicine_request');
  const preparingOperation = escortTask?.details?.operation;
  assert(escortTask && preparingOperation, 'dynamic caravan has no escort task backed by a world operation');
  assert.strictEqual(preparingOperation.phase, 'preparing', 'new supply operation did not start in preparation');
  assert.strictEqual(preparingOperation.requestTaskId, waterTask.id,
    'escort operation did not link to the matching delivery request');
  assert.strictEqual(preparingOperation.escortTaskId, escortTask.id,
    'delivery operation did not retain its escort task link');
  assert.deepStrictEqual(preparingOperation.demand, { water: 60 },
    'operation did not expose the delivery request demand');
  assert.deepStrictEqual(preparingOperation.cargo, { water: 60 },
    'operation cargo diverged from the caravan cargo');
  assert.strictEqual(waterTask.details?.operationId, preparingOperation.id,
    'matching delivery request was not assigned to the caravan operation');
  assert.strictEqual(waterTask.details?.escortTaskId, escortTask.id,
    'matching delivery request was not linked back to its escort task');
  assert.strictEqual(medicineTask.details?.operationId, undefined,
    'non-matching medicine request was incorrectly assigned to a water caravan');

  const publicPreparing = sim.publicState().parties.find(row => row.id === caravan.id);
  assert.strictEqual(publicPreparing?.leaderName, 'Караванщик',
    'dynamic caravan does not expose the generic caravan leader');
  assert.strictEqual(preparingOperation.assignment?.leaderName, 'Караванщик',
    'world operation is not assigned to the generic caravan leader');
  assert.strictEqual(publicPreparing?.operationId, preparingOperation.id,
    'public caravan state lost the operation identity');
  assert.strictEqual(publicPreparing?.operationPhase, 'preparing',
    'public caravan state does not expose the preparation phase');
  assert(publicPreparing?.operationStageLabel,
    'public caravan state does not expose a readable operation stage');

  const onsiteZone = state.worldZones.find(zone => zone.id === caravan.onsiteZoneId);
  assert(onsiteZone?.details?.onsiteParty, 'dynamic caravan did not materialize at its loading site');
  caravan.stagingUntilHour = state.worldHour;
  sim.tick(Date.now() + 2000, { hours: 0.01, force: true });

  const travelingOperation = escortTask.details?.operation;
  assert.strictEqual(travelingOperation?.phase, 'traveling',
    'supply operation did not advance to traveling when staging ended');
  assert(Number(travelingOperation?.departureHour || 0) > 0,
    'traveling supply operation has no departure time');
  assert.strictEqual(onsiteZone.details?.departureRequested, true,
    'dynamic caravan did not request a physical exit after preparation');
  assert.strictEqual(sim.publicState().parties.find(row => row.id === caravan.id)?.operationPhase, 'traveling',
    'public caravan state did not advance to the traveling phase');

  const departure = sim.completeOnsitePartyDeparture({
    worldZoneId: onsiteZone.id,
    roomId: onsiteZone.roomId,
    reason: 'dynamic_supply_departure',
    actors: (onsiteZone.details?.actors || []).map(actor => ({
      actorId: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      dead: actor.dead,
      inventory: actor.inventory
    }))
  });
  assert.strictEqual(departure?.ok, true, 'dynamic supply caravan could not leave its loading site');
  assert.strictEqual(caravan.state, 'moving', 'dynamic supply caravan did not enter world-map travel');
  assert.strictEqual(caravan.destinationSiteId, 'settlement',
    'assigned supply caravan abandoned its operation destination');

  sim.tick(Date.now() + 3000, { hours: 2, force: true });

  const completedEscort = state.worldTasks.find(task => task?.id === escortTask.id);
  const completedWater = state.worldTasks.find(task => task?.id === waterTask.id);
  const untouchedMedicine = state.worldTasks.find(task => task?.id === medicineTask.id);
  const completedOperation = completedEscort?.details?.operation;
  assert.strictEqual(state.parties[caravan.id], undefined,
    'delivered dynamic resource caravan was not removed from the world');
  assert.strictEqual(completedEscort?.status, 'resolved',
    'unescorted NPC supply run did not resolve its escort task on arrival');
  assert.strictEqual(completedWater?.status, 'resolved',
    'matching delivery request did not resolve when its cargo arrived');
  assert.strictEqual(untouchedMedicine?.status, 'active',
    'water delivery incorrectly closed the non-matching medicine request');
  assert.strictEqual(completedOperation?.phase, 'completed',
    'supply operation did not reach the completed phase');
  assert.strictEqual(completedOperation?.status, 'completed',
    'completed supply operation retained an active status');
  assert.strictEqual(completedOperation?.outcome?.result, 'delivered',
    'completed supply operation did not record a delivered outcome');
  assert.strictEqual(completedOperation?.outcome?.siteId, 'settlement',
    'completed supply operation recorded the wrong destination');
  assert.deepStrictEqual(completedOperation?.outcome?.cargo, { water: 60 },
    'completed supply operation recorded the wrong delivered cargo');
  assert.strictEqual(completedWater?.details?.npcAssignment?.status, 'delivered',
    'matching delivery request did not retain the NPC assignment outcome');
  assert.deepStrictEqual(state.sites.settlement.lastDelivery?.cargo, { water: 60 },
    'destination did not record the demand-backed caravan delivery');
}

function assertInterFactionTradeResolvesDeliveryBeforeEscortReturn() {
  const { sim, state } = simulation('inter-faction-trade-return-operation');
  state.sites = {
    settlement: site('settlement', 390, 90, {
      type: 'settlement',
      owner: 'old_klim',
      locationId: 'world_trade_home',
      stockpile: { water: 125, food: 125 },
      extra: {
        prosperity: 45,
        surplusTradeProgress: 6,
        lastSurplusTradeHour: 0
      }
    }),
    scrapTown: site('scrapTown', 510, 90, {
      type: 'settlement',
      owner: 'scrap_union',
      locationId: 'world_trade_destination',
      stockpile: { silver: 500 },
      extra: { prosperity: 45 }
    })
  };
  state.worldTasks = [{
    id: 'deliver_trade_goods_request',
    key: 'deliver_trade_goods_request',
    type: 'deliver_supplies',
    status: 'active',
    title: 'Trade goods delivery request',
    siteId: 'scrapTown',
    issuerSiteId: 'scrapTown',
    createdHour: 99,
    expiresHour: 200,
    priority: 4,
    reward: {},
    details: { demand: { water: 70, food: 70 } }
  }];

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const caravan = Object.values(state.parties).find(row => row?.interFactionTrade
    && row.homeSiteId === 'settlement');
  assert(caravan, 'settlement surplus did not create an inter-faction trade caravan');
  assert.deepStrictEqual(caravan.cargo, { water: 70, food: 70 },
    'inter-faction caravan did not load the goods requested by the remote settlement');
  const escortTask = state.worldTasks.find(task => task?.type === 'escort_caravan' && task.partyId === caravan.id);
  const deliveryTask = state.worldTasks.find(task => task?.id === 'deliver_trade_goods_request');
  const outboundOperation = escortTask?.details?.operation;
  assert(escortTask && outboundOperation, 'inter-faction caravan has no linked escort operation');
  assert.strictEqual(outboundOperation.requestTaskId, deliveryTask.id,
    'inter-faction escort did not link to the remote delivery request');
  assert.strictEqual(deliveryTask.details?.escortTaskId, escortTask.id,
    'remote delivery request did not link back to the escort task');

  const loadingZone = state.worldZones.find(zone => zone.id === caravan.onsiteZoneId);
  assert(loadingZone?.details?.onsiteParty, 'inter-faction caravan did not materialize at its home loading site');
  caravan.stagingUntilHour = state.worldHour;
  sim.tick(Date.now() + 2000, { hours: 0.01, force: true });
  const departure = sim.completeOnsitePartyDeparture({
    worldZoneId: loadingZone.id,
    roomId: loadingZone.roomId,
    reason: 'inter_faction_trade_departure',
    actors: (loadingZone.details?.actors || []).map(actor => ({
      actorId: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      dead: actor.dead,
      inventory: actor.inventory
    }))
  });
  assert.strictEqual(departure?.ok, true, 'inter-faction caravan could not leave its home loading site');

  for (let index = 0; index < 24 && !caravan.returningFromTrade; index += 1) {
    sim.tick(Date.now() + 3000 + index, { hours: 0.25, force: true });
  }

  assert.strictEqual(caravan.returningFromTrade, true,
    'inter-faction caravan did not begin its return after remote unloading');
  assert.strictEqual(caravan.destinationSiteId, 'settlement',
    'inter-faction caravan did not turn back toward its home settlement');
  assert.strictEqual(deliveryTask.status, 'resolved',
    'linked delivery request remained active after goods were unloaded at the remote settlement');
  assert.strictEqual(deliveryTask.details?.finishReason, 'caravan_delivery',
    'remote delivery request was not resolved by the outbound caravan delivery');
  assert.strictEqual(escortTask.status, 'active',
    'escort task completed at the remote settlement instead of waiting for the return trip');
  assert.strictEqual(escortTask.details?.operation?.phase, 'returning',
    'trade operation did not enter the returning phase after remote unloading');
  assert.strictEqual(escortTask.details?.operation?.status, 'active',
    'trade operation completed before the caravan returned home');
  assert.strictEqual(Number(escortTask.details?.operation?.completedHour || 0), 0,
    'trade operation recorded completion at the remote unloading point');
  assert.strictEqual(sim.publicState().parties.find(row => row.id === caravan.id)?.operationPhase, 'returning',
    'public caravan state does not expose the return phase');
  assert.deepStrictEqual(state.sites.scrapTown.lastDelivery?.cargo, { water: 70, food: 70 },
    'remote settlement did not record the outbound trade delivery');
  assert(Number(caravan.cargo?.silver || 0) > 0,
    'inter-faction caravan did not carry trade proceeds home');

  const remoteZone = state.worldZones.find(zone => zone.id === caravan.onsiteZoneId);
  assert(remoteZone?.details?.onsiteParty && remoteZone.siteId === 'scrapTown',
    'inter-faction caravan has no physical remote unloading visit');
  caravan.onsiteUntilHour = state.worldHour;
  sim.tick(Date.now() + 4000, { hours: 0.01, force: true });
  const returnDeparture = sim.completeOnsitePartyDeparture({
    worldZoneId: remoteZone.id,
    roomId: remoteZone.roomId,
    reason: 'inter_faction_trade_return',
    actors: (remoteZone.details?.actors || []).map(actor => ({
      actorId: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      dead: actor.dead,
      inventory: actor.inventory
    }))
  });
  assert.strictEqual(returnDeparture?.ok, true,
    'inter-faction caravan could not leave the remote settlement for its return trip');

  for (let index = 0; index < 24 && state.parties[caravan.id]; index += 1) {
    sim.tick(Date.now() + 5000 + index, { hours: 0.25, force: true });
  }

  assert.strictEqual(state.parties[caravan.id], undefined,
    'inter-faction caravan remained in the world after completing its home return');
  assert.strictEqual(escortTask.status, 'resolved',
    'NPC escort task did not resolve after the caravan reached home');
  assert.strictEqual(escortTask.details?.operation?.phase, 'completed',
    'trade operation did not complete at the home settlement');
  assert.strictEqual(escortTask.details?.operation?.status, 'completed',
    'returned trade operation retained an active status');
  assert.strictEqual(escortTask.details?.operation?.outcome?.siteId, 'settlement',
    'trade operation completion was not recorded at the home settlement');
  assert.strictEqual(escortTask.details?.operation?.outcome?.result, 'delivered',
    'returned trade operation did not record a successful outcome');
  assert.strictEqual(deliveryTask.status, 'resolved',
    'completed return trip changed the already resolved remote delivery request');
}

function regressionSupplyOperationFixture(name, options = {}) {
  const { sim, state } = simulation(name);
  const requestExpiresHour = Number(options.requestExpiresHour ?? 200);
  state.sites = {
    settlement: site('settlement', Number(options.destinationX || 750), 90, {
      type: 'settlement',
      owner: 'old_klim',
      locationId: 'world_supply_regression_destination',
      stockpile: { water: 2, silver: 500 },
      extra: { prosperity: 45 }
    }),
    supply_source: site('supply_source', 390, 90, {
      type: 'resource',
      owner: 'old_klim',
      locationId: 'world_supply_regression_source',
      stockpile: { water: 78 },
      output: { water: 1 },
      extra: {
        resourceExportProgress: 3,
        lastResourceExportHour: 0
      }
    })
  };
  if (options.intermediateSettlement) {
    state.sites.crossing = site('crossing', Number(options.intermediateX || 540), 90, {
      type: 'settlement',
      owner: 'old_klim',
      locationId: 'world_supply_regression_crossing',
      stockpile: { water: 200, silver: 100 }
    });
  }
  const request = {
    id: 'regression_supply_request',
    key: 'regression_supply_request',
    type: 'deliver_supplies',
    status: 'active',
    title: 'Regression supply request',
    siteId: 'settlement',
    issuerSiteId: 'settlement',
    createdHour: 99,
    expiresHour: requestExpiresHour,
    priority: 3,
    reward: {},
    details: { demand: { water: 60 } }
  };
  state.worldTasks = [request];

  const startedAt = Date.now();
  sim.tick(startedAt + 1000, { hours: 0.01, force: true });

  const caravan = Object.values(state.parties).find(row => row?.resourceExport
    && row.resourceSourceSiteId === 'supply_source');
  assert(caravan, `${name}: resource surplus did not create the regression caravan`);
  const escortTask = state.worldTasks.find(task => task?.status === 'active'
    && task.type === 'escort_caravan' && task.partyId === caravan.id);
  assert(escortTask?.details?.operation, `${name}: caravan has no active supply operation`);
  assert.strictEqual(escortTask.details.operation.requestTaskId, request.id,
    `${name}: supply operation did not bind the regression request`);

  const onsiteZone = state.worldZones.find(zone => zone.id === caravan.onsiteZoneId);
  assert(onsiteZone?.details?.onsiteParty, `${name}: caravan did not materialize at its loading site`);
  caravan.stagingUntilHour = state.worldHour;
  sim.tick(startedAt + 2000, { hours: 0.01, force: true });
  const departure = sim.completeOnsitePartyDeparture({
    worldZoneId: onsiteZone.id,
    roomId: onsiteZone.roomId,
    reason: 'supply_regression_departure',
    actors: (onsiteZone.details?.actors || []).map(actor => ({
      actorId: actor.id,
      hp: actor.hp,
      maxHp: actor.maxHp,
      dead: actor.dead,
      inventory: actor.inventory
    }))
  });
  assert.strictEqual(departure?.ok, true, `${name}: regression caravan could not leave its loading site`);
  assert.strictEqual(caravan.state, 'moving', `${name}: regression caravan did not enter world travel`);
  assert.strictEqual(caravan.destinationSiteId, 'settlement', `${name}: regression caravan lost its physical destination`);
  return {
    sim,
    state,
    request,
    caravan,
    escortTask,
    operationId: escortTask.details.operation.id,
    startedAt
  };
}

function assertSupplyOperationIgnoresIncidentalSettlement() {
  const fixture = regressionSupplyOperationFixture('supply-operation-incidental-settlement', {
    intermediateSettlement: true
  });
  const { sim, state, request, caravan, escortTask, startedAt } = fixture;
  caravan.baseSpeedKmh = 90;
  caravan.speedKmh = 90;

  sim.tick(startedAt + 3000, { hours: 1, force: true });

  assert(state.parties[caravan.id], 'supply caravan disappeared after touching an incidental settlement');
  assert.strictEqual(caravan.lastSiteId, 'crossing',
    'supply caravan did not exercise the incidental-settlement arrival path');
  assert.strictEqual(caravan.destinationSiteId, 'settlement',
    'incidental settlement replaced the physical supply destination');
  assert.strictEqual(escortTask.status, 'active',
    'incidental settlement completed the escort task before its destination');
  assert.strictEqual(escortTask.details?.operation?.status, 'active',
    'incidental settlement completed the NPC supply operation before its destination');
  assert.strictEqual(request.status, 'active',
    'incidental settlement resolved the destination supply request');
  assert.strictEqual(Number(caravan.cargo?.water || 0), 60,
    'mission cargo was unloaded at an incidental settlement');
  assert.strictEqual(state.sites.crossing.lastDelivery, undefined,
    'incidental settlement recorded mission cargo as a completed delivery');
}

function assertSupplyDeliveryRespectsAssignedCaravan() {
  const fixture = regressionSupplyOperationFixture('supply-operation-assignment-race');
  const { sim, state, request, caravan, startedAt } = fixture;
  state.parties.other_caravan = party('other_caravan', 'caravan', 'old_klim', 748, 90, {
    speedKmh: 36,
    destinationSiteId: 'settlement',
    homeSiteId: 'settlement',
    nextDecisionHour: 999,
    cargo: { water: 60 },
    extra: { cargoCapacity: 80 }
  });

  sim.tick(startedAt + 3000, { hours: 0.01, force: true });

  assert.strictEqual(request.status, 'active',
    'delivery by another caravan closed a request assigned to the live supply operation');
  assert.strictEqual(request.details?.assignedPartyId, caravan.id,
    'delivery by another caravan replaced the request assignment');
  assert.strictEqual(request.details?.npcAssignment?.status, 'active',
    'delivery by another caravan finalized the assigned NPC operation');
}

function assertLinkedSupplyRequestTerminalKeepsNpcDestination() {
  const completed = regressionSupplyOperationFixture('supply-operation-request-completed');
  const completedResult = completed.sim.completeWorldTaskDelivery(completed.request.id, {
    playerId: 'regression_player',
    delivered: { water: 60 }
  });
  assert.strictEqual(completedResult?.ok, true, 'linked supply request could not be completed for the regression');
  assert.strictEqual(completed.request.status, 'completed', 'linked player delivery did not complete its request');
  assert.strictEqual(completed.escortTask.details?.operation?.requestTaskId, '',
    'completed request stayed attached to the live NPC operation');
  assert.strictEqual(completed.escortTask.details?.operation?.status, 'active',
    'completed request terminated the physical NPC operation');
  assert.strictEqual(completed.caravan.destinationSiteId, 'settlement',
    'completed request erased the caravan physical destination');
  assert.strictEqual(completed.caravan.goal?.targetSiteId, 'settlement',
    'completed request erased the caravan physical goal');
  assert.strictEqual(completed.caravan.assignment?.operationId, completed.operationId,
    'completed request detached the caravan from its live operation');

  const expired = regressionSupplyOperationFixture('supply-operation-request-expired', {
    requestExpiresHour: 100.03
  });
  expired.sim.tick(expired.startedAt + 3000, { hours: 0.02, force: true });
  assert.strictEqual(expired.request.status, 'expired', 'linked request did not exercise its expiry path');
  assert.strictEqual(expired.escortTask.details?.operation?.requestTaskId, '',
    'expired request stayed attached to the live NPC operation');
  assert.strictEqual(expired.escortTask.details?.operation?.status, 'active',
    'expired request terminated the physical NPC operation');
  assert.strictEqual(expired.caravan.destinationSiteId, 'settlement',
    'expired request erased the caravan physical destination');
  assert.strictEqual(expired.caravan.goal?.targetSiteId, 'settlement',
    'expired request erased the caravan physical goal');
  assert.strictEqual(expired.caravan.assignment?.operationId, expired.operationId,
    'expired request detached the caravan from its live operation');
}

function assertEscortExpiryKeepsNpcSupplyOperation() {
  const fixture = regressionSupplyOperationFixture('supply-operation-escort-expired');
  const { sim, request, caravan, escortTask, operationId, startedAt } = fixture;
  escortTask.expiresHour = fixture.state.worldHour;

  sim.tick(startedAt + 3000, { hours: 0.01, force: true });

  assert.strictEqual(escortTask.status, 'expired', 'escort task did not exercise its expiry path');
  assert.strictEqual(escortTask.details?.operation?.status, 'active',
    'escort expiry terminated a live NPC supply operation');
  assert.strictEqual(escortTask.details?.operation?.phase, 'traveling',
    'escort expiry moved the live NPC supply operation into a terminal phase');
  assert.strictEqual(caravan.assignment?.operationId, operationId,
    'escort expiry removed the live operation assignment from its caravan');
  assert.strictEqual(caravan.goal?.targetSiteId, 'settlement',
    'escort expiry removed the live physical goal from its caravan');
  assert.strictEqual(caravan.destinationSiteId, 'settlement',
    'escort expiry changed the caravan physical destination');
  assert.strictEqual(request.details?.assignedPartyId, caravan.id,
    'escort expiry released a request whose NPC operation is still alive');
}

function assertExpiredEscortOperationReroutesAndSettles() {
  const fixture = regressionSupplyOperationFixture('supply-operation-expired-escort-reroute');
  const { sim, state, request, caravan, escortTask, startedAt } = fixture;
  state.sites.fallback = site('fallback', 630, 90, {
    type: 'settlement',
    owner: 'old_klim',
    locationId: 'world_supply_regression_fallback',
    stockpile: { water: 0, silver: 100 }
  });
  escortTask.expiresHour = state.worldHour;
  sim.tick(startedAt + 3000, { hours: 0.01, force: true });
  assert.strictEqual(escortTask.status, 'expired',
    'reroute regression did not expire the player escort window');
  assert.strictEqual(escortTask.details?.npcOperationContinues, true,
    'expired escort did not retain its live NPC operation before rerouting');

  state.sites.settlement.owner = 'raiders';
  sim.tick(startedAt + 4000, { hours: 0.01, force: true });

  const reroutedOperation = escortTask.details?.operation;
  const archivedAfterReroute = state.worldTaskHistory.find(task => task?.id === escortTask.id);
  assert.strictEqual(caravan.destinationSiteId, 'fallback',
    'live caravan did not reroute after its original destination became hostile');
  assert.strictEqual(reroutedOperation?.destinationSiteId, 'fallback',
    'expired escort retained the blocked destination in its live operation');
  assert.strictEqual(reroutedOperation?.goal?.targetSiteId, 'fallback',
    'rerouted operation goal did not follow the physical fallback destination');
  assert.strictEqual(escortTask.details?.destinationSiteId, 'fallback',
    'expired escort details did not follow the physical fallback destination');
  assert.strictEqual(escortTask.details?.liveEvent?.impactSiteId, 'fallback',
    'expired escort live event did not follow the physical fallback destination');
  assert.strictEqual(archivedAfterReroute?.details?.operation?.destinationSiteId, 'fallback',
    'archived operation copy did not receive the fallback destination');
  assert.strictEqual(archivedAfterReroute?.details?.destinationSiteId, 'fallback',
    'archived escort details did not receive the fallback destination');
  assert.strictEqual(archivedAfterReroute?.details?.liveEvent?.impactSiteId, 'fallback',
    'archived live event did not receive the fallback destination');
  assert.strictEqual(reroutedOperation?.requestTaskId, '',
    'rerouted operation stayed attached to the request for its blocked destination');
  assert.strictEqual(request.details?.assignedPartyId, '',
    'blocked destination request stayed reserved by the rerouted caravan');

  caravan.x = 628;
  caravan.y = 90;
  caravan.state = 'moving';
  caravan.baseSpeedKmh = 36;
  caravan.speedKmh = 36;
  caravan.infrastructureRoutePoints = [];
  caravan.infrastructureRouteIndex = 0;
  sim.tick(startedAt + 5000, { hours: 0.01, force: true });

  const archivedAfterDelivery = state.worldTaskHistory.find(task => task?.id === escortTask.id);
  assert.strictEqual(state.sites.fallback.lastDelivery?.partyId, caravan.id,
    'rerouted caravan could not unload at its synchronized fallback destination');
  assert.strictEqual(escortTask.details?.operation?.status, 'completed',
    'rerouted live operation did not settle after unloading at the fallback');
  assert.strictEqual(escortTask.details?.operation?.outcome?.siteId, 'fallback',
    'rerouted operation recorded the wrong terminal delivery site');
  assert.strictEqual(escortTask.details?.npcOperationContinues, false,
    'terminal operation still claims that its NPC operation continues');
  assert.strictEqual(archivedAfterDelivery?.details?.operation?.status, 'completed',
    'archived operation copy did not settle after fallback delivery');
  assert.strictEqual(archivedAfterDelivery?.details?.npcOperationContinues, false,
    'archived terminal operation still claims that its NPC operation continues');
}

function assertLootedTransientOnsiteZoneReactivates() {
  const { sim, state } = simulation('onsite-zone-reactivation');
  state.sites.current = site('current', 390, 90, { owner: 'old_klim' });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 360, 90, {
    speedKmh: 48,
    destinationSiteId: 'current',
    nextDecisionHour: 999
  });

  sim.tick(Date.now() + 1000, { hours: 0.1, force: true });
  const patrol = state.parties.patrol;
  const zoneId = patrol.onsiteZoneId;
  const zone = state.worldZones.find(row => row.id === zoneId);
  assert(zone, 'first onsite visit did not create a transient world zone');
  zone.status = 'looted';
  zone.resolvedHour = state.worldHour;
  zone.details = { ...(zone.details || {}), looted: true, clearedHour: state.worldHour };
  patrol.state = 'moving';
  delete patrol.onsiteZoneId;
  delete patrol.onsiteSiteId;
  delete patrol.onsiteReason;
  delete patrol.onsiteUntilHour;
  patrol.x = 360;
  patrol.y = 90;
  patrol.destinationSiteId = 'current';
  patrol.nextDecisionHour = 999;
  patrol.siteExitIgnoreId = '';
  patrol.siteExitIgnoreUntilHour = 0;
  patrol.infrastructureRoutePoints = [];
  patrol.infrastructureRouteIndex = 1;
  patrol.infrastructureDestinationSiteId = '';

  sim.tick(Date.now() + 2000, { hours: 0.1, force: true });
  const reused = state.worldZones.find(row => row.id === zoneId);
  assert.strictEqual(patrol.state, 'onsite', 'party did not re-enter a previously used location instance');
  assert.strictEqual(reused?.status, 'active', 'reused transient onsite zone remained looted instead of reactivating');
  assert(!reused?.details?.looted, 'reused transient onsite zone kept stale looted state');
  sim.tick(Date.now() + 3000, { hours: 0.01, force: true });
  assert.strictEqual(patrol.state, 'onsite', 'reactivated onsite zone was discarded on the following tick');
}

function assertSweptPartyCollision() {
  const { sim, state } = simulation('party-contact');
  state.sites.west = site('west', 240, 90);
  state.sites.east = site('east', 660, 90);
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 360, 90, {
    speedKmh: 54,
    destinationSiteId: 'east',
    strength: 100
  });
  state.parties.raiders = party('raiders', 'raider', 'raiders', 540, 90, {
    speedKmh: 52,
    destinationSiteId: 'west',
    strength: 100
  });

  sim.tick(Date.now() + 1000, { hours: 0.75, force: true });

  const patrol = state.parties.patrol;
  const raiders = state.parties.raiders;
  assert.strictEqual(patrol.state, 'engaged', 'patrol passed through a hostile party between server ticks');
  assert.strictEqual(raiders.state, 'engaged', 'hostile party passed through the patrol between server ticks');
  assert.strictEqual(patrol.engagedZoneId, raiders.engagedZoneId, 'colliding parties did not enter one shared battle');
  const battle = state.worldZones.find(zone => zone.id === patrol.engagedZoneId);
  assert(battle && battle.sourceType === 'party_clash', 'physical party contact did not create a real party clash');
  assert(Math.abs(Number(battle.x || 0) - 450) < 18, 'battle was not placed near the actual contact point');
}

function assertThirdPartyJoinsLiveBattle() {
  const { sim, state } = simulation('battle-reinforcement');
  state.sites.west = site('west', 240, 90);
  state.sites.east = site('east', 660, 90);
  state.sites.south = site('south', 450, 300);
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 360, 90, {
    speedKmh: 54,
    destinationSiteId: 'east',
    strength: 100
  });
  state.parties.raiders = party('raiders', 'raider', 'raiders', 540, 90, {
    speedKmh: 52,
    destinationSiteId: 'west',
    strength: 100
  });
  state.parties.reinforcement = party('reinforcement', 'patrol', 'old_klim', 450, 0, {
    speedKmh: 54,
    destinationSiteId: 'south',
    strength: 70
  });

  sim.tick(Date.now() + 1000, { hours: 0.75, force: true });

  const battle = state.worldZones.find(zone => zone.sourceType === 'party_clash' && zone.status === 'active');
  assert(battle, 'primary physical collision did not create a battle');
  assert.strictEqual(state.parties.reinforcement.state, 'engaged', 'third party passed through an already active live battle');
  assert.strictEqual(state.parties.reinforcement.engagedZoneId, battle.id, 'reinforcement entered a separate battle reality');
  const joined = (battle.details?.joinedParties || []).find(row => row.partyId === 'reinforcement');
  assert(joined && joined.side === 'defender', 'friendly reinforcement joined the wrong side of the battle');
  assert((battle.details?.actors || []).some(actor => String(actor.id || '').startsWith('reinforcement_')),
    'joined party did not add its real NPC actors to the shared battle');
}

function assertPartyClashOutcomeFollowsAssignedSides() {
  const { sim, state } = simulation('party-clash-side-outcome');
  state.sites.west = site('west', 240, 90);
  state.sites.east = site('east', 660, 90);
  state.sites.near = site('near', 450, 114, { owner: 'old_klim', security: 35 });
  state.parties.raider = party('raider', 'raider', 'raiders', 360, 90, {
    speedKmh: 54,
    destinationSiteId: 'east',
    homeSiteId: 'near',
    strength: 100
  });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 540, 90, {
    speedKmh: 52,
    destinationSiteId: 'west',
    homeSiteId: 'near',
    strength: 100
  });

  sim.tick(Date.now() + 1000, { hours: 0.75, force: true });

  const battle = state.worldZones.find(zone => zone.sourceType === 'party_clash' && zone.status === 'active');
  assert(battle, 'reversed party order did not create a live clash');
  assert.strictEqual(battle.details?.partySides?.raider, 'attacker', 'raider was assigned to the wrong site-battle side');
  assert.strictEqual(battle.details?.partySides?.patrol, 'defender', 'patrol was assigned to the wrong site-battle side');
  assert.strictEqual(battle.faction, 'old_klim', 'battle defender faction still followed primary-party storage order');
  assert.strictEqual(battle.targetFaction, 'raiders', 'battle attacker faction still followed threat-party storage order');
  const snapshots = (battle.details?.actors || []).map(actor => ({
    actorId: actor.id,
    maxHp: actor.maxHp,
    hp: actor.side === 'defender' ? 0 : actor.maxHp,
    dead: actor.side === 'defender'
  }));
  sim.syncBattleZoneActors({ worldZoneId: battle.id, roomId: battle.roomId, actors: snapshots });

  assert(!state.parties.raider.destroyed, 'winning attacker was destroyed because it was stored as the primary party');
  assert.strictEqual(state.parties.patrol.state, 'destroyed', 'defeated defender survived because it was stored as the threat party');
  assert.strictEqual(Number(state.stats.battlesResolved || 0), 1, 'completed live battle was not counted in simulation statistics');
}

function assertMutuallyHostilePartiesStayOnOppositeSides() {
  const { sim, state } = simulation('party-clash-mutual-hostility');
  state.sites.west = site('west', 240, 90);
  state.sites.east = site('east', 660, 90);
  state.sites.near = site('near', 450, 114, { owner: 'old_klim', security: 35 });
  state.parties.raiders = party('raiders', 'raider', 'raiders', 360, 90, {
    speedKmh: 54,
    destinationSiteId: 'east',
    homeSiteId: 'near',
    strength: 100
  });
  state.parties.mutants = party('mutants', 'monster', 'mutants', 540, 90, {
    speedKmh: 52,
    destinationSiteId: 'west',
    homeSiteId: 'near',
    strength: 100
  });

  sim.tick(Date.now() + 1000, { hours: 0.75, force: true });

  const battle = state.worldZones.find(zone => zone.sourceType === 'party_clash' && zone.status === 'active');
  assert(battle, 'mutually hostile parties did not create a live clash');
  assert.notStrictEqual(battle.details?.partySides?.raiders, battle.details?.partySides?.mutants,
    'mutually hostile parties were allied because both were hostile to the nearby site');
  assert(!(battle.details?.actors || []).some(actor => String(actor.id || '').startsWith('near_defender_')),
    'site defenders were incorrectly allied with one of two parties that are both hostile to the site');
}

function assertThreatAvoidanceRoute() {
  const { sim, state } = simulation('avoidance');
  state.sites.destination = site('destination', 660, 90);
  state.parties.support = party('support', 'support', 'old_klim', 300, 90, {
    speedKmh: 42,
    destinationSiteId: 'destination',
    strength: 20,
    members: 3,
    extra: { supportSiteId: 'destination' }
  });
  state.parties.threat = party('threat', 'raider', 'raiders', 420, 90, {
    speedKmh: 1,
    strength: 220,
    members: 18,
    destinationSiteId: '',
    nextDecisionHour: 999
  });

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const route = state.parties.support.infrastructureRoutePoints || [];
  assert(route.length >= 3, 'party kept a straight route through a much stronger hostile group');
  const closest = route.slice(1).reduce((distance, point, index) => Math.min(
    distance,
    pointSegmentDistance(state.parties.threat, route[index], point)
  ), Infinity);
  assert(closest >= 45, `avoidance route still crosses the hostile exclusion area (${closest.toFixed(1)} map points)`);
}

function assertBlockedLocationAvoidance() {
  const { sim, state } = simulation('blocked-location');
  state.sites.destination = site('destination', 660, 180, { owner: 'neutral' });
  state.sites.settlement = site('settlement', 450, 180, {
    owner: 'old_klim',
    security: 100,
    locationId: 'settlement',
    extra: { capital: true, capitalFaction: 'old_klim', pvpMode: 'peaceful' }
  });
  state.parties.raiders = party('raiders', 'raider', 'raiders', 300, 180, {
    speedKmh: 52,
    destinationSiteId: 'destination',
    strength: 85
  });

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const route = state.parties.raiders.infrastructureRoutePoints || [];
  assert(route.length >= 3, 'hostile party routed straight through a protected faction capital');
  const closest = route.slice(1).reduce((distance, point, index) => Math.min(
    distance,
    pointSegmentDistance(state.sites.settlement, route[index], point)
  ), Infinity);
  assert(closest >= 20, `route still intersects the protected capital circle (${closest.toFixed(1)} map points)`);
}

function assertSituationalReplanning() {
  const { sim, state } = simulation('replanning');
  state.sites.routine = site('routine', 660, 90, { owner: 'old_klim', security: 70 });
  state.sites.attacked = site('attacked', 390, 90, {
    owner: 'old_klim',
    security: 18,
    extra: {
      activeConflict: {
        id: 'test_raid',
        active: true,
        status: 'active',
        attackers: [{ faction: 'raiders', power: 80, count: 6 }]
      }
    }
  });
  state.parties.patrol = party('patrol', 'patrol', 'old_klim', 300, 90, {
    speedKmh: 54,
    destinationSiteId: 'routine',
    homeSiteId: 'routine',
    nextDecisionHour: 0,
    route: ['routine']
  });

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const patrol = state.parties.patrol;
  assert.strictEqual(patrol.destinationSiteId, 'attacked', 'patrol ignored a nearby attack and kept its fixed route');
  assert.strictEqual(patrol.decisionKind, 'defend', 'patrol did not explain its situational priority as defense');
  assert.strictEqual(patrol.decisionReason, 'friendly_site_attacked', 'patrol decision did not reflect the current world event');
}

function patrolMissionVerticalSliceFixture(name, options = {}) {
  const { sim, state } = simulation(name);
  const conflictId = 'vertical_patrol_conflict';
  const targetExtra = options.defense
    ? {
        activeConflict: {
          id: conflictId,
          active: true,
          kind: 'raid',
          status: 'active',
          startedHour: state.worldHour,
          updatedHour: state.worldHour,
          expiresHour: state.worldHour + 18,
          ownerAtStart: 'old_klim',
          progress: 2,
          attackers: [{
            faction: 'raiders',
            power: 80,
            count: 6,
            firstHour: state.worldHour,
            lastHour: state.worldHour,
            order: 0
          }]
        }
      }
    : {};
  state.sites = {
    vertical_patrol_home: site('vertical_patrol_home', 270, 90, {
      type: 'settlement',
      owner: 'old_klim',
      locationId: 'world_vertical_patrol_home',
      security: 82,
      stockpile: { silver: 500 }
    }),
    vertical_patrol_target: site('vertical_patrol_target', 390, 90, {
      type: 'resource',
      owner: 'old_klim',
      locationId: 'world_vertical_patrol_target',
      security: options.defense ? 18 : 4,
      output: { scrap: 1 },
      extra: targetExtra
    })
  };
  const defenseTask = options.defense ? {
    id: 'vertical_patrol_defense_request',
    key: 'site_conflict:vertical_patrol_target',
    type: 'defend_resource',
    status: 'active',
    title: 'Defend the vertical patrol target',
    siteId: 'vertical_patrol_target',
    issuerSiteId: 'vertical_patrol_home',
    targetFaction: 'raiders',
    objective: 'site_conflict',
    createdHour: state.worldHour,
    expiresHour: state.worldHour + 24,
    priority: 5,
    reward: {},
    details: { conflictId }
  } : null;
  state.worldTasks = defenseTask ? [defenseTask] : [];
  state.parties.vertical_patrol_party = party(
    'vertical_patrol_party',
    'patrol',
    'old_klim',
    300,
    90,
    {
      name: 'Vertical Patrol',
      speedKmh: Number(options.speedKmh ?? 1),
      strength: 92,
      members: 5,
      homeSiteId: 'vertical_patrol_home',
      destinationSiteId: 'vertical_patrol_home',
      nextDecisionHour: 0,
      route: ['vertical_patrol_home']
    }
  );

  const startedAt = Date.now();
  sim.tick(startedAt + 1000, { hours: 0.01, force: true });

  const patrol = state.parties.vertical_patrol_party;
  const missionTask = state.worldTasks.find(task => task?.type === 'patrol_mission'
    && task.partyId === patrol.id);
  const participationTask = state.worldTasks.find(task => task?.type === 'join_patrol'
    && task.partyId === patrol.id);
  return {
    sim,
    state,
    patrol,
    target: state.sites.vertical_patrol_target,
    defenseTask,
    missionTask,
    participationTask,
    startedAt
  };
}

function assertPatrolDecisionCreatesLinkedMissionParticipation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-linked-participation');
  const { sim, patrol, target, missionTask, participationTask } = fixture;
  const operation = missionTask?.details?.operation;

  assert.strictEqual(patrol.decisionKind, 'patrol',
    'real patrol decision did not choose the weak friendly target');
  assert(missionTask, 'real patrol decision did not create an authoritative patrol_mission task');
  assert.strictEqual(missionTask.status, 'active',
    'new authoritative patrol mission was not active');
  assert.strictEqual(missionTask.siteId, target.id,
    'patrol mission task did not target the site selected by the real decision');
  assert.strictEqual(operation?.kind, 'patrol_mission',
    'patrol mission task did not carry a patrol_mission operation');
  assert.strictEqual(operation?.status, 'active',
    'new patrol operation was terminal before the NPC mission ran');
  assert.strictEqual(operation?.phase, 'patrolling',
    'routine patrol decision did not start in the patrolling phase');
  assert.strictEqual(operation?.goal?.targetSiteId, target.id,
    'patrol operation goal diverged from the physical destination');
  assert.strictEqual(operation?.assignment?.assigneeId, patrol.id,
    'patrol operation was not assigned to the deciding world party');
  assert.strictEqual(operation?.assignment?.leaderName, 'Командир патруля',
    'patrol operation does not expose the generic patrol commander');
  assert.strictEqual(patrol.assignment?.operationId, operation?.id,
    'real patrol party did not retain its operation identity');
  assert.strictEqual(patrol.assignment?.taskId, missionTask.id,
    'real patrol party assignment did not point to the authoritative mission task');

  assert(participationTask, 'patrol mission did not create a linked join_patrol participation task');
  assert.strictEqual(participationTask.status, 'active',
    'new patrol participation window was not active');
  assert.strictEqual(participationTask.details?.operationId, operation?.id,
    'join_patrol task lost the NPC operation identity');
  assert.strictEqual(participationTask.details?.missionTaskId, missionTask.id,
    'join_patrol task did not link back to its authoritative patrol mission');
  assert.strictEqual(missionTask.details?.participationTaskId, participationTask.id,
    'authoritative patrol mission did not link to its participation window');

  const publicPatrol = sim.publicState().parties.find(row => row.id === patrol.id);
  assert.strictEqual(publicPatrol?.leaderName, 'Командир патруля',
    'public patrol state does not expose the generic patrol commander');
  assert.strictEqual(publicPatrol?.operationId, operation?.id,
    'public patrol state lost the active operation identity');
  assert.strictEqual(publicPatrol?.operationPhase, 'patrolling',
    'public patrol state lost the active operation phase');
  assert(publicPatrol?.operationStageLabel,
    'public patrol state has no readable operation stage');
}

function assertPatrolPublicFeedSeparatesNpcStatusFromPlayerParticipation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-public-feed-contract');
  const { sim, patrol, missionTask, participationTask } = fixture;
  const patrolRows = snapshot => snapshot.worldTasks.filter(task => (
    task?.partyId === patrol.id && ['patrol_mission', 'join_patrol'].includes(task.type)
  ));
  const activityRows = snapshot => snapshot.worldActivities.filter(task => (
    task?.partyId === patrol.id && ['patrol_mission', 'join_patrol'].includes(task.type)
  ));

  let snapshot = sim.publicState();
  assert.deepStrictEqual(patrolRows(snapshot).map(task => task.type), ['join_patrol'],
    'public task board duplicated the NPC patrol mission beside its join window');
  assert.deepStrictEqual(activityRows(snapshot).map(task => task.type), ['join_patrol'],
    'live activity feed duplicated the NPC patrol mission beside its join window');
  assert.strictEqual(patrolRows(snapshot)[0]?.actionMode, 'join_party',
    'open patrol participation did not expose its server-authoritative join action');

  for (let index = 0; index < 5; index += 1) {
    joinPatrolVerticalSlicePlayer(fixture, `public-feed-${index}`);
  }
  snapshot = sim.publicState();
  assert.deepStrictEqual(patrolRows(snapshot).map(task => task.type), ['join_patrol'],
    'a full patrol hid the accepted participation task from its current members');
  assert.strictEqual(patrolRows(snapshot)[0]?.actionMode, '',
    'a full patrol still advertised a join action');
  assert.strictEqual(patrolRows(snapshot)[0]?.joinPartySlotsLeft, 0,
    'a full patrol exposed an incorrect player-slot count');

  patrol.playerMembers = [];
  participationTask.status = 'resolved';
  snapshot = sim.publicState();
  const mission = patrolRows(snapshot).find(task => task.id === missionTask.id);
  assert(mission, 'NPC patrol status disappeared after its participation window closed');
  assert.strictEqual(mission.actionMode, 'status_only',
    'NPC patrol mission did not expose an explicit status-only action contract');
  assert.strictEqual(mission.statusOnly, true,
    'NPC patrol mission was not marked as status-only');
  assert.strictEqual(mission.npcOnly, true,
    'NPC patrol mission was not marked as NPC-owned');
}

function assertPatrolDefenseAssignmentSynchronizesWorldTasks() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-defense-assignment', { defense: true });
  const { patrol, target, defenseTask, missionTask } = fixture;
  const operation = missionTask?.details?.operation;

  assert.strictEqual(patrol.decisionKind, 'defend',
    'patrol did not convert the active friendly conflict into a defense decision');
  assert(missionTask, 'defense decision did not create an authoritative patrol mission');
  assert.strictEqual(operation?.phase, 'traveling',
    'patrol defense operation claimed to hold the site before physically arriving');
  assert.strictEqual(operation?.goal?.reason, 'friendly_site_attacked',
    'patrol defense operation lost the world-state reason for its assignment');
  assert.strictEqual(operation?.goal?.targetSiteId, target.id,
    'patrol defense operation targeted the wrong conflict site');
  assert.strictEqual(defenseTask?.status, 'active',
    'defend_resource request closed when the patrol merely accepted it');
  assert.strictEqual(defenseTask?.details?.operationId, operation?.id,
    'defend_resource request did not synchronize the patrol operation id');
  assert.strictEqual(defenseTask?.details?.assignedPartyId, patrol.id,
    'defend_resource request did not synchronize the assigned patrol id');
  assert.strictEqual(defenseTask?.details?.npcAssignment?.status, 'active',
    'defend_resource request does not expose an active NPC assignment');
}

function prepareVerticalPatrolArrival(fixture) {
  const { patrol, target } = fixture;
  patrol.x = target.x - 10;
  patrol.y = target.y;
  patrol.state = 'moving';
  patrol.baseSpeedKmh = 54;
  patrol.speedKmh = 54;
  patrol.destinationSiteId = target.id;
  patrol.nextDecisionHour = 999;
  patrol.infrastructureRoutePoints = [];
  patrol.infrastructureRouteIndex = 1;
  patrol.infrastructureDestinationSiteId = '';
}

function assertPatrolArrivalCompletesMissionOperation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-arrival-completion');
  const { sim, patrol, target, missionTask, startedAt } = fixture;
  assert(missionTask?.details?.operation, 'arrival regression has no patrol operation to complete');

  prepareVerticalPatrolArrival(fixture);
  sim.tick(startedAt + 2000, { hours: 0.1, force: true });

  const operation = missionTask.details?.operation;
  assert.strictEqual(patrol.lastSiteId, target.id,
    'patrol did not physically arrive at its mission target');
  assert.strictEqual(missionTask.status, 'resolved',
    'authoritative patrol mission stayed active after target arrival');
  assert.strictEqual(operation?.phase, 'completed',
    'patrol operation did not enter the completed phase on arrival');
  assert.strictEqual(operation?.status, 'completed',
    'arrived patrol operation retained an active status');
  assert.strictEqual(operation?.outcome?.siteId, target.id,
    'arrived patrol operation recorded the wrong terminal site');
  assert(Number(operation?.completedHour || 0) > 0,
    'arrived patrol operation has no completion time');
}

function assertPatrolRepelledConflictCompletesMissionOperation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-conflict-repelled', { defense: true });
  const { sim, state, target, defenseTask, missionTask, startedAt } = fixture;
  assert(missionTask?.details?.operation, 'conflict regression has no patrol operation to complete');

  target.activeConflict.startedHour = state.worldHour - 2;
  target.activeConflict.progress = -6;
  sim.tick(startedAt + 2000, { hours: 0.01, force: true });

  const operation = missionTask.details?.operation;
  assert.strictEqual(target.activeConflict, null,
    'defended site kept an active conflict after the repel condition');
  assert.strictEqual(defenseTask.status, 'resolved',
    'defend_resource request stayed active after its conflict was repelled');
  assert.strictEqual(missionTask.status, 'resolved',
    'authoritative patrol mission stayed active after its conflict was repelled');
  assert.strictEqual(operation?.phase, 'completed',
    'repelled conflict did not complete the patrol operation');
  assert.strictEqual(operation?.status, 'completed',
    'repelled patrol operation retained an active status');
  assert.strictEqual(operation?.outcome?.siteId, target.id,
    'repelled patrol operation recorded the wrong conflict site');
}

function assertDefendingPatrolHoldsOnsiteUntilConflictEnds() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-defense-holds-onsite', { defense: true });
  const { sim, state, patrol, target, missionTask, startedAt } = fixture;
  prepareVerticalPatrolArrival(fixture);
  sim.tick(startedAt + 2000, { hours: 0.1, force: true });

  assert.strictEqual(patrol.state, 'onsite',
    'defending patrol did not enter the attacked site');
  assert.strictEqual(patrol.onsiteSiteId, target.id,
    'defending patrol entered the wrong site');
  assert(target.activeConflict,
    'defense-hold regression resolved the conflict before the patrol could hold it');
  assert.strictEqual(missionTask.details?.operation?.phase, 'holding',
    'arrived defending patrol did not transition from traveling to holding');

  sim.tick(startedAt + 3000, { hours: 2, force: true });
  const onsiteZone = state.worldZones.find(zone => zone?.id === patrol.onsiteZoneId);
  assert(target.activeConflict,
    'defense-hold regression unexpectedly ended the conflict during the dwell check');
  assert.strictEqual(patrol.state, 'onsite',
    'defending patrol left while its assigned site conflict was still active');
  assert.strictEqual(onsiteZone?.details?.departureRequested, undefined,
    'defending patrol requested departure while its assigned conflict was active');
  assert.strictEqual(missionTask.status, 'active',
    'defending patrol mission ended before the site conflict');
  assert.strictEqual(missionTask.details?.operation?.phase, 'holding',
    'defending patrol stopped holding before the site conflict ended');

  target.activeConflict.startedHour = state.worldHour - 2;
  target.activeConflict.progress = -6;
  sim.tick(startedAt + 4000, { hours: 0.01, force: true });
  assert.strictEqual(target.activeConflict, null,
    'defense-hold regression did not resolve the forced repel condition');
  assert.strictEqual(missionTask.status, 'resolved',
    'defending patrol mission stayed active after the conflict ended');
  assert.strictEqual(missionTask.details?.operation?.phase, 'completed',
    'defending patrol operation did not complete after the conflict ended');
}

function assertPatrolDoesNotReinforceCapturedTarget() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-captured-target-revalidation');
  const { sim, patrol, target, missionTask, startedAt } = fixture;
  assert.strictEqual(missionTask.details?.operation?.goal?.kind, 'reinforce_site',
    'captured-target regression did not start with a reinforcement mission');
  target.type = 'test_site';
  target.owner = 'raiders';
  target.security = 17;
  prepareVerticalPatrolArrival(fixture);
  sim.tick(startedAt + 2000, { hours: 0.1, force: true });

  const operation = missionTask.details?.operation;
  assert.strictEqual(target.security, 17,
    'patrol reinforced a target captured by a hostile faction before arrival');
  assert.strictEqual(missionTask.status, 'failed',
    'captured patrol target was recorded as a successful mission');
  assert.strictEqual(operation?.phase, 'failed',
    'captured patrol target left the operation active or completed');
  assert.strictEqual(operation?.outcome?.reason, 'patrol_target_became_hostile',
    'captured patrol target recorded the wrong terminal reason');
  assert.strictEqual(patrol.assignment, null,
    'failed captured-target mission remained assigned to the patrol');
}

function joinPatrolVerticalSlicePlayer(fixture, suffix) {
  const joined = fixture.sim.joinWorldParty({
    taskId: fixture.participationTask?.id,
    partyId: fixture.patrol.id,
    playerId: `vertical-patrol-player-${suffix}`,
    userId: `vertical-patrol-account-${suffix}`,
    characterId: `vertical-patrol-character-${suffix}`,
    name: `Vertical Patrol Player ${suffix}`,
    factionId: 'old_klim'
  });
  assert.strictEqual(joined?.ok, true,
    `${suffix}: player could not join the patrol participation task`);
}

function assertPatrolParticipationTerminalKeepsNpcOperationActive() {
  const completed = patrolMissionVerticalSliceFixture('patrol-participation-duty-completed');
  assert(completed.missionTask?.details?.operation,
    'completed-duty regression has no active NPC patrol operation');
  assert(completed.participationTask,
    'completed-duty regression has no patrol participation task');
  joinPatrolVerticalSlicePlayer(completed, 'completed');
  completed.participationTask.details.dutyEndsHour = completed.state.worldHour;
  completed.sim.tick(completed.startedAt + 2000, { hours: 0.01, force: true });

  assert.strictEqual(completed.participationTask.status, 'completed',
    'finished player duty did not complete join_patrol participation');
  assert.strictEqual(completed.missionTask.status, 'active',
    'finished player duty terminated the live authoritative patrol mission');
  assert.strictEqual(completed.missionTask.details?.operation?.status, 'active',
    'finished player duty terminated the live NPC patrol operation');
  assert.strictEqual(completed.patrol.assignment?.operationId,
    completed.missionTask.details?.operation?.id,
    'finished player duty detached the living patrol from its NPC operation');
  assert.strictEqual(completed.patrol.playerMembers.length, 0,
    'completed patrol participation left the rewarded player attached to the party');

  const expired = patrolMissionVerticalSliceFixture('patrol-participation-duty-expired');
  assert(expired.missionTask?.details?.operation,
    'expired-duty regression has no active NPC patrol operation');
  assert(expired.participationTask,
    'expired-duty regression has no patrol participation task');
  joinPatrolVerticalSlicePlayer(expired, 'expired');
  expired.participationTask.expiresHour = expired.state.worldHour;
  expired.sim.tick(expired.startedAt + 2000, { hours: 0.01, force: true });

  assert.strictEqual(expired.participationTask.status, 'expired',
    'expired player duty did not close join_patrol participation');
  assert.strictEqual(expired.missionTask.status, 'active',
    'participation expiry terminated the live authoritative patrol mission');
  assert.strictEqual(expired.missionTask.details?.operation?.status, 'active',
    'participation expiry terminated the live NPC patrol operation');
  assert.strictEqual(expired.patrol.assignment?.operationId,
    expired.missionTask.details?.operation?.id,
    'participation expiry detached the living patrol from its NPC operation');
  assert.strictEqual(expired.patrol.playerMembers.length, 0,
    'expired patrol participation left the player attached to the party');
}

function assertPatrolOperationRewardRequiresCompletedDuty() {
  const early = patrolMissionVerticalSliceFixture('patrol-operation-early-duty-no-reward');
  joinPatrolVerticalSlicePlayer(early, 'early-operation');
  prepareVerticalPatrolArrival(early);
  early.sim.tick(early.startedAt + 2000, { hours: 0.1, force: true });

  assert.strictEqual(early.missionTask.status, 'resolved',
    'early-duty regression did not finish the NPC patrol operation');
  assert.strictEqual(early.participationTask.status, 'resolved',
    'short patrol participation was incorrectly marked reward-complete');
  assert.strictEqual(Number(early.participationTask.details?.rewardEligibleCount || 0), 0,
    'short patrol participation produced an eligible reward recipient');
  assert.strictEqual(Number(early.participationTask.details?.rewardPlayerCount || 0), 0,
    'short patrol participation received a trusted group reward snapshot');
  assert.strictEqual((early.participationTask.details?.rewardMemberKeys || []).length, 0,
    'short patrol participation retained a claimable reward identity');
  assert.strictEqual(early.patrol.playerMembers.length, 0,
    'short-duty player remained attached after the NPC operation ended');

  const served = patrolMissionVerticalSliceFixture('patrol-operation-served-duty-reward');
  joinPatrolVerticalSlicePlayer(served, 'served-operation');
  const servedMember = served.patrol.playerMembers.find(member => member?.taskId === served.participationTask.id);
  assert(servedMember, 'served-duty regression did not attach the patrol player');
  servedMember.joinedHour = served.state.worldHour - 6.1;
  served.participationTask.details.dutyStartedHour = servedMember.joinedHour;
  served.participationTask.details.dutyEndsHour = served.state.worldHour - 0.1;
  prepareVerticalPatrolArrival(served);
  served.sim.tick(served.startedAt + 2000, { hours: 0.1, force: true });

  assert.strictEqual(served.missionTask.status, 'resolved',
    'served-duty regression did not finish the NPC patrol operation');
  assert.strictEqual(served.participationTask.status, 'completed',
    'confirmed patrol duty did not complete the participation reward');
  assert.strictEqual(served.participationTask.details?.rewardEligibleCount, 1,
    'confirmed patrol duty did not record one eligible recipient');
  assert.strictEqual(served.participationTask.details?.rewardPlayerCount, 1,
    'confirmed patrol duty did not produce a trusted reward snapshot');
  assert.strictEqual((served.participationTask.details?.rewardMemberKeys || []).length, 1,
    'confirmed patrol duty did not retain its claimable reward identity');
  assert.strictEqual(served.patrol.playerMembers.length, 0,
    'served-duty player remained attached after the operation reward');
}

function assertDestroyedPatrolFailsMissionOperation() {
  const fixture = patrolMissionVerticalSliceFixture('patrol-mission-destroyed-failure');
  const { sim, patrol, missionTask } = fixture;
  assert(missionTask?.details?.operation, 'destruction regression has no patrol operation to fail');

  sim.recordEncounterOutcome({
    encounterId: 'vertical_raiders_vs_patrol',
    worldPartyId: patrol.id,
    worldPoint: { x: patrol.x, y: patrol.y },
    deadFactions: ['old_klim'],
    aliveFactions: ['raiders'],
    playerInvolved: false
  });

  const operation = missionTask.details?.operation;
  assert.strictEqual(patrol.state, 'destroyed',
    'patrol destruction regression did not destroy the physical world party');
  assert.strictEqual(missionTask.status, 'failed',
    'destroyed patrol did not fail its authoritative patrol mission');
  assert.strictEqual(operation?.phase, 'failed',
    'destroyed patrol operation did not enter the failed phase');
  assert.strictEqual(operation?.status, 'failed',
    'destroyed patrol operation retained an active status');
  assert(Number(operation?.completedHour || 0) > 0,
    'destroyed patrol operation has no terminal time');
}

function assertTradeMachineStockIsActuallyBacked() {
  const { sim, state } = simulation('trade-machine-stock');
  state.sites.ammoWorks = site('ammoWorks', 390, 90, {
    type: 'production',
    owner: 'old_klim',
    locationId: 'klimAmmoWorks',
    stockpile: {
      ammo9: 18,
      ammo556: 18,
      ammoParts: 0,
      scrap: 0,
      silver: 500
    }
  });

  const market = sim.applyTraderSupply('ammoWorksMachine', {
    stock: [
      { id: 'ammo9', price: 3, qty: 120 },
      { id: 'ammo556', price: 5, qty: 80 }
    ],
    caps: 500
  }, { siteId: 'ammoWorks' });
  const offer = market.stock.find(row => row.id === 'ammo9');

  assert(offer, 'ammo workshop stopped offering its available 9mm ammunition');
  assert.strictEqual(offer.qty, 18, 'trade machine advertised more ammunition than the site can deliver');
  const purchase = sim.applyTradeMachineTransaction('ammoWorks', {
    buys: [{ id: 'ammo9', qty: offer.qty }],
    silverDelta: offer.qty * offer.price,
    playerId: 'economy-check'
  });
  assert(purchase.ok, 'trade machine could not deliver the full quantity shown in its market');
  assert.strictEqual(Math.floor(Number(state.sites.ammoWorks.stockpile.ammo9 || 0)), 0,
    'successful ammunition purchase did not consume the real site stock');
}

function assertWorldTaskOutcomeStatsStayAccurate() {
  const { sim, state } = simulation('world-task-outcome-stats');
  state.sites.destination = site('destination', 660, 90, { owner: 'old_klim' });
  state.worldTasks = [
    {
      id: 'expired_delivery',
      key: 'expired_delivery',
      type: 'deliver_supplies',
      status: 'active',
      title: 'Expired delivery',
      siteId: 'destination',
      createdHour: 90,
      expiresHour: 99,
      priority: 2,
      reward: {},
      details: {}
    },
    {
      id: 'unavailable_patrol',
      key: 'unavailable_patrol',
      type: 'join_patrol',
      status: 'active',
      title: 'Unavailable patrol',
      partyId: 'missing_patrol',
      createdHour: 99,
      expiresHour: 200,
      priority: 1,
      reward: {},
      details: {}
    }
  ];

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  assert.strictEqual(Number(state.stats.worldTasksFailed || 0), 1,
    'expired task was not counted as a failed world task');
  assert.strictEqual(Number(state.stats.worldTasksResolved || 0), 1,
    'task removed because its world party vanished was not counted as resolved');
}

function assertFactionCaravanLossIsCountedAndFailsEscort() {
  const { sim, state } = simulation('faction-caravan-loss');
  state.parties.faction_caravan = party('faction_caravan', 'caravan', 'old_klim', 390, 90, {
    speedKmh: 30,
    strength: 55,
    members: 6,
    homeSiteId: 'settlement',
    destinationSiteId: 'scrapTown'
  });
  state.worldTasks = [{
    id: 'escort_faction_caravan',
    key: 'escort_faction_caravan',
    type: 'escort_caravan',
    status: 'active',
    title: 'Escort faction caravan',
    partyId: 'faction_caravan',
    siteId: 'settlement',
    createdHour: 99,
    expiresHour: 200,
    priority: 3,
    reward: {},
    details: {}
  }];

  sim.recordEncounterOutcome({
    encounterId: 'faction_caravan_ambush',
    worldPartyId: 'faction_caravan',
    worldPoint: { x: 390, y: 90 },
    deadFactions: ['old_klim'],
    aliveFactions: ['raiders'],
    playerInvolved: true,
    playerId: 'economy-check'
  });

  const escort = state.worldTasks.find(task => task.id === 'escort_faction_caravan');
  assert.strictEqual(state.parties.faction_caravan.state, 'destroyed', 'defeated faction caravan stayed alive');
  assert.strictEqual(Number(state.stats.caravansLost || 0), 1, 'faction-owned caravan loss was not counted exactly once');
  assert.strictEqual(escort?.status, 'failed', 'escort task did not fail when its faction-owned caravan was destroyed');
  assert.strictEqual(Number(state.stats.worldTasksFailed || 0), 1, 'failed caravan escort was missing from task statistics');
  assert.strictEqual(Number(state.stats.encountersResolved || 0), 1, 'recorded encounter was missing from simulation statistics');
}

function assertLiveCaravanBattleLossIsNotDoubleCounted() {
  const { sim, state } = simulation('live-caravan-loss-count');
  state.sites.west = site('west', 240, 90);
  state.sites.east = site('east', 660, 90);
  state.parties.caravan = party('caravan', 'caravan', 'caravans', 360, 90, {
    speedKmh: 54,
    destinationSiteId: 'east',
    strength: 80,
    members: 8
  });
  state.parties.raiders = party('raiders', 'raider', 'raiders', 540, 90, {
    speedKmh: 52,
    destinationSiteId: 'west',
    strength: 100,
    members: 8
  });
  state.worldTasks = [{
    id: 'escort_live_caravan',
    key: 'escort_live_caravan',
    type: 'escort_caravan',
    status: 'active',
    title: 'Escort live caravan',
    partyId: 'caravan',
    siteId: 'west',
    createdHour: 99,
    expiresHour: 200,
    priority: 3,
    reward: {},
    details: {}
  }];

  sim.tick(Date.now() + 1000, { hours: 0.75, force: true });
  const battle = state.worldZones.find(zone => zone.sourceType === 'caravan_battle' && zone.status === 'active');
  assert(battle, 'caravan collision did not create a live battle');
  sim.recordEncounterOutcome({
    encounterId: battle.encounterId,
    worldZoneId: battle.id,
    worldPartyId: 'caravan',
    worldPoint: { x: battle.x, y: battle.y },
    deadFactions: ['caravans'],
    aliveFactions: ['raiders'],
    playerInvolved: true,
    playerId: 'battle-check'
  });

  const escort = state.worldTasks.find(task => task.id === 'escort_live_caravan');
  assert.strictEqual(state.parties.caravan.state, 'destroyed', 'lost live caravan battle did not destroy the caravan');
  assert.strictEqual(Number(state.stats.caravansLost || 0), 1, 'one live caravan loss was counted more than once');
  assert.strictEqual(Number(state.stats.battlesResolved || 0), 1, 'resolved live caravan battle was not counted exactly once');
  assert.strictEqual(escort?.status, 'failed', 'live caravan loss did not fail its escort task');
}

function assertOnsiteZoneMigratesToUniqueLocationRoom() {
  const { sim, state } = simulation('onsite-zone-unique-location-room');
  state.sites.unique_site = site('unique_site', 360, 90, {
    locationId: 'world_unique_site',
    extra: { templateLocationId: 'randomAshGrove' }
  });
  state.worldZones = [{
    id: 'onsite_test_unique_site',
    kind: 'visit',
    status: 'active',
    sourceType: 'party_onsite',
    siteId: 'unique_site',
    partyId: 'test_party',
    locationId: 'randomAshGrove',
    roomId: 'randomAshGrove#1',
    createdHour: 90,
    expiresHour: 200,
    details: { onsiteParty: true, siteId: 'unique_site' }
  }];

  sim.tick(Date.now() + 1000, { hours: 0.01, force: true });

  const zone = state.worldZones.find(row => row.id === 'onsite_test_unique_site');
  assert.strictEqual(zone?.locationId, 'world_unique_site',
    'onsite zone kept the shared template instead of its unique global-map location');
  assert.strictEqual(zone?.roomId, 'world_unique_site',
    'onsite zone did not migrate into the single shared reality of its unique location');
}

function assertDestroyedPartyFormsVisiblyBeforeReturning() {
  const { sim, state } = simulation('destroyed-party-visible-formation');
  state.sites.settlement = site('settlement', 315, 615, {
    type: 'settlement',
    owner: 'old_klim',
    locationId: 'settlement'
  });
  state.parties.klim_road_patrol = party('klim_road_patrol', 'patrol', 'old_klim', 720, 120, {
    state: 'destroyed',
    homeSiteId: 'settlement',
    destinationSiteId: 'roadOutpost',
    extra: {
      destroyed: true,
      destroyedAtHour: 100,
      reformAtHour: 112,
      respawnHours: 12
    }
  });

  sim.tick(Date.now() + 1000, { hours: 8.5, force: true });
  assert.strictEqual(state.parties.klim_road_patrol.state, 'destroyed',
    'destroyed party became visible too early instead of respecting its rebuild delay');

  sim.tick(Date.now() + 2000, { hours: 0.6, force: true });
  const forming = state.parties.klim_road_patrol;
  assert.strictEqual(forming.state, 'forming',
    'destroyed default party reappeared without a visible formation phase');
  assert.strictEqual(forming.destroyed, true,
    'forming party became encounterable before the rebuild completed');
  assert.deepStrictEqual({ x: forming.x, y: forming.y }, { x: 315, y: 615 },
    'forming party did not appear at its home base');
  assert(state.events.some(event => event.type === 'party_forming' && event.partyId === forming.id),
    'visible party formation was not recorded in the world event stream');
  const publicForming = sim.publicState().parties.find(row => row.id === forming.id);
  assert.strictEqual(publicForming?.state, 'forming',
    'formation state is not exposed to the global-map client');
  assert(Number(publicForming?.reformAtHour || 0) > Number(state.worldHour || 0),
    'formation countdown is missing from the public party state');
  assert(String(publicForming?.statusText || '').includes('формируется на базе'),
    'formation status is not explained on the global map');

  sim.tick(Date.now() + 3000, { hours: 3, force: true });
  const reformed = state.parties.klim_road_patrol;
  assert.strictEqual(reformed.destroyed, false,
    'party stayed destroyed after its visible rebuild countdown elapsed');
  assert(!['destroyed', 'forming'].includes(String(reformed.state || '').toLowerCase()),
    'party did not return to a normal world-map state after rebuilding');
  assert.strictEqual(reformed.formationStartedHour, undefined,
    'formation bookkeeping leaked into the active party state');
}

function assertGlobalMapDoesNotHidePartiesByListPosition() {
  const { sim, state } = simulation('all-parties-visible');
  state.parties = {};
  for (let index = 0; index < 40; index += 1) {
    const id = `visibility_party_${index}`;
    state.parties[id] = party(id, index % 2 ? 'caravan' : 'patrol', index % 2 ? 'caravans' : 'old_klim', 60 + index * 10, 90);
  }
  assert.strictEqual(sim.publicState().parties.length, 40,
    'server public state truncates active parties before they reach players');

  const rowsStart = worldPartyRendererSource.indexOf('const allPartyRows');
  const rowsEnd = worldPartyRendererSource.indexOf('const signature = globalMapWorldParties3DSignature', rowsStart);
  assert(rowsStart >= 0 && rowsEnd > rowsStart, 'global-map party renderer block is missing');
  const partyRowsBody = worldPartyRendererSource.slice(rowsStart, rowsEnd);
  assert(!/\.slice\(0\s*,\s*\d+\)/.test(partyRowsBody),
    '3D global map still hides parties after a hard list-position limit');
  const canvasRowsStart = globalMapCanvasSource.indexOf('(Array.isArray(WASTELAND_SIM_STATE.parties)');
  const canvasRowsEnd = globalMapCanvasSource.indexOf(".filter(row => row && globalMapWorldPartyDestroyed(row)", canvasRowsStart);
  assert(canvasRowsStart >= 0 && canvasRowsEnd > canvasRowsStart, '2D global-map party renderer block is missing');
  const canvasPartyRowsBody = globalMapCanvasSource.slice(canvasRowsStart, canvasRowsEnd);
  assert(!/\.slice\(0\s*,\s*\d+\)/.test(canvasPartyRowsBody),
    '2D global map still hides active parties after a hard list-position limit');
  assert(worldPartyStatusSource.includes("if (String(row.state || '').toLowerCase() === 'forming') return true;"),
    'forming parties are not visible on their home base');
  assert(partyRowsBody.includes("String(row.state || '').toLowerCase() !== 'forming'"),
    'forming party would be drawn twice as both a live marker and destroyed aftermath');
}

function assertGlobalMapDestinationMarkersStayConsistent() {
  assert(globalMapPlayerModelSource.includes('new THREE.TorusBufferGeometry(globalMapPlayerMarkerCircleRadius()'),
    'player marker does not use the shared player-circle radius');
  assert(globalMapDynamicCacheSource.includes('const playerMarkerRadius = globalMapPlayerMarkerCircleRadius();')
    && globalMapDynamicCacheSource.includes('new THREE.TorusBufferGeometry(playerMarkerRadius,'),
    'destination marker diameter differs from the player circle');
  assert(worldPartyRendererSource.includes('dynamic.flag.scale.setScalar(1);'),
    'destination marker is resized independently from the player circle');
  assert(!/addGlobalMap3DPointLine\s*\(\s*dynamic\.(?:worldParties|factionFronts)/.test(worldPartyRendererSource),
    'a 3D squad threat, front, or destination layer still draws a dotted connector');
  const front2dStart = worldPartyStatusSource.indexOf('function drawGlobalMapFactionFronts2D');
  const front2dEnd = worldPartyStatusSource.indexOf('\n  function ', front2dStart + 10);
  assert(front2dStart >= 0 && front2dEnd > front2dStart,
    '2D faction-front renderer block is missing');
  const front2dBody = worldPartyStatusSource.slice(front2dStart, front2dEnd);
  assert(!front2dBody.includes('ctx.setLineDash') && !front2dBody.includes('ctx.lineTo(target.x, target.y)'),
    'the 2D fallback still draws a dotted connector from a squad to a target');
}

function assertOnsitePartiesCanMaterializeInSafeLocations() {
  const setupStart = serverSource.indexOf('function setupWorldZoneBattleRoom');
  const setupEnd = serverSource.indexOf('function attachActiveWorldZoneToSharedRoom', setupStart);
  assert(setupStart >= 0 && setupEnd > setupStart, 'world-zone room setup block is missing');
  const setupBody = serverSource.slice(setupStart, setupEnd);
  assert(setupBody.includes('allowSafeLocation: true'),
    'physical onsite-party actors are still rejected by the safe-location spawn guard');
}

try {
  assertIntermediateSiteEntry();
  assertCapturedSiteExitDoesNotRetrigger();
  assertCompletedVisitChoosesAnotherLocation();
  assertStagingCaravanLeavesThroughLocalExit();
  assertDynamicSupplyCaravanCompletesLinkedOperation();
  assertInterFactionTradeResolvesDeliveryBeforeEscortReturn();
  assertSupplyOperationIgnoresIncidentalSettlement();
  assertSupplyDeliveryRespectsAssignedCaravan();
  assertLinkedSupplyRequestTerminalKeepsNpcDestination();
  assertEscortExpiryKeepsNpcSupplyOperation();
  assertExpiredEscortOperationReroutesAndSettles();
  assertLootedTransientOnsiteZoneReactivates();
  assertSweptPartyCollision();
  assertThirdPartyJoinsLiveBattle();
  assertPartyClashOutcomeFollowsAssignedSides();
  assertMutuallyHostilePartiesStayOnOppositeSides();
  assertThreatAvoidanceRoute();
  assertBlockedLocationAvoidance();
  assertSituationalReplanning();
  assertPatrolDecisionCreatesLinkedMissionParticipation();
  assertPatrolPublicFeedSeparatesNpcStatusFromPlayerParticipation();
  assertPatrolDefenseAssignmentSynchronizesWorldTasks();
  assertPatrolArrivalCompletesMissionOperation();
  assertPatrolRepelledConflictCompletesMissionOperation();
  assertDefendingPatrolHoldsOnsiteUntilConflictEnds();
  assertPatrolDoesNotReinforceCapturedTarget();
  assertPatrolParticipationTerminalKeepsNpcOperationActive();
  assertPatrolOperationRewardRequiresCompletedDuty();
  assertDestroyedPatrolFailsMissionOperation();
  assertTradeMachineStockIsActuallyBacked();
  assertWorldTaskOutcomeStatsStayAccurate();
  assertFactionCaravanLossIsCountedAndFailsEscort();
  assertLiveCaravanBattleLossIsNotDoubleCounted();
  assertOnsiteZoneMigratesToUniqueLocationRoom();
  assertDestroyedPartyFormsVisiblyBeforeReturning();
  assertGlobalMapDoesNotHidePartiesByListPosition();
  assertGlobalMapDestinationMarkersStayConsistent();
  assertOnsitePartiesCanMaterializeInSafeLocations();
  console.log('Wasteland autonomy check passed: complete party visibility, stable site visits, linked dynamic supply and patrol operations, physical caravan exits, unique onsite rooms, visible party reformation, zone reactivation, side-aware battle outcomes, collisions, routing, situational goals, and backed trade stock.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
