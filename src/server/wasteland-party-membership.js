'use strict';

const {
  isWorldPartyTask,
  worldPartyMemberIdentityKey,
  worldPartyTaskIsActiveForParty
} = require('./world-party-integrity');
const {
  factionGroup,
  isJoinableWorldFaction
} = require('./wasteland-factions');
const {
  safeId,
  safeTransferIdentity
} = require('./wasteland-sim-utils');

const WORLD_PARTY_PLAYER_LIMIT = 5;
const HEAVY_CARAVAN_PLAYER_LIMIT = 10;
const PATROL_DUTY_WORLD_HOURS = 6;
const PATROL_DUTY_INTEGRITY_VERSION = 1;

function safeMemberName(value, fallback = 'Игрок') {
  return String(value || fallback).replace(/[<>]/g, '').trim().slice(0, 32) || fallback;
}

function normalizePartyPlayerMember(input = {}, index = 0, worldHour = 0) {
  const characterId = safeId(input.characterId || input.charId || '', '');
  const userId = safeId(input.userId || input.accountId || '', '');
  const playerId = safeId(input.playerId || input.socketId || input.id || characterId || `player_${index + 1}`, `player_${index + 1}`);
  const id = characterId || playerId;
  if (!id) return null;
  return {
    id,
    playerId,
    userId,
    characterId,
    name: safeMemberName(input.name || input.playerName || `Игрок ${index + 1}`),
    factionId: isJoinableWorldFaction(input.factionId || input.worldFactionId || input.playerFactionId || '')
      ? factionGroup(input.factionId || input.worldFactionId || input.playerFactionId || '')
      : '',
    taskId: safeId(input.taskId || input.worldTaskId || '', ''),
    joinedHour: Number.isFinite(Number(input.joinedHour)) ? Number(input.joinedHour) : Number(worldHour || 0),
    lastSeenHour: Number.isFinite(Number(input.lastSeenHour)) ? Number(input.lastSeenHour) : Number(worldHour || 0)
  };
}

function isHeavyCaravanParty(party = {}, task = null) {
  const kind = String(party?.kind || task?.joinPartyKind || '').toLowerCase();
  const taskType = String(task?.type || '').toLowerCase();
  if (kind !== 'caravan' && taskType !== 'escort_caravan') return false;
  const supplyRole = String(party?.supplyRole || task?.supplyRole || task?.details?.supplyRole || '').toLowerCase();
  const objective = String(task?.objective || task?.details?.objective || '').toLowerCase();
  return supplyRole === 'heavy' || objective === 'escort_heavy_caravan';
}

function worldPartyPlayerLimit(party = {}, task = null) {
  return isHeavyCaravanParty(party, task) ? HEAVY_CARAVAN_PLAYER_LIMIT : WORLD_PARTY_PLAYER_LIMIT;
}

function worldPartyPlayerCount(party = {}) {
  return Array.isArray(party?.playerMembers) ? party.playerMembers.filter(Boolean).length : 0;
}

function normalizePartyPlayerMembers(party = {}, worldHour = 0) {
  const limit = worldPartyPlayerLimit(party);
  return Array.isArray(party?.playerMembers)
    ? party.playerMembers.map((row, index) => normalizePartyPlayerMember(row, index, worldHour)).filter(Boolean).slice(-limit)
    : [];
}

function normalizedWorldPartyMemberKey(userId = '', characterId = '') {
  return worldPartyMemberIdentityKey(userId, characterId, value => safeId(value, ''));
}

function syncPatrolDutyWindow(task = {}, taskMembers = [], worldHour = 0) {
  if (!task || String(task.type || '') !== 'join_patrol') return;
  task.details = task.details && typeof task.details === 'object' ? task.details : {};
  if (!Array.isArray(taskMembers) || taskMembers.length <= 0) {
    delete task.details.dutyStartedHour;
    delete task.details.dutyEndsHour;
    delete task.details.patrolDutyIntegrityVersion;
    return;
  }
  const now = Number(worldHour || 0);
  if (Number(task.details.patrolDutyIntegrityVersion || 0) < PATROL_DUTY_INTEGRITY_VERSION) {
    taskMembers.forEach(member => {
      member.joinedHour = now;
      member.lastSeenHour = Math.max(Number(member.lastSeenHour || 0), now);
    });
  }
  const joinedHours = taskMembers
    .map(member => Number(member?.joinedHour))
    .filter(Number.isFinite);
  const firstJoinedHour = joinedHours.length ? Math.min(...joinedHours) : now;
  const lastJoinedHour = joinedHours.length ? Math.max(...joinedHours) : now;
  task.details.patrolDutyIntegrityVersion = PATROL_DUTY_INTEGRITY_VERSION;
  task.details.dutyStartedHour = Number(firstJoinedHour.toFixed(2));
  task.details.dutyEndsHour = Number((lastJoinedHour + PATROL_DUTY_WORLD_HOURS).toFixed(2));
  task.expiresHour = Math.max(Number(task.expiresHour || 0), task.details.dutyEndsHour + 1);
}

function migrateLegacyWorldIdentityReferences(state = {}, legacyCharacterIdRemaps = []) {
  const remaps = (Array.isArray(legacyCharacterIdRemaps) ? legacyCharacterIdRemaps : [])
    .map(row => {
      const userId = safeId(row?.userId || row?.accountId || '', '');
      const previousCharacterId = safeId(row?.previousCharacterId || row?.oldCharacterId || '', '');
      const characterId = safeId(row?.characterId || row?.newCharacterId || '', '');
      return {
        userId,
        previousCharacterId,
        characterId,
        previousMemberKeyAmbiguous: !!row?.previousMemberKeyAmbiguous,
        previousMemberKey: normalizedWorldPartyMemberKey(userId, previousCharacterId),
        memberKey: normalizedWorldPartyMemberKey(userId, characterId)
      };
    })
    .filter(row => row.userId && row.previousCharacterId && row.characterId && row.previousCharacterId !== row.characterId);
  if (!remaps.length) return { remapped: 0, removedAmbiguous: 0 };
  const previousMemberKeyCounts = remaps.reduce((map, row) => {
    map.set(row.previousMemberKey, Number(map.get(row.previousMemberKey) || 0) + 1);
    return map;
  }, new Map());
  const ambiguousMemberKeys = new Set(remaps
    .filter(row => row.previousMemberKeyAmbiguous || Number(previousMemberKeyCounts.get(row.previousMemberKey) || 0) > 1)
    .map(row => row.previousMemberKey));
  const remapByPreviousMemberKey = new Map(remaps
    .filter(row => !ambiguousMemberKeys.has(row.previousMemberKey))
    .map(row => [row.previousMemberKey, row]));
  const ambiguousCharacterIds = new Set(remaps.map(row => row.previousCharacterId));
  let remapped = 0;
  let removedAmbiguous = 0;
  const remapCompositeIds = values => [...new Set((Array.isArray(values) ? values : [])
    .map(value => {
      const id = safeTransferIdentity(value || '');
      if (ambiguousMemberKeys.has(id)) {
        removedAmbiguous += 1;
        return '';
      }
      const exact = remapByPreviousMemberKey.get(id);
      if (exact) {
        remapped += 1;
        return exact.memberKey;
      }
      if (ambiguousCharacterIds.has(safeId(id, ''))) {
        removedAmbiguous += 1;
        return '';
      }
      return id;
    })
    .filter(Boolean))];
  const removeAmbiguousIds = values => [...new Set((Array.isArray(values) ? values : [])
    .map(value => safeTransferIdentity(value || ''))
    .filter(id => {
      if (!id || ambiguousCharacterIds.has(safeId(id, ''))) {
        if (id) removedAmbiguous += 1;
        return false;
      }
      return true;
    }))];
  const cleanDetails = details => {
    if (!details || typeof details !== 'object') return;
    if (Array.isArray(details.rewardMemberKeys)) {
      details.rewardMemberKeys = remapCompositeIds(details.rewardMemberKeys);
    }
    if (Array.isArray(details.arrivalTransferredPlayerIds)) {
      details.arrivalTransferredPlayerIds = remapCompositeIds(details.arrivalTransferredPlayerIds);
    }
    for (const field of [
      'rewardPlayerIds',
      'rewardCharacterIds',
      'eligibleRewardPlayerIds',
      'eligibleRewardCharacterIds',
      'joinedPlayers'
    ]) {
      if (Array.isArray(details[field])) details[field] = removeAmbiguousIds(details[field]);
    }
    for (const field of ['playerId', 'characterId', 'ownerPlayerId', 'startedByPlayerId']) {
      if (!ambiguousCharacterIds.has(safeId(details[field] || '', ''))) continue;
      delete details[field];
      removedAmbiguous += 1;
    }
  };
  for (const task of [
    ...(Array.isArray(state.worldTasks) ? state.worldTasks : []),
    ...(Array.isArray(state.worldTaskHistory) ? state.worldTaskHistory : [])
  ]) {
    cleanDetails(task?.details);
  }
  for (const event of Array.isArray(state.events) ? state.events : []) cleanDetails(event);
  for (const zone of Array.isArray(state.worldZones) ? state.worldZones : []) {
    cleanDetails(zone);
    cleanDetails(zone?.details);
    const sourceId = safeId(zone?.sourceId || '', '');
    if (ambiguousCharacterIds.has(sourceId)
      && (String(zone?.sourceType || '').toLowerCase() === 'player' || zone?.details?.playerAmbush)) {
      delete zone.sourceId;
      removedAmbiguous += 1;
    }
  }
  return {
    remapped,
    removedAmbiguous,
    remapByPreviousMemberKey,
    ambiguousCharacterIds,
    ambiguousMemberKeys
  };
}

function pruneInvalidWorldPartyPlayerMembers(state = {}, authoritativeCharacters = null, options = {}) {
  const legacyMigration = migrateLegacyWorldIdentityReferences(
    state,
    options?.legacyCharacterIdRemaps || options?.legacyRemaps || []
  );
  const taskById = new Map((Array.isArray(state.worldTasks) ? state.worldTasks : [])
    .filter(task => task?.id)
    .map(task => [String(task.id), task]));
  const authoritativeRows = authoritativeCharacters === null
    ? null
    : (Array.isArray(authoritativeCharacters) ? authoritativeCharacters : [])
      .map(row => {
        const userId = safeId(row?.userId || row?.accountId || '', '');
        const characterId = safeId(row?.characterId || row?.id || '', '');
        const memberKey = normalizedWorldPartyMemberKey(userId, characterId);
        return {
          userId,
          characterId,
          memberKey,
          accepted: new Set((Array.isArray(row?.acceptedTaskIds) ? row.acceptedTaskIds : [])
            .map(id => safeId(id || '', '')).filter(Boolean)),
          factionId: factionGroup(row?.factionId || row?.worldFactionId || '')
        };
      })
      .filter(row => row.memberKey);
  const authoritativeByMember = authoritativeRows === null
    ? null
    : new Map(authoritativeRows.map(row => [row.memberKey, row]));
  const authoritativeByCharacter = authoritativeRows === null
    ? null
    : authoritativeRows.reduce((map, row) => {
      if (!map.has(row.characterId)) map.set(row.characterId, []);
      map.get(row.characterId).push(row);
      return map;
    }, new Map());
  const candidates = [];
  let removed = 0;

  for (const party of Object.values(state.parties || {})) {
    if (!party || !Array.isArray(party.playerMembers)) continue;
    for (const member of party.playerMembers) {
      let characterId = safeId(member?.characterId || '', '');
      let userId = safeId(member?.userId || member?.accountId || '', '');
      const previousMemberKey = normalizedWorldPartyMemberKey(userId, characterId);
      const ambiguousLegacyMemberKey = legacyMigration.ambiguousMemberKeys?.has(previousMemberKey);
      const exactRemap = ambiguousLegacyMemberKey
        ? null
        : (legacyMigration.remapByPreviousMemberKey?.get(previousMemberKey) || null);
      if (exactRemap) {
        characterId = exactRemap.characterId;
        member.characterId = characterId;
        member.id = characterId;
        member.playerId = '';
        member.socketId = '';
      }
      const ambiguousLegacyIdentity = !!(
        ambiguousLegacyMemberKey
        || (!userId && legacyMigration.ambiguousCharacterIds?.has(characterId))
      );
      if (!userId && authoritativeByCharacter) {
        const owners = authoritativeByCharacter.get(characterId) || [];
        if (!ambiguousLegacyIdentity && owners.length === 1) {
          userId = owners[0].userId;
          member.userId = userId;
        }
      }
      const memberKey = normalizedWorldPartyMemberKey(userId, characterId);
      const taskId = safeId(member?.taskId || '', '');
      const task = taskById.get(taskId);
      const requiredFaction = factionGroup(party.faction || '');
      const memberFaction = factionGroup(member?.factionId || '');
      const authoritative = authoritativeByMember?.get(memberKey) || null;
      const valid = !!(!ambiguousLegacyIdentity
        && characterId
        && (authoritativeByMember === null || memberKey)
        && taskId
        && task
        && worldPartyTaskIsActiveForParty(task, party, state.worldHour)
        && (!isJoinableWorldFaction(requiredFaction) || memberFaction === requiredFaction)
        && (authoritativeByMember === null
          || (authoritative
            && authoritative.accepted.has(taskId)
            && (!isJoinableWorldFaction(requiredFaction) || authoritative.factionId === requiredFaction))));
      if (!valid) {
        removed += 1;
        continue;
      }
      candidates.push({
        party,
        member,
        characterId,
        memberKey: memberKey || `legacy:${characterId}`
      });
    }
    party.playerMembers = [];
  }

  candidates.sort((left, right) => (
    Number(right.member.joinedHour || 0) - Number(left.member.joinedHour || 0)
    || String(left.party.id || '').localeCompare(String(right.party.id || ''))
    || left.memberKey.localeCompare(right.memberKey)
  ));
  const seenMembers = new Set();
  for (const candidate of candidates) {
    if (seenMembers.has(candidate.memberKey)) {
      removed += 1;
      continue;
    }
    seenMembers.add(candidate.memberKey);
    candidate.party.playerMembers.push(candidate.member);
  }

  for (const party of Object.values(state.parties || {})) {
    if (!party) continue;
    party.playerMembers = (Array.isArray(party.playerMembers) ? party.playerMembers : [])
      .slice(0, worldPartyPlayerLimit(party));
  }
  for (const task of taskById.values()) {
    if (!isWorldPartyTask(task) || task.status !== 'active') continue;
    const party = state.parties?.[task.partyId || ''];
    if (!party) continue;
    const playerLimit = worldPartyPlayerLimit(party, task);
    const taskMembers = party.playerMembers.filter(member => member?.taskId === task.id).slice(0, playerLimit);
    task.details = task.details && typeof task.details === 'object' ? task.details : {};
    task.details.playerLimit = playerLimit;
    task.details.joinedPlayers = taskMembers.map(member => member.id).filter(Boolean);
    task.details.playerCount = taskMembers.length;
    syncPatrolDutyWindow(task, taskMembers, state.worldHour);
  }
  return {
    removed,
    kept: seenMembers.size,
    remappedReferences: Number(legacyMigration.remapped || 0),
    removedAmbiguousReferences: Number(legacyMigration.removedAmbiguous || 0)
  };
}

module.exports = {
  HEAVY_CARAVAN_PLAYER_LIMIT,
  PATROL_DUTY_INTEGRITY_VERSION,
  PATROL_DUTY_WORLD_HOURS,
  WORLD_PARTY_PLAYER_LIMIT,
  isHeavyCaravanParty,
  migrateLegacyWorldIdentityReferences,
  normalizePartyPlayerMember,
  normalizePartyPlayerMembers,
  normalizedWorldPartyMemberKey,
  pruneInvalidWorldPartyPlayerMembers,
  safeMemberName,
  syncPatrolDutyWindow,
  worldPartyPlayerCount,
  worldPartyPlayerLimit
};
