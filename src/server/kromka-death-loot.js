'use strict';

function cloneRows(rows = []) {
  return Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
}

function deathLootTransactionId(target = {}, mode = 'peaceful', now = Date.now()) {
  return `${String(target.characterId || target.id || 'player')}:${Math.max(0, Number(target.diedAt || now))}:${String(mode || 'peaceful')}`;
}

function deathLootPolicy(mode = 'peaceful') {
  if (mode === 'pvpFullDrop') return Object.freeze({ mode, loss: 'inventory', loadedMagazines: true });
  if (mode === 'pvp') return Object.freeze({ mode, loss: 'consumables', fraction: 0.5 });
  return Object.freeze({ mode: 'peaceful', loss: 'none' });
}

function persistedDownedState(player = {}) {
  return {
    downed: !!player.downed,
    downedUntil: player.downed ? Math.max(0, Number(player.downedUntil || 0)) : 0
  };
}

function restoreDownedState(savedPlayer = {}) {
  const downed = savedPlayer.downed === true;
  return {
    dead: downed,
    downed,
    downedUntil: downed ? Math.max(0, Number(savedPlayer.downedUntil || 0)) : 0
  };
}

/**
 * Синхронная атомарная граница трупного лута. Маркер ставится до compute(),
 * поэтому повтор того же смертельного события не создаст предметы второй раз.
 */
function resolveDeathLootTransaction(target = {}, mode = 'peaceful', now = Date.now(), compute = () => []) {
  const id = deathLootTransactionId(target, mode, now);
  if (target.lastDeathLootTransaction?.id === id) {
    return {
      id,
      reused: true,
      result: cloneRows(target.lastDeathLootTransaction.result)
    };
  }
  target.lastDeathLootTransaction = { id, result: [] };
  const result = cloneRows(compute());
  target.lastDeathLootTransaction.result = cloneRows(result);
  return { id, reused: false, result };
}

module.exports = {
  deathLootPolicy,
  deathLootTransactionId,
  persistedDownedState,
  restoreDownedState,
  resolveDeathLootTransaction
};
