'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  KROMKA_FACTION_IDS,
  PLAYER_FACTION_MODEL_VERSION,
  canonicalKromkaFactionId,
  migrateKromkaPlayerFactionState,
  sanitizeKromkaContracts
} = require('../src/server/kromka-faction-contracts');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const factions = JSON.parse(read('data/kromka/factions.json'));
const economy = JSON.parse(read('data/kromka/economy.json'));
const items = JSON.parse(read('data/kromka/items.json'));
const server = read('server.js');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const pipboyCanvas = read('unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs');
const interaction = read('unity-client/Assets/Scripts/Game/RoaInteraction.cs');

assert.deepStrictEqual(factions.factions.map(row => row.id), KROMKA_FACTION_IDS,
  'authoritative faction order/ids differ from the runtime contract');
assert(factions.factions.every(row => row.joinable === false), 'permanent faction membership must be disabled');
assert(factions.factions.every(row => Object.keys(row.relations || {}).length === KROMKA_FACTION_IDS.length - 1),
  'every side must define relations with all other sides');
assert(factions.factions.every(row => row.patrolDoctrine && row.economicPlan && row.contractFamilies?.length >= 3),
  'every side must define patrols, an economic plan and contract families');
assert.strictEqual(factions.playerMembership, 'contract-reputation');
assert.strictEqual(economy.currency.itemId, 'silver');
assert.strictEqual(economy.strategicResource.itemId, 'blue');
assert.strictEqual(economy.strategicResource.ordinaryCurrency, false);
assert.strictEqual(economy.strategicResource.rules.soldByOrdinaryVendors, false);
assert(server.includes("socket.on('worldFactionJoin'"), 'legacy join socket must remain for a clear migration error');
assert(server.includes('Постоянного вступления больше нет. Возьмите временный контракт'), 'join socket must reject permanent membership');
assert.strictEqual(items.items.find(row => row.id === 'blue')?.stackLimit, 60,
  'the authoritative item catalog must enforce the strategic resource stack limit');
assert(server.includes('const SERVER_ITEM_STACK_LIMITS = KROMKA_ITEM_INDEXES.stackLimits;'),
  'server must read strategic resource stack limits from the authoritative item catalog');
assert(pipboy.includes('public static bool IsJoinableFaction(string id)\n        {\n            return false;'), 'Unity must reject permanent faction joining');
assert(pipboyCanvas.includes('Независимый наёмник'), 'Unity faction page must identify the player as an independent mercenary');
assert(pipboyCanvas.includes('КОНТРАКТ АКТИВЕН'), 'Unity faction page must expose temporary contract state');
assert(pipboyCanvas.includes('Тайна:'), 'Unity faction page must expose discovered-secret state');
assert(interaction.includes('Joinable = false'), 'job boards must not offer permanent faction joining');

assert.strictEqual(canonicalKromkaFactionId('old_klim'), 'uprava');
assert.strictEqual(canonicalKromkaFactionId('scrap_union'), 'free_artels');
assert.strictEqual(canonicalKromkaFactionId('relay_order'), 'contour');
assert.strictEqual(canonicalKromkaFactionId('caravans'), 'tract_league');

const now = 1_900_000_000_000;
const legacy = {
  characterProfile: {
    factionId: 'scrap_union',
    factionName: 'Свалочный союз',
    worldFactionReputation: { scrap_union: 11 }
  },
  worldFactionReputation: { relay_order: -7 },
  inventory: [{ id: 'rifle', qty: 1 }, { id: 'silver', qty: 93 }],
  factionStorages: { scrap_union: [{ id: 'scrap', qty: 9 }] }
};
const migrated = migrateKromkaPlayerFactionState(JSON.parse(JSON.stringify(legacy)), now);
assert.strictEqual(migrated.characterProfile.factionId, '');
assert.strictEqual(migrated.characterProfile.worldFactionId, '');
assert.strictEqual(migrated.worldFactionModelVersion, PLAYER_FACTION_MODEL_VERSION);
assert.strictEqual(migrated.worldFactionReputation.free_artels, 25);
assert.strictEqual(migrated.worldFactionReputation.contour, -7);
assert.strictEqual(migrated.factionContracts.free_artels.source, 'legacy-transition');
assert.strictEqual(migrated.factionContracts.free_artels.expiresAt, now + 7 * 24 * 60 * 60 * 1000);
assert.deepStrictEqual(migrated.inventory, legacy.inventory, 'faction migration must not alter inventory');
assert.deepStrictEqual(migrated.factionStorages, legacy.factionStorages, 'faction migration must not alter stored items');

const contracts = sanitizeKromkaContracts({
  old_klim: { taskId: 'task-old', issuedAt: now - 10, expiresAt: now + 10 },
  relay_order: { taskId: '', issuedAt: now - 20, expiresAt: now - 1 }
}, now);
assert(contracts.uprava, 'active legacy-alias contract should migrate');
assert(!contracts.contour, 'expired transition contract should be removed');

console.log(`Kromka factions OK: ${KROMKA_FACTION_IDS.length} contract sides, independent-player migration, blue/marks split.`);
