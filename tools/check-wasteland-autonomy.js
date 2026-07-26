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
  assertLootedTransientOnsiteZoneReactivates();
  assertSweptPartyCollision();
  assertThirdPartyJoinsLiveBattle();
  assertPartyClashOutcomeFollowsAssignedSides();
  assertMutuallyHostilePartiesStayOnOppositeSides();
  assertThreatAvoidanceRoute();
  assertBlockedLocationAvoidance();
  assertSituationalReplanning();
  assertTradeMachineStockIsActuallyBacked();
  assertWorldTaskOutcomeStatsStayAccurate();
  assertFactionCaravanLossIsCountedAndFailsEscort();
  assertLiveCaravanBattleLossIsNotDoubleCounted();
  assertOnsiteZoneMigratesToUniqueLocationRoom();
  assertDestroyedPartyFormsVisiblyBeforeReturning();
  assertGlobalMapDoesNotHidePartiesByListPosition();
  assertGlobalMapDestinationMarkersStayConsistent();
  assertOnsitePartiesCanMaterializeInSafeLocations();
  console.log('Wasteland autonomy check passed: complete party visibility, stable site visits, physical caravan exits, unique onsite rooms, visible party reformation, zone reactivation, side-aware battle outcomes, collisions, routing, situational goals, and backed trade stock.');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
