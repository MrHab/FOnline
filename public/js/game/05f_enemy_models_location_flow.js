  function createHpBar(width = 1.1) {
    const group = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.09), mats.black);
    const fg = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.07), mats.green);
    fg.position.z = 0.004;
    fg.position.x = 0;
    group.add(bg, fg);
    group.userData.fg = fg;
    group.userData.width = width;
    return group;
  }

  // v7.53: враги больше не являются одинаковыми цилиндрами. Силуэты собраны
  // из лёгких примитивов и специально читаются с изометрической камеры:
  // рейдер — человек с оружием и рваной бронёй, гуль — худой сгорбленный,
  // супермутант — широкий тяжёлый силуэт, пепельный волк — низкий зверь.
  const enemyVisualMats = {
    raiderCloth: matStandard({ color: 0x6d4633, map: makeNoiseTexture('enemy-raider-cloth', 0x6d4633, 0x8f6144, 0x271913, { seed: 211, repeat: 1, lines: 8, specks: 42 }), roughness: 0.88 }),
    raiderArmor: matStandard({ color: 0x5b5d55, map: makeNoiseTexture('enemy-raider-scrap', 0x5b5d55, 0x7c7b6e, 0x252721, { seed: 213, repeat: 1, lines: 16, specks: 50, lineAlpha: 0.22 }), roughness: 0.58, metalness: 0.34 }),
    ghoulSkin: matStandard({ color: 0x736c4e, map: makeNoiseTexture('enemy-ghoul-skin', 0x736c4e, 0x958a60, 0x302d20, { seed: 217, repeat: 1, lines: 7, specks: 62 }), roughness: 0.92 }),
    mutantSkin: matStandard({ color: 0x6d7552, map: makeNoiseTexture('enemy-mutant-skin', 0x6d7552, 0x8d956a, 0x303623, { seed: 219, repeat: 1, lines: 8, specks: 56 }), roughness: 0.86 }),
    wolfHide: matStandard({ color: 0x4b4435, map: makeNoiseTexture('enemy-ash-wolf-hide', 0x4b4435, 0x6c604a, 0x1f1c16, { seed: 223, repeat: 1, lines: 14, specks: 60 }), roughness: 0.9 }),
    scorpionCarapace: matStandard({ color: 0x3b3024, map: makeNoiseTexture('enemy-radscorpion-shell', 0x3b3024, 0x6a4a2d, 0x15100d, { seed: 229, repeat: 1, lines: 18, specks: 70 }), roughness: 0.82, metalness: 0.08 }),
    antCarapace: matStandard({ color: 0x5a2c1b, map: makeNoiseTexture('enemy-mutant-ant-shell', 0x5a2c1b, 0x8a4628, 0x21110b, { seed: 233, repeat: 1, lines: 14, specks: 64 }), roughness: 0.76 }),
    geckoHide: matStandard({ color: 0x587047, map: makeNoiseTexture('enemy-gecko-hide', 0x587047, 0x81965e, 0x202d1b, { seed: 239, repeat: 1, lines: 10, specks: 78 }), roughness: 0.88 }),
    fireGeckoHide: matStandard({ color: 0x74513a, map: makeNoiseTexture('enemy-fire-gecko-hide', 0x74513a, 0xb46b34, 0x26160f, { seed: 241, repeat: 1, lines: 13, specks: 84 }), roughness: 0.84 }),
    bone: matStandard({ color: 0xc4b68e, roughness: 0.82 }),
    ember: matStandard({ color: 0xe77d38, emissive: 0x7a250d, emissiveIntensity: 0.55, roughness: 0.62 }),
    toxic: matStandard({ color: 0x9fe36b, emissive: 0x4ba92c, emissiveIntensity: 0.55, roughness: 0.7 })
  };
  const ENEMY_ANIMATION_LOD_NEAR_DISTANCE = 5;
  const ENEMY_ANIMATION_LOD_CLOSE_DISTANCE = 10;
  const ENEMY_ANIMATION_LOD_MID_DISTANCE = 18;
  const ENEMY_ANIMATION_LOD_CLOSE_INTERVAL = 1 / 30;
  const ENEMY_ANIMATION_LOD_MID_INTERVAL = 0.05;
  const ENEMY_ANIMATION_LOD_FAR_INTERVAL = 0.08;
  const ENEMY_ANIMATION_LOD_MAX_DT = 0.08;
  const ENEMY_ANIMATION_CROWD_MIN_HEAVY_ACTORS = 6;
  const ENEMY_ANIMATION_CROWD_PRESSURE_FPS = 48;
  const ENEMY_ANIMATION_CROWD_RECOVERY_FPS = 54;
  const ENEMY_ANIMATION_CROWD_IDLE_INTERVAL = 0.05;
  const ENEMY_ANIMATION_LOD_STAGGER_BUCKETS = 8;
  let enemyAnimationCrowdPressureLatched = false;
  const enemyAnimationFrameContextState = {
    heavyActorCount: 0,
    measuredFps: 0,
    crowdPressure: false
  };

  function enemyAnimationLodInterval(distance, visible = true, important = false) {
    if (!visible) return Infinity;
    const numericDistance = Number(distance || 0);
    if (important || numericDistance <= ENEMY_ANIMATION_LOD_NEAR_DISTANCE) return 0;
    if (numericDistance <= ENEMY_ANIMATION_LOD_CLOSE_DISTANCE) return ENEMY_ANIMATION_LOD_CLOSE_INTERVAL;
    return numericDistance <= ENEMY_ANIMATION_LOD_MID_DISTANCE
      ? ENEMY_ANIMATION_LOD_MID_INTERVAL
      : ENEMY_ANIMATION_LOD_FAR_INTERVAL;
  }

  function enemyAnimationStableStaggerUnit(enemy = {}) {
    const key = String(enemy?.id || enemy?.mesh?.uuid || enemy?.name || '');
    if (!key) return 0;
    let hash = 2166136261;
    for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const buckets = Math.max(1, ENEMY_ANIMATION_LOD_STAGGER_BUCKETS);
    return ((hash >>> 0) % buckets) / buckets;
  }

  function enemyAnimationLodStaggerThreshold(enemy, interval) {
    const seconds = Math.max(0, Number(interval || 0));
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return seconds * (1 - enemyAnimationStableStaggerUnit(enemy));
  }

  function enemyAnimationCrowdPressure(actorCount = 0, measuredFps = 0, active = false) {
    if (Math.max(0, Number(actorCount || 0)) < ENEMY_ANIMATION_CROWD_MIN_HEAVY_ACTORS) return false;
    const fps = Math.max(0, Number(measuredFps || 0));
    if (active) return fps <= 0 || fps < ENEMY_ANIMATION_CROWD_RECOVERY_FPS;
    return fps > 0 && fps < ENEMY_ANIMATION_CROWD_PRESSURE_FPS;
  }

  function enemyAnimationCrowdAdjustedInterval(interval, options = {}) {
    const base = Number(interval);
    if (!Number.isFinite(base)) return interval;
    if (
      options.crowdPressure !== true
      || options.heavy !== true
      || options.idle !== true
      || options.important === true
    ) return base;
    return Math.max(base, ENEMY_ANIMATION_CROWD_IDLE_INTERVAL);
  }

  function enemyActorUsesHeavyAnimation(actor) {
    const mesh = actor?.mesh;
    const parts = mesh?.userData?.actorParts || mesh?.userData?.parts;
    return !!(
      mesh
      && mesh.visible !== false
      && !actor?._removed
      && !actor?.dead
      && (
        parts?.unifiedHumanoidNpc
        || mesh.userData?.characterGlbRuntime
        || mesh.userData?.npcCreatureGlbAnimation
        || mesh.userData?.approvedEquipmentCharacterRuntime
      )
    );
  }

  function createEnemyAnimationFrameContext(rows = [], trader = null, measuredFps = 0) {
    let heavyActorCount = 0;
    let traderAlreadyCounted = false;
    if (Array.isArray(rows)) {
      for (let index = 0; index < rows.length; index += 1) {
        const actor = rows[index];
        if (trader && (actor === trader || actor?.mesh === trader?.mesh)) traderAlreadyCounted = true;
        if (enemyActorUsesHeavyAnimation(actor)) heavyActorCount += 1;
      }
    }
    if (!traderAlreadyCounted && enemyActorUsesHeavyAnimation(trader)) heavyActorCount += 1;
    enemyAnimationCrowdPressureLatched = enemyAnimationCrowdPressure(
      heavyActorCount,
      measuredFps,
      enemyAnimationCrowdPressureLatched
    );
    enemyAnimationFrameContextState.heavyActorCount = heavyActorCount;
    enemyAnimationFrameContextState.measuredFps = Math.max(0, Number(measuredFps || 0));
    enemyAnimationFrameContextState.crowdPressure = enemyAnimationCrowdPressureLatched;
    return enemyAnimationFrameContextState;
  }

  function consumeEnemyAnimationLodDt(enemy, dt, interval, stateKey) {
    const numericDt = Number(dt);
    const frameDt = Number.isFinite(numericDt) ? Math.max(0, Math.min(0.05, numericDt)) : 0.016;
    const accumulatedDt = Math.min(
      ENEMY_ANIMATION_LOD_MAX_DT,
      Math.max(0, Number(enemy?.heavyAnimationLodDt || 0)) + frameDt
    );
    const nextStateKey = String(stateKey || '');
    const stateChanged = String(enemy?.heavyAnimationLodStateKey || '') !== nextStateKey;
    const previousInterval = enemy?.heavyAnimationLodInterval;
    const finiteInterval = Number.isFinite(interval);
    const intervalChanged = previousInterval !== undefined && (
      Number.isFinite(previousInterval) !== finiteInterval
      || (finiteInterval && Math.abs(Number(previousInterval) - Number(interval)) > 1e-6)
    );
    enemy.heavyAnimationLodStateKey = nextStateKey;
    enemy.heavyAnimationLodInterval = finiteInterval ? Math.max(0, Number(interval || 0)) : Infinity;
    if (!finiteInterval) {
      enemy.heavyAnimationLodDt = accumulatedDt;
      enemy.heavyAnimationLodThreshold = Infinity;
      return 0;
    }
    const normalizedInterval = Math.max(0, Number(interval || 0));
    if (stateChanged) {
      enemy.heavyAnimationLodDt = 0;
      enemy.heavyAnimationLodThreshold = normalizedInterval > 0
        ? enemyAnimationLodStaggerThreshold(enemy, normalizedInterval)
        : 0;
      return accumulatedDt;
    }
    if (intervalChanged) {
      enemy.heavyAnimationLodThreshold = normalizedInterval > 0
        ? enemyAnimationLodStaggerThreshold(enemy, normalizedInterval)
        : 0;
    }
    const threshold = normalizedInterval > 0
      ? Math.max(0, Number(enemy?.heavyAnimationLodThreshold ?? normalizedInterval))
      : 0;
    if (normalizedInterval > 0 && accumulatedDt + 1e-6 < threshold) {
      enemy.heavyAnimationLodDt = accumulatedDt;
      return 0;
    }
    enemy.heavyAnimationLodDt = 0;
    enemy.heavyAnimationLodThreshold = normalizedInterval;
    return accumulatedDt;
  }

  function makeEnemyBox(w, h, d, material, x, y, z, sx = 1, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * sx, h * sx, d * sx), material);
    mesh.position.set(x * sx, y * sx, z * sx);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = !IS_MOBILE_DEVICE;
    mesh.receiveShadow = false;
    return mesh;
  }

  function makeEnemyCylinder(r1, r2, h, material, x, y, z, sx = 1, radial = 10, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1 * sx, r2 * sx, h * sx, radial), material);
    mesh.position.set(x * sx, y * sx, z * sx);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = !IS_MOBILE_DEVICE;
    mesh.receiveShadow = false;
    return mesh;
  }

  function makeEnemySphere(r, material, x, y, z, sx = 1, seg = 12) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r * sx, seg, Math.max(8, Math.floor(seg * 0.75))), material);
    mesh.position.set(x * sx, y * sx, z * sx);
    mesh.castShadow = !IS_MOBILE_DEVICE;
    mesh.receiveShadow = false;
    return mesh;
  }

  function addEnemyBaseShadow(group, scale, radius = 0.64) {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(radius * scale, 22),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.27, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    shadow.visible = true; // v7.74.81: cheap pseudo contact shadow while real shadow maps are disabled
    group.add(shadow);
    return shadow;
  }

  function addEnemyTargetRing(group, scale, radius = 0.82) {
    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(radius * scale, (radius + 0.17) * scale, 48),
      new THREE.MeshBasicMaterial({ color: 0xf0c65b, transparent: true, opacity: 0.88, depthWrite: false })
    );
    targetRing.rotation.x = -Math.PI / 2;
    targetRing.position.y = 0.04;
    targetRing.visible = false;
    group.add(targetRing);
    group.userData.targetRing = targetRing;
  }

  function enemyVariantAccentProfile(id) {
    if (id === 'scarred') return { color: 0xd06a3a, opacity: 0.42, radius: 0.9 };
    if (id === 'swift') return { color: 0x7fd6ff, opacity: 0.34, radius: 0.82 };
    if (id === 'legendary') return { color: 0xf0c65b, opacity: 0.58, radius: 0.98 };
    return null;
  }

  function addEnemyVariantAccent(group, type, visual) {
    const profile = enemyVariantAccentProfile(type.variantId || 'normal');
    if (!profile) return;
    const scale = type.scale || 1;
    const baseRadius = (visual === 'wolf' ? 0.76 : 0.82) * profile.radius;
    const accent = new THREE.Mesh(
      new THREE.RingGeometry(baseRadius * scale, (baseRadius + 0.055) * scale, 36),
      new THREE.MeshBasicMaterial({ color: profile.color, transparent: true, opacity: profile.opacity, depthWrite: false })
    );
    accent.rotation.x = -Math.PI / 2;
    accent.position.y = 0.055;
    accent.userData.baseOpacity = profile.opacity;
    group.add(accent);
    group.userData.variantAccent = accent;
  }

  function addEnemyHumanoidDetailPass(group, s = 1, profile = 'raider') {
    const armorMat = profile === 'mutant' ? enemyVisualMats.raiderArmor : actorMats.rustPlate;
    const skinMat = profile === 'mutant' ? enemyVisualMats.mutantSkin : mats.skin;
    const clothMat = profile === 'mutant' ? enemyVisualMats.raiderArmor : actorMats.strap;
    group.add(makeEnemyBox(0.15, 0.11, 0.15, skinMat, -0.52, 0.64, -0.10, s, 0.03, 0, -0.08));
    group.add(makeEnemyBox(0.15, 0.11, 0.15, skinMat, 0.52, 0.64, -0.10, s, 0.03, 0, 0.08));
    group.add(makeEnemyBox(0.20, 0.09, 0.20, armorMat, -0.16, 0.38, -0.12, s, 0.07, 0, 0.05));
    group.add(makeEnemyBox(0.20, 0.09, 0.20, armorMat, 0.16, 0.38, -0.12, s, -0.07, 0, -0.05));
    group.add(makeEnemyBox(0.07, 0.68, 0.06, clothMat, -0.15, 1.02, -0.25, s, 0.08, 0, -0.54));
    group.add(makeEnemyBox(0.13, 0.10, 0.05, armorMat, 0.06, 0.92, -0.28, s, 0, 0, -0.08));
    group.add(makeEnemyBox(0.15, 0.20, 0.11, actorMats.pack, -0.34, 0.78, -0.02, s, 0.02, 0, -0.08));
    group.add(makeEnemyBox(0.15, 0.20, 0.11, actorMats.pack, 0.34, 0.78, -0.02, s, 0.02, 0, 0.08));
    if (profile === 'mutant') {
      group.add(makeEnemyBox(0.58, 0.10, 0.08, actorMats.rustPlate, 0, 1.30, -0.32, s, 0, 0, 0.02));
      group.add(makeEnemyBox(0.22, 0.18, 0.10, enemyVisualMats.bone, -0.16, 1.52, -0.28, s, 0, 0, 0.04));
      group.add(makeEnemyBox(0.22, 0.18, 0.10, enemyVisualMats.bone, 0.16, 1.52, -0.28, s, 0, 0, -0.04));
    } else {
      group.add(makeEnemyBox(0.20, 0.10, 0.06, actorMats.strap, 0, 1.39, -0.21, s));
      group.add(makeEnemyBox(0.14, 0.055, 0.045, actorMats.armor, -0.09, 1.43, -0.255, s));
      group.add(makeEnemyBox(0.14, 0.055, 0.045, actorMats.armor, 0.09, 1.43, -0.255, s));
    }
  }

  function addGhoulDetailPass(group, s = 1) {
    group.add(makeEnemyBox(0.20, 0.055, 0.04, enemyVisualMats.bone, 0, 1.25, -0.31, s, -0.08, 0, 0));
    group.add(makeEnemySphere(0.04, enemyVisualMats.toxic, -0.17, 0.73, -0.22, s, 8));
    group.add(makeEnemySphere(0.032, enemyVisualMats.toxic, 0.12, 1.17, -0.25, s, 8));
    group.add(makeEnemyBox(0.08, 0.22, 0.055, enemyVisualMats.bone, -0.43, 0.50, -0.22, s, 0.22, 0, -0.58));
    group.add(makeEnemyBox(0.08, 0.22, 0.055, enemyVisualMats.bone, 0.43, 0.50, -0.22, s, 0.22, 0, 0.58));
    [-0.14, 0, 0.14].forEach((x, i) => {
      group.add(makeEnemyBox(0.045, 0.10, 0.035, enemyVisualMats.bone, x, 0.98 - i * 0.055, -0.245, s, -0.14, 0, 0));
    });
  }

  function addCreatureDetailPass(group, s = 1, kind = '') {
    if (kind === 'wolf') {
      group.add(makeEnemyBox(0.07, 0.18, 0.07, enemyVisualMats.bone, -0.12, 0.86, -0.72, s, -0.2, 0, -0.28));
      group.add(makeEnemyBox(0.07, 0.18, 0.07, enemyVisualMats.bone, 0.12, 0.86, -0.72, s, -0.2, 0, 0.28));
      group.add(makeEnemySphere(0.035, enemyVisualMats.toxic, -0.08, 0.73, -0.84, s, 8));
      group.add(makeEnemySphere(0.035, enemyVisualMats.toxic, 0.08, 0.73, -0.84, s, 8));
      return;
    }
    if (kind === 'scorpion') {
      [-0.24, 0, 0.24].forEach((x, i) => {
        group.add(makeEnemyBox(0.18, 0.045, 0.30, enemyVisualMats.bone, x, 0.57 + i * 0.035, -0.04 + i * 0.18, s, 0.04, 0, x * 0.3));
      });
      group.add(makeEnemySphere(0.055, enemyVisualMats.toxic, 0, 0.82, 1.25, s, 8));
      return;
    }
    if (kind === 'ant') {
      [-0.16, 0.16].forEach(x => {
        group.add(makeEnemySphere(0.045, enemyVisualMats.ember, x, 0.43, -0.62, s, 8));
        group.add(makeEnemyBox(0.05, 0.05, 0.34, enemyVisualMats.bone, x * 0.9, 0.29, -0.74, s, 0, x < 0 ? -0.38 : 0.38, x < 0 ? -0.12 : 0.12));
      });
      return;
    }
    if (kind === 'gecko' || kind === 'fireGecko') {
      const glow = kind === 'fireGecko' ? enemyVisualMats.ember : enemyVisualMats.toxic;
      group.add(makeEnemyBox(0.10, 0.08, 0.36, glow, 0, 0.57, -0.20, s, 0.08, 0, 0));
      group.add(makeEnemyBox(0.08, 0.07, 0.28, glow, -0.13, 0.53, 0.12, s, 0.06, 0, -0.18));
      group.add(makeEnemyBox(0.08, 0.07, 0.28, glow, 0.13, 0.53, 0.12, s, 0.06, 0, 0.18));
    }
  }

  function buildRaiderEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 0.62);
    const legs = new THREE.Group();
    legs.add(makeEnemyBox(0.17, 0.5, 0.2, actorMats.pants, -0.15, 0.3, 0.02, s, 0.04, 0, -0.05));
    legs.add(makeEnemyBox(0.17, 0.5, 0.2, actorMats.pants, 0.15, 0.3, 0.02, s, -0.04, 0, 0.05));
    legs.add(makeEnemyBox(0.24, 0.13, 0.3, actorMats.boot, -0.15, 0.07, -0.05, s));
    legs.add(makeEnemyBox(0.24, 0.13, 0.3, actorMats.boot, 0.15, 0.07, -0.05, s));
    group.add(legs);

    const body = makeEnemyCylinder(0.28, 0.38, 0.78, enemyVisualMats.raiderCloth, 0, 0.86, 0.02, s, 9);
    const chest = makeEnemyBox(0.66, 0.42, 0.28, enemyVisualMats.raiderArmor, 0, 1.02, -0.05, s, 0.02, 0, 0.04);
    const head = makeEnemySphere(0.22, mats.skin, 0, 1.43, -0.02, s, 12);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.245 * s, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55), actorMats.rustPlate);
    helmet.position.set(0, 1.51 * s, -0.02 * s);
    helmet.castShadow = !IS_MOBILE_DEVICE;
    const armL = makeEnemyBox(0.13, 0.52, 0.15, enemyVisualMats.raiderCloth, -0.43, 0.96, -0.02, s, 0, 0, -0.28);
    const armR = makeEnemyBox(0.13, 0.52, 0.15, enemyVisualMats.raiderCloth, 0.43, 0.96, -0.02, s, 0, 0, 0.28);
    const gun = makeEnemyBox(0.1, 0.1, 0.78, mats.darkMetal, 0.52, 0.92, -0.34, s, 0, 0.04, 0.0);
    const pack = makeEnemyBox(0.46, 0.46, 0.18, actorMats.pack, 0, 0.95, 0.31, s);
    group.add(body, chest, head, helmet, armL, armR, gun, pack);
    addEnemyHumanoidDetailPass(group, s, 'raider');
    group.userData.actorParts = {
      kind: 'raider',
      legs, body, chest, head, helmet, armL, armR,
      backpack: pack,
      weaponStatic: gun,
      baseMaterials: { body: enemyVisualMats.raiderCloth, chest: enemyVisualMats.raiderArmor, arm: enemyVisualMats.raiderCloth, helmet: actorMats.rustPlate }
    };
  }

  function buildGhoulEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 0.54);
    const legs = new THREE.Group();
    legs.add(makeEnemyBox(0.12, 0.52, 0.14, enemyVisualMats.ghoulSkin, -0.12, 0.31, 0.02, s, 0.12, 0, -0.12));
    legs.add(makeEnemyBox(0.12, 0.5, 0.14, enemyVisualMats.ghoulSkin, 0.14, 0.31, -0.02, s, -0.1, 0, 0.1));
    group.add(legs);
    const body = makeEnemyCylinder(0.2, 0.27, 0.82, enemyVisualMats.ghoulSkin, 0, 0.83, 0.06, s, 8, -0.16, 0, 0);
    const ribs = makeEnemyBox(0.42, 0.26, 0.08, enemyVisualMats.bone, 0, 0.94, -0.18, s, -0.14, 0, 0);
    const head = makeEnemySphere(0.22, enemyVisualMats.ghoulSkin, 0.01, 1.34, -0.16, s, 10);
    const armL = makeEnemyBox(0.1, 0.68, 0.12, enemyVisualMats.ghoulSkin, -0.36, 0.84, -0.11, s, 0.2, 0, -0.54);
    const armR = makeEnemyBox(0.1, 0.68, 0.12, enemyVisualMats.ghoulSkin, 0.36, 0.84, -0.11, s, 0.2, 0, 0.54);
    const glow1 = makeEnemySphere(0.045, enemyVisualMats.toxic, -0.12, 1.04, -0.23, s, 8);
    const glow2 = makeEnemySphere(0.035, enemyVisualMats.toxic, 0.16, 0.78, -0.2, s, 8);
    group.add(body, ribs, head, armL, armR, glow1, glow2);
    addGhoulDetailPass(group, s);
    group.userData.actorParts = { kind: 'ghoul', legs, body, head, armL, armR };
  }

  function buildMutantEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 0.78);
    const legs = new THREE.Group();
    legs.add(makeEnemyBox(0.23, 0.56, 0.28, enemyVisualMats.mutantSkin, -0.22, 0.34, 0.04, s, 0.04, 0, -0.04));
    legs.add(makeEnemyBox(0.23, 0.56, 0.28, enemyVisualMats.mutantSkin, 0.22, 0.34, 0.04, s, -0.04, 0, 0.04));
    legs.add(makeEnemyBox(0.34, 0.16, 0.38, actorMats.boot, -0.22, 0.07, -0.05, s));
    legs.add(makeEnemyBox(0.34, 0.16, 0.38, actorMats.boot, 0.22, 0.07, -0.05, s));
    group.add(legs);
    const body = makeEnemyCylinder(0.42, 0.58, 1.02, enemyVisualMats.mutantSkin, 0, 0.98, 0.03, s, 11);
    const chest = makeEnemyBox(0.92, 0.48, 0.38, enemyVisualMats.raiderArmor, 0, 1.17, -0.08, s, 0.02, 0, 0);
    const head = makeEnemySphere(0.27, enemyVisualMats.mutantSkin, 0, 1.62, -0.02, s, 12);
    const jaw = makeEnemyBox(0.36, 0.14, 0.12, enemyVisualMats.bone, 0, 1.49, -0.2, s);
    const shoulderL = makeEnemyBox(0.34, 0.2, 0.34, enemyVisualMats.raiderArmor, -0.62, 1.29, -0.01, s, 0, 0, -0.18);
    const shoulderR = makeEnemyBox(0.34, 0.2, 0.34, actorMats.rustPlate, 0.62, 1.29, -0.01, s, 0, 0, 0.18);
    const armL = makeEnemyBox(0.19, 0.72, 0.22, enemyVisualMats.mutantSkin, -0.67, 0.93, -0.02, s, 0.02, 0, -0.22);
    const armR = makeEnemyBox(0.19, 0.72, 0.22, enemyVisualMats.mutantSkin, 0.67, 0.93, -0.02, s, 0.02, 0, 0.22);
    const weapon = makeEnemyBox(0.16, 0.16, 0.86, mats.darkMetal, 0.74, 0.87, -0.32, s, 0, 0, 0.1);
    group.add(body, chest, head, jaw, shoulderL, shoulderR, armL, armR, weapon);
    addEnemyHumanoidDetailPass(group, s, 'mutant');
    group.userData.actorParts = {
      kind: 'mutant',
      legs, body, chest, head, armL, armR,
      shoulderL, shoulderR,
      weaponStatic: weapon,
      baseMaterials: { body: enemyVisualMats.mutantSkin, chest: enemyVisualMats.raiderArmor, arm: enemyVisualMats.mutantSkin }
    };
  }

  function buildWolfEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 0.72);
    const body = makeEnemyBox(0.52, 0.34, 0.92, enemyVisualMats.wolfHide, 0, 0.48, 0.02, s, -0.02, 0, 0);
    const chest = makeEnemyBox(0.42, 0.42, 0.36, enemyVisualMats.wolfHide, 0, 0.57, -0.38, s, -0.12, 0, 0);
    const head = makeEnemySphere(0.22, enemyVisualMats.wolfHide, 0, 0.69, -0.68, s, 10);
    const muzzle = makeEnemyBox(0.18, 0.12, 0.22, enemyVisualMats.bone, 0, 0.64, -0.86, s, -0.08, 0, 0);
    const tail = makeEnemyBox(0.12, 0.12, 0.44, enemyVisualMats.wolfHide, 0, 0.56, 0.68, s, 0.32, 0, 0);
    const legs = new THREE.Group();
    [[-0.21,0.31,-0.3], [0.21,0.31,-0.3], [-0.21,0.28,0.34], [0.21,0.28,0.34]].forEach((p, i) => {
      legs.add(makeEnemyBox(0.12, 0.42, 0.12, enemyVisualMats.wolfHide, p[0], p[1], p[2], s, i < 2 ? -0.18 : 0.12, 0, i % 2 ? 0.12 : -0.12));
    });
    const spines = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055 * s, 0.22 * s, 5), enemyVisualMats.bone);
      spike.position.set(0, (0.78 - i * 0.035) * s, (-0.28 + i * 0.2) * s);
      spike.rotation.x = -0.35;
      spike.castShadow = !IS_MOBILE_DEVICE;
      spines.add(spike);
    }
    group.add(body, chest, head, muzzle, tail, legs, spines);
    addCreatureDetailPass(group, s, 'wolf');
    group.userData.actorParts = { kind: 'wolf', legs, body, chest, head, tail };
  }

  function buildRadscorpionEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 0.9);
    const mat = enemyVisualMats.scorpionCarapace;
    const body = makeEnemySphere(0.43, mat, 0, 0.34, 0.06, s, 14);
    body.scale.set(1.45, 0.48, 1.0);
    const head = makeEnemySphere(0.27, mat, 0, 0.31, -0.65, s, 12);
    head.scale.set(1.1, 0.62, 0.85);
    const mask = makeEnemyBox(0.34, 0.08, 0.12, enemyVisualMats.bone, 0, 0.31, -0.88, s);
    const legs = new THREE.Group();
    [-0.42, -0.18, 0.1, 0.36].forEach((z, row) => {
      [-1, 1].forEach(side => {
        legs.add(makeEnemyBox(0.62, 0.07, 0.08, mat, side * 0.48, 0.2, z, s, 0.04, side * 0.12, side * (0.34 + row * 0.04)));
        legs.add(makeEnemyBox(0.38, 0.06, 0.07, mat, side * 0.86, 0.13, z + 0.06, s, 0.03, side * 0.06, side * -0.24));
      });
    });
    const claws = new THREE.Group();
    [-1, 1].forEach(side => {
      claws.add(makeEnemyBox(0.5, 0.08, 0.1, mat, side * 0.45, 0.28, -0.82, s, 0, side * -0.16, side * 0.46));
      const claw = makeEnemySphere(0.16, mat, side * 0.78, 0.29, -1.05, s, 10);
      claw.scale.set(1.2, 0.5, 0.85);
      claws.add(claw);
      claws.add(makeEnemyBox(0.08, 0.07, 0.22, enemyVisualMats.bone, side * 0.9, 0.29, -1.14, s, 0, side * 0.45, side * 0.2));
    });
    const tail = new THREE.Group();
    [
      [0, 0.42, 0.58, 0.17],
      [0, 0.56, 0.82, 0.14],
      [0, 0.68, 1.02, 0.12],
      [0, 0.76, 1.18, 0.1]
    ].forEach(([x, y, z, r]) => tail.add(makeEnemySphere(r, mat, x, y, z, s, 10)));
    const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.1 * s, 0.34 * s, 8), enemyVisualMats.toxic);
    stinger.position.set(0, 0.74 * s, 1.36 * s);
    stinger.rotation.x = Math.PI * 0.62;
    stinger.castShadow = !IS_MOBILE_DEVICE;
    tail.add(stinger);
    const eyes = new THREE.Group();
    eyes.add(makeEnemySphere(0.035, enemyVisualMats.toxic, -0.1, 0.42, -0.84, s, 8));
    eyes.add(makeEnemySphere(0.035, enemyVisualMats.toxic, 0.1, 0.42, -0.84, s, 8));
    group.add(body, head, mask, legs, claws, tail, eyes);
    addCreatureDetailPass(group, s, 'scorpion');
    group.userData.actorParts = { kind: 'scorpion', body, head, legs, tail, claws };
  }

  function buildMutantAntEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 0.74);
    const mat = enemyVisualMats.antCarapace;
    const abdomen = makeEnemySphere(0.34, mat, 0, 0.34, 0.48, s, 12);
    abdomen.scale.set(1.0, 0.78, 1.24);
    const thorax = makeEnemySphere(0.3, mat, 0, 0.36, -0.02, s, 12);
    thorax.scale.set(1.05, 0.72, 0.92);
    const head = makeEnemySphere(0.24, mat, 0, 0.33, -0.48, s, 10);
    head.scale.set(1.05, 0.7, 0.88);
    const legs = new THREE.Group();
    [-0.3, -0.02, 0.28].forEach((z, row) => {
      [-1, 1].forEach(side => {
        legs.add(makeEnemyBox(0.52, 0.06, 0.07, mat, side * 0.45, 0.22, z, s, 0.03, side * 0.08, side * (0.36 + row * 0.08)));
        legs.add(makeEnemyBox(0.34, 0.055, 0.06, mat, side * 0.78, 0.13, z + 0.06, s, 0.02, side * 0.05, side * -0.26));
      });
    });
    const mandibles = new THREE.Group();
    mandibles.add(makeEnemyBox(0.08, 0.06, 0.25, enemyVisualMats.bone, -0.12, 0.31, -0.72, s, 0, -0.32, -0.12));
    mandibles.add(makeEnemyBox(0.08, 0.06, 0.25, enemyVisualMats.bone, 0.12, 0.31, -0.72, s, 0, 0.32, 0.12));
    mandibles.add(makeEnemySphere(0.035, enemyVisualMats.ember, -0.09, 0.43, -0.62, s, 8));
    mandibles.add(makeEnemySphere(0.035, enemyVisualMats.ember, 0.09, 0.43, -0.62, s, 8));
    const antennae = new THREE.Group();
    antennae.add(makeEnemyBox(0.04, 0.04, 0.42, mat, -0.12, 0.51, -0.68, s, -0.2, -0.36, -0.22));
    antennae.add(makeEnemyBox(0.04, 0.04, 0.42, mat, 0.12, 0.51, -0.68, s, -0.2, 0.36, 0.22));
    group.add(abdomen, thorax, head, legs, mandibles, antennae);
    addCreatureDetailPass(group, s, 'ant');
    group.userData.actorParts = { kind: 'mutantAnt', body: thorax, abdomen, head, legs, antennae };
  }

  function buildGeckoEnemy(group, type, fire = false) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, fire ? 0.84 : 0.78);
    const mat = fire ? enemyVisualMats.fireGeckoHide : enemyVisualMats.geckoHide;
    const body = makeEnemySphere(0.36, mat, 0, 0.36, 0.0, s, 14);
    body.scale.set(1.15, 0.58, 1.48);
    const head = makeEnemySphere(0.25, mat, 0, 0.38, -0.68, s, 12);
    head.scale.set(1.0, 0.72, 0.95);
    const snout = makeEnemyBox(0.28, 0.11, 0.26, mat, 0, 0.34, -0.9, s, -0.04, 0, 0);
    const tail = makeEnemyBox(0.16, 0.12, 0.86, mat, 0, 0.32, 0.88, s, 0.12, 0, 0);
    const legs = new THREE.Group();
    [[-0.28,-0.36], [0.28,-0.36], [-0.28,0.34], [0.28,0.34]].forEach(([x, z], i) => {
      const side = x < 0 ? -1 : 1;
      legs.add(makeEnemyBox(0.34, 0.07, 0.1, mat, x, 0.22, z, s, 0.03, side * 0.14, side * (i < 2 ? 0.42 : -0.34)));
      legs.add(makeEnemyBox(0.22, 0.055, 0.08, mat, x + side * 0.25, 0.12, z + (i < 2 ? -0.08 : 0.1), s, 0.02, side * 0.08, side * -0.2));
    });
    const eyes = new THREE.Group();
    eyes.add(makeEnemySphere(0.04, fire ? enemyVisualMats.ember : enemyVisualMats.toxic, -0.1, 0.5, -0.83, s, 8));
    eyes.add(makeEnemySphere(0.04, fire ? enemyVisualMats.ember : enemyVisualMats.toxic, 0.1, 0.5, -0.83, s, 8));
    if (fire) {
      for (let i = 0; i < 4; i++) {
        const ember = makeEnemySphere(0.04, enemyVisualMats.ember, (i % 2 ? 0.16 : -0.16), 0.54 - i * 0.03, -0.18 + i * 0.22, s, 8);
        group.add(ember);
      }
    }
    group.add(body, head, snout, tail, legs, eyes);
    addCreatureDetailPass(group, s, fire ? 'fireGecko' : 'gecko');
    group.userData.actorParts = { kind: 'gecko', body, head, tail, legs, fire };
  }

  function buildBrahminEnemy(group, type) {
    const s = type.scale || 1;
    addEnemyBaseShadow(group, s, 1.08);
    const modelKey = type.modelKey || 'friendlyBrahmin';
    if (typeof makeStaticModelGroup === 'function') {
      const model = makeStaticModelGroup(modelKey, 0, 0, 0, 'enemy-brahmin', {
        scale: s,
        cloneMaterials: true,
        castShadow: !IS_MOBILE_DEVICE,
        receiveShadow: false,
        afterApply: (_holder, instance, appliedKey) => {
          configureEnemyStaticGlbAnimation(group, instance, appliedKey || modelKey);
        }
      });
      model.position.set(0, 0, 0);
      group.add(model);
      group.userData.actorParts = { kind: 'brahmin' };
      return;
    }
    const hide = enemyVisualMats.wolfHide;
    const body = makeEnemyBox(1.25, 0.58, 0.62, hide, 0, 0.55, 0, s);
    const hump = makeEnemySphere(0.34, hide, 0, 0.92, 0.04, s, 12);
    hump.scale.set(1.35, 0.74, 0.92);
    const headL = makeEnemySphere(0.18, hide, -0.24, 0.72, -0.48, s, 10);
    const headR = makeEnemySphere(0.18, hide, 0.24, 0.72, -0.48, s, 10);
    const legs = new THREE.Group();
    [-0.38, 0.38].forEach(x => [-0.22, 0.26].forEach(z => legs.add(makeEnemyBox(0.13, 0.42, 0.13, hide, x, 0.24, z, s))));
    group.add(body, hump, headL, headR, legs);
    group.userData.actorParts = { kind: 'brahmin', body, head: headL, legs };
  }

  function enemyActorKindForStaticVisual(visual = '', modelKey = '') {
    const text = `${visual} ${modelKey}`.toLowerCase();
    if (text.includes('brahmin')) return 'brahmin';
    if (text.includes('radscorpion')) return 'scorpion';
    if (text.includes('mutantant') || text.includes('mutant_ant')) return 'mutantAnt';
    if (text.includes('firegecko') || text.includes('fire_gecko')) return 'gecko';
    if (text.includes('gecko')) return 'gecko';
    if (text.includes('ashwolf') || text.includes('ash_wolf') || text.includes('wolf')) return 'wolf';
    if (text.includes('supermutant') || text.includes('super_mutant')) return 'mutant';
    if (text.includes('ghoul')) return 'ghoul';
    return 'raider';
  }

  function configureEnemyStaticGlbAnimation(actorGroup, model, modelKey) {
    if (
      (
        modelKey !== 'enemyGhoul'
        && (
          typeof APPROVED_CREATURE_STATIC_MODEL_KEYS === 'undefined'
          || !APPROVED_CREATURE_STATIC_MODEL_KEYS.has(modelKey)
        )
      )
      || !actorGroup
      || !model
      || typeof staticModelAnimations !== 'function'
      || !THREE.AnimationMixer
    ) return null;
    const clips = staticModelAnimations(modelKey);
    if (!clips.length) return null;
    const previous = actorGroup.userData?.npcCreatureGlbAnimation;
    previous?.mixer?.stopAllAction?.();
    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    clips.forEach(clip => {
      const name = String(clip?.name || '').toLowerCase();
      if (!name || actions[name]) return;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(1);
      actions[name] = action;
    });
    const runtime = {
      mixer,
      actions,
      root: model,
      model,
      modelKey,
      currentAction: ''
    };
    actorGroup.userData.npcCreatureGlbAnimation = runtime;
    setEnemyStaticGlbAction(runtime, 'idle', 0);
    if (modelKey === 'enemySuperMutant') {
      runtime.appearance = typeof normalizeCharacterAppearance === 'function'
        ? normalizeCharacterAppearance({ sex: 'male', bodyType: 'large' })
        : { sex: 'male', bodyType: 'large' };
      runtime.approvedAssaultRifleRestPose = typeof captureApprovedAssaultRifleRestPose === 'function'
        ? captureApprovedAssaultRifleRestPose(model)
        : null;
      actorGroup.userData.characterAppearance = runtime.appearance;
      actorGroup.userData.approvedEquipmentCharacterRuntime = runtime;
      actorGroup.userData.approvedEquipmentRefreshPending = true;
      const enemy = actorGroup.userData.enemy;
      if (enemy && typeof updateEnemyEquipmentVisuals === 'function') {
        actorGroup.userData.enemyEquipmentKey = '';
        updateEnemyEquipmentVisuals(enemy);
        actorGroup.userData.approvedEquipmentRefreshPending = false;
      }
    }
    return runtime;
  }

  function setEnemyStaticGlbAction(runtime, requested = 'idle', fadeSeconds = 0.12, options = {}) {
    if (!runtime?.actions) return false;
    const name = runtime.actions[requested]
      ? requested
      : (runtime.actions.idle ? 'idle' : Object.keys(runtime.actions)[0]);
    if (!name) return false;
    const restart = options.restart === true;
    if (runtime.currentAction === name && !restart) return true;
    const previous = runtime.actions[runtime.currentAction];
    const next = runtime.actions[name];
    if (previous && previous !== next) previous.fadeOut(Math.max(0, fadeSeconds));
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (name === 'death') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else if (name === 'hurt' || name === 'attack') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.fadeIn(Math.max(0, fadeSeconds)).play();
    runtime.currentAction = name;
    return true;
  }

  function updateEnemyStaticGlbAnimation(enemy, dt = 0.016, state = {}) {
    const runtime = enemy?.mesh?.userData?.npcCreatureGlbAnimation;
    if (!runtime?.mixer) return false;
    let action = 'idle';
    if (state.dead || enemy.dead) action = 'death';
    else if (Number(enemy.flash || 0) > 0.001) action = 'hurt';
    else if (
      state.attackActive !== undefined
        ? state.attackActive
        : (enemy.aiState === 'attack' || enemy.mesh?.userData?.meleeAnim)
    ) action = 'attack';
    else if (
      state.moving
      && runtime.actions.run
      && Number(state.visualSpeed || 0) >= 1.35
    ) action = 'run';
    else if (state.moving) action = 'walk';
    const restartAttack = typeof characterOneShotRestart === 'function'
      && characterOneShotRestart(runtime, action, state.attackToken);
    setEnemyStaticGlbAction(runtime, action, action === 'death' ? 0.08 : 0.12, {
      restart: restartAttack
    });
    const active = runtime.actions?.[runtime.currentAction];
    if (active) {
      const visualSpeed = Number(state.visualSpeed || 0.8);
      const movingRate = runtime.currentAction === 'run'
        ? Math.max(0.82, Math.min(1.45, visualSpeed * 0.42))
        : Math.max(0.72, Math.min(1.6, visualSpeed * 0.72));
      active.setEffectiveTimeScale(
        state.moving && (runtime.currentAction === 'walk' || runtime.currentAction === 'run')
          ? movingRate
          : 1
      );
    }
    runtime.mixer.update(Math.max(0, Math.min(0.08, Number(dt || 0.016))));
    return true;
  }

  function tryBuildStaticEnemyModel(group, type, visual) {
    const rawKey = String(type.modelKey || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!rawKey || typeof makeStaticModelGroup !== 'function') return false;
    if (typeof STATIC_MODEL_URLS === 'undefined' || !STATIC_MODEL_URLS[rawKey]) return false;
    const s = Number(type.scale || 1) || 1;
    const kind = enemyActorKindForStaticVisual(visual, rawKey);
    const shadowRadius = kind === 'brahmin' ? 1.08 : (kind === 'scorpion' ? 0.9 : (kind === 'mutantAnt' ? 0.74 : 0.64));
    addEnemyBaseShadow(group, s, shadowRadius);
    const model = makeStaticModelGroup(rawKey, 0, 0, 0, `enemy-${rawKey}`, {
      scale: s,
      cloneMaterials: true,
      castShadow: !IS_MOBILE_DEVICE,
      receiveShadow: false,
      afterApply: (_holder, instance, appliedKey) => {
        configureEnemyStaticGlbAnimation(group, instance, appliedKey || rawKey);
      }
    });
    model.position.set(0, 0, 0);
    group.add(model);
    group.userData.actorParts = { kind, staticModel: model };
    return true;
  }

  function unifiedHumanoidNpcHash(value = '') {
    let hash = 2166136261;
    const text = String(value || 'npc');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function unifiedHumanoidNpcAppearance(type = {}) {
    if (type.appearance && typeof type.appearance === 'object') {
      return normalizeCharacterAppearance(type.appearance);
    }
    const seed = [
      type.id,
      type.name,
      type.role,
      type.faction,
      type.visual,
      type.modelKey
    ].map(value => String(value || '')).join('|');
    const hash = unifiedHumanoidNpcHash(seed);
    const sex = (hash & 1) === 0 ? 'female' : 'male';
    const bodyType = CHARACTER_BODY_TYPES[(hash >>> 1) % CHARACTER_BODY_TYPES.length];
    const faces = CHARACTER_FACE_OPTIONS[sex] || CHARACTER_FACE_OPTIONS.male;
    return normalizeCharacterAppearance({
      sex,
      bodyType,
      faceId: faces[(hash >>> 4) % faces.length]?.id,
      hairId: CHARACTER_HAIR_OPTIONS[(hash >>> 7) % CHARACTER_HAIR_OPTIONS.length]?.id,
      hairColorId: CHARACTER_HAIR_COLOR_OPTIONS[(hash >>> 11) % CHARACTER_HAIR_COLOR_OPTIONS.length]?.id
    });
  }

  function isUnifiedHumanoidNpcType(type = {}, visual = '') {
    if (typeof isNaturalCreatureEnemy === 'function' && isNaturalCreatureEnemy(type)) return false;
    const compact = [visual, type.visual, type.modelKey, type.species, type.role, type.name]
      .map(value => String(value || '').toLowerCase())
      .join('|')
      .replace(/[^a-z0-9а-яё]+/gi, '');
    if (
      compact.includes('ghoul')
      || compact.includes('гул')
      || compact.includes('supermutant')
      || compact.includes('супермутант')
      || compact.includes('mutantant')
      || compact.includes('мурав')
      || compact.includes('gecko')
      || compact.includes('геккон')
      || compact.includes('wolf')
      || compact.includes('волк')
      || compact.includes('radscorpion')
      || compact.includes('скорпион')
      || compact.includes('brahmin')
      || compact.includes('брамин')
    ) return false;
    return visual !== 'mutant' && visual !== 'ghoul';
  }

  function buildUnifiedHumanoidNpc(group, type = {}, visual = 'raider') {
    const parts = {};
    const modelScale = Math.max(0.75, Math.min(1.35, Number(type.scale || 1) || 1));
    buildModernWastelandHumanoid(group, parts, { castShadow: !IS_MOBILE_DEVICE, isPlayer: false });
    if (parts.motionRoot) parts.motionRoot.scale.setScalar(modelScale);
    if (typeof captureCharacterProceduralBaseMeshes === 'function') {
      captureCharacterProceduralBaseMeshes(group, parts);
    }
    parts.kind = 'humanoidNpc';
    parts.unifiedHumanoidNpc = true;
    group.userData.parts = parts;
    group.userData.actorParts = parts;
    group.userData.characterAppearance = unifiedHumanoidNpcAppearance(type);
    group.userData.weaponId = equipmentVisualBaseId(type?.equipment?.weapon || type.weapon || 'fists');
    stabilizeCharacterNoCull(group);
    if (typeof applyCharacterGlbAppearance === 'function') {
      void applyCharacterGlbAppearance(group, group.userData.characterAppearance, {
        castShadow: !IS_MOBILE_DEVICE,
        equipment: type.equipment || {},
        modelScale,
        npcAnimations: true
      });
    }
    return parts;
  }

  function createEnemyModel(type) {
    const group = new THREE.Group();
    const name = String(type.name || '').toLowerCase();
    const visual = type.visual || (name.includes('скорпион') ? 'radscorpion' : name.includes('мурав') ? 'mutantAnt' : name.includes('огненный геккон') ? 'fireGecko' : name.includes('геккон') ? 'gecko' : name.includes('волк') ? 'wolf' : name.includes('супер') ? 'mutant' : name.includes('гул') ? 'ghoul' : 'raider');
    if (isUnifiedHumanoidNpcType(type, visual)) {
      buildUnifiedHumanoidNpc(group, type, visual);
    } else if (!tryBuildStaticEnemyModel(group, type, visual)) {
      if (visual === 'brahmin') buildBrahminEnemy(group, type);
      else if (visual === 'radscorpion') buildRadscorpionEnemy(group, type);
      else if (visual === 'mutantAnt') buildMutantAntEnemy(group, type);
      else if (visual === 'gecko' || visual === 'fireGecko') buildGeckoEnemy(group, type, visual === 'fireGecko');
      else if (visual === 'wolf') buildWolfEnemy(group, type);
      else if (visual === 'mutant') buildMutantEnemy(group, type);
      else if (visual === 'ghoul') buildGhoulEnemy(group, type);
      else buildRaiderEnemy(group, type);
    }
    const ringRadius = visual === 'brahmin' ? 1.12 : (visual === 'radscorpion' ? 0.92 : (visual === 'mutantAnt' ? 0.76 : (visual === 'gecko' || visual === 'fireGecko' || visual === 'wolf' ? 0.78 : 0.82)));
    addEnemyTargetRing(group, type.scale || 1, ringRadius);
    if (typeof attachActorInteractionProxy === 'function') {
      const interactionHeight = visual === 'brahmin' ? 2.0 : (visual === 'radscorpion' || visual === 'mutantAnt' ? 1.15 : (visual === 'gecko' || visual === 'fireGecko' || visual === 'wolf' ? 1.25 : 2.15));
      attachActorInteractionProxy(group, {
        radius: Math.max(0.48, ringRadius * Number(type.scale || 1)),
        height: interactionHeight * Number(type.scale || 1)
      });
    }
    addEnemyVariantAccent(group, type, visual);
    group.userData.enemyVisual = visual;
    group.traverse(m => {
      if (m.isMesh) {
        m.userData.enemyMesh = true;
        // v7.74.3: enemy hit/rocket flash must never tint shared materials.
        // Every enemy mesh receives its own material instance and remembers its base colors.
        if (m.material) {
          const list = Array.isArray(m.material) ? m.material : [m.material];
          const cloned = list.map(mat => {
            if (!mat) return mat;
            const copy = mat.clone ? mat.clone() : mat;
            if (copy.userData) copy.userData.sharedWorldMaterial = false;
            return copy;
          });
          m.material = Array.isArray(m.material) ? cloned : cloned[0];
          const after = Array.isArray(m.material) ? m.material : [m.material];
          m.userData.baseMaterialColors = after.map(mat => mat && mat.color ? mat.color.getHex() : null);
          m.userData.baseMaterialEmissives = after.map(mat => mat && mat.emissive ? mat.emissive.getHex() : null);
          if (after[0] && after[0].emissive) m.userData.baseEmissive = after[0].emissive.getHex();
        }
      }
    });
    return group;
  }

  function enemyAnimCaptureBase(object) {
    if (!object || !object.position || !object.rotation) return null;
    object.userData = object.userData || {};
    if (!object.userData.enemyAnimBase) {
      object.userData.enemyAnimBase = {
        px: Number(object.position.x || 0),
        py: Number(object.position.y || 0),
        pz: Number(object.position.z || 0),
        rx: Number(object.rotation.x || 0),
        ry: Number(object.rotation.y || 0),
        rz: Number(object.rotation.z || 0),
        visible: object.visible !== false
      };
    }
    return object.userData.enemyAnimBase;
  }

  function enemyAnimLerp(current, target, amount) {
    return current + (target - current) * Math.max(0, Math.min(1, amount));
  }

  function enemyAnimRestorePart(object, amount = 1) {
    const base = enemyAnimCaptureBase(object);
    if (!object || !base) return;
    const k = Math.max(0, Math.min(1, amount));
    object.position.x = enemyAnimLerp(Number(object.position.x || 0), base.px, k);
    object.position.y = enemyAnimLerp(Number(object.position.y || 0), base.py, k);
    object.position.z = enemyAnimLerp(Number(object.position.z || 0), base.pz, k);
    object.rotation.x = enemyAnimLerp(Number(object.rotation.x || 0), base.rx, k);
    object.rotation.y = enemyAnimLerp(Number(object.rotation.y || 0), base.ry, k);
    object.rotation.z = enemyAnimLerp(Number(object.rotation.z || 0), base.rz, k);
  }

  function enemyAnimRestoreActorParts(parts = {}, amount = 1) {
    [
      parts.legs,
      parts.body,
      parts.chest,
      parts.head,
      parts.helmet,
      parts.armL,
      parts.armR,
      parts.tail,
      parts.claws,
      parts.antennae,
      parts.abdomen
    ].forEach(part => enemyAnimRestorePart(part, amount));
  }

  function enemyAnimHumanoid(parts = {}) {
    const kind = String(parts.kind || 'raider');
    return !['wolf', 'scorpion', 'mutantAnt', 'gecko', 'brahmin'].includes(kind) && !parts.staticModel;
  }

  function enemyAnimWeaponVisible(mesh, visible = true) {
    const weaponGroup = mesh?.userData?.enemyWeaponGroup;
    if (!weaponGroup) return;
    const nextVisible = !!visible && weaponGroup.children.length > 0;
    if (weaponGroup.visible === nextVisible) return;
    weaponGroup.visible = nextVisible;
    // Visibility participates in the cached decision that skips the fallback
    // procedural rig. Sleep/wake must invalidate it so a weapon still attached
    // to that rig resumes animating immediately after the NPC wakes up.
    if (typeof invalidateModernProceduralRigAnimationCache === 'function') {
      invalidateModernProceduralRigAnimationCache(
        mesh,
        mesh?.userData?.parts || mesh?.userData?.actorParts || null
      );
    }
  }

  function enemyAnimApplySleepPose(enemy, mesh, parts, dt, t) {
    if (!mesh || !enemyAnimHumanoid(parts)) return false;
    const k = Math.min(1, Math.max(0, Number(dt || 0.016)) * 8);
    mesh.rotation.z = enemyAnimLerp(Number(mesh.rotation.z || 0), Math.PI / 2, k);
    mesh.position.y = enemyAnimLerp(Number(mesh.position.y || 0), 0.08, k);
    enemyAnimWeaponVisible(mesh, false);
    const breath = Math.sin(t * 0.62) * 0.018;
    if (parts.body) {
      parts.body.rotation.x += 0.08;
      parts.body.position.y += breath;
    }
    if (parts.chest) parts.chest.position.y += breath * 0.7;
    if (parts.head) {
      parts.head.rotation.z += -0.16;
      parts.head.rotation.x += 0.06 + Math.sin(t * 0.45) * 0.012;
    }
    if (parts.legs) parts.legs.rotation.z += 0.12;
    if (parts.armL) {
      parts.armL.rotation.z += -0.88;
      parts.armL.rotation.x += 0.08;
    }
    if (parts.armR) {
      parts.armR.rotation.z += 0.88;
      parts.armR.rotation.x += -0.05;
    }
    enemy.enemyVisualSpeed = 0;
    return true;
  }

  function enemyAnimApplyDialoguePose(enemy, mesh, parts, dt, t) {
    if (!mesh || !enemyAnimHumanoid(parts)) return false;
    const talking = !!String(enemy?.speechText || '').trim() && Number(enemy?.speechUntil || 0) > performance.now();
    const gesture = talking ? 1 : 0.45;
    if (parts.body) {
      parts.body.rotation.z += Math.sin(t * 0.72) * 0.035;
      parts.body.rotation.x += -0.035;
    }
    if (parts.head) {
      parts.head.rotation.z += Math.sin(t * 1.15) * 0.055 * gesture;
      parts.head.rotation.x += -0.035 + Math.sin(t * 1.55) * 0.032 * gesture;
    }
    if (parts.armL) {
      parts.armL.rotation.z += -0.36 - Math.sin(t * 1.9) * 0.18 * gesture;
      parts.armL.rotation.x += Math.sin(t * 1.35) * 0.055 * gesture;
    }
    if (parts.armR) {
      parts.armR.rotation.z += 0.48 + Math.sin(t * 2.05 + 0.7) * 0.22 * gesture;
      parts.armR.rotation.x += -0.08 + Math.sin(t * 1.5) * 0.05 * gesture;
    }
    if (parts.legs) parts.legs.rotation.z += Math.sin(t * 0.45) * 0.025;
    return true;
  }

  function animateEnemyVisual(enemy, dt = 0.016, frameContext = null) {
    const mesh = enemy?.mesh;
    const parts = mesh?.userData?.actorParts;
    if (!mesh || !parts) return;
    if (
      mesh.userData.approvedEquipmentRefreshPending
      && mesh.userData.approvedEquipmentCharacterRuntime?.root
      && typeof updateEnemyEquipmentVisuals === 'function'
    ) {
      // The skinned GLB may finish before the network row is attached to the
      // actor group. Refresh on the first animation frame where both exist so
      // the old box overlay cannot survive a fast cache hit.
      mesh.userData.enemyEquipmentKey = '';
      updateEnemyEquipmentVisuals(enemy);
      mesh.userData.approvedEquipmentRefreshPending = false;
    }
    const distanceToPlayer = player ? Math.hypot(player.x - (enemy.x || 0), player.z - (enemy.z || 0)) : 0;
    const visible = mesh.visible !== false;
    const heavyActor = !!(
      parts.unifiedHumanoidNpc
      || mesh.userData.characterGlbRuntime
      || mesh.userData.npcCreatureGlbAnimation
      || mesh.userData.approvedEquipmentCharacterRuntime
    );
    if (enemy.dead) {
      const animationDt = heavyActor
        ? consumeEnemyAnimationLodDt(
            enemy,
            dt,
            enemyAnimationLodInterval(distanceToPlayer, visible, false),
            `${visible ? 1 : 0}|dead`
          )
        : dt;
      if (animationDt <= 0) return;
      if (mesh.userData.characterGlbRuntime) {
        updateCharacterGlbAnimation(mesh, animationDt, { dead: true, moving: false, footIk: false });
      } else {
        updateEnemyStaticGlbAnimation(enemy, animationDt, { dead: true });
      }
      return;
    }
    const restoreK = Math.min(1, Math.max(0, Number(dt || 0.016)) * 10);
    const nowMs = performance.now();
    const scheduleState = String(enemy.scheduleState || enemy.aiState || '').toLowerCase();
    const sleeping = scheduleState === 'sleep';
    const inDialogue = scheduleState === 'dialogue'
      || String(enemy.aiState || '').toLowerCase() === 'dialogue'
      || (!!String(enemy.speechText || '').trim() && Number(enemy.speechUntil || 0) > nowMs);
    if (!sleeping) {
      mesh.rotation.z = enemyAnimLerp(Number(mesh.rotation.z || 0), 0, restoreK);
      mesh.position.y = enemyAnimLerp(Number(mesh.position.y || 0), 0, restoreK);
      enemyAnimWeaponVisible(mesh, true);
    }
    const visualX = Number(mesh.position?.x ?? enemy.visualX ?? enemy.x ?? 0);
    const visualZ = Number(mesh.position?.z ?? enemy.visualZ ?? enemy.z ?? 0);
    const moved = Math.hypot(visualX - Number(enemy.prevAnimX ?? visualX), visualZ - Number(enemy.prevAnimZ ?? visualZ)); 
    enemy.prevAnimX = visualX;
    enemy.prevAnimZ = visualZ;
    const moving = moved > 0.002 || Number(enemy.enemyVisualSpeed || 0) > 0.035 || Number(enemy.speed || 0) > 0.035 && !!enemy.moving;
    const important = moving
      || sleeping
      || inDialogue
      || enemy.aiState === 'attack'
      || enemy.aiState === 'chase'
      || enemy.targetId
      || enemy.factionTargetId
      || mesh.userData?.meleeAnim;
    const visualSpeed = Math.max(
      Number(enemy.enemyVisualSpeed || 0),
      moved / Math.max(0.001, Number(dt || 0.016))
    );
    const attackAnimation = typeof actorAttackAnimationPulseState === 'function'
      ? actorAttackAnimationPulseState(mesh, String(enemy.aiState || '').toLowerCase() === 'attack')
      : {
          active: String(enemy.aiState || '').toLowerCase() === 'attack',
          token: 0
        };
    const attackWindowActive = Number(attackAnimation.token || 0) > 0
      && Number(mesh.userData?.attackAnimationUntil || 0) > nowMs;
    const meleeAnim = mesh.userData?.meleeAnim;
    const meleeWindowActive = Number(meleeAnim?.startedAt || 0) > 0
      && nowMs < Number(meleeAnim.startedAt || 0) + Math.max(0.18, Number(meleeAnim.duration || 0.32)) * 1000;
    const hitReaction = mesh.userData?.hitReactionAnim;
    const hitReactionActive = Number(hitReaction?.startedAt || 0) > 0
      && nowMs < Number(hitReaction.startedAt || 0) + Math.max(0.22, Number(hitReaction.duration || 0.34)) * 1000;
    const heavyImportant = attackAnimation.active
      || attackWindowActive
      || meleeWindowActive
      || hitReactionActive
      || inDialogue
      || Number(enemy.flash || 0) > 0.02
      || (!!player && player.attackTarget === enemy)
      || (typeof hoveredEnemy !== 'undefined' && hoveredEnemy === enemy);
    const activeAiState = ['attack', 'chase', 'flee'].includes(String(enemy.aiState || '').toLowerCase());
    const crowdIdle = !moving
      && !sleeping
      && !inDialogue
      && !activeAiState
      && !attackAnimation.active
      && !meleeWindowActive
      && !hitReactionActive;
    let animationDt = dt;
    if (heavyActor) {
      const stateKey = [
        visible ? 1 : 0,
        moving ? 1 : 0,
        sleeping ? 1 : 0,
        inDialogue ? 1 : 0,
        String(enemy.aiState || ''),
        attackAnimation.active ? 1 : 0,
        Number(attackAnimation.token || 0),
        Number(mesh.userData?.meleeAnim?.startedAt || 0),
        Number(hitReaction?.startedAt || 0),
        Number(enemy.flash || 0) > 0.02 ? 1 : 0
      ].join('|');
      const animationInterval = enemyAnimationCrowdAdjustedInterval(
        enemyAnimationLodInterval(distanceToPlayer, visible, heavyImportant),
        {
          crowdPressure: frameContext?.crowdPressure === true,
          heavy: true,
          idle: crowdIdle,
          important: heavyImportant
        }
      );
      animationDt = consumeEnemyAnimationLodDt(
        enemy,
        dt,
        animationInterval,
        stateKey
      );
      if (animationDt <= 0) return;
    }
    // Keep the last skeletal/procedural pose intact between LOD ticks. Restoring
    // actor parts on skipped frames would pull them toward the base pose before
    // the next mixer/IK update and make distant actors visibly pulse.
    const animationRestoreK = Math.min(1, Math.max(0, Number(animationDt || 0.016)) * 10);
    enemyAnimRestoreActorParts(parts, animationRestoreK);
    if (parts.unifiedHumanoidNpc) {
      const facingAngle = Number.isFinite(Number(enemy.angle))
        ? Number(enemy.angle)
        : Number(mesh.rotation.y || 0) - Math.PI;
      updateCharacterLocomotionAnimation(mesh, animationDt, {
        moving,
        speed: visualSpeed,
        moveX: visualX - Number(enemy.prevUnifiedAnimX ?? visualX),
        moveZ: visualZ - Number(enemy.prevUnifiedAnimZ ?? visualZ),
        facingAngle,
        attacking: attackAnimation.active,
        attackToken: attackAnimation.token,
        hurt: Number(enemy.flash || 0) > 0.02,
        talking: inDialogue,
        footIk: heavyImportant || distanceToPlayer <= 6
      });
      enemy.prevUnifiedAnimX = visualX;
      enemy.prevUnifiedAnimZ = visualZ;
      const npcWeaponGroup = mesh.userData.enemyWeaponGroup;
      if (npcWeaponGroup?.userData?.weaponMeshLegacy && typeof makeWeaponModelMesh === 'function') {
        const upgraded = makeWeaponModelMesh(mesh.userData.weaponId || enemy.weapon || '');
        if (upgraded) {
          disposeGroupChildren(npcWeaponGroup);
          initWeaponVisualState(npcWeaponGroup);
          npcWeaponGroup.add(upgraded);
          npcWeaponGroup.userData.weaponMeshLegacy = false;
        }
      }
      if (npcWeaponGroup) {
        updateWeaponVisualAnimation(npcWeaponGroup, animationDt, enemy);
      }
      if (typeof updateCharacterMeleeAnimation === 'function') {
        updateCharacterMeleeAnimation(mesh, animationDt);
      }
      const accent = mesh.userData.variantAccent;
      if (accent?.material) {
        const baseOpacity = Number(accent.userData.baseOpacity || 0.4);
        accent.material.opacity = baseOpacity + Math.sin(performance.now() * 0.0042) * 0.045;
      }
      return;
    }
    updateEnemyStaticGlbAnimation(enemy, animationDt, {
      moving,
      visualSpeed,
      sleeping,
      inDialogue,
      attackActive: attackAnimation.active,
      attackToken: attackAnimation.token
    });
    if (
      mesh.userData.approvedEquipmentCharacterRuntime
      && typeof applyApprovedWeaponGrip === 'function'
    ) {
      applyApprovedWeaponGrip(mesh, enemy.equipment?.weapon || enemy.weapon || 'fists');
    }
    if (!important) {
      enemy.idleVisualAnimTimer = Math.max(0, Number(enemy.idleVisualAnimTimer || 0) - Math.max(0, Number(animationDt || 0.016)));
      if (enemy.idleVisualAnimTimer > 0) return;
      enemy.idleVisualAnimTimer = distanceToPlayer > 18 ? 0.36 : (distanceToPlayer > 7 ? 0.18 : 0.10);
    } else {
      enemy.idleVisualAnimTimer = 0;
    }
    if (mesh.userData.enemyWeaponGroup) updateWeaponVisualAnimation(mesh.userData.enemyWeaponGroup, animationDt, enemy);
    const far = distanceToPlayer > 18;
    if (far && (graphicsSettings?.id === 'low' || graphicsSettings?.id === 'medium')) return;
    const t = performance.now() * 0.006;
    if (sleeping && enemyAnimApplySleepPose(enemy, mesh, parts, animationDt, t)) {
      if (typeof updateCharacterMeleeAnimation === 'function') updateCharacterMeleeAnimation(mesh, animationDt);
      return;
    }
    const accent = mesh.userData.variantAccent;
    if (accent && accent.material) {
      const baseOpacity = Number(accent.userData.baseOpacity || 0.4);
      accent.material.opacity = baseOpacity + Math.sin(t * 0.7) * 0.045;
    }
    const amp = moving ? Math.min(0.28, Math.max(moved * 11, visualSpeed * 0.09)) : 0.035;
    if (parts.kind === 'wolf') {
      if (parts.body) parts.body.rotation.z = Math.sin(t) * amp * 0.18;
      if (parts.chest) parts.chest.position.y = ((0.57 * (enemy.scale || 1)) + Math.sin(t * 1.2) * amp * 0.06);
      if (parts.tail) parts.tail.rotation.z = Math.sin(t * 1.4) * 0.18;
      if (parts.head) parts.head.rotation.x = -0.08 + Math.sin(t * 1.1) * 0.04;
    } else if (parts.kind === 'scorpion' || parts.kind === 'mutantAnt' || parts.kind === 'gecko') {
      const bodyBaseY = Number.isFinite(parts.body?.userData?.baseY) ? parts.body.userData.baseY : parts.body?.position?.y;
      if (parts.body && Number.isFinite(bodyBaseY)) {
        parts.body.userData.baseY = bodyBaseY;
        parts.body.position.y = bodyBaseY + Math.sin(t * 1.3) * (moving ? 0.025 : 0.008);
      }
      if (parts.legs) parts.legs.rotation.y = moving ? Math.sin(t * 1.9) * amp * 0.45 : Math.sin(t * 0.45) * 0.025;
      if (parts.tail) {
        parts.tail.rotation.y = Math.sin(t * 1.1) * (parts.kind === 'scorpion' ? 0.1 : 0.16);
        parts.tail.rotation.z = Math.sin(t * 0.9) * 0.045;
      }
      if (parts.claws) parts.claws.rotation.y = Math.sin(t * 1.35) * 0.06;
      if (parts.head) parts.head.rotation.x = Math.sin(t * 0.95) * 0.025;
    } else {
      if (parts.legs) parts.legs.rotation.z = moving ? Math.sin(t * 1.4) * amp : 0;
      if (parts.armL) parts.armL.rotation.z = -0.22 - Math.sin(t * 1.2) * amp;
      if (parts.armR) parts.armR.rotation.z = 0.22 + Math.sin(t * 1.2) * amp;
      if (parts.body) {
        if (!Number.isFinite(parts.body.userData.baseY)) parts.body.userData.baseY = parts.body.position.y;
        parts.body.position.y = parts.body.userData.baseY + Math.sin(t * 1.1) * (moving ? 0.035 : 0.012);
      }
      if (parts.head) parts.head.rotation.z = Math.sin(t * 0.75) * 0.035;
    }
    if (inDialogue) enemyAnimApplyDialoguePose(enemy, mesh, parts, animationDt, t);
    if (typeof updateCharacterMeleeAnimation === 'function') updateCharacterMeleeAnimation(mesh, animationDt);
  }

  function rollEnemyLoot() {
    return [];
  }

  function spawnEnemy() {
    if (typeof clientEnemyStateMayUseLocalFallback === 'function'
      ? !clientEnemyStateMayUseLocalFallback()
      : enemiesAreServerAuthoritative()) return null;
    if (!currentLocation || currentLocation.safe) return;
    if (currentLocation.noRespawn) return;
    if (enemies.filter(e => !e.dead).length >= (Number.isFinite(Number(currentLocation.enemyCap)) ? Number(currentLocation.enemyCap) : 12)) return;
    const typeIndex = Math.floor(rand() * ENEMY_TYPES.length);
    const type = ENEMY_TYPES[typeIndex];
    const visual = String(type.visual || '').toLowerCase();
    const startingCaps = visual === 'raider' ? 5 + Math.floor(rand() * 3)
      : visual === 'mutant' ? 14 + Math.floor(rand() * 3)
        : 0;
    let tx = 0, tz = 0;
    for (let tries = 0; tries < 120; tries++) {
      tx = 2 + Math.floor(rand() * (MAP_W - 4));
      tz = 2 + Math.floor(rand() * (MAP_H - 4));
      const pos = tileToWorld(tx, tz);
      if (isWalkableTile(tx, tz) && Math.hypot(pos.x - player.x, pos.z - player.z) > 12) break;
    }
    const pos = tileToWorld(tx, tz);
    const mesh = createEnemyModel(type);
    mesh.position.set(pos.x, 0, pos.z);
    scene.add(mesh);
    const enemy = {
      ...type,
      id: makeEntityId('enemy'),
      x: pos.x,
      z: pos.z,
      hp: type.hp,
      maxHp: type.hp,
      mesh,
      dead: false,
      attackTimer: 0,
      wanderTimer: 0,
      vx: 0,
      vz: 0,
      flash: 0,
      selected: false,
      inventory: startingCaps > 0 ? [{ id: 'silver', qty: startingCaps }] : [],
      loot: rollEnemyLoot(type),
      typeIndex,
      path: [],
      pathTimer: 0
    };
    mesh.userData.enemy = enemy;
    mesh.traverse(child => { if (child.isMesh) child.userData.enemy = enemy; });
    enemies.push(enemy);
    enemyMeshes.push(mesh);
    applyNetworkFogVisibilityNow(mesh, enemy.x, enemy.z);
  }


  function clearEnemies() {
    player.attackTarget = null;
    hoveredEnemy = null;
    hideTargetHint();
    enemies.forEach(e => {
      forgetNetworkRevealObject(e.mesh);
      if (e.mesh) scene.remove(e.mesh);
    });
    enemies.length = 0;
    enemyMeshes.length = 0;
  }

  function saveCurrentLocationState() {
    if (!currentLocation || !map.length) return;
    const state = locationStates[currentLocation.id] || {};
    const canPersistLocalEnemies = typeof clientEnemyStateMayUseLocalFallback === 'function'
      ? clientEnemyStateMayUseLocalFallback()
      : !enemiesAreServerAuthoritative();
    state.environmentVersion = typeof WORLD_ENVIRONMENT_VERSION !== 'undefined' ? WORLD_ENVIRONMENT_VERSION : '';
    state.map = map.map(row => row.slice());
    state.resources = resourceNodes.map(r => ({ id: ensureResourceId(r), tx: r.tx, tz: r.tz, type: r.type, hp: r.hp, maxHp: r.maxHp || 3 }));
    state.enemies = canPersistLocalEnemies ? enemies
      .filter(e => e && !e._removed)
      .map(e => {
        const naturalCreature = isNaturalCreatureEnemy(e);
        const traderStock = naturalCreature
          ? []
          : (typeof normalizeTraderStockRows === 'function'
            ? normalizeTraderStockRows(e.traderStock || [])
            : (Array.isArray(e.traderStock) ? e.traderStock.map(row => ({
              id: String(row.id || ''),
              price: Math.max(1, Math.round(Number(row.price || 1))),
              qty: Math.max(1, Math.round(Number(row.qty || 1)))
            })).filter(row => row.id) : []));
        const traderInventory = naturalCreature
          ? []
          : (typeof normalizeNpcInventoryRows === 'function'
            ? normalizeNpcInventoryRows(e.inventory || [])
            : (Array.isArray(e.inventory) ? e.inventory.map(row => ({
              id: String(row.id || ''),
              qty: Math.max(1, Math.floor(Number(row.qty || 1)))
            })).filter(row => row.id) : []));
        const traderMarket = naturalCreature || !e.traderMarket || typeof e.traderMarket !== 'object'
          ? null
          : {
            siteId: String(e.traderMarket.siteId || ''),
            state: String(e.traderMarket.state || ''),
            stateLabel: String(e.traderMarket.stateLabel || ''),
            scarcity: Math.max(0, Math.min(100, Math.round(Number(e.traderMarket.scarcity || 0)))),
            abundance: Math.max(0, Math.min(100, Math.round(Number(e.traderMarket.abundance || 0)))),
            priceMultiplier: Number(e.traderMarket.priceMultiplier || 1),
            quantityMultiplier: Number(e.traderMarket.quantityMultiplier || 1)
          };
        return ({
        id: ensureEnemyId(e),
        typeIndex: Number.isInteger(e.typeIndex) ? e.typeIndex : Math.max(0, ENEMY_TYPES.findIndex(t => t.name === e.name)),
        x: e.x,
        z: e.z,
        hp: e.hp,
        maxHp: e.maxHp,
        name: e.name || '',
        baseSpeed: Number(e.speed || 0),
        scale: Number(e.scale || 1),
        xp: Number(e.xp || 0),
        atk: Number(e.atk || 0),
        variantId: e.variantId || 'normal',
        variantName: e.variantName || '',
        visual: e.visual || e.mesh?.userData?.enemyVisual || '',
        modelKey: e.modelKey || '',
        species: e.species || '',
        role: e.role || e.encounterRole || '',
        encounterRole: e.encounterRole || '',
        profile: e.profile || '',
        statProfile: e.statProfile || '',
        equipmentProfile: e.equipmentProfile || '',
        lootProfile: e.lootProfile || '',
        tradeProfile: e.tradeProfile || '',
        personality: e.personality || null,
        special: e.special || null,
        scheduleState: e.scheduleState || '',
        scheduleLabel: e.scheduleLabel || '',
        equipment: naturalCreature ? { weapon: 'fists', armor: '', helmet: '', boots: '', backpack: '' } : (e.equipment || {}),
        weapon: naturalCreature ? 'fists' : (e.weapon || e.equipment?.weapon || ''),
        canDialogue: naturalCreature ? false : e.canDialogue !== false,
        traderId: naturalCreature ? '' : (e.traderId || ''),
        traderProfile: naturalCreature ? '' : (e.traderProfile || ''),
        dialogueProfile: naturalCreature ? '' : (e.dialogueProfile || ''),
        traderQuests: naturalCreature ? [] : (Array.isArray(e.traderQuests) ? e.traderQuests.map(id => String(id || '')).filter(Boolean) : []),
        traderStock,
        traderBuyInterests: naturalCreature ? [] : (Array.isArray(e.traderBuyInterests) ? e.traderBuyInterests.map(id => String(id || '')).filter(Boolean) : []),
        traderMarket,
        inventory: traderInventory,
        dead: !!e.dead,
        attackTimer: e.attackTimer || 0,
        loot: (e.loot || []).map(x => ({ id: x.id, qty: x.qty })),
        looted: !!e._looted
      });
      }) : [];
    locationStates[currentLocation.id] = state;
  }

  function restoreEnemiesFromState() {
    if (typeof clientEnemyStateMayUseLocalFallback === 'function' && !clientEnemyStateMayUseLocalFallback()) return false;
    const state = locationStates[currentLocation.id];
    if (!state || !Array.isArray(state.enemies)) return false;
    state.enemies.forEach(saved => {
      const type = enemyTypeFromNetworkSnapshot(saved);
      const naturalCreature = naturalCreatureSnapshotFor(saved, type);
      const equipment = enemyEquipmentFromData(saved);
      const mesh = createEnemyModel(type);
      mesh.position.set(saved.x, 0, saved.z);
      scene.add(mesh);
      const enemy = {
        ...type,
        id: saved.id || makeEntityId('enemy'),
        typeIndex: saved.typeIndex,
        x: saved.x,
        z: saved.z,
        hp: Number(saved.hp ?? type.hp),
        maxHp: Number(saved.maxHp ?? type.hp),
        mesh,
        visual: type.visual || saved.visual || '',
        modelKey: saved.modelKey || type.modelKey || '',
        species: saved.species || type.species || '',
        role: saved.role || saved.encounterRole || '',
        encounterRole: saved.encounterRole || '',
        profile: saved.profile || '',
        statProfile: saved.statProfile || '',
        equipmentProfile: saved.equipmentProfile || '',
        lootProfile: saved.lootProfile || '',
        tradeProfile: saved.tradeProfile || '',
        personality: naturalCreature ? null : (saved.personality || null),
        special: naturalCreature ? null : (saved.special || null),
        scheduleState: naturalCreature ? '' : (saved.scheduleState || ''),
        scheduleLabel: naturalCreature ? '' : (saved.scheduleLabel || ''),
        equipment,
        weapon: equipment.weapon,
        canDialogue: naturalCreature ? false : saved.canDialogue !== false,
        traderId: naturalCreature ? '' : (saved.traderId || ''),
        traderProfile: naturalCreature ? '' : (saved.traderProfile || ''),
        dialogueProfile: naturalCreature ? '' : (saved.dialogueProfile || ''),
        traderQuests: naturalCreature ? [] : (Array.isArray(saved.traderQuests) ? saved.traderQuests.map(id => String(id || '')).filter(Boolean) : []),
        traderStock: naturalCreature ? [] : (Array.isArray(saved.traderStock) ? saved.traderStock.map(row => ({
          id: String(row.id || ''),
          price: Math.max(1, Math.round(Number(row.price || 1))),
          qty: Math.max(1, Math.round(Number(row.qty || 1)))
        })).filter(row => row.id) : []),
        traderBuyInterests: naturalCreature ? [] : (Array.isArray(saved.traderBuyInterests) ? saved.traderBuyInterests.map(id => String(id || '')).filter(Boolean) : []),
        traderMarket: naturalCreature || !saved.traderMarket || typeof saved.traderMarket !== 'object' ? null : {
          siteId: String(saved.traderMarket.siteId || ''),
          state: String(saved.traderMarket.state || ''),
          stateLabel: String(saved.traderMarket.stateLabel || ''),
          scarcity: Math.max(0, Math.min(100, Math.round(Number(saved.traderMarket.scarcity || 0)))),
          abundance: Math.max(0, Math.min(100, Math.round(Number(saved.traderMarket.abundance || 0)))),
          priceMultiplier: Number(saved.traderMarket.priceMultiplier || 1),
          quantityMultiplier: Number(saved.traderMarket.quantityMultiplier || 1)
        },
        inventory: naturalCreature ? [] : (typeof normalizeNpcInventoryWithLegacyCaps === 'function'
          ? normalizeNpcInventoryWithLegacyCaps(saved.inventory || [], saved.traderCaps)
          : (Array.isArray(saved.inventory) ? saved.inventory.slice() : [])),
        dead: !!saved.dead,
        attackTimer: saved.attackTimer || 0,
        wanderTimer: 0,
        vx: 0,
        vz: 0,
        flash: 0,
        selected: false,
        variantId: type.variantId || 'normal',
        variantName: type.variantName || '',
        loot: (saved.loot || []).map(x => ({ id: x.id, qty: x.qty })),
        path: [],
        pathTimer: 0
      };
      mesh.userData.enemy = enemy;
      mesh.traverse(child => { if (child.isMesh) child.userData.enemy = enemy; });
      enemies.push(enemy);
      enemyMeshes.push(mesh);
      updateEnemyEquipmentVisuals(enemy);
      if (enemy.dead) makeCorpse(enemy);
      applyNetworkFogVisibilityNow(mesh, enemy.x, enemy.z);
    });
    return true;
  }

  function spawnInitialEnemies() {
    if (typeof clientEnemyStateMayUseLocalFallback === 'function' && !clientEnemyStateMayUseLocalFallback()) return;
    if (!currentLocation || currentLocation.safe) return;
    if (currentLocation.noRespawn) return;
    const count = Number.isFinite(Number(currentLocation.spawnCount)) ? Number(currentLocation.spawnCount) : 8;
    for (let i = 0; i < count; i++) spawnEnemy();
  }

  function setPlayerToSpawn(spawn) {
    const p = spawn || currentLocation.spawn;
    const pos = tileToWorld(p.tx, p.tz);
    player.x = pos.x;
    player.z = pos.z;
    player.y = 0;
    player.attackTarget = null;
    if (isMobileControlsEnabled && isMobileControlsEnabled()) {
      player.angle = Math.PI;
      pointerHasWorld = false;
      lastTouchAimX = null;
      lastTouchAimY = null;
      stopTouchAim();
    }
    playerGroup.position.set(player.x, player.y, player.z);
    playerGroup.rotation.y = player.angle + Math.PI;
  }

  function forceCloseGlobalMapOverlayForLocationLoad() {
    const mapWindow = document.getElementById('global-map-window');
    if (mapWindow) {
      mapWindow.classList.remove('visible');
      mapWindow.setAttribute('aria-hidden', 'true');
    }
    const encounterPanel = document.getElementById('global-encounter-panel');
    if (encounterPanel) {
      encounterPanel.classList.remove('visible');
      encounterPanel.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('global-map-mode');
    document.body.classList.remove('game-ui-panel-open');
    if (playerGroup) playerGroup.visible = true;
  }

  function loadLocationImmediate(id, entryKey = 'spawn', options = {}) {
    const next = LOCATIONS[id];
    if (!next) return false;
    const serverRequired = typeof clientWorldRequiresServer === 'function' && clientWorldRequiresServer();
    const networkJoined = !!(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined);
    const waitForNetworkRoom = options.waitForNetworkRoom !== false
      && (serverRequired || networkJoined);
    forceCloseGlobalMapOverlayForLocationLoad();
    saveCurrentLocationState();
    closeLootWindow();
    closeTraderWindow();
    closeStorageWindow();
    closeAllWindows();
    clearNetworkRoomEntities({ keepPlayer: true });
    clearEnemies();
    if (typeof multiplayer !== 'undefined' && multiplayer) multiplayer.pendingEntryKey = String(entryKey || 'spawn');
    currentLocation = next;
    if (typeof rememberCurrentSettlementLocation === 'function') rememberCurrentSettlementLocation(currentLocation.id);
    buildWorld();
    const spawn = next[entryKey] || next.spawn;
    setPlayerToSpawn(spawn);
    if (!waitForNetworkRoom) {
      const restored = restoreEnemiesFromState();
      if (!restored) spawnInitialEnemies();
    } else {
      clearNetworkRoomEntities({ keepPlayer: true });
    }
    const title = document.getElementById('map-title');
    if (title) title.textContent = currentLocation.name;
    addLog(`Переход: ${currentLocation.name}.`, null, 'system');
    setReadout(currentLocation.safe ? 'Вы в безопасном поселении.' : 'Вы вошли в опасную зону.');
    drawMinimap();
    queueSave(true);
    if (waitForNetworkRoom) {
      const timeoutMs = options.timeoutMs || 6500;
      if (networkJoined) return changeMultiplayerLocationReady({ timeoutMs });
      if (typeof connectMultiplayer === 'function') {
        setReadout('Синхронизирую локацию с сервером...');
        return Promise.resolve(connectMultiplayer({ waitForJoin: true, timeoutMs })).then(ok => {
          if (!ok || !(multiplayer.socket && multiplayer.socket.connected && multiplayer.joined)) {
            setReadout('Нет соединения с сервером: локация не загружена локально.');
            return false;
          }
          return changeMultiplayerLocationReady({ timeoutMs });
        });
      }
      setReadout('Нет соединения с сервером: локация не загружена локально.');
      return false;
    }
    changeMultiplayerLocation();
    return true;
  }

  function loadLocation(id, entryKey = 'spawn') {
    const next = LOCATIONS[id];
    if (!next || locationTransitionActive) return false;
    forceCloseGlobalMapOverlayForLocationLoad();
    return runLocationTransition(next, () => loadLocationImmediate(id, entryKey, { waitForNetworkRoom: true }), {
      subtitle: currentLocation && currentLocation.id !== next.id
        ? `Переход: ${currentLocation.name} → ${next.name}`
        : `Загрузка: ${next.name}`
    });
  }

  function useLocationExit() {
    if (!exitPortal) return false;
    const dist = Math.hypot(exitPortal.x - player.x, exitPortal.z - player.z);
    if (dist > 2.4) return false;
    const target = LOCATIONS[exitPortal.to];
    if (!target) return false;
    const entryKey = target.id === 'settlement' ? 'entryFromWasteland' : 'entryFromSettlement';
    return loadLocation(target.id, entryKey) !== false;
  }
  spawnInitialEnemies();
