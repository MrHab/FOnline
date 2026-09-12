'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  beginInventoryMutation,
  commitInventoryMutation,
  sanitizeInventoryMutationLedger
} = require('../src/server/kromka-inventory-transactions');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const unity = [
  'unity-client/Assets/Scripts/Game/RoaInteraction.cs',
  'unity-client/Assets/Scripts/Game/RoaInventory.cs',
  'unity-client/Assets/Scripts/Game/RoaPipboyCanvas.cs'
].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

const player = { inventoryMutationLedger: [] };
const payload = {
  requestId: 'tx_storage_1',
  direction: 'deposit',
  rows: [{ id: 'pistol', qty: 1 }]
};

const first = beginInventoryMutation(player, 'storageTransfer', payload, ['direction', 'rows']);
assert.strictEqual(first.ok, true, 'first request should be accepted');
assert.strictEqual(first.replay, false, 'first request cannot be a replay');
commitInventoryMutation(player, first, { ok: true, direction: 'deposit', moved: 1 });

const duplicate = beginInventoryMutation(player, 'storageTransfer', payload, ['direction', 'rows']);
assert.strictEqual(duplicate.ok, true, 'identical replay should be acknowledged');
assert.strictEqual(duplicate.replay, true, 'identical replay should not execute again');
assert.strictEqual(duplicate.result.reused, true, 'replay response should be explicit');

const collision = beginInventoryMutation(player, 'storageTransfer', {
  ...payload,
  rows: [{ id: 'pistol', qty: 2 }]
}, ['direction', 'rows']);
assert.strictEqual(collision.ok, false, 'request id reuse with other data must fail');

const reconnected = { inventoryMutationLedger: JSON.parse(JSON.stringify(player.inventoryMutationLedger)) };
const afterReconnect = beginInventoryMutation(reconnected, 'storageTransfer', payload, ['direction', 'rows']);
assert.strictEqual(afterReconnect.replay, true, 'persisted ledger must reject a replay after reconnect');

const cancelled = beginInventoryMutation(player, 'craftingStationUsed', {
  requestId: 'tx_cancelled',
  recipeId: 'ammo9'
}, ['recipeId']);
assert.strictEqual(cancelled.replay, false);
const retryAfterCancellation = beginInventoryMutation(player, 'craftingStationUsed', {
  requestId: 'tx_cancelled',
  recipeId: 'ammo9'
}, ['recipeId']);
assert.strictEqual(retryAfterCancellation.replay, false, 'uncommitted/failed mutation must remain retryable');

assert.strictEqual(sanitizeInventoryMutationLedger(new Array(140).fill(null).map((_, index) => ({
  kind: 'craftingStationUsed', requestId: `req_${index}`, fingerprint: 'x', t: index
}))).length, 96, 'ledger should remain bounded');

for (const kind of ['storageTransfer', 'inventoryItemAction', 'tradeMachineExchange', 'craftingStationUsed']) {
  assert(server.includes(`'${kind}'`) && server.includes('beginInventoryMutation'), `${kind} is not protected on server`);
}
assert(server.includes('next.inventoryMutationLedger = sanitizeInventoryMutationLedger'), 'ledger is not persisted');
assert(server.includes('inventoryMutationLedger: sanitizeInventoryMutationLedger(savedState.inventoryMutationLedger || [])'), 'ledger is not restored');
assert((unity.match(/\["requestId"\]\s*=\s*Guid\.NewGuid\(\)/g) || []).length >= 7, 'Unity inventory requests need unique request ids');

console.log('Kromka inventory transaction checks passed: replay, cancellation, collision and reconnect are safe.');
