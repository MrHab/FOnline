#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert(start >= 0, `Missing function ${name}`);
  const paramsOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let paramsClose = -1;
  for (let index = paramsOpen; index < source.length; index++) {
    if (source[index] === '(') parenDepth++;
    else if (source[index] === ')' && --parenDepth === 0) {
      paramsClose = index;
      break;
    }
  }
  const open = source.indexOf('{', paramsClose);
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed function ${name}`);
}

function rows(input = []) {
  const source = Array.isArray(input)
    ? input
    : Object.entries(input && typeof input === 'object' ? input : {}).map(([id, qty]) => ({ id, qty }));
  return source
    .map(row => ({ id: String(row?.id || ''), qty: Math.max(0, Math.floor(Number(row?.qty || 0))) }))
    .filter(row => row.id && row.qty > 0);
}

const context = {
  SERVER_FACTION_STORAGE_IDS: new Set(['old_klim', 'scrap_union', 'relay_order', 'caravans']),
  sanitizeServerInventorySnapshot: rows,
  serverInventoryRowsToObject: input => Object.fromEntries(rows(input).map(row => [row.id, row.qty])),
  locationCapitalFaction: value => ({ settlement: 'old_klim', scrapTown: 'scrap_union', relayStation: 'relay_order', caravanCamp: 'caravans' })[String(value || '')] || ''
};
vm.createContext(context);
vm.runInContext([
  functionSource(server, 'serverStorageFactionKey'),
  functionSource(server, 'serverPlayerStorageFaction'),
  functionSource(server, 'ensureServerFactionStorages'),
  functionSource(server, 'serverFactionStorageRows'),
  functionSource(server, 'serverFactionStoragesFromState'),
  functionSource(server, 'serverFactionStoragesToState')
].join('\n'), context);

const migrated = context.serverFactionStoragesFromState({ storage: { water: 3, ammo9: 8 } });
assert.deepStrictEqual(Array.from(migrated.old_klim), [{ id: 'water', qty: 3 }, { id: 'ammo9', qty: 8 }]);
assert.strictEqual(migrated.scrap_union.length, 0, 'Legacy storage leaked into Scrap Union storage');
assert.strictEqual(migrated.relay_order.length, 0, 'Legacy storage leaked into Relay Order storage');
assert.strictEqual(migrated.caravans.length, 0, 'Legacy storage leaked into Free Caravans storage');

const canonical = context.serverFactionStoragesFromState({
  storage: { water: 99 },
  factionStorages: {
    old_klim: { water: 1 },
    scrap_union: { ammo9: 4 },
    relay_order: { electronics: 2 },
    caravans: { food: 6 }
  }
});
assert.deepStrictEqual(Array.from(canonical.old_klim), [{ id: 'water', qty: 1 }]);
assert.deepStrictEqual(Array.from(canonical.scrap_union), [{ id: 'ammo9', qty: 4 }]);
assert.deepStrictEqual(Array.from(canonical.relay_order), [{ id: 'electronics', qty: 2 }]);
assert.deepStrictEqual(Array.from(canonical.caravans), [{ id: 'food', qty: 6 }]);

const player = { storage: [{ id: 'scrap', qty: 5 }] };
context.ensureServerFactionStorages(player);
context.serverFactionStorageRows(player, 'scrap_union').push({ id: 'ammo9', qty: 7 });
assert.deepStrictEqual(Array.from(player.factionStorages.old_klim), [{ id: 'scrap', qty: 5 }]);
assert.deepStrictEqual(Array.from(player.factionStorages.scrap_union), [{ id: 'ammo9', qty: 7 }]);
assert.strictEqual(context.serverFactionStorageRows(player, 'unknown').length, 0);

const spawnContainers = functionSource(server, 'spawnRoomWorldContainers');
assert(!spawnContainers.includes('wastelandFactionWarehouseDefs'), 'Remote faction warehouses are still spawned as world containers');
const normalizeLocation = functionSource(server, 'normalizeLocationDefinition');
assert(normalizeLocation.includes('locationDefinitionObjectIsWarehouse'), 'Location normalization does not remove remote warehouse objects');
assert(normalizeLocation.includes('locationCapitalStorageObject'), 'Faction capitals do not receive canonical storage objects');
const transfer = functionSource(server, 'performServerStorageTransfer');
assert(transfer.includes('ensureServerFactionStorages(player)[storageFaction] = nextStorage'), 'Transfers are not persisted in the selected faction storage');

console.log('Faction storage check passed: four isolated capital storages with legacy migration.');
