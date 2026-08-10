  function weaponBaseId(w = currentWeapon()) {
    const raw = w?.id || 'fists';
    try { return baseItemId(raw) || raw; }
    catch (_) { return raw; }
  }

  function isExplosionWeapon(w = currentWeapon()) {
    return !!w && weaponBaseId(w) === 'rocketLauncher';
  }

  function explosiveRadiusForWeapon(w = currentWeapon()) {
    const base = Math.max(1.5, Number(w?.explosiveRadius || 3.6));
    if (!isExplosionWeapon(w)) return base;
    return base + skillNorm('throwing') * 0.45 + talentLevel('grenadier') * 0.2;
  }

  function explosionLineClear(cx, cz, tx, tz) {
    const dx = tx - cx;
    const dz = tz - cz;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return true;
    if (typeof isStaticCollisionBlockingWorldLine === 'function' && isStaticCollisionBlockingWorldLine(cx, cz, tx, tz, 0.04)) return false;
    const step = 0.45;
    for (let d = step; d < len; d += step) {
      const tile = worldToTile(cx + dx / len * d, cz + dz / len * d);
      if (isBallisticBlockingTile(tile.tx, tile.tz, { shooterCrouching: false })) return false;
    }
    return true;
  }

  function explosionWouldAffectNpc(centerX, centerZ, w = currentWeapon()) {
    const radius = explosiveRadiusForWeapon(w);
    return enemies.some(enemy => {
      if (!enemy || enemy.dead || enemy._removed) return false;
      const dist = Math.hypot(enemy.x - centerX, enemy.z - centerZ);
      const targetRadius = 0.5 * (enemy.scale || 1) + 0.22;
      return dist <= radius + targetRadius && explosionLineClear(centerX, centerZ, enemy.x, enemy.z);
    });
  }

  function applyExplosionDamage(centerX, centerZ, w, modeInfo, options = {}) {
    if (typeof rejectBlockedGameplayAction === 'function' && rejectBlockedGameplayAction()) return false;
    if (!currentLocationAllowsNpcCombat() && explosionWouldAffectNpc(centerX, centerZ, w)) {
      return rejectPeacefulNpcCombat();
    }
    const radius = explosiveRadiusForWeapon(w);
    const rawBaseRoll = Math.max(1, Math.round((damageRoll(w) + talentLevel('sharpshooter') * 2) * (modeInfo.damageMul || 1)));
    let anyHit = false;
    if (enemiesAreServerAuthoritative()) {
      return emitGuardedMultiplayerGameplayAction('explosionAttack', {
        ...multiplayerProgressionSnapshot(),
        equipment: typeof multiplayerEquipmentSnapshot === 'function' ? multiplayerEquipmentSnapshot() : null,
        weapon: weaponBaseId(w),
        mode: modeInfo.id,
        attackToken: options.spend?.token || '',
        combat: combatResourceSnapshot(w, modeInfo, options.spend || {}),
        impactX: centerX,
        impactZ: centerZ,
        x: player.x,
        z: player.z,
        angle: player.angle
      }, ack => {
        if (!ack || !ack.ok) {
          if (ack?.combat) applyServerCombatState(ack.combat);
          if (ack?.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
          setReadout(ack?.error || 'Сервер отклонил взрыв.');
          return;
        }
        if (ack.combat) applyServerCombatState(ack.combat);
        if (ack.self && typeof applyServerAuthoritativePlayerState === 'function') applyServerAuthoritativePlayerState(ack.self);
        if (Array.isArray(ack.enemies)) {
          applyNetworkEnemies(ack.enemies, { allowPositionSync: true, fromServer: true, pruneMissing: false });
        }
        (ack.enemyHits || []).forEach(hit => {
          const enemy = enemies.find(row => row && row.id === hit.enemyId);
          const x = enemy?.x ?? centerX;
          const z = enemy?.z ?? centerZ;
          const critical = hit.critical === true;
          const damage = Math.max(0, Number(hit.damage || 0));
          createFloatingText(x, z, critical ? `КРИТ! -${damage}` : `-${damage}`, critical ? '#ffd166' : '#ff9b5a');
          const absorbed = Number(hit.absorbed || 0) > 0 ? `, броня поглотила ${Number(hit.absorbed)}` : '';
          const criticalText = critical ? 'КРИТИЧЕСКИЙ ВЫСТРЕЛ! ' : '';
          addLog(`${w.icon} ${criticalText}${w.name}: ${hit.enemyName || 'цель'} получает ${damage} взрывного урона${absorbed}.`, null, 'combat');
        });
        if (!ack.hit) setReadout(`${w.name}: взрыв никого не задел.`);
        renderInventoryIfVisibleDeferred();
        renderUI();
        updateTargetHintFromHover();
      });
    }
    const explosionCritical = rollCriticalShot(rawBaseRoll, w);
    const rawBase = explosionCritical.rawDamage;
    enemies.forEach(enemy => {
      if (!enemy || enemy.dead || enemy._removed) return;
      const dist = Math.hypot(enemy.x - centerX, enemy.z - centerZ);
      const targetRadius = 0.5 * (enemy.scale || 1) + 0.22;
      if (dist > radius + targetRadius) return;
      if (!explosionLineClear(centerX, centerZ, enemy.x, enemy.z)) return;
      const falloff = Math.max(0.34, 1 - Math.max(0, dist - targetRadius) / radius * 0.72);
      const raw = Math.max(1, Math.round(rawBase * falloff * ambushDamageMultiplier(enemy)));
      const dmgInfo = mitigateEnemyDamage(raw, enemy, 'explosive');
      const dmg = dmgInfo.damage;
      enemy.flash = 0.2;
      if (!enemiesAreServerAuthoritative()) {
        const criticalText = explosionCritical.critical ? 'КРИТИЧЕСКИЙ ВЫСТРЕЛ! ' : '';
        createFloatingText(enemy.x, enemy.z, explosionCritical.critical ? `КРИТ! -${dmg}` : `-${dmg}`, explosionCritical.critical ? '#ffd166' : '#ff9b5a');
        const absorbedText = dmgInfo.absorbed > 0 ? `, броня поглотила ${dmgInfo.absorbed}` : '';
        addLog(`${w.icon} ${criticalText}${w.name}: ${enemy.name} получает ${dmg} взрывного урона${absorbedText}.`, null, 'combat');
      }
      anyHit = true;
      if (enemiesAreServerAuthoritative()) {
        emitGuardedMultiplayerGameplayAction('enemyHit', {
          enemyId: enemy.id,
          ...multiplayerProgressionSnapshot(),
          clientPredictedDamage: dmg,
          clientPredictedRawDamage: raw,
          weapon: weaponBaseId(w),
          mode: modeInfo.id,
          multiTarget: true,
          explosive: true,
          attackToken: options.spend?.token || '',
          combat: combatResourceSnapshot(w, modeInfo, options.spend || {}),
          impactX: centerX,
          impactZ: centerZ,
          x: player.x,
          z: player.z,
          targetX: enemyCombatTargetPoint(enemy).x,
          targetZ: enemyCombatTargetPoint(enemy).z,
          angle: player.angle
        }, ack => {
          if (ack && ack.ok && ack.enemy) {
            if (ack.hit === false) {
              createFloatingText(enemy.x, enemy.z, 'мимо', '#b7b7b7');
            } else {
              const serverDamage = Math.max(0, Number(ack.damage || 0));
              const serverAbsorbed = Math.max(0, Number(ack.absorbed || 0));
              const serverAbsorbedText = serverAbsorbed > 0 ? `, броня поглотила ${serverAbsorbed}` : '';
              if (serverDamage > 0) createFloatingText(enemy.x, enemy.z, '-' + serverDamage, '#ff9b5a');
              addLog(`${w.icon} ${w.name}: ${enemy.name} получает ${serverDamage} взрывного урона${serverAbsorbedText}.`, null, 'combat');
            }
            applyNetworkEnemies([ack.enemy], { allowPositionSync: true, fromServer: true, pruneMissing: false });
            if (ack.combat) applyServerCombatState(ack.combat);
          }
          else if (ack && ack.error) {
            if (ack.combat) applyServerCombatState(ack.combat);
            setReadout(ack.error);
          }
          updateTargetHintFromHover();
        });
      } else {
        enemy.hp -= dmg;
        if (enemy.hp <= 0) killEnemy(enemy);
      }
    });

    const selfDist = Math.hypot(player.x - centerX, player.z - centerZ);
    if (selfDist <= radius && player.invincible <= 0 && explosionLineClear(centerX, centerZ, player.x, player.z)) {
      const falloff = Math.max(0.35, 1 - selfDist / radius * 0.7);
      const raw = Math.max(1, Math.round(rawBase * falloff));
      const incoming = mitigateIncomingDamage(raw, 'explosive');
      const reduced = incoming.damage;
      const savedBySecondChance = player.hp - reduced <= 0 && typeof trySecondChance === 'function' && trySecondChance(reduced, 'взрыв');
      if (!savedBySecondChance) player.hp = Math.max(0, player.hp - reduced);
      player.invincible = 0.35;
      createFloatingText(player.x, player.z, explosionCritical.critical ? `КРИТ! -${reduced}` : `-${reduced}`, explosionCritical.critical ? '#ffd166' : '#ff5b4a');
      const absorbedText = incoming.absorbed > 0 ? `, броня поглотила ${incoming.absorbed}` : '';
      const criticalText = explosionCritical.critical ? 'КРИТИЧЕСКИЙ ВЫСТРЕЛ! ' : '';
      addLog(`${w.icon} ${criticalText}Взрыв задел вас: -${reduced} HP${absorbedText}.`, null, 'combat');
      rollSelfInjuryFromHit(reduced, 'explosive', 'самоповреждение взрывом ракеты');
      anyHit = true;
      if (player.hp <= 0) playerDeath();
      else sendImmediateMultiplayerState('selfExplosionDamage');
      queueSave(true);
    }

    renderInventoryIfVisibleDeferred();
    renderUI();
    updateTargetHintFromHover();
    return anyHit;
  }

  function getWeaponMuzzlePoint(w = currentWeapon(), handSlot = 'weapon') {
    // Локальная точка конца ствола в модели игрока. Модель развёрнута отдельно,
    // поэтому берём реальный world-space через playerGroup.localToWorld.
    const weaponId = weaponBaseId(w);
    let localZ = -0.72;
    if (weaponId === 'pistol') localZ = -0.92;
    else if (weaponId === 'rifle') localZ = -1.36;
    else if (weaponId === 'assaultRifle') localZ = -1.16;
    else if (weaponId === 'machineGun') localZ = -1.42;
    else if (weaponId === 'laserPistol') localZ = -0.98;
    else if (weaponId === 'flamethrower') localZ = -1.02;
    else if (weaponId === 'plasmaRifle') localZ = -1.24;
    else if (weaponId === 'shotgun') localZ = -1.18;
    else if (weaponId === 'rocketLauncher') localZ = -1.36;
    else if (weaponId === 'knife') localZ = -0.72;
    playerGroup.position.set(player.x, player.y, player.z);
    playerGroup.rotation.y = player.angle + Math.PI;
    const handX = handSlot === 'offhand' ? -0.48 : 0.48;
    const weaponGroup = typeof actorWeaponGroupForSlot === 'function' ? actorWeaponGroupForSlot(playerGroup, handSlot) : null;
    if (weaponGroup) {
      const socketPoint = typeof weaponMuzzleSocketWorldPoint === 'function'
        ? weaponMuzzleSocketWorldPoint(weaponGroup)
        : null;
      if (socketPoint) return socketPoint;
      return weaponGroup.localToWorld(new THREE.Vector3(0, 0, localZ));
    }
    return playerGroup.localToWorld(new THREE.Vector3(handX, 1.05, localZ));
  }

  function createFloatingText(x, z, text, color = '#f0d28a') {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 30px Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, 2.4, z);
    sprite.scale.set(2.7, 0.68, 1);
    scene.add(sprite);
    floatingTexts.push({ sprite, mat, tex, life: 1.0, maxLife: 1.0 });
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
  }

  function wrapNpcSpeechText(ctx, text, maxWidth) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(word => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines.slice(0, 2);
  }

  function createNpcSpeechTexture(text) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 144;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.font = 'bold 25px Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapNpcSpeechText(ctx, text, 420);
    const boxH = lines.length > 1 ? 92 : 64;
    const boxY = 18;
    roundedRectPath(ctx, 24, boxY, 464, boxH, 14);
    ctx.fillStyle = 'rgba(5, 12, 8, 0.88)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(225, 184, 75, 0.92)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(236, boxY + boxH - 1);
    ctx.lineTo(256, boxY + boxH + 18);
    ctx.lineTo(276, boxY + boxH - 1);
    ctx.closePath();
    ctx.fillStyle = 'rgba(5, 12, 8, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(225, 184, 75, 0.92)';
    ctx.stroke();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 4;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fillStyle = '#f2d986';
    const firstY = lines.length > 1 ? boxY + 31 : boxY + boxH / 2;
    lines.forEach((line, i) => {
      const y = firstY + i * 30;
      ctx.strokeText(line, 256, y);
      ctx.fillText(line, 256, y);
    });
    return new THREE.CanvasTexture(c);
  }

  function disposeNpcSpeechBubble(id, row) {
    if (!row) row = npcSpeechBubbles.get(id);
    if (!row) return;
    if (row.sprite) scene.remove(row.sprite);
    if (row.texture && row.texture.dispose) row.texture.dispose();
    if (row.material && row.material.dispose) row.material.dispose();
    npcSpeechBubbles.delete(id);
  }

  let npcSpeechBubbleUpdateTimer = 0;

  function updateNpcSpeechBubbles(dt = 0) {
    if (!scene || !Array.isArray(enemies)) return;
    npcSpeechBubbleUpdateTimer -= Math.max(0, Number(dt || 0));
    if (npcSpeechBubbleUpdateTimer > 0) return;
    npcSpeechBubbleUpdateTimer = 0.10;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const liveIds = new Set();
    enemies.forEach(enemy => {
      if (!enemy || !enemy.id) return;
      liveIds.add(enemy.id);
      const text = String(enemy.speechText || '').trim();
      const active = text
        && !enemy.dead
        && enemy.mesh
        && enemy.mesh.visible !== false
        && Number(enemy.speechUntil || 0) > now;
      if (!active) {
        disposeNpcSpeechBubble(enemy.id);
        return;
      }
      let row = npcSpeechBubbles.get(enemy.id);
      if (!row || row.text !== text || row.speechId !== enemy.speechId) {
        disposeNpcSpeechBubble(enemy.id, row);
        const texture = createNpcSpeechTexture(text);
        const material = new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
          depthWrite: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.renderOrder = 45;
        scene.add(sprite);
        row = { sprite, texture, material, text, speechId: enemy.speechId || text };
        npcSpeechBubbles.set(enemy.id, row);
      }
      const scale = Math.max(0.75, Math.min(1.25, Number(enemy.scale || 1)));
      const pos = enemy.mesh.position || { x: enemy.x, z: enemy.z };
      row.sprite.position.set(Number(pos.x || enemy.x || 0), 2.85 * scale, Number(pos.z || enemy.z || 0));
      row.sprite.scale.set(3.45, 0.98, 1);
      const leftMs = Math.max(0, Number(enemy.speechUntil || 0) - now);
      row.material.opacity = Math.max(0.18, Math.min(1, Math.min(leftMs / 420, 1)));
    });
    for (const [id, row] of [...npcSpeechBubbles.entries()]) {
      if (!liveIds.has(id)) disposeNpcSpeechBubble(id, row);
    }
  }
