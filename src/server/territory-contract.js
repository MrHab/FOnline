'use strict';

/**
 * Контракт наёмника на входе в Сердцевину.
 *
 * Принадлежность к фракции оформляется на входе в территорию, а не только у
 * регистратора на базе: игрок или группа приходит к узлу Сердцевины на
 * глобальной карте, видит доли фракций среди сохранённых персонажей и
 * подписывает контракт. После подписания сервер заводит прибывших на базу
 * выбранной фракции; сама зона по-прежнему открывается только с платформы
 * метро своей базы.
 *
 * Модуль чистый: доли считаются по переданному списку принадлежностей, время
 * приходит аргументом. Сервер добавляет кэш и источник данных.
 */
const {
  canJoinTerritoryFaction,
  sanitizeTerritoryMembership,
  territoryChangeCooldownMs,
  territoryFactionIds,
  territoryFactionRow
} = require('./territory-membership');

const TERRITORY_CONTRACT_VERSION = 1;

function safeId(value = '', limit = 32) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, limit);
}

function roundShare(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

/**
 * Доли фракций среди персонажей. Процент считается от подписавших контракт,
 * поэтому окно показывает распределение внутри территории, а не долю от всех
 * персонажей мира. Персонажи без контракта учитываются отдельным счётчиком.
 */
function territoryFactionShares(memberships = [], catalog = {}) {
  const ids = territoryFactionIds(catalog);
  const counts = new Map(ids.map(id => [id, 0]));
  let characters = 0;
  let signed = 0;
  for (const row of Array.isArray(memberships) ? memberships : []) {
    characters += 1;
    const factionId = safeId(typeof row === 'string' ? row : row?.factionId);
    if (!counts.has(factionId)) continue;
    counts.set(factionId, counts.get(factionId) + 1);
    signed += 1;
  }
  return {
    characters,
    signed,
    factions: ids.map(id => {
      const count = counts.get(id) || 0;
      return {
        factionId: id,
        characters: count,
        sharePct: signed > 0 ? roundShare((count / signed) * 100) : 0
      };
    })
  };
}

/**
 * Предложение контракта для персонажа: доли фракций, возможность подписать и
 * причина отказа по каждой фракции. Клиент показывает это окном при прибытии
 * к воротам Сердцевины.
 */
function territoryContractOffer(options = {}) {
  const catalog = options.catalog && typeof options.catalog === 'object' ? options.catalog : {};
  const now = Number.isFinite(Number(options.now)) ? Math.floor(Number(options.now)) : Date.now();
  const membership = sanitizeTerritoryMembership(options.membership, catalog);
  const shares = options.shares && typeof options.shares === 'object'
    ? options.shares
    : territoryFactionShares([], catalog);
  const names = options.factionNames && typeof options.factionNames === 'object' ? options.factionNames : {};
  const reputation = options.reputation && typeof options.reputation === 'object' ? options.reputation : {};
  const shareById = new Map((Array.isArray(shares.factions) ? shares.factions : [])
    .map(row => [safeId(row?.factionId), row]));

  const factions = territoryFactionIds(catalog).map(id => {
    const row = territoryFactionRow(catalog, id) || {};
    const share = shareById.get(id) || { characters: 0, sharePct: 0 };
    const check = canJoinTerritoryFaction(membership, id, catalog, now, {
      reputation: Number(reputation[id] || 0)
    });
    return {
      factionId: id,
      displayName: String(names[id] || row.baseDisplayName || id),
      baseLocationId: String(row.baseLocationId || ''),
      baseDisplayName: String(row.baseDisplayName || ''),
      characters: Math.max(0, Math.floor(Number(share.characters || 0))),
      sharePct: roundShare(share.sharePct),
      canSign: check.ok === true,
      reason: check.ok === true ? '' : String(check.error || '')
    };
  });

  const changeLocked = membership.changeAllowedAt > now;
  const currentRow = membership.factionId ? territoryFactionRow(catalog, membership.factionId) : null;
  return {
    version: TERRITORY_CONTRACT_VERSION,
    territoryId: safeId(catalog?.id || 'core'),
    displayName: String(catalog?.displayName || 'Сердцевина'),
    factionId: membership.factionId,
    factionDisplayName: membership.factionId
      ? String(names[membership.factionId] || currentRow?.baseDisplayName || membership.factionId)
      : '',
    baseLocationId: String(currentRow?.baseLocationId || ''),
    signed: !!membership.factionId,
    canSign: !membership.factionId && !changeLocked,
    changeLocked,
    changeAllowedAt: membership.changeAllowedAt,
    changeCooldownMs: territoryChangeCooldownMs(catalog),
    characters: Math.max(0, Math.floor(Number(shares.characters || 0))),
    signedCharacters: Math.max(0, Math.floor(Number(shares.signed || 0))),
    factions
  };
}

/**
 * База фракции, на которую сервер заводит прибывшего к воротам. Пустая строка
 * означает, что контракт ещё не подписан и нужно показать окно выбора.
 */
function territoryContractBaseLocationId(membership = {}, catalog = {}) {
  const current = sanitizeTerritoryMembership(membership, catalog);
  if (!current.factionId) return '';
  const row = territoryFactionRow(catalog, current.factionId);
  return String(row?.baseLocationId || '');
}

module.exports = {
  TERRITORY_CONTRACT_VERSION,
  territoryContractBaseLocationId,
  territoryContractOffer,
  territoryFactionShares
};
