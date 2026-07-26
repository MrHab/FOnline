'use strict';

const WORLD_PARTY_TASK_KINDS = Object.freeze({
  escort_caravan: 'caravan',
  join_patrol: 'patrol'
});
const WORLD_PARTY_REWARD_INTEGRITY_VERSION = 1;
const WORLD_TASK_CLAIM_LIMIT = 800;

function worldPartyTaskType(task = {}) {
  return String(task?.type || '').trim().toLowerCase();
}

function worldPartyTaskExpectedKind(task = {}) {
  return WORLD_PARTY_TASK_KINDS[worldPartyTaskType(task)] || '';
}

function isWorldPartyTask(task = {}) {
  return !!worldPartyTaskExpectedKind(task);
}

function worldPartyTaskIsActiveForParty(task = {}, party = {}, worldHour = 0) {
  if (!task || !party || String(task.status || '') !== 'active') return false;
  const taskPartyId = String(task.partyId || '').trim();
  const partyId = String(party.id || '').trim();
  if (!taskPartyId || !partyId || taskPartyId !== partyId) return false;
  if (worldPartyTaskExpectedKind(task) !== String(party.kind || '').trim().toLowerCase()) return false;
  if (party.destroyed || String(party.state || '').toLowerCase() === 'destroyed') return false;
  const expiresHour = Number(task.expiresHour);
  return !Number.isFinite(expiresHour) || expiresHour <= 0 || expiresHour > Number(worldHour || 0);
}

function defaultIdentity(value) {
  return String(value || '').trim();
}

function normalizeWorldTaskClaimId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_:-]/g, '').slice(0, 120);
}

function sanitizeWorldTaskClaimIds(input = [], limit = WORLD_TASK_CLAIM_LIMIT) {
  const max = Math.max(0, Math.floor(Number(limit || 0)));
  if (!Array.isArray(input) || max <= 0) return [];
  const seen = new Set();
  const newestFirst = [];
  for (let index = input.length - 1; index >= 0 && newestFirst.length < max; index -= 1) {
    const id = normalizeWorldTaskClaimId(input[index]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    newestFirst.push(id);
  }
  return newestFirst.reverse();
}

function worldPartyMemberIdentityKey(userId = '', characterId = '', normalizeId = defaultIdentity) {
  if (typeof normalizeId !== 'function') return '';
  const account = normalizeId(userId);
  const character = normalizeId(characterId);
  return account && character ? `${account}:${character}` : '';
}

function removeAmbiguousSocialCharacterReferences(database = {}, characterIds = new Set(), normalizeId = defaultIdentity) {
  if (!(characterIds instanceof Set) || characterIds.size <= 0) return 0;
  const stores = database?.characters && typeof database.characters === 'object'
    ? database.characters
    : {};
  let removed = 0;
  const cleanEntries = entries => {
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => {
      const id = normalizeId(entry?.id || entry?.characterId || entry?.playerId || '');
      if (!id || !characterIds.has(id)) return true;
      removed += 1;
      return false;
    });
  };
  for (const store of Object.values(stores)) {
    for (const row of Object.values(store && typeof store === 'object' ? store : {})) {
      const state = row?.state && typeof row.state === 'object' ? row.state : null;
      const social = state?.socialState && typeof state.socialState === 'object' ? state.socialState : null;
      if (!social) continue;
      social.friends = cleanEntries(social.friends);
      social.friendRequests = cleanEntries(social.friendRequests);
      social.clanInvites = cleanEntries(social.clanInvites);
      if (social.clan && typeof social.clan === 'object') {
        social.clan.members = cleanEntries(social.clan.members);
      }
    }
  }
  return removed;
}

function migrateDuplicateCharacterIds(database = {}, makeId = () => '', normalizeId = defaultIdentity) {
  const stores = database?.characters && typeof database.characters === 'object'
    ? database.characters
    : {};
  const normalizedRowCharacterId = (storeId, row) => {
    for (const value of [
      row?.id,
      row?.state?.characterProfile?.serverCharacterId,
      row?.summary?.id,
      storeId
    ]) {
      const id = normalizeId(value);
      if (id) return id;
    }
    return '';
  };
  const usedIds = new Set();
  const legacyMemberKeyCounts = new Map();
  Object.entries(stores).forEach(([userId, store]) => {
    Object.entries(store && typeof store === 'object' ? store : {}).forEach(([storeId, row]) => {
      const identities = [
        storeId,
        row?.id,
        row?.state?.characterProfile?.serverCharacterId,
        row?.summary?.id
      ].map(value => normalizeId(value)).filter(Boolean);
      identities.forEach(id => usedIds.add(id));
      const characterId = normalizedRowCharacterId(storeId, row);
      const memberKey = worldPartyMemberIdentityKey(userId, characterId, normalizeId);
      if (memberKey) legacyMemberKeyCounts.set(memberKey, Number(legacyMemberKeyCounts.get(memberKey) || 0) + 1);
    });
  });
  const ownerById = new Map();
  const remapped = [];
  const rebuiltStores = new Map();
  let canonicalizedStoreKeys = 0;
  for (const userId of Object.keys(stores).sort()) {
    const store = stores[userId];
    if (!store || typeof store !== 'object') continue;
    const rebuilt = {};
    for (const [storeId, row] of Object.entries(store).sort(([left], [right]) => left.localeCompare(right))) {
      const characterId = normalizedRowCharacterId(storeId, row);
      if (!characterId) {
        rebuilt[storeId] = row;
        continue;
      }
      let finalId = characterId;
      if (ownerById.has(characterId)) {
        finalId = '';
        for (let attempt = 0; attempt < 100 && !finalId; attempt += 1) {
          const candidate = normalizeId(makeId());
          if (candidate && !usedIds.has(candidate)) finalId = candidate;
        }
        if (!finalId) throw new Error(`Unable to remap duplicate character id: ${characterId}`);
        usedIds.add(finalId);
        const previousMemberKey = worldPartyMemberIdentityKey(userId, characterId, normalizeId);
        remapped.push({
          userId,
          previousCharacterId: characterId,
          characterId: finalId,
          previousMemberKeyAmbiguous: Number(legacyMemberKeyCounts.get(previousMemberKey) || 0) > 1
        });
      }
      ownerById.set(finalId, userId);
      row.id = finalId;
      row.state = row.state && typeof row.state === 'object' ? row.state : {};
      row.state.characterProfile = row.state.characterProfile && typeof row.state.characterProfile === 'object'
        ? row.state.characterProfile
        : {};
      row.state.characterProfile.serverCharacterId = finalId;
      row.summary = row.summary && typeof row.summary === 'object' ? row.summary : {};
      row.summary.id = finalId;
      rebuilt[finalId] = row;
      if (storeId !== finalId) canonicalizedStoreKeys += 1;
    }
    rebuiltStores.set(userId, rebuilt);
  }
  for (const [userId, rebuilt] of rebuiltStores.entries()) {
    const store = stores[userId];
    for (const key of Object.keys(store)) delete store[key];
    Object.assign(store, rebuilt);
  }
  removeAmbiguousSocialCharacterReferences(
    database,
    new Set(remapped.map(row => normalizeId(row.previousCharacterId)).filter(Boolean)),
    normalizeId
  );
  Object.defineProperty(remapped, 'canonicalizedStoreKeys', {
    configurable: false,
    enumerable: false,
    value: canonicalizedStoreKeys,
    writable: false
  });
  return remapped;
}

function normalizedUniqueIds(values = [], normalizeId = defaultIdentity) {
  const out = [];
  for (const value of values) {
    const id = normalizeId(value);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function worldTaskRewardMatchesPlayer(task = {}, player = {}, normalizeId = defaultIdentity) {
  if (!task || !player || typeof normalizeId !== 'function') return false;
  const details = task.details && typeof task.details === 'object' ? task.details : {};
  if (isWorldPartyTask(task)) {
    const memberKey = worldPartyMemberIdentityKey(player.userId, player.characterId, normalizeId);
    const rewardMemberKeys = normalizedUniqueIds(
      Array.isArray(details.rewardMemberKeys) ? details.rewardMemberKeys : [],
      defaultIdentity
    );
    return !!memberKey && rewardMemberKeys.includes(memberKey);
  }
  const rewardIds = normalizedUniqueIds([
    ...(Array.isArray(details.rewardPlayerIds) ? details.rewardPlayerIds : []),
    ...(Array.isArray(details.rewardCharacterIds) ? details.rewardCharacterIds : []),
    ...(Array.isArray(details.joinedPlayers) ? details.joinedPlayers : [])
  ], normalizeId);
  if (!rewardIds.length) return false;
  const playerIds = normalizedUniqueIds([player.id, player.characterId, player.userId], normalizeId);
  return playerIds.some(id => rewardIds.includes(id));
}

function worldPartyRewardSnapshotIsTrusted(task = {}) {
  if (!isWorldPartyTask(task)) return true;
  const details = task?.details && typeof task.details === 'object' ? task.details : {};
  return Number(details.worldPartyRewardIntegrityVersion || 0) >= WORLD_PARTY_REWARD_INTEGRITY_VERSION;
}

function worldTaskClaimEligible(task = {}, player = {}, accepted = false, normalizeId = defaultIdentity) {
  const rewardMatch = worldTaskRewardMatchesPlayer(task, player, normalizeId);
  return isWorldPartyTask(task)
    ? !!accepted && worldPartyRewardSnapshotIsTrusted(task) && rewardMatch
    : !!accepted || rewardMatch;
}

module.exports = {
  WORLD_PARTY_REWARD_INTEGRITY_VERSION,
  WORLD_TASK_CLAIM_LIMIT,
  isWorldPartyTask,
  migrateDuplicateCharacterIds,
  sanitizeWorldTaskClaimIds,
  worldPartyMemberIdentityKey,
  worldPartyRewardSnapshotIsTrusted,
  worldPartyTaskExpectedKind,
  worldPartyTaskIsActiveForParty,
  worldTaskClaimEligible,
  worldTaskRewardMatchesPlayer
};
