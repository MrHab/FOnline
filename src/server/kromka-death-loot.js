'use strict';

function cloneRows(rows = []) {
  return Array.isArray(rows) ? rows.map(row => ({ ...row })) : [];
}

function deathLootTransactionId(target = {}, mode = 'peaceful', now = Date.now()) {
  return `${String(target.characterId || target.id || 'player')}:${Math.max(0, Number(target.diedAt || now))}:${String(mode || 'peaceful')}`;
}

/**
 * Политики потерь по режиму зоны (лестница экономики v3, библия 16.5).
 *
 * - `peaceful`, `pve` (синяя), `pvp` (жёлтая), `pvpEvent` — ничего не
 *   выпадает; износ надетого считает сервер по `data/kromka/economy.json`;
 * - `pvpFullDrop` (красная) — частичная потеря: выпадает содержимое
 *   инвентаря, а действительная экипировка (с установленными модификациями и
 *   заряженными патронами), экипированный рюкзак, экипированный контейнер и
 *   установленные в него стабилизированные артефакты сохраняются. Содержимое
 *   рюкзака и быстрые слоты защиты не получают;
 * - `pvpBlack` (чёрная) — выпадает всё, включая экипировку и установленные
 *   артефакты; каждая выпавшая единица может стать ломом.
 */
function deathLootPolicy(mode = 'peaceful') {
  if (mode === 'pvpBlack') {
    return Object.freeze({ mode, loss: 'all', loadedMagazines: true, trash: true });
  }
  if (mode === 'pvpFullDrop') {
    return Object.freeze({
      mode, loss: 'inventory', loadedMagazines: true, keepEquipment: true, keepInstalledArtifacts: true
    });
  }
  if (mode === 'pvp') return Object.freeze({ mode, loss: 'none' });
  if (mode === 'pve') return Object.freeze({ mode, loss: 'none' });
  if (mode === 'pvpEvent') return Object.freeze({ mode, loss: 'none' });
  return Object.freeze({ mode: 'peaceful', loss: 'none' });
}

/**
 * Лом чёрной зоны: каждая выпавшая единица независимо с шансом `chance`
 * становится ломом. Возвращает строки, которые упадут целыми, и сколько единиц
 * каждого вида уничтожено.
 */
function splitTrashRows(rows = [], chance = 0, random = Math.random) {
  const kept = [];
  const trashed = [];
  const odds = Math.min(1, Math.max(0, Number(chance) || 0));
  for (const row of Array.isArray(rows) ? rows : []) {
    const qty = Math.max(0, Math.floor(Number(row?.qty || 0)));
    if (!row?.id || qty <= 0) continue;
    let lost = 0;
    if (odds > 0) {
      for (let i = 0; i < qty; i += 1) if (random() < odds) lost += 1;
    }
    if (qty - lost > 0) kept.push({ ...row, qty: qty - lost });
    if (lost > 0) trashed.push({ id: row.id, qty: lost });
  }
  return { kept, trashed };
}

/**
 * Сколько единиц лома остаётся от уничтоженного: доля базовой цены
 * уничтоженных предметов в пересчёте на цену лома. Дешёвые патроны лома почти
 * не дают, оружие и броня — заметно.
 */
function trashScrapQty(trashed = [], priceOf = () => 0, scrapPrice = 1, valueShare = 0.25) {
  const value = (Array.isArray(trashed) ? trashed : []).reduce((sum, row) => (
    sum + Math.max(0, Number(priceOf(row.id) || 0)) * Math.max(0, Math.floor(Number(row.qty || 0)))
  ), 0);
  return Math.max(0, Math.floor(value * Math.max(0, Number(valueShare) || 0) / Math.max(1, Number(scrapPrice) || 1)));
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
  selectBagDropRows,
  splitTrashRows,
  trashScrapQty
};
