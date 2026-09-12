'use strict';

const clean = (value = '', max = 96) => String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, max);

function addChallenge(event = {}, clanId = '', now = Date.now(), pledge = {}) {
  const id = clean(clanId);
  if (!id || event.defenderClanId === id) return { ok: false, error: 'Владелец не может вызвать сам себя.' };
  event.challengers = Array.isArray(event.challengers) ? event.challengers : [];
  if (event.challengers.some(row => row.clanId === id)) return { ok: false, error: 'Вызов этого клана уже зарегистрирован.' };
  event.challengers.push({ clanId: id, declaredAt: Number(now), pledge: { ...(pledge || {}) } });
  event.relayScores = event.relayScores && typeof event.relayScores === 'object' ? event.relayScores : {};
  event.relayScores[id] = 0;
  return { ok: true };
}

function eligibleMember(clan = {}, characterId = '', now = Date.now(), config = {}) {
  const member = clan.members?.[clean(characterId)];
  if (!member) return { ok: false, error: 'Персонаж не состоит в этом клане.' };
  const age = Number(now) - Number(member.joinedAt || now);
  if (age < Number(config.membershipMinAgeMs || 259200000)) return { ok: false, error: 'Для осады требуется 72 часа членства в клане.' };
  return { ok: true, member };
}

function sideAllowed(event = {}, clanId = '') {
  const id = clean(clanId);
  return id === event.defenderClanId || (event.challengers || []).some(row => row.clanId === id);
}

function registerMember(event = {}, clan = {}, characterId = '', now = Date.now(), config = {}) {
  if (event.rosterLocked || Number(now) >= Number(event.rosterLocksAt || 0)) return { ok: false, error: 'Состав уже заблокирован.' };
  if (!sideAllowed(event, clan.id)) return { ok: false, error: 'Клан не является стороной этой осады.' };
  const eligibility = eligibleMember(clan, characterId, now, config);
  if (!eligibility.ok) return eligibility;
  event.rosters = event.rosters && typeof event.rosters === 'object' ? event.rosters : {};
  const roster = Array.isArray(event.rosters[clan.id]) ? event.rosters[clan.id] : [];
  if (roster.includes(clean(characterId))) return { ok: true, duplicate: true, roster };
  if (roster.length >= Number(config.maxParticipantsPerClan || 20)) return { ok: false, error: 'В составе уже 20 участников.' };
  roster.push(clean(characterId)); event.rosters[clan.id] = roster;
  return { ok: true, roster };
}

function unregisterMember(event = {}, clanId = '', characterId = '', now = Date.now()) {
  if (event.rosterLocked || Number(now) >= Number(event.rosterLocksAt || 0)) return { ok: false, error: 'Состав уже заблокирован.' };
  const roster = Array.isArray(event.rosters?.[clean(clanId)]) ? event.rosters[clean(clanId)] : [];
  event.rosters[clean(clanId)] = roster.filter(id => id !== clean(characterId));
  return { ok: true, roster: event.rosters[clean(clanId)] };
}

function lockRosters(event = {}, now = Date.now()) {
  if (event.rosterLocked || Number(now) < Number(event.rosterLocksAt || 0)) return false;
  event.rosterLocked = true; event.rosterLockedAt = Number(now);
  for (const key of Object.keys(event.rosters || {})) event.rosters[key] = (event.rosters[key] || []).slice(0, 20);
  return true;
}

function isRegistered(event = {}, clanId = '', characterId = '') {
  return (event.rosters?.[clean(clanId)] || []).includes(clean(characterId));
}

function selectQualifiedAttacker(event = {}) {
  const candidates = [...(event.challengers || [])];
  if (!candidates.length) return '';
  candidates.sort((a, b) => Number(event.relayScores?.[b.clanId] || 0) - Number(event.relayScores?.[a.clanId] || 0)
    || Number(a.declaredAt || 0) - Number(b.declaredAt || 0));
  event.qualifiedAttackerClanId = candidates[0].clanId;
  return event.qualifiedAttackerClanId;
}

module.exports = { addChallenge, eligibleMember, isRegistered, lockRosters, registerMember, selectQualifiedAttacker, sideAllowed, unregisterMember };
