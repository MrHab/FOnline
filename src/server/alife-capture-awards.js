'use strict';

function awardId(siteId, generation, characterId) {
  return `${String(siteId || '')}:${Math.max(1, Math.floor(Number(generation || 1)))}:${String(characterId || '')}`;
}

function stageAwards(ledger, siteId, generation, contributions, totalXp) {
  const rows = ledger && typeof ledger === 'object' ? ledger : {};
  const entries = Object.entries(contributions || {}).filter(([characterId, value]) =>
    characterId && Number(value) > 0);
  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
  if (total <= 0) return [];
  const inserted = [];
  for (const [characterId, value] of entries) {
    const key = awardId(siteId, generation, characterId);
    if (rows[key]) continue;
    rows[key] = { id: key, siteId, generation, characterId,
      xp: Math.max(1, Math.round(Number(totalXp || 0) * Number(value) / total)), appliedAt: 0 };
    inserted.push(key);
  }
  return inserted;
}

function pendingAwards(ledger, characterId) {
  return Object.values(ledger || {}).filter(row => row && row.characterId === characterId
    && Number(row.xp) > 0 && !Number(row.appliedAt));
}

module.exports = { awardId, stageAwards, pendingAwards };
