'use strict';

// The account balance and legacy character inventory are staged together.
// The caller persists both in one save transaction before the migration is
// considered complete. A failed write restores the live account and player.
function migrateAccountMarks(player, account, options = {}) {
  if (!player || !account) return false;
  const { inventoryQty, inventorySetRows, persist, onError } = options;
  if (typeof inventoryQty !== 'function' || typeof inventorySetRows !== 'function' || typeof persist !== 'function') {
    throw new TypeError('inventoryQty, inventorySetRows and persist are required');
  }
  const legacy = inventoryQty(player.inventory || [], 'silver');
  const previousMarks = account.marks || 0;
  const previousInventory = player.inventory;
  const maxMarks = Math.max(0, Number(options.maxMarks) || 0);
  const nextMarks = Math.min(maxMarks, previousMarks + legacy);
  const nextInventory = inventorySetRows(player.inventory || [], 'silver', nextMarks);
  account.marks = nextMarks;
  player.inventory = nextInventory;
  player.marksOnAccount = true;
  if (legacy <= 0) return true;

  let saved = false;
  try {
    saved = persist(player) === true;
  } catch (error) {
    if (typeof onError === 'function') {
      try { onError(error); } catch (_) { /* reporting cannot prevent rollback */ }
    }
  }
  if (saved) return true;
  account.marks = previousMarks;
  player.inventory = previousInventory;
  player.marksOnAccount = false;
  return false;
}

module.exports = { migrateAccountMarks };
