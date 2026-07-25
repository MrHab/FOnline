  // ===== COMBAT / INTERACTION =====
  function damageTypeLabel(type) {
    return ({ ballistic: 'баллистический', explosive: 'взрывной', energy: 'энергетический', fire: 'огненный', radiation: 'радиационный', toxic: 'токсичный' })[type] || 'баллистический';
  }

  function armorProtectionText(item) {
    if (!item) return '';
    const rows = [];
    const protection = item.protection || {};
    const thresholds = item.thresholds || {};
    ['ballistic','explosive','energy','fire','radiation','toxic'].forEach(type => {
      const pct = Math.round(Number(protection[type] || 0) * 100);
      const th = Number(thresholds[type] || 0);
      if (pct > 0 || th > 0) rows.push(`${damageTypeLabel(type)} ${pct}%${th ? ` / порог ${th}` : ''}`);
    });
    return rows.length ? `Защита: ${rows.join(' · ')} · без слабостей` : 'Почти не защищает';
  }

  function weaponSkillId(w = currentWeapon()) {
    if (!w) return 'unarmed';
    if (w.weaponSkill) return w.weaponSkill;
    if (!w.ammoType) return weaponBaseId(w) === 'fists' ? 'unarmed' : 'melee';
    return 'lightWeapons';
  }

  function weaponSkillNorm(w = currentWeapon()) {
    return skillNorm(weaponSkillId(w));
  }

  function weaponStrengthMissing(w = currentWeapon()) {
    const req = Number(w?.requiredStrength || 0);
    return Math.max(0, req - statValue('str'));
  }

  function weaponStrengthHitPenalty(w = currentWeapon()) {
    return weaponStrengthMissing(w) * 0.055;
  }

  function isPlayerMovingForAccuracy() {
    // Используем только уже инициализированные данные игрока: функция может
    // вызываться до объявления мобильного стика/клавиатуры.
    return !!(player?.targetPath?.length);
  }

  function automaticAccuracyPenalty(w = currentWeapon()) {
    if (!w?.automatic) return 0;
    const skillReduction = weaponSkillNorm(w) * 0.08;
    const strengthPenalty = weaponStrengthMissing(w) * 0.025;
    const movementPenalty = isPlayerMovingForAccuracy() && !player.crouching ? 0.04 : 0;
    const crouchBonus = player.crouching ? 0.03 : 0;
    const conditionPenalty = typeof w?.condition === 'number'
      ? Math.max(0, 70 - w.condition) * 0.0015
      : 0;
    let perkReduction = 0;
    const skillId = weaponSkillId(w);
    if (skillId === 'lightWeapons') perkReduction += talentLevel('automaticMan') * 0.03;
    if (skillId === 'heavyWeapons') perkReduction += talentLevel('machineGunner') * 0.04;
    if (skillId === 'energyWeapons') perkReduction += talentLevel('energyTech') * 0.03;
    return Math.max(0.04, Math.min(0.32, 0.18 - skillReduction + strengthPenalty + movementPenalty + conditionPenalty - crouchBonus - perkReduction));
  }

  function automaticAccuracyPenaltyPercent(w = currentWeapon()) {
    return Math.round(automaticAccuracyPenalty(w) * 100);
  }

  function automaticApCost(w = currentWeapon()) {
    // Автоматический режим делает один обычный выстрел за тик удержания,
    // поэтому стоимость одного тика ниже одиночного выстрела. При высоком
    // профильном навыке оружия округляем половину стоимости вниз.
    const baseAp = Math.max(1, Math.round(Number(w?.apCost || 3)));
    const half = baseAp / 2;
    const skill = skillPercent(weaponSkillId(w));
    const rounded = skill >= 70 ? Math.floor(half) : Math.ceil(half);
    return Math.max(1, rounded);
  }

  function isEnergyWeapon(w = currentWeapon()) {
    return !!w && (weaponSkillId(w) === 'energyWeapons' || w.damageType === 'energy');
  }

  function energyFailureChance(w = currentWeapon(), modeInfo = getWeaponModeInfo(w)) {
    if (!isEnergyWeapon(w)) return 0;
    const base = typeof w.energyFailureBase === 'number' ? w.energyFailureBase : 0.16;
    const skillReduction = weaponSkillNorm(w) * 0.55;
    const conditionPenalty = typeof w.condition === 'number' ? Math.max(0, 65 - w.condition) * 0.003 : 0;
    const modePenalty = modeInfo?.id === 'auto' ? 0.04 : 0;
    return Math.max(0.01, Math.min(0.36, base * (1 - skillReduction) + conditionPenalty + modePenalty - talentLevel('energyTech') * 0.035));
  }

  function rollEnergyFailure(w = currentWeapon(), modeInfo = getWeaponModeInfo(w)) {
    const chance = energyFailureChance(w, modeInfo);
    return chance > 0 && Math.random() < chance;
  }

  function playerVisionRadius() {
    return perceptionTileVisionRadius();
  }

  function damageRoll(w) {
    let dmg = w.dmg[0] + Math.floor(Math.random() * (w.dmg[1] - w.dmg[0] + 1));
    if (!w.ammoType) {
      const skillId = weaponSkillId(w);
      const meleeBonus = Math.round(weaponSkillNorm(w) * (skillId === 'unarmed' ? 4 : 6));
      dmg += Math.max(0, Math.floor((statValue('str') - 5) / 2)) + (hasStartTrait('bruiser') ? 2 : 0) + meleeBonus;
      if (skillId === 'melee') dmg += talentLevel('meleeBreaker') * 2;
      if (skillId === 'unarmed') dmg += talentLevel('unarmedFighter') * 2;
    }
    if (weaponSkillId(w) === 'energyWeapons') dmg += Math.max(0, Math.floor((statValue('int') - 5) / 2));
    return dmg;
  }

  function fireDamageMultiplier(w = currentWeapon()) {
    return w?.damageType === 'fire' ? 1 + talentLevel('pyromaniac') * 0.12 : 1;
  }

  function isAmbushAttack(enemy) {
    if (!enemy || talentLevel('ambush') <= 0 || !player?.crouching) return false;
    const state = String(enemy.aiState || 'idle');
    return state !== 'chase' && state !== 'attack';
  }

  function ambushDamageMultiplier(enemy) {
    return isAmbushAttack(enemy) ? 1 + talentLevel('ambush') * 0.14 : 1;
  }

  function enemyCombatTargetPoint(e) {
    const x = Number(e?.mesh?.position?.x ?? e?.visualX ?? e?.x ?? 0);
    const z = Number(e?.mesh?.position?.z ?? e?.visualZ ?? e?.z ?? 0);
    return {
      x: Number.isFinite(x) ? x : Number(e?.x || 0),
      z: Number.isFinite(z) ? z : Number(e?.z || 0)
    };
  }

  function enemyCombatHitRadius(e, padding = 0.2) {
    const modelRadius = typeof dynamicActorCollisionRadius === 'function'
      ? Number(dynamicActorCollisionRadius(e) || 0)
      : 0;
    const legacyRadius = 0.78 * Number(e?.scale || 1) + 0.28;
    return Math.max(0.5, legacyRadius, modelRadius + Math.max(0, Number(padding || 0)));
  }

  function distanceToEnemy(e) {
    const target = enemyCombatTargetPoint(e);
    return Math.hypot(target.x - player.x, target.z - player.z);
  }

  function facePoint(x, z) {
    player.angle = Math.atan2(x - player.x, z - player.z);
  }

  function hasLineOfSightTo(enemy) {
    // Standing view is high enough to see over low cover. Crouched view is low,
    // so low cover becomes a real vision blocker for the crouched observer.
    const target = enemyCombatTargetPoint(enemy);
    if (typeof isStaticCollisionBlockingWorldLine === 'function' && isStaticCollisionBlockingWorldLine(player.x, player.z, target.x, target.z, 0.04)) return false;
    if (typeof isTraderBuildingLowCoverBlockingWorldLine === 'function' && isTraderBuildingLowCoverBlockingWorldLine(player.x, player.z, target.x, target.z, player.crouching)) return false;
    const steps = Math.ceil(distanceToEnemy(enemy) / 0.9);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = player.x + (target.x - player.x) * t;
      const z = player.z + (target.z - player.z) * t;
      const tile = worldToTile(x, z);
      if (isVisionBlockingTileForObserver(tile.tx, tile.tz, player.crouching)) return false;
    }
    return true;
  }

  function blockingDistanceOnRay(dir, maxRange) {
    const step = 0.45;
    let worldCoverBlock = null;
    if (typeof traderBuildingLowCoverHitDistanceOnWorldSegment === 'function') {
      worldCoverBlock = traderBuildingLowCoverHitDistanceOnWorldSegment(player.x, player.z, player.x + dir.x * maxRange, player.z + dir.z * maxRange, player.crouching);
    }
    const staticBlock = typeof staticCollisionRayHitDistance === 'function'
      ? staticCollisionRayHitDistance(player.x, player.z, dir.x, dir.z, maxRange, 0.035, { startPad: 0.20 })
      : null;
    if (staticBlock !== null) worldCoverBlock = worldCoverBlock === null ? staticBlock : Math.min(worldCoverBlock, staticBlock);
    for (let d = step; d <= maxRange; d += step) {
      if (worldCoverBlock !== null && worldCoverBlock <= d) return Math.max(0.1, worldCoverBlock - step * 0.5);
      const tile = worldToTile(player.x + dir.x * d, player.z + dir.z * d);
      // Water is transparent to bullets. Low cover is shoot-through only while
      // standing; crouched shooting from cover is blocked by that cover.
      if (isBallisticBlockingTile(tile.tx, tile.tz, { shooterCrouching: player.crouching })) return Math.max(0.1, d - step * 0.5);
    }
    return worldCoverBlock !== null ? Math.min(maxRange, Math.max(0.1, worldCoverBlock - step * 0.5)) : maxRange;
  }

  function findEnemyAlongRay(dir, maxRange) {
    let best = null;
    let bestProj = maxRange + 1;
    enemies.forEach(e => {
      if (!e || e.dead || e._removed) return;
      const target = enemyCombatTargetPoint(e);
      const vx = target.x - player.x;
      const vz = target.z - player.z;
      const proj = vx * dir.x + vz * dir.z;
      if (proj < 0.45 || proj > maxRange || proj >= bestProj) return;
      const closestX = player.x + dir.x * proj;
      const closestZ = player.z + dir.z * proj;
      const perp = Math.hypot(target.x - closestX, target.z - closestZ);
      const hitRadius = enemyCombatHitRadius(e, 0.28);
      if (perp > hitRadius) return;
      const block = blockingDistanceOnRay(dir, proj);
      if (block + 0.25 < proj) return;
      best = e;
      bestProj = proj;
    });
    return best;
  }

  function isMultiTargetConeWeapon(w = currentWeapon()) {
    const id = weaponBaseId(w);
    return !!w && (id === 'shotgun' || id === 'flamethrower');
  }

  function coneWeaponWidthAtDistance(w, distance) {
    if (!w) return 0.45;
    const id = weaponBaseId(w);
    if (id === 'flamethrower') return 0.42 + distance * 0.24;
    if (id === 'shotgun') {
      const d = Math.max(0, Number(distance || 0));
      return 0.28 + d * 0.24 + d * d * 0.006;
    }
    return 0.45;
  }

  function isShotgunWeapon(w = currentWeapon()) {
    return weaponBaseId(w) === 'shotgun';
  }

  function shotgunDamageMultiplierAt(w, dist = 0, perp = 0, width = null) {
    if (!isShotgunWeapon(w)) return 1;
    const range = Math.max(1, Number(w.range || 1));
    const t = clamp01(Number(dist || 0) / range);
    const closeBoost = t <= 0.18 ? 1.14 : 1.08;
    const falloff = t <= 0.25 ? closeBoost : 1.08 - ((t - 0.25) / 0.75) * 0.68;
    const coneWidth = Number.isFinite(Number(width)) ? Number(width) : coneWeaponWidthAtDistance(w, dist);
    const edge = clamp01(Math.abs(Number(perp || 0)) / Math.max(0.15, coneWidth + 0.15));
    return Math.max(0.28, Math.min(1.14, falloff * (1 - edge * 0.28)));
  }

  function shotgunHitMultiplierAt(w, dist = 0, perp = 0, width = null) {
    if (!isShotgunWeapon(w)) return 1;
    const range = Math.max(1, Number(w.range || 1));
    const t = clamp01(Number(dist || 0) / range);
    const distanceMul = 1 - Math.max(0, (t - 0.25) / 0.75) * 0.24;
    const coneWidth = Number.isFinite(Number(width)) ? Number(width) : coneWeaponWidthAtDistance(w, dist);
    const edge = clamp01(Math.abs(Number(perp || 0)) / Math.max(0.15, coneWidth + 0.15));
    return Math.max(0.55, Math.min(1, distanceMul * (1 - edge * 0.22)));
  }

  function shotgunVisualSpreadAtDistance(w, distance = 0) {
    if (!isShotgunWeapon(w)) return 0.12;
    return Math.max(0.28, Math.min(2.7, coneWeaponWidthAtDistance(w, distance) * 0.72));
  }

  function findEnemiesInWeaponCone(dir, maxRange, w = currentWeapon()) {
    const targets = [];
    if (!isMultiTargetConeWeapon(w)) return targets;
    const normalizedDir = { x: dir.x, z: dir.z };
    const len = Math.hypot(normalizedDir.x, normalizedDir.z) || 1;
    normalizedDir.x /= len;
    normalizedDir.z /= len;
    enemies.forEach(e => {
      if (!e || e.dead || e._removed) return;
      const target = enemyCombatTargetPoint(e);
      const vx = target.x - player.x;
      const vz = target.z - player.z;
      const proj = vx * normalizedDir.x + vz * normalizedDir.z;
      if (proj < 0.35 || proj > maxRange) return;
      const closestX = player.x + normalizedDir.x * proj;
      const closestZ = player.z + normalizedDir.z * proj;
      const perp = Math.hypot(target.x - closestX, target.z - closestZ);
      const targetRadius = Math.max(0.55 * Number(e.scale || 1) + 0.22, enemyCombatHitRadius(e, 0.12));
      const coneWidth = coneWeaponWidthAtDistance(w, proj);
      if (perp > coneWidth + targetRadius) return;
      const dist = Math.hypot(vx, vz);
      const toTarget = { x: vx / Math.max(0.001, dist), z: vz / Math.max(0.001, dist) };
      const block = blockingDistanceOnRay(toTarget, dist);
      if (block + 0.25 < dist) return;
      targets.push({ enemy: e, dist, proj, perp, coneWidth, dirX: normalizedDir.x, dirZ: normalizedDir.z });
    });
    targets.sort((a, b) => a.proj - b.proj || a.perp - b.perp);
    return targets;
  }

  function applyConeWeaponDamage(targets, w, modeInfo, shots = 1, spend = null) {
    if (!currentLocationAllowsNpcCombat()) return rejectPeacefulNpcCombat();
    let hit = false;
    const rows = Array.isArray(targets) ? targets.slice() : [];
    rows.forEach(row => {
      const enemy = row.enemy;
      if (!enemy || enemy.dead || enemy._removed) return;
      for (let i = 0; i < shots && !enemy.dead && !enemy._removed; i++) {
        hit = applyWeaponDamage(enemy, row.dist, w, modeInfo, {
          multiTarget: true,
          spend,
          conePerp: row.perp,
          coneWidth: row.coneWidth,
          shotDirX: row.dirX,
          shotDirZ: row.dirZ
        }) || hit;
      }
    });
    return hit;
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function getWeaponModes(w) {
    if (!w || !w.ammoType) return [{ id: 'melee', label: 'Ближний бой', apCost: w?.apCost || 2, shots: 1, hitBonus: 0, damageMul: 1 }];
    const baseAp = w.apCost || 3;
    const modes = [
      { id: 'single', label: 'Одиночный', apCost: baseAp, shots: 1, hitBonus: 0, damageMul: 1, fireRateMul: 1 },
      { id: 'aimed', label: 'Прицельный', apCost: baseAp + 2, shots: 1, hitBonus: 0.24, damageMul: 1.05, fireRateMul: 1.12 }
    ];
    if (w.automatic) {
      modes.push({
        id: 'auto',
        label: 'Автоматический',
        // Автоматический режим — не дробовик и не залп. Он делает один
        // обычный выстрел за тик автоогня при удержании кнопки. За скорость
        // автоогонь платит прямым штрафом к точности.
        // Стоимость авто-тика = половина одиночного выстрела; при навыке 70%+ округляется вниз.
        apCost: automaticApCost(w),
        shots: 1,
        hitBonus: 0,
        damageMul: 1,
        fireRateMul: 0.72
      });
    }
    return modes;
  }

  function getWeaponModeInfo(w = currentWeapon(), preferred = player.fireMode) {
    const modes = getWeaponModes(w);
    return modes.find(m => m.id === preferred) || modes[0];
  }

  function ensureWeaponMode(w = currentWeapon()) {
    const info = getWeaponModeInfo(w);
    if (player.fireMode !== info.id) player.fireMode = info.id;
    return info;
  }

  function cycleFireMode() {
    const w = currentWeapon();
    const modes = getWeaponModes(w);
    if (modes.length <= 1) {
      setReadout(`${w.name}: режим стрельбы не меняется.`);
      return;
    }
    const current = getWeaponModeInfo(w);
    const idx = Math.max(0, modes.findIndex(m => m.id === current.id));
    const next = modes[(idx + 1) % modes.length];
    player.fireMode = next.id;
    addLog(`X: ${w.name} — режим «${next.label}», ${next.apCost} AP.`, null, 'system');
    renderWeaponReadout();
    updateTargetHintFromHover();
    queueSave();
  }

  function calculateHitChance(enemy, dist, w = currentWeapon(), modeInfo = getWeaponModeInfo(w), options = {}) {
    if (!enemy || enemy.dead || dist > w.range) return 0;
    const conditionPenalty = w.ammoType && typeof w.condition === 'number' ? Math.max(0, 70 - w.condition) * 0.0025 : 0;
    const statAimBonus = (statValue('per') - 5) * 0.025 + (hasStartTrait('trainedEye') ? 0.06 : 0);
    const luckBonus = Math.max(0, statValue('luck') - 5) * 0.006;
    let modeBonus = modeInfo?.hitBonus || 0;
    if (w?.ammoType && (modeInfo?.id === 'single' || modeInfo?.id === 'aimed')) modeBonus += talentLevel('gunslinger') * 0.07;
    if (w?.damageType === 'explosive') modeBonus += talentLevel('grenadier') * 0.06;
    if (w?.damageType === 'fire') modeBonus += talentLevel('pyromaniac') * 0.04;
    if (isAmbushAttack(enemy)) modeBonus += talentLevel('ambush') * 0.08;
    let skillBonus = weaponSkillNorm(w) * (w.ammoType ? 0.30 : 0.18);
    if (w?.damageType === 'explosive') skillBonus += skillNorm('throwing') * 0.08;
    if (weaponSkillId(w) === 'heavyWeapons') skillBonus += talentLevel('heavyShooter') * 0.06;
    if (weaponSkillId(w) === 'energyWeapons') skillBonus += talentLevel('energyTech') * 0.05;
    if (weaponSkillId(w) === 'unarmed') skillBonus += talentLevel('unarmedFighter') * 0.04;
    const strengthPenalty = weaponStrengthHitPenalty(w);
    const movementPenalty = isPlayerMovingForAccuracy() && !player.crouching ? 0.035 : 0;
    const traumaPenalty = injuryHitPenalty();
    let base;
    if (w.ammoType) {
      base = Math.max(0.38, 0.82 - dist / (w.range * 3.1)) + skillBonus + statAimBonus + luckBonus + modeBonus - conditionPenalty - strengthPenalty - movementPenalty - traumaPenalty;
      if (modeInfo?.id === 'auto') base -= automaticAccuracyPenalty(w);
      if (isShotgunWeapon(w)) base *= shotgunHitMultiplierAt(w, dist, options.conePerp || 0, options.coneWidth);
    } else {
      base = 0.72 + skillBonus + Math.max(0, statValue('str') - 5) * 0.012 + luckBonus - strengthPenalty - traumaPenalty;
    }
    const cap = modeInfo?.id === 'aimed' ? 0.99 : (w.ammoType ? 0.96 : 0.94);
    return Math.min(cap, Math.max(0.05, base));
  }

  function hitChanceClass(percent) {
    if (percent >= 70) return 'hit-good';
    if (percent >= 40) return 'hit-mid';
    return 'hit-bad';
  }

  function enemyHealthStateText(enemy) {
    const hp = Math.max(0, Number(enemy?.hp || 0));
    const maxHp = Math.max(1, Number(enemy?.maxHp || hp || 1));
    if (hp <= 0 || enemy?.dead) return 'при смерти';
    const pct = hp / maxHp;
    if (hp >= maxHp || pct >= 0.995) return 'здоров';
    if (pct >= 0.8) return 'лёгкое ранение';
    if (pct >= 0.5) return 'ранен';
    if (pct >= 0.3) return 'сильное ранение';
    if (pct >= 0.1) return 'критическое ранение';
    return 'при смерти';
  }

  function estimatedWeaponDamageRange(enemy, w = currentWeapon(), modeInfo = getWeaponModeInfo(w)) {
    if (!enemy || !w || !Array.isArray(w.dmg)) return null;
    const skillId = weaponSkillId(w);
    let bonus = 0;
    if (!w.ammoType) {
      const meleeBonus = Math.round(weaponSkillNorm(w) * (skillId === 'unarmed' ? 4 : 6));
      bonus += Math.max(0, Math.floor((statValue('str') - 5) / 2)) + (hasStartTrait('bruiser') ? 2 : 0) + meleeBonus;
      if (skillId === 'melee') bonus += talentLevel('meleeBreaker') * 2;
      if (skillId === 'unarmed') bonus += talentLevel('unarmedFighter') * 2;
    }
    if (skillId === 'energyWeapons') bonus += Math.max(0, Math.floor((statValue('int') - 5) / 2));
    if (w.ammoType) bonus += talentLevel('sharpshooter') * 2;
    const mul = Number(modeInfo?.damageMul || 1);
    const ambushMul = ambushDamageMultiplier(enemy);
    const fireMul = fireDamageMultiplier(w);
    const shotgunMul = shotgunDamageMultiplierAt(w, distanceToEnemy(enemy), 0);
    const minRaw = Math.max(1, Math.round((Number(w.dmg[0] || 1) + bonus) * fireMul * mul * ambushMul * shotgunMul));
    const maxRaw = Math.max(minRaw, Math.round((Number(w.dmg[1] || w.dmg[0] || 1) + bonus) * fireMul * mul * ambushMul * shotgunMul));
    const avgRaw = Math.max(1, Math.round(((Number(w.dmg[0] || 1) + Number(w.dmg[1] || w.dmg[0] || 1)) / 2 + bonus) * fireMul * mul * ambushMul * shotgunMul));
    const type = w.damageType || 'ballistic';
    const min = mitigateEnemyDamage(minRaw, enemy, type).damage;
    const max = mitigateEnemyDamage(maxRaw, enemy, type).damage;
    const avg = mitigateEnemyDamage(avgRaw, enemy, type).damage;
    return { min: Math.min(min, max), max: Math.max(min, max), avg, type };
  }

  function estimatedWeaponDamageText(enemy, info) {
    if (talentLevel('awareness') <= 0) return '';
    const w = currentWeapon();
    const est = estimatedWeaponDamageRange(enemy, w, info?.modeInfo || getWeaponModeInfo(w));
    if (!est) return 'нет данных';
    const range = est.min === est.max ? `${est.min}` : `${est.min}–${est.max}`;
    const expected = Math.max(0, Math.round(est.avg * Math.max(0, Number(info?.chance || 0)) / 100));
    return `${range} ${damageTypeLabel(est.type)} · средний ${est.avg} · с шансом ≈${expected}`;
  }

  function getTargetHitInfo(enemy) {
    const w = currentWeapon();
    const modeInfo = getWeaponModeInfo(w);
    const dist = distanceToEnemy(enemy);
    const dx = enemy.x - player.x;
    const dz = enemy.z - player.z;
    const len = Math.hypot(dx, dz) || 1;
    const dir = { x: dx / len, z: dz / len };
    const blocked = blockingDistanceOnRay(dir, dist) + 0.25 < dist;
    const inRange = dist <= w.range;
    const chance = (!blocked && inRange) ? Math.round(calculateHitChance(enemy, dist, w, modeInfo) * 100) : 0;
    let note = `${modeInfo.label} · ${modeInfo.apCost} AP · ${Math.round(dist)} м`;
    if (isEnergyWeapon(w)) note += ` · риск сбоя ${Math.round(energyFailureChance(w, modeInfo) * 100)}%`;
    if (!inRange) note = `Вне дальности · ${Math.round(dist)}/${w.range} м`;
    else if (blocked) note = 'Линия огня перекрыта';
    return { chance, note, modeInfo, dist, inRange, blocked };
  }

  function formatActionCost(value) {
    const n = Number(value || 0);
    return String(Math.max(0, Math.round(n)));
  }

  function reloadApCost(w = currentWeapon()) {
    if (!w || !w.ammoType) return 0;
    const base = Number.isFinite(Number(w.reloadApCost))
      ? Number(w.reloadApCost)
      : Math.max(2, Math.round(Number(w.apCost || 3)));
    return Math.max(1, Math.round(base - talentLevel('quickHands') + injuryApPenalty('reload')));
  }

  function makeAttackToken() {
    return `atk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function combatResourceSnapshot(w = currentWeapon(), modeInfo = getWeaponModeInfo(w), spend = {}) {
    const loadedNow = w?.ammoType ? Math.max(0, Number(w.loaded || 0)) : 0;
    const ammoType = w?.ammoType || '';
    const reserveNow = ammoType ? Math.max(0, Number(inventory.get(ammoType) || 0)) : 0;
    return {
      token: spend.token || '',
      weapon: weaponBaseId(w),
      mode: modeInfo?.id || player.fireMode || 'single',
      apCost: Number(spend.apCost ?? (modeInfo?.apCost || w?.apCost || 0)),
      shots: Math.max(1, Math.floor(Number(spend.shots || 1))),
      apBefore: Number(spend.apBefore ?? player.ap ?? 0),
      apAfter: Number(spend.apAfter ?? player.ap ?? 0),
      loadedBefore: Number(spend.loadedBefore ?? loadedNow),
      loadedAfter: Number(spend.loadedAfter ?? loadedNow),
      conditionBefore: Number.isFinite(Number(spend.conditionBefore)) ? Number(spend.conditionBefore) : (Number.isFinite(Number(w?.condition)) ? Number(w.condition) : null),
      conditionAfter: Number.isFinite(Number(spend.conditionAfter)) ? Number(spend.conditionAfter) : (Number.isFinite(Number(w?.condition)) ? Number(w.condition) : null),
      ammoType,
      reserveAmmo: reserveNow
    };
  }

  function multiplayerCombatSnapshot() {
    const w = currentWeapon();
    const modeInfo = getWeaponModeInfo(w);
    return combatResourceSnapshot(w, modeInfo, {
      token: '',
      apBefore: player.ap,
      apAfter: player.ap,
      loadedBefore: w?.ammoType ? Number(w.loaded || 0) : 0,
      loadedAfter: w?.ammoType ? Number(w.loaded || 0) : 0,
      shots: 1,
      apCost: 0
    });
  }

  function applyServerCombatState(combat = null) {
    if (!combat || typeof combat !== 'object') return false;
    if (Number.isFinite(Number(combat.ap))) player.ap = Math.min(player.maxAp, Math.max(0, Number(combat.ap)));
    const w = currentWeapon();
    const currentRuntimeId = String(equipment?.weapon || w?.id || '');
    const runtimeMatches = !combat.weaponRuntimeId || String(combat.weaponRuntimeId) === currentRuntimeId;
    if (w && runtimeMatches && combat.weapon && weaponBaseId(w) === String(combat.weapon) && w.ammoType && Number.isFinite(Number(combat.loaded))) {
      w.loaded = Math.max(0, Math.min(Number(w.magSize || combat.magSize || 0), Math.round(Number(combat.loaded))));
    }
    if (w && runtimeMatches && combat.weapon && weaponBaseId(w) === String(combat.weapon) && Number.isFinite(Number(combat.condition))) {
      w.condition = Math.max(1, Math.min(100, Number(combat.condition)));
    }
    renderQuickbar();
    renderWeaponReadout();
    renderUI();
    return true;
  }


  let deferredInventoryRenderQueued = false;
