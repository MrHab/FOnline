'use strict';

// Перки поиска в экономике v3 (библия 14.5, 15.3). Прогрессия ничего не создаёт
// из воздуха: она усиливает кран, который уже открыт. «Редкая находка» —
// останки снаряжения NPC, «Нюх на тайники» — материалы авторского тайника,
// «Падальщик» — трофеи существа. Марки не трогает никто: их множит премиум, и
// второй множитель на том же кране сложился бы с ним.

const DEFAULT_LOOT_PERKS = Object.freeze({
  // «Редкая находка»: прибавка к доле останков (`npcRemnants.share`) за ранг.
  remnantSharePerRank: 0.15,
  // «Нюх на тайники»: прибавка к каждой стопке материалов тайника за ранг.
  cacheMaterialsPerRank: 0.25,
  // «Падальщик»: шанс, что существо оставит на один трофей больше.
  scavengerTrophyChance: 0.25,
  trophyItemId: 'trophy'
});

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function rank(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function normalizeLootPerkConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return Object.freeze({
    remnantSharePerRank: finite(src.remnantSharePerRank, DEFAULT_LOOT_PERKS.remnantSharePerRank, 0, 1),
    cacheMaterialsPerRank: finite(src.cacheMaterialsPerRank, DEFAULT_LOOT_PERKS.cacheMaterialsPerRank, 0, 1),
    scavengerTrophyChance: finite(src.scavengerTrophyChance, DEFAULT_LOOT_PERKS.scavengerTrophyChance, 0, 1),
    trophyItemId: String(src.trophyItemId || DEFAULT_LOOT_PERKS.trophyItemId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
      || DEFAULT_LOOT_PERKS.trophyItemId
  });
}

/** Во сколько раз «Редкая находка» увеличивает долю останков снаряжения NPC. */
function remnantShareMultiplier(config = DEFAULT_LOOT_PERKS, scroungerRank = 0) {
  return 1 + finite(config?.remnantSharePerRank, 0, 0, 1) * rank(scroungerRank);
}

// Целая часть гарантирована, дробная выпадает шансом — так же, как множители
// зон в world-economy (`rollQuantity`); своя копия держит модуль без зависимостей.
function rollQuantity(amount, random) {
  const value = Math.max(0, Number(amount) || 0);
  const whole = Math.floor(value);
  return whole + (random() < value - whole ? 1 : 0);
}

/**
 * «Нюх на тайники»: стопки материалов тайника растут на долю за ранг. Строки,
 * которые `isMaterial` материалом не признал (расходники, марки, патроны), и
 * сам состав тайника не меняются — новых предметов перк не добавляет.
 */
function cacheSenseLoot(config = DEFAULT_LOOT_PERKS, loot = [], cacheSenseRank = 0, isMaterial = () => false, random = Math.random) {
  const rows = (Array.isArray(loot) ? loot : []).map(row => ({ ...row }));
  const bonus = finite(config?.cacheMaterialsPerRank, 0, 0, 1) * rank(cacheSenseRank);
  if (bonus <= 0) return { loot: rows, changed: false };
  let changed = false;
  for (const row of rows) {
    const qty = Math.max(0, Math.floor(Number(row.qty || 0)));
    if (qty <= 0 || !isMaterial(row.id)) continue;
    const next = rollQuantity(qty * (1 + bonus), random);
    if (next !== qty) changed = true;
    row.qty = next;
  }
  return { loot: rows, changed };
}

/**
 * «Падальщик»: существо, с которого и так падает трофей, с шансом оставляет на
 * один больше. Труп без трофеев (человек-NPC) перк не трогает.
 */
function scavengerLoot(config = DEFAULT_LOOT_PERKS, loot = [], hasTrait = false, random = Math.random) {
  const rows = (Array.isArray(loot) ? loot : []).map(row => ({ ...row }));
  const trophyId = String(config?.trophyItemId || DEFAULT_LOOT_PERKS.trophyItemId);
  const trophy = rows.find(row => row.id === trophyId && Number(row.qty || 0) > 0);
  if (!hasTrait || !trophy) return { loot: rows, changed: false };
  if (random() >= finite(config?.scavengerTrophyChance, 0, 0, 1)) return { loot: rows, changed: false };
  trophy.qty = Math.floor(Number(trophy.qty)) + 1;
  return { loot: rows, changed: true };
}

module.exports = {
  DEFAULT_LOOT_PERKS,
  normalizeLootPerkConfig,
  remnantShareMultiplier,
  cacheSenseLoot,
  scavengerLoot
};
