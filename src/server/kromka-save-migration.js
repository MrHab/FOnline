'use strict';

const CURRENT_WORLD_REVISION = 'kromka-1';

function cleanId(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function nodeIndex(globalMap = {}) {
  return new Map((Array.isArray(globalMap.nodes) ? globalMap.nodes : [])
    .filter(row => row && cleanId(row.id))
    .map(row => [cleanId(row.id), row]));
}

function fallbackKey(point = null) {
  const x = Number(point?.x ?? point?.playerX ?? 450);
  const y = Number(point?.y ?? point?.playerY ?? 450);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'unknown';
  if (x < 450 && y < 450) return 'north-west';
  if (x >= 450 && y < 450) return 'north-east';
  if (x < 450 && y >= 450) return 'south-west';
  return 'south-east';
}

function migrationDestination(savedState = {}, migration = {}, globalMap = {}) {
  const nodes = nodeIndex(globalMap);
  const preservedId = cleanId(savedState.currentLocationId || savedState.player?.locationId);
  if (nodes.has(preservedId)) {
    const node = nodes.get(preservedId);
    return {
      targetLocationId: preservedId,
      spawnId: `${preservedId}-migration`,
      node
    };
  }
  const rows = Array.isArray(migration.safeDestinations) ? migration.safeDestinations : [];
  const key = fallbackKey(savedState.globalMap || savedState.player?.globalMap);
  const row = rows.find(candidate => candidate?.legacyArea === key)
    || rows.find(candidate => candidate?.legacyArea === 'unknown')
    || { targetLocationId: 'settlement', spawnId: 'keys-arrival' };
  const targetLocationId = nodes.has(cleanId(row.targetLocationId))
    ? cleanId(row.targetLocationId) : 'settlement';
  return { targetLocationId, spawnId: cleanId(row.spawnId), node: nodes.get(targetLocationId) };
}

function migrateSavedStateToKromka(savedState = {}, migration = {}, globalMap = {}) {
  if (!savedState || typeof savedState !== 'object') return { migrated: false, state: savedState };
  const previousRevision = cleanId(savedState.worldRevision || savedState.player?.worldRevision || 'legacy');
  if (previousRevision === CURRENT_WORLD_REVISION) return { migrated: false, state: savedState };

  const destination = migrationDestination(savedState, migration, globalMap);
  const x = Number(destination.node?.x || 95);
  const y = Number(destination.node?.y || 205);
  savedState.worldRevision = CURRENT_WORLD_REVISION;
  savedState.currentLocationId = destination.targetLocationId;
  savedState.lastVisitedSettlementId = destination.targetLocationId;
  savedState.migrationSpawnId = destination.spawnId;
  savedState.onGlobalMap = false;
  savedState.globalMap = {
    ...(savedState.globalMap && typeof savedState.globalMap === 'object' ? savedState.globalMap : {}),
    playerX: x,
    playerY: y,
    selectedX: x,
    selectedY: y,
    route: [],
    travelling: false,
    worldRevision: CURRENT_WORLD_REVISION
  };
  savedState.serverLocationContext = {};
  if (savedState.player && typeof savedState.player === 'object') {
    savedState.player.worldRevision = CURRENT_WORLD_REVISION;
    savedState.player.locationId = destination.targetLocationId;
    savedState.player.globalMap = { ...savedState.globalMap };
    savedState.player.onGlobalMap = false;
  }
  if (!Array.isArray(savedState.migrations)) savedState.migrations = [];
  savedState.migrations.push({
    id: 'kromka-world-v1',
    from: previousRevision || 'legacy',
    to: CURRENT_WORLD_REVISION,
    targetLocationId: destination.targetLocationId,
    spawnId: destination.spawnId
  });
  return { migrated: true, state: savedState, previousRevision, destination };
}

module.exports = {
  CURRENT_WORLD_REVISION,
  fallbackKey,
  migrationDestination,
  migrateSavedStateToKromka
};
