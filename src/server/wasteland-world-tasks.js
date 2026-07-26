'use strict';

const { localizeLegacyWorldText } = require('./wasteland-localization');
const { clamp, clone, safeId } = require('./wasteland-sim-utils');

function normalizeWorldTask(input = {}, worldHour = 0) {
  if (!input || typeof input !== 'object') return null;
  const type = safeId(input.type || 'world_task', 'world_task');
  const id = safeId(input.id || `${type}_${Date.now()}`, `${type}_${Date.now()}`);
  const status = ['active', 'completed', 'resolved', 'expired', 'failed'].includes(String(input.status || 'active'))
    ? String(input.status || 'active')
    : 'active';
  const createdHour = Number.isFinite(Number(input.createdHour)) ? Number(input.createdHour) : Number(worldHour || 0);
  const expiresHour = Number.isFinite(Number(input.expiresHour)) ? Number(input.expiresHour) : createdHour + 36;
  const reward = input.reward && typeof input.reward === 'object' ? input.reward : {};
  return {
    id,
    key: String(input.key || id).slice(0, 140),
    type,
    status,
    title: localizeLegacyWorldText(input.title || input.name || type).slice(0, 120),
    text: localizeLegacyWorldText(input.text || '').slice(0, 320),
    siteId: safeId(input.siteId || '', ''),
    issuerSiteId: safeId(input.issuerSiteId || input.boardSiteId || '', ''),
    partyId: safeId(input.partyId || '', ''),
    targetFaction: safeId(input.targetFaction || '', ''),
    objective: String(input.objective || '').slice(0, 80),
    createdHour,
    expiresHour,
    completedHour: Number.isFinite(Number(input.completedHour)) ? Number(input.completedHour) : 0,
    priority: clamp(input.priority ?? 1, 0, 5),
    reward: {
      xp: Math.max(0, Math.floor(Number(reward.xp || 0))),
      caps: Math.max(0, Math.floor(Number(reward.caps ?? reward.silver ?? 0))),
      reputation: Math.max(0, Math.floor(Number(reward.reputation || 0)))
    },
    details: input.details && typeof input.details === 'object' ? clone(input.details) : {}
  };
}

module.exports = {
  normalizeWorldTask
};
