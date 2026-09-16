'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  TERRITORY_MEMBERSHIP_VERSION,
  canJoinTerritoryFaction,
  joinTerritoryFaction,
  leaveTerritoryFaction,
  publicTerritoryMembership,
  sanitizeTerritoryMembership,
  territoryChangeCooldownMs,
  territoryFactionIds,
  territoryLocationAccess,
  territoryMembershipActive
} = require('../src/server/territory-membership');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
// Канонные характеристики видов: усиление внутренней части считается от них.
const mutantStats = Object.fromEntries(
  (JSON.parse(read('data/mutants.json')).types || []).map(row => [row.id, row.stats || {}])
);
const catalog = JSON.parse(read('data/kromka/territory.json'));
const now = 1_900_000_000_000;
const cooldown = territoryChangeCooldownMs(catalog);

assert.strictEqual(catalog.schema, 'kromka.territory.v1');
assert.deepStrictEqual(territoryFactionIds(catalog), ['uprava', 'free_artels', 'contour', 'tract_league']);
assert.strictEqual(cooldown, 259200000, 'faction change cooldown is 72 real hours');
assert.strictEqual(catalog.rules.combatExitGraceMs, 10000);
assert.strictEqual(catalog.outpostRules.ownerChangeLockMs, 1200000, 'outpost owner-change lock is 20 real minutes');

// Пустая/испорченная запись безопасна.
assert.deepStrictEqual(sanitizeTerritoryMembership(null, catalog), {
  version: TERRITORY_MEMBERSHIP_VERSION, factionId: '', joinedAt: 0, changeAllowedAt: 0, history: []
});
assert.strictEqual(sanitizeTerritoryMembership({ factionId: 'seconds', joinedAt: 5 }, catalog).factionId, '',
  'a faction outside the territory list cannot be a territory membership');
assert.strictEqual(territoryMembershipActive(sanitizeTerritoryMembership({ factionId: 'uprava' }, catalog)), true);

// Вступление, кулдаун, смена и выход.
assert.strictEqual(canJoinTerritoryFaction(null, 'seconds', catalog, now).ok, false);
const joined = joinTerritoryFaction(null, 'uprava', catalog, now, { reputation: 0 });
assert.strictEqual(joined.ok, true);
assert.strictEqual(joined.membership.factionId, 'uprava');
assert.strictEqual(joined.membership.joinedAt, now);
assert.strictEqual(joined.membership.changeAllowedAt, now + cooldown);
assert.deepStrictEqual(joined.membership.history, [{ factionId: 'uprava', action: 'join', at: now }]);
assert.strictEqual(joinTerritoryFaction(joined.membership, 'uprava', catalog, now + 1).ok, false, 'joining twice is rejected');
const tooEarly = joinTerritoryFaction(joined.membership, 'contour', catalog, now + cooldown - 1);
assert.strictEqual(tooEarly.ok, false);
assert.strictEqual(tooEarly.retryAt, now + cooldown);
const switched = joinTerritoryFaction(joined.membership, 'contour', catalog, now + cooldown);
assert.strictEqual(switched.ok, true);
assert.strictEqual(switched.switched, true);
assert.strictEqual(switched.previousFactionId, 'uprava');
assert.strictEqual(switched.membership.factionId, 'contour');
assert.strictEqual(switched.membership.history.length, 2);
assert.strictEqual(leaveTerritoryFaction(switched.membership, catalog, now + cooldown + 5).ok, false, 'leaving inside the cooldown is closed');
const left = leaveTerritoryFaction(switched.membership, catalog, now + cooldown * 2);
assert.strictEqual(left.ok, true);
assert.strictEqual(left.membership.factionId, '');
assert.strictEqual(left.membership.changeAllowedAt, now + cooldown * 3);
assert.strictEqual(leaveTerritoryFaction(left.membership, catalog, now + cooldown * 4).ok, false);
assert.strictEqual(joinTerritoryFaction(null, 'uprava', catalog, now, { reputation: -30 }).ok,
  catalog.rules.joinRequiresReputation <= -30, 'reputation gate follows the catalog');

// Доступ к локациям: зона, база своей/чужой фракции, обычная локация.
const zone = JSON.parse(read('data/locations/coreZone.json'));
const ownBase = JSON.parse(read('data/locations/coreBaseUprava.json'));
const otherBase = JSON.parse(read('data/locations/coreBaseContour.json'));
const lab = JSON.parse(read('data/locations/coreLabSprout.json'));
const settlement = JSON.parse(read('data/locations/settlement.json'));
assert.strictEqual(territoryLocationAccess(settlement, null, catalog).allowed, true);
assert.strictEqual(territoryLocationAccess(zone, null, catalog).allowed, false, 'non-members cannot enter the zone');
assert.strictEqual(territoryLocationAccess(lab, null, catalog).allowed, false, 'non-members cannot enter labs');
assert.strictEqual(territoryLocationAccess(ownBase, null, catalog).allowed, false, 'non-members cannot enter bases');
assert.strictEqual(territoryLocationAccess(zone, joined.membership, catalog).allowed, true);
assert.strictEqual(territoryLocationAccess(lab, joined.membership, catalog).allowed, true);
assert.strictEqual(territoryLocationAccess(ownBase, joined.membership, catalog).allowed, true);
assert.strictEqual(territoryLocationAccess(otherBase, joined.membership, catalog).allowed, false, 'only the own faction enters its base');
assert.strictEqual(territoryLocationAccess(otherBase, joined.membership, catalog).access, 'ownFaction');
assert.strictEqual(zone.noGlobalMapEntry, true, 'the zone is entered only through faction platforms');
assert.strictEqual(zone.allowGlobalMapExit, false);
// Экономика v3: Сердцевина — чёрная зона, базы фракций остаются мирными.
assert.strictEqual(zone.pvpMode, 'pvpBlack');
assert.strictEqual(lab.pvpMode, 'pvpBlack');
assert.strictEqual(ownBase.pvpMode, 'peaceful');
assert.strictEqual(zone.map.width, 320);
for (const faction of catalog.factions) {
  const base = JSON.parse(read(`data/locations/${faction.baseLocationId}.json`));
  assert.strictEqual(base.factionAccess, faction.id);
  const metro = base.transitions.find(row => row.id === 'metro_platform');
  assert(metro && metro.to === 'coreZone' && metro.entryKey === faction.platform.entryKey, `${faction.id} base has a metro platform into the zone`);
  assert(zone[faction.platform.entryKey], `zone has the ${faction.id} platform entry point`);
  const back = zone.transitions.find(row => row.id === `metro_${faction.id}`);
  assert(back && back.to === faction.baseLocationId && back.factionAccess === faction.id, `zone platform returns only its faction to ${faction.baseLocationId}`);
  const platform = zone.worldZones.find(row => row.id === faction.platform.id);
  assert(platform && platform.type === 'factionPlatform' && platform.factionId === faction.id);
  assert(base.objects.some(row => row.entity?.service === 'registrar'), `${faction.id} base has a registrar`);
  assert(base.objects.some(row => row.entity?.service === 'medic'), `${faction.id} base has a medic`);
  assert(base.objects.some(row => row.entity?.service === 'auction'), `${faction.id} base has an auctioneer`);
  assert(base.objects.some(row => row.entity?.service === 'artifactLab'), `${faction.id} base has an artifact researcher`);
  assert(base.objects.some(row => row.interactive?.role === 'storage' && row.interactive.storageFaction === faction.id), `${faction.id} base has personal storage`);
  assert(base.objects.some(row => row.entity?.traderProfile === faction.traderProfile), `${faction.id} base has a trader`);
}
// Все пять лабораторий наследуют правила территории: вход только для членов
// фракции, тот же режим PvP и та же полная потеря при смерти, что в зоне.
const labIds = [...catalog.labs.map(row => row.id), 'coreLabCenterService', 'coreLabCenterResearch', 'coreLabCenterReactor'];
for (const labId of labIds) {
  const definition = JSON.parse(read(`data/locations/${labId}.json`));
  assert.strictEqual(definition.pvpMode, zone.pvpMode, `${labId} keeps the territory PvP mode`);
  assert.strictEqual(definition.safe, false, `${labId} is not a safe location`);
  assert.strictEqual(definition.factionAccess, 'territory', `${labId} is open only to members of the territory factions`);
  assert.strictEqual(definition.noGlobalMapEntry, true, `${labId} is not entered from the world map`);
  assert.notStrictEqual(definition.allowGlobalMapExit, true, `${labId} has no way out to the world map`);
}
for (const labRow of catalog.labs) {
  const definition = JSON.parse(read(`data/locations/${labRow.id}.json`));
  const exit = definition.transitions.find(row => row.id === 'exit_to_core');
  assert(exit && exit.to === 'coreZone' && exit.entryKey === labRow.entryKey && zone[labRow.entryKey], `${labRow.id} returns to its zone entrance`);
  assert(zone.transitions.some(row => row.to === labRow.id), `zone has an entrance into ${labRow.id}`);

  // Второй путь наружу: аварийный шлюз в дальнем конце внутренней секции
  // выводит к вентиляционной шахте, а не к гермодвери, через которую вошли.
  const vent = definition.transitions.find(row => row.id === 'vent_to_core');
  assert(vent && vent.to === 'coreZone' && vent.entryKey === labRow.ventEntryKey,
    `${labRow.id} has an emergency way back`);
  assert(zone[labRow.ventEntryKey], `zone has the surface point of the ${labRow.id} shaft`);
  assert(Math.hypot(vent.x - exit.x, vent.z - exit.z) > 20, `${labRow.id}: the shaft is not next to the main door`);
  assert(Math.hypot(zone[labRow.ventEntryKey].x - zone[labRow.entryKey].x, zone[labRow.ventEntryKey].z - zone[labRow.entryKey].z) > 10,
    `${labRow.id}: the shaft surfaces away from the laboratory door`);
  assert(!zone.transitions.some(row => row.entryKey === labRow.ventEntryKey),
    `${labRow.id}: the shaft is a way out, not a second entrance`);
  assert(definition.objects.some(row => row.id === 'vent_shaft' && row.interactive?.kind === 'transition' && row.interactive.to === 'coreZone'),
    `${labRow.id}: the shaft is visible in the hall`);

  // Внешние помещения и опасная внутренняя часть отличаются не только
  // расстановкой: за герметичной секцией стоят откормленные твари.
  const guardians = definition.objects.filter(row => String(row.id || '').includes('_guardian_'));
  assert(guardians.length >= 4, `${labRow.id}: the hall is guarded`);
  const outer = guardians.filter(row => row.entity?.labSection === 'outer');
  const inner = guardians.filter(row => row.entity?.labSection === 'inner');
  assert(outer.length >= 1 && inner.length >= 2, `${labRow.id}: the hall has both an outer and an inner guard`);
  for (const row of outer) {
    assert(Number(row.position?.z || 0) < 12, `${labRow.id}: ${row.id} stands in the outer rooms`);
    assert(row.entity.hp === undefined && row.entity.atk === undefined, `${labRow.id}: ${row.id} keeps the ordinary stats of its kind`);
  }
  for (const row of inner) {
    assert(Number(row.position?.z || 0) >= 12, `${labRow.id}: ${row.id} stands beyond the sealed section`);
    const base = mutantStats[row.entity.creatureTypeId] || {};
    assert.equal(row.entity.hp, Math.round(Number(base.hp || 40) * 1.5), `${labRow.id}: ${row.id} is fed up on health`);
    assert.equal(row.entity.atk, Math.round(Number(base.attack || 5) * 1.3), `${labRow.id}: ${row.id} hits harder than its kin outside`);
  }
}
const service = JSON.parse(read('data/locations/coreLabCenterService.json'));
const research = JSON.parse(read('data/locations/coreLabCenterResearch.json'));
const reactor = JSON.parse(read('data/locations/coreLabCenterReactor.json'));
assert(service.transitions.some(row => row.to === 'coreLabCenterResearch') && research.transitions.some(row => row.to === 'coreLabCenterReactor'));
assert(research.transitions.filter(row => row.to === 'coreZone' || row.to === 'coreLabCenterService').length >= 2, 'the research level has several ways back');

// Исследовательский уровень разделён на крылья, и спуск к установке есть в
// каждом: центральный лифт и восточный грузовой ствол. Тем же стволом уходят
// обратно, поэтому из зала установки наверх ведут два пути.
const descents = research.transitions.filter(row => row.to === 'coreLabCenterReactor');
assert.equal(descents.length, 2, 'the research level offers two routes down to the installation');
assert.equal(new Set(descents.map(row => row.entryKey)).size, 2, 'each descent arrives at its own point');
for (const row of descents) assert(reactor[row.entryKey], `the installation has the arrival point ${row.entryKey}`);
assert(Math.hypot(descents[0].x - descents[1].x, descents[0].z - descents[1].z) > 15, 'the routes down run through different wings');
assert(Math.hypot(reactor[descents[0].entryKey].x - reactor[descents[1].entryKey].x,
  reactor[descents[0].entryKey].z - reactor[descents[1].entryKey].z) > 15, 'the routes land in different parts of the hall');
const ascents = reactor.transitions.filter(row => row.to === 'coreLabCenterResearch');
assert.equal(ascents.length, 2, 'the installation has two ways back up');
for (const row of ascents) assert(research[row.entryKey], `the research level has the arrival point ${row.entryKey}`);
for (const level of [research, reactor]) {
  assert(level.objects.some(row => row.id === 'east_shaft' && row.interactive?.kind === 'transition'),
    'the cargo shaft is visible on both levels');
}
assert(reactor.objects.some(row => row.entity?.worldBoss === true), 'the reactor level hosts the world boss');
assert(reactor.objects.filter(row => row.interactive?.role === 'shield').length === 4, 'the boss has four shield nodes');

// Публичный снимок не содержит лишнего и объясняет кулдаун.
const snapshot = publicTerritoryMembership(joined.membership, catalog, now + 10);
assert.deepStrictEqual(Object.keys(snapshot).sort(), [
  'availableFactionIds', 'baseLocationId', 'changeAllowedAt', 'changeCooldownMs', 'changeLocked', 'factionId', 'joinedAt', 'territoryId', 'version'
]);
assert.strictEqual(snapshot.changeLocked, true);
assert.strictEqual(snapshot.baseLocationId, 'coreBaseUprava');

// Серверная привязка: доступ проверяется на каждом пути входа, PvP и охрана
// используют принадлежность, членство сохраняется и восстанавливается.
const server = read('server.js');
for (const token of [
  "require('./src/server/territory-membership')",
  'territoryLocationAccess(baseLoc, p.territoryFaction, KROMKA_TERRITORY_CATALOG)',
  'territoryLocationAccess(baseLoc, savedState.territoryFaction, KROMKA_TERRITORY_CATALOG)',
  'territoryLocationAccess(targetLoc, member.territoryFaction, KROMKA_TERRITORY_CATALOG)',
  'targetLoc.noGlobalMapEntry === true',
  'next.territoryFaction = sanitizeTerritoryMembership(player.territoryFaction, KROMKA_TERRITORY_CATALOG);',
  'territoryFaction: sanitizeTerritoryMembership(savedState.territoryFaction, KROMKA_TERRITORY_CATALOG),',
  '&& !serverTerritoryPvpBlock(attacker, target, room, now)',
  "if (playerTerritoryFaction && playerTerritoryFaction !== actorTerritoryFaction) return true;",
  "socket.on('territoryFactionAction'",
  "socket.on('baseServiceAction'",
  'serverAccessibleSettlementId(p.lastVisitedSettlementId || cause.lastVisitedSettlementId',
  'territoryFaction: publicTerritoryMembership(p.territoryFaction, KROMKA_TERRITORY_CATALOG)',
  "coreBaseUprava: 'uprava'",
  '&& !ticketedRuntimeLocation && !localTransition) {',
  // Авторские характеристики доходят до актёра — иначе усиленные стражи
  // внутренней части лаборатории ничем не отличались бы от внешних.
  'hp: Number.isFinite(Number(entity.hp)) ? Math.max(1, Math.floor(Number(entity.hp))) : undefined,',
  'atk: Number.isFinite(Number(entity.atk)) ? Math.max(0, Math.floor(Number(entity.atk))) : undefined,',
  'if (Number.isFinite(Number(opts.hp))) {',
  'enemy.maxHp = Math.max(1, Math.floor(Number(opts.hp)));'
]) assert(server.includes(token), `server.js is missing territory wiring: ${token}`);
assert(!server.includes('Постоянного вступления больше нет') || server.includes("socket.on('worldFactionJoin'"),
  'legacy permanent-join stub stays for old clients while territory allegiance is the new path');

console.log('Territory membership OK: 4 factions, 72h change cooldown, per-entry access checks, metro platforms, labs and base services are wired.');
