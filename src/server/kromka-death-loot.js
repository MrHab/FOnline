'use strict';

function cloneRows(rows = []) {
  return Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
}

function deathLootTransactionId(target = {}, mode = 'peaceful', now = Date.now()) {
  return `${String(target.characterId || target.id || 'player')}:${Math.max(0, Number(target.diedAt || now))}:${String(mode || 'peaceful')}`;
}

/**
 * Политики потерь по режиму зоны.
 *
 * - `peaceful`, `pve`, `pvpEvent` — предметы сохраняются;
 * - `pvp` — падает половина каждой стопки расходников (старый режим);
 * - `pvpFullDrop` — частичная потеря: выпадает содержимое инвентаря, а
 *   действительная экипировка (с установленными модификациями и заряженными
 *   патронами), экипированный рюкзак, экипированный контейнер и установленные
 *   в него стабилизированные артефакты сохраняются. Содержимое рюкзака и
 *   быстрые слоты защиты не получают.
 */
function deathLootPolicy(mode = 'peaceful') {
  if (mode === 'pvpFullDrop') {
    return Object.freeze({
      mode, loss: 'inventory', loadedMagazines: true, keepEquipment: true, keepInstalledArtifacts: true
    });
  }
  if (mode === 'pvp') return Object.freeze({ mode, loss: 'consumables', fraction: 0.5 });
  if (mode === 'pve') return Object.freeze({ mode, loss: 'none' });
  if (mode === 'pvpEvent') return Object.freeze({ mode, loss: 'none' });
  return Object.freeze({ mode: 'peaceful', loss: 'none' });
}

/**
 * Выбор строк рюкзака, которые выпадают при частичной потере. Экипировка в
 * строках рюкзака не присутствует по построению; здесь дополнительно
 * защищаются установленные в контейнер артефакты (по числу экземпляров того же
 * вида) и явно защищённые идентификаторы (валюта, сюжетные предметы).
 */
function selectBagDropRows(rows = [], options = {}) {
  const installedCounts = options.installedCounts instanceof Map ? options.installedCounts : new Map();
  const isProtected = typeof options.isProtected === 'function' ? options.isProtected : () => false;
  const drops = [];
  const kept = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || '');
    const have = Math.max(0, Math.floor(Number(row?.qty || 0)));
    if (!id || have <= 0) continue;
    if (isProtected(id)) {
      kept.push({ ...row, id, qty: have });
      continue;
    }
    const keep = Math.min(have, Math.max(0, Math.floor(Number(installedCounts.get(id) || 0))));
    const drop = have - keep;
    if (drop > 0) drops.push({ ...row, id, qty: drop });
    if (keep > 0) kept.push({ ...row, id, qty: keep });
  }
  return { drops, kept };
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
 * Момент смерти и идентификатор последней транзакции лута сохраняются, чтобы
 * повтор того же смертельного события после reconnect или перезапуска не
 * создал предметы второй раз.
 */
function persistedDeathState(player = {}) {
  return {
    diedAt: Math.max(0, Math.floor(Number(player.diedAt || 0))),
    deathLootTransactionId: String(player.lastDeathLootTransaction?.id || '').slice(0, 200)
  };
}

function restoreDeathState(savedState = {}, savedPlayer = {}) {
  const transactionId = String(savedState?.deathLootTransactionId || '').slice(0, 200);
  return {
    diedAt: Math.max(0, Math.floor(Number(savedPlayer?.diedAt || 0))),
    lastDeathLootTransaction: transactionId ? { id: transactionId, result: [] } : null
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
  persistedDeathState,
  persistedDownedState,
  restoreDeathState,
  restoreDownedState,
  resolveDeathLootTransaction,
  selectBagDropRows
};
