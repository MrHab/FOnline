  // ===== GLB CHARACTER ANIMATION BRIDGE =====
  // Character geometry is authored exclusively in GLB assets. This file keeps
  // the public animation hooks used by gameplay and the approved weapon grips.

  function modernAnimationWeaponId(actor) {
    const weaponGroup = typeof activeActorWeaponGroup === 'function'
      ? activeActorWeaponGroup(actor)
      : actorAnimationParts(actor).weaponGroup;
    if (!weaponGroup || !weaponGroup.children || !weaponGroup.children.length) return 'fists';
    return String(actor.userData?.weaponId || weaponGroup.userData?.weaponId || 'ranged');
  }

  function updateModernApprovedWeaponGrip(actor, weaponId = '') {
    if (typeof applyApprovedWeaponGrip === 'function') {
      return !!applyApprovedWeaponGrip(actor, weaponId);
    }
    if (typeof applyApprovedAssaultRifleGrip === 'function') {
      return !!applyApprovedAssaultRifleGrip(actor, weaponId);
    }
    return false;
  }

  // Kept as a no-op compatibility hook while callers are migrated. GLB actors
  // have no generated rig topology or procedural animation cache to invalidate.
  function invalidateModernProceduralRigAnimationCache() {
    return 0;
  }

  function triggerCharacterReloadVisual(actor, weaponId = 'pistol', duration = 0.82) {
    if (!actor?.userData) return;
    const reloadDuration = Math.max(0.5, Number(duration || 0.82));
    actor.userData.reloadAnim = {
      startedAt: performance.now(),
      duration: reloadDuration,
      weaponId: String(weaponId || 'pistol')
    };
    const weaponGroup = (typeof activeActorWeaponGroup === 'function' ? activeActorWeaponGroup(actor) : null)
      || actorAnimationParts(actor)?.weaponGroup
      || actor.userData?.enemyWeaponGroup;
    if (typeof triggerWeaponModelAction === 'function') {
      triggerWeaponModelAction(weaponGroup, 'reload', { duration: reloadDuration });
    }
  }

  function triggerCharacterHitReaction(actor, direction = 1, duration = 0.34) {
    if (!actor?.userData) return;
    actor.userData.hitReactionAnim = {
      startedAt: performance.now(),
      duration: Math.max(0.22, Number(duration || 0.34)),
      direction: Number(direction || 1) < 0 ? -1 : 1
    };
  }

  function updateCharacterLocomotionAnimation(actor, dt = 0.016, state = {}) {
    if (!actor) return;
    const moving = !!state.moving;
    const turnInPlace = typeof characterTurnInPlaceState === 'function'
      ? characterTurnInPlaceState(actor, state.facingAngle, moving, dt)
      : { turning: false, amount: 0 };
    const animationState = {
      ...state,
      turning: turnInPlace.turning,
      turnAmount: turnInPlace.amount
    };
    const glbUpdated = typeof updateCharacterGlbAnimation === 'function'
      && updateCharacterGlbAnimation(actor, dt, animationState) === true;
    if (!glbUpdated || !actor.userData?.characterGlbRuntime?.root) return;

    updateModernApprovedWeaponGrip(actor, modernAnimationWeaponId(actor));

    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const reloadAnim = actor.userData.reloadAnim;
    if (reloadAnim && now >= Number(reloadAnim.startedAt || 0)
      + Math.max(0.5, Number(reloadAnim.duration || 0.82)) * 1000) {
      delete actor.userData.reloadAnim;
    }
    const hitAnim = actor.userData.hitReactionAnim;
    if (hitAnim && now >= Number(hitAnim.startedAt || 0)
      + Math.max(0.22, Number(hitAnim.duration || 0.34)) * 1000) {
      delete actor.userData.hitReactionAnim;
    }
  }
