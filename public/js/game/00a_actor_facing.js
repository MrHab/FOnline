(function initRealmActorFacing(scope) {
  'use strict';

  // Three.js-authored legacy actors face -Z. Blender assets authored toward
  // Blender -Y are exported toward glTF +Z and need the opposite root yaw.
  const MODEL_FORWARD_AXIS_BY_KEY = Object.freeze({
    traderNpc: '-Z',
    caravanMerchant: '-Z',
    caravanGuard: '-Z',
    klimPatrolGuard: '-Z',
    wastelandSettler: '-Z',
    enemyRaider: '-Z',
    enemyGhoul: '+Z',
    enemySuperMutant: '+Z',
    enemyAshWolf: '+Z',
    enemyRadscorpion: '-Z',
    enemyMutantAnt: '-Z',
    enemyGecko: '+Z',
    enemyFireGecko: '+Z',
    brahmin: '+Z',
    friendlyBrahmin: '+Z'
  });

  const MODEL_KEY_BY_VISUAL = Object.freeze({
    raider: 'enemyRaider',
    enemyraider: 'enemyRaider',
    ghoul: 'enemyGhoul',
    enemyghoul: 'enemyGhoul',
    mutant: 'enemySuperMutant',
    supermutant: 'enemySuperMutant',
    enemysupermutant: 'enemySuperMutant',
    wolf: 'enemyAshWolf',
    ashwolf: 'enemyAshWolf',
    enemyashwolf: 'enemyAshWolf',
    radscorpion: 'enemyRadscorpion',
    enemyradscorpion: 'enemyRadscorpion',
    mutantant: 'enemyMutantAnt',
    enemymutantant: 'enemyMutantAnt',
    gecko: 'enemyGecko',
    enemygecko: 'enemyGecko',
    firegecko: 'enemyFireGecko',
    enemyfiregecko: 'enemyFireGecko',
    brahmin: 'friendlyBrahmin',
    friendlybrahmin: 'friendlyBrahmin'
  });

  function normalizedFacingKey(value = '') {
    return String(value || '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  }

  function actorFacingModelKey(actor = {}) {
    const explicit = String(actor.modelKey || actor.staticModelKey || '').trim();
    if (MODEL_FORWARD_AXIS_BY_KEY[explicit]) return explicit;
    return MODEL_KEY_BY_VISUAL[normalizedFacingKey(actor.visual || actor.species || '')] || explicit;
  }

  function actorFacingCorrectionY(actor = {}) {
    return MODEL_FORWARD_AXIS_BY_KEY[actorFacingModelKey(actor)] === '+Z' ? Math.PI : 0;
  }

  function validFacingVector(dx, dz, epsilon = 0.01) {
    return Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > epsilon;
  }

  function actorLookVector(actor = {}, epsilon = 0.01) {
    const x = Number(actor.x || 0);
    const z = Number(actor.z || 0);
    const lookX = Number(actor.lookX);
    const lookZ = Number(actor.lookZ);
    const dx = lookX - x;
    const dz = lookZ - z;
    return actor.lookX !== null
      && actor.lookX !== undefined
      && actor.lookZ !== null
      && actor.lookZ !== undefined
      && validFacingVector(dx, dz, epsilon)
      ? { dx, dz }
      : null;
  }

  function actorFacingIntent(actor = {}, movementDx = 0, movementDz = 0, options = {}) {
    const epsilon = Math.max(0.0001, Number(options.epsilon || 0.01));
    const look = actorLookVector(actor, epsilon);
    const attacking = options.attackActive === true
      || actor.aiState === 'attack'
      || !!actor.meleeAnim;
    if (attacking && look) return { ...look, source: 'attack' };

    const dx = Number(movementDx);
    const dz = Number(movementDz);
    if (validFacingVector(dx, dz, epsilon)) return { dx, dz, source: 'movement' };
    if (look) return { ...look, source: 'look' };

    const fallbackX = Number(options.fallbackX);
    const fallbackZ = Number(options.fallbackZ);
    const fallbackDx = fallbackX - Number(actor.x || 0);
    const fallbackDz = fallbackZ - Number(actor.z || 0);
    if (
      options.fallbackX !== null
      && options.fallbackX !== undefined
      && options.fallbackZ !== null
      && options.fallbackZ !== undefined
      && validFacingVector(fallbackDx, fallbackDz, epsilon)
    ) {
      return { dx: fallbackDx, dz: fallbackDz, source: attacking ? 'attack-fallback' : 'fallback' };
    }
    return null;
  }

  function actorFacingYaw(actor = {}, dx = 0, dz = 0) {
    const vx = Number(dx);
    const vz = Number(dz);
    if (!validFacingVector(vx, vz)) return null;
    return Math.atan2(vx, vz) + Math.PI + actorFacingCorrectionY(actor);
  }

  const api = Object.freeze({
    MODEL_FORWARD_AXIS_BY_KEY,
    actorFacingCorrectionY,
    actorFacingIntent,
    actorFacingModelKey,
    actorFacingYaw
  });

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (scope) scope.RealmActorFacing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
