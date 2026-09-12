'use strict';

const { selectQualifiedAttacker } = require('./siege-qualification');

function createSiegeEvent(spec = {}, config = {}, now = Date.now()) {
  const startAt = Number(spec.startAt || 0);
  return {
    id: String(spec.id || ''), baseId: String(spec.baseId || ''), locationId: String(spec.locationId || ''),
    roomId: String(spec.roomId || ''), windowUtc: String(spec.windowUtc || ''),
    announcedAt: Number(now), startAt, rosterLocksAt: startAt - Number(config.rosterLockLeadMs || 3600000),
    defenderClanId: String(spec.defenderClanId || ''), challengers: [], rosters: {}, rosterLocked: false,
    status: 'scheduled', phase: 'waiting', phaseStartedAt: 0, phaseEndsAt: startAt,
    relayOwners: { relay_a: '', relay_b: '', relay_c: '' }, relayScores: {}, qualifiedAttackerClanId: '',
    gateHp: Number(config.gateHp || 1000), coreOwnerClanId: '', coreHoldStartedAt: 0,
    respawnWaves: {}, lastObjectiveActionAt: {}, resolvedAt: 0, winnerClanId: '', result: '',
    rewardClaims: {}, evacuatedPersonalStorage: false, returnedAt: 0, history: []
  };
}

function totalDuration(config = {}) {
  return Number(config.relayDurationMs || 600000) + Number(config.breachDurationMs || 1200000) + Number(config.coreDurationMs || 1200000);
}

function actionReady(event = {}, characterId = '', now = Date.now(), config = {}) {
  const key = String(characterId || ''); const last = Number(event.lastObjectiveActionAt?.[key] || 0);
  if (Number(now) - last < Number(config.objectiveActionCooldownMs || 900)) return false;
  if (!event.lastObjectiveActionAt) event.lastObjectiveActionAt = {};
  event.lastObjectiveActionAt[key] = Number(now); return true;
}

function beginSiege(event = {}, now = Date.now(), config = {}) {
  if (event.status !== 'scheduled') return false;
  if (!(event.challengers || []).length) return resolveEvent(event, event.defenderClanId, 'no_challenger', now);
  event.status = 'active'; event.phase = 'relay'; event.phaseStartedAt = Number(now);
  event.phaseEndsAt = Number(event.startAt) + Number(config.relayDurationMs || 600000);
  if (event.challengers.length === 1) event.qualifiedAttackerClanId = event.challengers[0].clanId;
  event.history.push({ type: 'siege_started', at: Number(now) });
  return true;
}

function resolveEvent(event = {}, winnerClanId = '', result = '', now = Date.now()) {
  if (event.status === 'resolved' || event.status === 'cancelled') return false;
  event.status = result === 'no_challenger' ? 'cancelled' : 'resolved';
  event.phase = 'complete'; event.phaseEndsAt = Number(now); event.resolvedAt = Number(now);
  event.winnerClanId = String(winnerClanId || event.defenderClanId || ''); event.result = String(result || 'defender_timeout');
  event.history.push({ type: 'resolved', winnerClanId: event.winnerClanId, result: event.result, at: Number(now) });
  return true;
}

function tickSiege(event = {}, now = Date.now(), config = {}) {
  const changes = [];
  if (event.status === 'scheduled' && Number(now) >= Number(event.startAt || 0)) {
    if (beginSiege(event, now, config)) changes.push('started');
  }
  if (event.status !== 'active') return changes;
  if (event.phase === 'relay' && Number(now) >= Number(event.phaseEndsAt || 0)) {
    selectQualifiedAttacker(event);
    if (!event.qualifiedAttackerClanId) resolveEvent(event, event.defenderClanId, 'defender_no_attacker', now);
    else {
      event.phase = 'breach'; event.phaseStartedAt = Number(now);
      event.phaseEndsAt = Number(event.startAt) + Number(config.relayDurationMs || 600000) + Number(config.breachDurationMs || 1200000);
      changes.push('breach');
    }
  } else if (event.phase === 'breach' && Number(now) >= Number(event.phaseEndsAt || 0)) {
    resolveEvent(event, event.defenderClanId, 'defender_gate_held', now); changes.push('resolved');
  } else if (event.phase === 'core') {
    if (event.coreOwnerClanId === event.qualifiedAttackerClanId && event.coreHoldStartedAt
      && Number(now) - Number(event.coreHoldStartedAt) >= Number(config.coreHoldMs || 180000)) {
      resolveEvent(event, event.qualifiedAttackerClanId, 'attacker_core_held', now); changes.push('resolved');
    } else if (Number(now) >= Number(event.phaseEndsAt || 0)) {
      resolveEvent(event, event.defenderClanId, 'defender_core_held', now); changes.push('resolved');
    }
  }
  return changes;
}

function applyObjective(event = {}, input = {}, now = Date.now(), config = {}) {
  if (event.status !== 'active') return { ok: false, error: 'Осада сейчас не активна.' };
  const clanId = String(input.clanId || ''); const characterId = String(input.characterId || '');
  if (event.eliminated?.[characterId]) return { ok: false, error: 'Вы выбыли из этой осады.' };
  if (!actionReady(event, characterId, now, config)) return { ok: false, error: 'Узел ещё подтверждает предыдущее действие.' };
  if (event.phase === 'relay' && input.action === 'captureRelay') {
    if (!(event.challengers || []).some(row => row.clanId === clanId)) return { ok: false, error: 'Передатчики захватывают претенденты.' };
    const relayId = ['relay_a', 'relay_b', 'relay_c'].includes(input.objectiveId) ? input.objectiveId : '';
    if (!relayId) return { ok: false, error: 'Неизвестный передатчик.' };
    event.relayOwners[relayId] = clanId;
    for (const challenger of event.challengers) event.relayScores[challenger.clanId] = Object.values(event.relayOwners).filter(id => id === challenger.clanId).length;
    if (event.relayScores[clanId] >= 2) {
      event.qualifiedAttackerClanId = clanId; event.phase = 'breach'; event.phaseStartedAt = Number(now);
      event.phaseEndsAt = Number(event.startAt) + Number(config.relayDurationMs || 600000) + Number(config.breachDurationMs || 1200000);
    }
    return { ok: true };
  }
  if (event.phase === 'breach' && input.action === 'damageGate') {
    if (clanId !== event.qualifiedAttackerClanId) return { ok: false, error: 'Ворота штурмует победитель квалификации.' };
    event.gateHp = Math.max(0, Number(event.gateHp || 0) - Number(config.gateDamagePerAction || 25));
    if (event.gateHp <= 0) {
      event.phase = 'core'; event.phaseStartedAt = Number(now);
      event.phaseEndsAt = Number(event.startAt) + totalDuration(config);
    }
    return { ok: true };
  }
  if (event.phase === 'core' && input.action === 'captureCore') {
    if (clanId !== event.qualifiedAttackerClanId) return { ok: false, error: 'Перезапись доступна только атакующей стороне.' };
    if (event.coreOwnerClanId !== clanId) { event.coreOwnerClanId = clanId; event.coreHoldStartedAt = Number(now); }
    return { ok: true };
  }
  if (event.phase === 'core' && input.action === 'contestCore') {
    if (clanId !== event.defenderClanId) return { ok: false, error: 'Сбить перезапись может только защита.' };
    event.coreOwnerClanId = ''; event.coreHoldStartedAt = 0; return { ok: true };
  }
  return { ok: false, error: 'Это действие не соответствует текущей фазе.' };
}

function consumeRespawnWave(event = {}, clanId = '', config = {}) {
  const id = String(clanId || ''); const used = Number(event.respawnWaves?.[id] || 0);
  if (used >= Number(config.respawnWavesPerSide || 3)) return { ok: false, remaining: 0 };
  if (!event.respawnWaves) event.respawnWaves = {};
  event.respawnWaves[id] = used + 1;
  return { ok: true, remaining: Number(config.respawnWavesPerSide || 3) - used - 1 };
}

function applyResolutionOnce(event = {}, clanStore = {}, config = {}, now = Date.now()) {
  if (event.status !== 'resolved' || event.resolutionAppliedAt) return { ok: true, duplicate: true };
  const base = clanStore.bases?.[event.baseId];
  if (!base) return { ok: false, error: 'Стратегическая база не найдена.' };
  const oldOwnerId = base.ownerClanId || event.defenderClanId;
  let attackerWon = !!event.winnerClanId && event.winnerClanId !== event.defenderClanId;
  const attacker = clanStore.clans?.[event.winnerClanId];
  const ownsOtherBase = attacker && ((attacker.baseId && attacker.baseId !== event.baseId)
    || Object.entries(clanStore.bases || {}).some(([id, row]) => id !== event.baseId && row.ownerClanId === attacker.id));
  if (attackerWon && (!attacker || ownsOtherBase || (base.ownerClanId && base.ownerClanId !== event.defenderClanId))) {
    // A challenge may predate another victory. Resolve it without transferring
    // a second base or paying another capture reward to the ineligible clan.
    event.winnerClanId = oldOwnerId;
    event.result = ownsOtherBase ? 'attacker_already_owns_base' : 'ownership_changed';
    attackerWon = false;
  }
  if (attackerWon) {
    if (clanStore.clans?.[oldOwnerId]) clanStore.clans[oldOwnerId].baseId = '';
    if (clanStore.clans?.[event.winnerClanId]) clanStore.clans[event.winnerClanId].baseId = event.baseId;
    base.ownerClanId = event.winnerClanId; base.claimedAt = Number(now); base.lastUpkeepAt = Number(now);
    // Экономические накопители принадлежат владельцу, а не самой территории:
    // новый клан не наследует округлительные кредиты и кулдауны заказов старого.
    base.lastWeeklyBenefitAt = 0;
    base.benefitCredits = {};
    base.benefitOrderCooldowns = {};
  }
  event.evacuatedPersonalStorage = true;
  const winnerClan = clanStore.clans?.[event.winnerClanId];
  if (winnerClan && !event.rewardClaims[event.winnerClanId]) {
    winnerClan.storage = winnerClan.storage || {};
    winnerClan.storage.silver = Number(winnerClan.storage.silver || 0) + Number(config.reward?.winnerSilver || 0);
    event.rewardClaims[event.winnerClanId] = Number(now);
  }
  base.history = Array.isArray(base.history) ? base.history : [];
  base.history.push({ type: 'siege', eventId: event.id, oldOwnerClanId: oldOwnerId, winnerClanId: event.winnerClanId, result: event.result, at: Number(now) });
  event.resolutionAppliedAt = Number(now);
  return { ok: true, captured: attackerWon, oldOwnerClanId: oldOwnerId, winnerClanId: event.winnerClanId };
}

module.exports = { actionReady, applyObjective, applyResolutionOnce, beginSiege, consumeRespawnWave, createSiegeEvent, resolveEvent, tickSiege, totalDuration };
