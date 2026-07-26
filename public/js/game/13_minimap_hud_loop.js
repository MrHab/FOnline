  function minimapArrowRotation(angle) {
    // Canvas arrow points north by default; world angle 0 is south, PI is north.
    // This formula keeps north/south correct and does not mirror west/east.
    return Math.PI - angle;
  }

  // v7.74.75: buildWorld() can call invalidateMinimapStaticCache() before
  // this late update/minimap chunk reaches its variable initialisers. Function
  // declarations are hoisted across the bundled IIFE, but let/const variables
  // would still be in TDZ and crash the login screen. Keep the cache state as
  // lazy var-backed data so early invalidation is a harmless no-op/initialise.
  var minimapStaticCache = minimapStaticCache || new Map();
  var minimapStaticRevision = Number.isFinite(minimapStaticRevision) ? minimapStaticRevision : 1;
  var minimapDrawTimer = Number.isFinite(minimapDrawTimer) ? minimapDrawTimer : 0;

  function getMinimapStaticCache() {
    if (!minimapStaticCache || typeof minimapStaticCache.get !== 'function') minimapStaticCache = new Map();
    if (!Number.isFinite(minimapStaticRevision)) minimapStaticRevision = 1;
    return minimapStaticCache;
  }

  function invalidateMinimapStaticCache(reason = 'map') {
    const cache = getMinimapStaticCache();
    minimapStaticRevision = (Number.isFinite(minimapStaticRevision) ? minimapStaticRevision : 1) + 1;
    cache.clear();
  }

  function minimapTileFill(type, mode = 'hud') {
    const hud = mode !== 'legacy';
    if (hud) {
      return type === TILE_TYPES.WATER ? 'rgba(23,83,100,0.62)'
        : type === TILE_TYPES.PATH ? 'rgba(129,102,57,0.66)'
        : type === TILE_TYPES.TREE ? 'rgba(45,86,37,0.62)'
        : type === TILE_TYPES.ROCK || type === TILE_TYPES.RUIN ? 'rgba(102,103,93,0.64)'
        : type === TILE_TYPES.OIL ? 'rgba(78,69,44,0.72)'
        : type === TILE_TYPES.ORE || type === TILE_TYPES.WOOD ? 'rgba(158,124,60,0.66)'
        : 'rgba(55,74,36,0.54)';
    }
    return type === TILE_TYPES.WATER ? '#0e3a4f'
      : type === TILE_TYPES.PATH ? '#6b5537'
      : type === TILE_TYPES.TREE ? '#244d20'
      : type === TILE_TYPES.ROCK || type === TILE_TYPES.RUIN ? '#55564f'
      : type === TILE_TYPES.OIL ? '#4e452c'
      : type === TILE_TYPES.ORE || type === TILE_TYPES.WOOD ? '#9a7a45'
      : '#29381f';
  }

  function minimapTileTypeAt(x, z) {
    const row = Array.isArray(map) ? map[z] : null;
    if (Array.isArray(row)) return row[x] ?? TILE_TYPES.GRASS;
    if (typeof tileTypeAt === 'function') return tileTypeAt(x, z) ?? TILE_TYPES.GRASS;
    return TILE_TYPES.GRASS;
  }

  function buildMinimapStaticCanvas(cacheKey, w, h, mode = 'hud') {
    if (!map) return null;
    const cache = getMinimapStaticCache();
    const fullKey = `${cacheKey}|${mode}|${w}x${h}|${minimapStaticRevision}|${currentLocation?.id || 'loc'}`;
    const cached = cache.get(fullKey);
    if (cached) return cached;
    const cnv = document.createElement('canvas');
    cnv.width = w;
    cnv.height = h;
    const ctx = cnv.getContext('2d');
    ctx.fillStyle = mode === 'legacy' ? '#070c0d' : 'rgba(7,12,13,0.72)';
    ctx.fillRect(0, 0, w, h);
    const sx = w / MAP_W;
    const sy = h / MAP_H;
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        ctx.fillStyle = minimapTileFill(minimapTileTypeAt(x, z), mode);
        ctx.fillRect(x * sx, z * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }
    if (mode !== 'legacy') {
      ctx.strokeStyle = 'rgba(227,195,110,0.22)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= MAP_W; x += 8) { ctx.beginPath(); ctx.moveTo(x * sx, 0); ctx.lineTo(x * sx, h); ctx.stroke(); }
      for (let z = 0; z <= MAP_H; z += 8) { ctx.beginPath(); ctx.moveTo(0, z * sy); ctx.lineTo(w, z * sy); ctx.stroke(); }
    }
    cache.set(fullKey, cnv);
    return cnv;
  }

  function drawMinimapActors(ctx, w, h, mode = 'hud') {
    const sx = w / MAP_W;
    const sy = h / MAP_H;
    if (typeof multiplayer !== 'undefined' && mode !== 'legacy') {
      multiplayer.worldContainers?.forEach(row => {
        if (!row || (row.mesh && row.mesh.visible === false)) return;
        const tt = worldToTile(Number(row.x || 0), Number(row.z || 0));
        ctx.fillStyle = row.empty ? 'rgba(133,111,73,0.62)' : 'rgba(229,181,88,0.88)';
        ctx.fillRect(tt.tx * sx - 2, tt.tz * sy - 2, 4, 4);
      });
      multiplayer.groundItems?.forEach(row => {
        if (!row || (row.mesh && row.mesh.visible === false)) return;
        const tt = worldToTile(Number(row.x || 0), Number(row.z || 0));
        ctx.fillStyle = 'rgba(230,214,128,0.86)';
        ctx.beginPath();
        ctx.arc(tt.tx * sx, tt.tz * sy, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    enemies.forEach(e => {
      if (e.dead || e._removed || (e.mesh && e.mesh.visible === false)) return;
      const tt = worldToTile(e.x, e.z);
      ctx.fillStyle = mode === 'legacy' ? '#dc553e' : 'rgba(224,80,55,0.92)';
      ctx.fillRect(tt.tx * sx - (mode === 'legacy' ? 1 : 1.5), tt.tz * sy - (mode === 'legacy' ? 1 : 1.5), mode === 'legacy' ? 4 : 3, mode === 'legacy' ? 4 : 3);
    });
    if (mode !== 'legacy') {
      multiplayer.remotePlayers.forEach(rp => {
        if (!rp || (!rp.x && rp.x !== 0) || (rp.group && rp.group.visible === false)) return;
        const tt = worldToTile(rp.x, rp.z);
        ctx.fillStyle = 'rgba(112,172,230,0.96)';
        ctx.beginPath();
        ctx.arc(tt.tx * sx, tt.tz * sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    const pt = worldToTile(player.x, player.z);
    if (mode === 'legacy') {
      ctx.fillStyle = '#e6d68f';
      ctx.beginPath();
      ctx.arc(pt.tx * sx, pt.tz * sy, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.save();
    ctx.translate(pt.tx * sx, pt.tz * sy);
    ctx.rotate(minimapArrowRotation(player.angle || 0));
    ctx.fillStyle = '#e6d68f';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function maybeDrawHudMinimaps(dt = 0, force = false) {
    if (document.body.classList.contains('global-map-mode') || globalMapState?.onWorldMap) {
      minimapDrawTimer = 0;
      return;
    }
    if (!force) {
      minimapDrawTimer -= Math.max(0, Number(dt || 0));
      const interval = IS_MOBILE_DEVICE ? 0.25 : 0.12;
      if (minimapDrawTimer > 0) return;
      minimapDrawTimer = interval;
    } else {
      minimapDrawTimer = 0;
    }
    drawMinimap();
    drawMobileHudMinimap();
    drawDesktopHudMinimap();
  }

  function drawMobileHudMinimap() {
    const canvas = document.getElementById('mobile-minimap-canvas');
    if (!canvas || !map || !player) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const bg = buildMinimapStaticCanvas('mobile-hud', w, h, 'hud');
    if (bg) ctx.drawImage(bg, 0, 0);
    else ctx.clearRect(0, 0, w, h);
    drawMinimapActors(ctx, w, h, 'hud');
  }

  function drawDesktopHudMinimap() {
    const canvas = document.getElementById('desktop-minimap-canvas');
    if (!canvas || !map || !player) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const bg = buildMinimapStaticCanvas('desktop-hud', w, h, 'hud');
    if (bg) ctx.drawImage(bg, 0, 0);
    else ctx.clearRect(0, 0, w, h);
    drawMinimapActors(ctx, w, h, 'hud');
  }

  function drawMinimap() {
    if (!miniCanvas || !miniCtx || !map || !player) return;
    const w = miniCanvas.width;
    const h = miniCanvas.height;
    const bg = buildMinimapStaticCanvas('legacy', w, h, 'legacy');
    if (bg) miniCtx.drawImage(bg, 0, 0);
    else miniCtx.clearRect(0, 0, w, h);
    drawMinimapActors(miniCtx, w, h, 'legacy');
  }

  function renderWeaponReadout() {
    const el = document.getElementById('weapon-readout');
    if (!el) return;
    const heldEntry = typeof currentHeldItem === 'function' ? currentHeldItem() : null;
    const heldItem = heldEntry?.item || null;
    const heldIsUtility = !!(heldItem && heldItem.type !== 'weapon' && !Array.isArray(heldItem.dmg));
    const w = currentWeapon();
    const displayItem = heldIsUtility ? heldItem : w;
    const heldMedical = !!(heldIsUtility && displayItem && (displayItem.heal || displayItem.doctor || displayItem.cureInfection));
    const heldApCost = heldMedical && typeof medicalItemApCost === 'function' ? medicalItemApCost(heldEntry?.id || displayItem.id) : 0;
    const modeInfo = heldIsUtility ? { id: 'held-item', label: 'ПРЕДМЕТ', apCost: heldApCost, damageMul: 1 } : ensureWeaponMode(w);
    const modes = heldIsUtility ? [] : getWeaponModes(w);
    const ammoName = !heldIsUtility && w.ammoType ? (ITEMS[w.ammoType]?.name || w.ammoType) : 'не нужны';
    const reserveAmmo = !heldIsUtility && w.ammoType ? (inventory.get(w.ammoType) || 0) : 0;
    const loadedAmmo = !heldIsUtility && w.ammoType ? Math.max(0, Number(w.loaded || 0)) : 0;
    const magSize = !heldIsUtility && w.ammoType ? Math.max(0, Number(w.magSize || 0)) : 0;
    const ammoMain = !heldIsUtility && w.ammoType ? String(loadedAmmo).padStart(3, '0') : '---';
    const magText = !heldIsUtility && w.ammoType ? `${loadedAmmo}/${magSize}` : '—';
    const reloadCost = !heldIsUtility && w.ammoType ? `${formatActionCost(reloadApCost(w))} ОД` : '—';
    const conditionValue = displayItem.id !== 'fists' && typeof displayItem.condition === 'number' ? Math.max(0, Math.min(100, Math.round(displayItem.condition))) : 100;
    const ammoDanger = !heldIsUtility && w.ammoType && loadedAmmo <= 0 ? ' is-empty' : '';
    const modeHint = heldIsUtility ? '✋ — использовать' : (modes.length > 1 ? 'X — сменить режим' : 'режим постоянный');
    const damageMin = Number(w.dmg?.[0] ?? 0);
    const damageMax = Number(w.dmg?.[1] ?? 0);
    const damageMul = Number(modeInfo.damageMul || 1);
    const damageText = heldIsUtility ? '—' : (damageMin || damageMax
      ? `${Math.max(1, Math.round(damageMin * damageMul))}-${Math.max(1, Math.round(damageMax * damageMul))}`
      : '—');
    const heldItemExtra = displayItem.type === 'tool'
      ? 'Используется для добычи рядом с ресурсом'
      : (displayItem.heal || displayItem.doctor || displayItem.cureInfection
        ? `Применяется на себя или рядом с игроком · ${formatActionCost(heldApCost)} ОД`
        : 'Предмет экипирован в руки');
    const modeExtra = heldIsUtility ? heldItemExtra : (modeInfo.id === 'auto'
      ? ''
      : (isEnergyWeapon(w) ? `Риск сбоя ${Math.round(energyFailureChance(w, modeInfo) * 100)}%` : `Урон ${damageText}`));
    const ledTotal = 15;
    const activeLedCount = Math.max(0, Math.min(ledTotal, Math.floor(Number.isFinite(player.ap) ? player.ap : Number(player.ap) || 0)));
    const leds = Array.from({ length: ledTotal }, (_, i) => `<span class="${i < activeLedCount ? 'on' : ''}" data-led="${i + 1}"></span>`).join('');
    const artId = String(displayItem.baseId || displayItem.id || 'fists').replace(/[^a-zA-Z0-9_-]/g, '');
    const apText = heldIsUtility ? (heldApCost > 0 ? `${formatActionCost(heldApCost)} ОД` : 'В РУКАХ') : `${formatActionCost(modeInfo.apCost)} ОД`;
    const hpNow = Math.max(0, Number(player.hp || 0));
    const hpMax = Math.max(1, Math.round(player.maxHp || 1));
    const hpRatio = Math.max(0, Math.min(1, hpNow / hpMax));
    const hpStateClass = hpRatio <= 0.25 ? 'hp-critical' : (hpRatio <= 0.55 ? 'hp-warning' : 'hp-healthy');
    const playerHpText = `${Math.ceil(hpNow)}/${hpMax}`;
    const playerApText = `${Math.floor(Math.max(0, Number(player.ap || 0)))}/${Math.max(1, Math.round(Number(player.maxAp || 0)))}`;
    const armorThreshold = typeof armorProfile === 'function' ? Math.round(Number(armorProfile('ballistic').threshold || 0)) : 0;
    const injuryLine = injuryText();
    const reserveText = !heldIsUtility && w.ammoType ? String(reserveAmmo) : '—';
    const ammoTypeText = !heldIsUtility && w.ammoType
      ? (String(ammoName).replace(/^Патроны\s*/i, '').replace(/^Патрон\s*/i, '').trim() || ammoName)
      : 'без патронов';
    const renderSignature = [
      artId, modeInfo.id, displayItem.name, loadedAmmo, magSize, reserveAmmo, conditionValue,
      activeLedCount, modeInfo.apCost, modeExtra, injuryLine, playerHpText, playerApText,
      armorThreshold, damageText, hpStateClass, ammoTypeText
    ].join('|');
    const layoutSignature = [
      artId, modeInfo.id, displayItem.name, magSize, ammoName, reloadCost, modeHint, modeExtra, injuryLine
    ].join('|');
    if (el.dataset.layoutSignature === layoutSignature) {
      if (el.dataset.renderSignature === renderSignature) return;
      el.dataset.renderSignature = renderSignature;
      const setText = (selector, value) => { const node = el.querySelector(selector); if (node) node.textContent = value; };
      setText('.weapon-ui-hp-value', playerHpText);
      const hpValueNode = el.querySelector('.weapon-ui-hp-value');
      if (hpValueNode) hpValueNode.className = `weapon-ui-value weapon-ui-hp-value ${hpStateClass}`;
      const hpBoxNode = el.querySelector('.weapon-ui-hp');
      if (hpBoxNode) hpBoxNode.dataset.hpState = hpStateClass;
      setText('.weapon-ui-ap-value', playerApText);
      setText('.weapon-ui-armor-value', String(armorThreshold));
      setText('.weapon-ui-damage-value', damageText);
      setText('.weapon-ui-mag-value', magText);
      setText('.weapon-ui-reserve-value', reserveText);
      setText('.weapon-ui-ammo-type-value', ammoTypeText);
      setText('.weapon-ui-action-label', modeInfo.label);
      setText('.weapon-ui-ap-cost', apText);
      setText('.weapon-ui-ammo-main', ammoMain);
      setText('.weapon-ui-weapon-name', displayItem.name);
      setText('.weapon-ui-mode-note b', modeHint);
      setText('.weapon-ui-mode-note span', modeExtra);
      const conditionNode = el.querySelector('.weapon-ui-condition-fill');
      if (conditionNode) conditionNode.style.width = `${conditionValue}%`;
      const ledNodes = el.querySelectorAll('.weapon-ui-leds span');
      ledNodes.forEach((node, i) => {
        node.className = `${i < activeLedCount ? 'on' : ''}`;
      });
      return;
    }
    el.dataset.layoutSignature = layoutSignature;
    el.dataset.renderSignature = renderSignature;
    el.classList.add('fallout-weapon-readout', 'weapon-ui-panel');
    el.dataset.weapon = artId;
    el.dataset.mode = modeInfo.id;
    el.innerHTML = `
      <div class="weapon-ui-leds" aria-hidden="true">${leds}</div>
      <div class="weapon-ui-box weapon-ui-hp" data-hp-state="${hpStateClass}">
        <div class="weapon-ui-label">ЗДОРОВЬЕ</div>
        <div class="weapon-ui-value weapon-ui-hp-value ${hpStateClass}">${escapeHtml(playerHpText)}</div>
      </div>
      <div class="weapon-ui-box weapon-ui-ap">
        <div class="weapon-ui-label">ОД</div>
        <div class="weapon-ui-value weapon-ui-ap-value">${escapeHtml(playerApText)}</div>
      </div>
      <div class="weapon-ui-box weapon-ui-armor">
        <div class="weapon-ui-label">БРОНЯ</div>
        <div class="weapon-ui-value weapon-ui-armor-value">${escapeHtml(String(armorThreshold))}</div>
      </div>

      <div class="weapon-ui-stage">
        <div class="weapon-ui-action-label">${escapeHtml(modeInfo.label)}</div>
        <div class="fallout-weapon-art item-art-host item-art-host-${artId}" aria-hidden="true">${typeof itemArtHtml === 'function' ? itemArtHtml(displayItem, { className: 'item-art-weapon' }) : ''}</div>
        <div class="weapon-ui-ap-cost">${escapeHtml(apText)}</div>
        <div class="weapon-ui-ammo-main">${escapeHtml(ammoMain)}</div>
        <div class="weapon-ui-weapon-name">${escapeHtml(displayItem.name)}</div>
        <div class="weapon-ui-condition"><span class="weapon-ui-condition-fill" style="width:${conditionValue}%"></span></div>
      </div>

      <div class="weapon-ui-box weapon-ui-damage">
        <div class="weapon-ui-label">УРОН</div>
        <div class="weapon-ui-value weapon-ui-damage-value">${escapeHtml(damageText)}</div>
      </div>
      <div class="weapon-ui-box weapon-ui-mag">
        <div class="weapon-ui-label">В МАГ.</div>
        <div class="weapon-ui-value weapon-ui-mag-value">${escapeHtml(magText)}</div>
      </div>
      <div class="weapon-ui-box weapon-ui-reserve">
        <div class="weapon-ui-label">ЗАПАС</div>
        <div class="weapon-ui-value weapon-ui-reserve-value">${escapeHtml(reserveText)}</div>
      </div>
      <div class="weapon-ui-box weapon-ui-ammo-type">
        <div class="weapon-ui-label">КАЛИБР</div>
        <div class="weapon-ui-value weapon-ui-ammo-type-value">${escapeHtml(ammoTypeText)}</div>
      </div>
      <div class="weapon-ui-mode-note"><b>${escapeHtml(modeHint)}</b><span>${escapeHtml(modeExtra)}</span></div>
    `;
  }

  function setDomTextIfChanged(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
  }

  function setDomWidthIfChanged(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const width = String(value);
    if (el.style.width !== width) el.style.width = width;
  }

  function renderUI(dt = 0, forceMinimap = false) {
    setDomWidthIfChanged('hp-fill', (player.hp / player.maxHp * 100) + '%');
    setDomTextIfChanged('hp-cur', Math.ceil(player.hp));
    setDomTextIfChanged('hp-max', player.maxHp);
    setDomWidthIfChanged('ap-fill', (player.ap / player.maxAp * 100) + '%');
    setDomTextIfChanged('ap-cur', String(Math.floor(Math.max(0, Number(player.ap || 0)))));
    setDomTextIfChanged('ap-max', player.maxAp);
    setDomWidthIfChanged('xp-fill', (player.xp / player.xpNeeded * 100) + '%');
    setDomTextIfChanged('xp-cur', player.xp);
    setDomTextIfChanged('xp-small', player.xp);
    setDomTextIfChanged('xp-needed', player.xpNeeded);
    setDomTextIfChanged('lvl-num', player.level);
    setDomTextIfChanged('perk-small', player.perkPoints);
    setDomTextIfChanged('skill-small', player.skillPoints);
    setDomTextIfChanged('map-title', currentLocation.name);
    updateCarryReadouts();
    renderWeaponReadout();
    renderInjuryStatusPanels();
    if (forceMinimap) maybeDrawHudMinimaps(dt, true);
  }

  // ===== LOOP =====
  let renderRecoveryWarned = false;
  let renderRetryFailedWarned = false;
  let renderUnexpectedWarned = false;

  function isRenderableThreeObject(obj) {
    return !!(obj && (obj.isMesh || obj.isLine || obj.isLineSegments || obj.isPoints || obj.isInstancedMesh));
  }

  function getGeometryAttributeCount(geom) {
    const pos = geom && geom.attributes && geom.attributes.position;
    if (!pos) return 0;
    if (Number.isFinite(pos.count) && pos.count > 0) return pos.count;
    if (pos.array && Number.isFinite(pos.itemSize) && pos.itemSize > 0) return Math.floor(pos.array.length / pos.itemSize);
    if (pos.data && pos.data.array && Number.isFinite(pos.itemSize) && pos.itemSize > 0) return Math.floor(pos.data.array.length / pos.data.stride);
    return 0;
  }

  function makeZeroBufferAttribute(count, itemSize, fill = 0) {
    const arr = new Float32Array(Math.max(0, count) * itemSize);
    if (fill !== 0) arr.fill(fill);
    return new THREE.BufferAttribute(arr, itemSize);
  }

  function materialListForRenderable(obj) {
    if (!obj || !obj.material) return [];
    return Array.isArray(obj.material) ? obj.material.filter(Boolean) : [obj.material];
  }

  function materialNeedsUv(material) {
    if (!material) return false;
    return !!(material.map || material.alphaMap || material.bumpMap || material.normalMap || material.displacementMap || material.roughnessMap || material.metalnessMap || material.specularMap || material.emissiveMap || material.lightMap || material.aoMap);
  }

  function materialNeedsNormal(material) {
    if (!material) return false;
    return !!(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.isMeshPhongMaterial || material.isMeshLambertMaterial || material.normalMap || material.bumpMap);
  }

  function normalizeRenderableGeometryAttributes(reason = 'render-exception') {
    if (!scene || !scene.traverse || !THREE || !THREE.BufferAttribute) return { fixed: 0, hidden: 0, scanned: 0 };
    let fixed = 0;
    let hidden = 0;
    let scanned = 0;
    const invalidNoPosition = [];

    scene.traverse(obj => {
      if (!obj || obj.visible === false || !isRenderableThreeObject(obj)) return;
      scanned++;
      const geom = obj.geometry;
      if (!geom || !geom.attributes) {
        invalidNoPosition.push(obj);
        return;
      }

      // Remove broken attribute keys instead of removing the whole world mesh.
      Object.keys(geom.attributes).forEach(key => {
        if (!geom.attributes[key]) {
          try { delete geom.attributes[key]; fixed++; } catch (_) {}
        }
      });

      const attrCount = getGeometryAttributeCount(geom);
      if (!attrCount) {
        invalidNoPosition.push(obj);
        return;
      }

      const mats = materialListForRenderable(obj);
      const needsUv = mats.some(materialNeedsUv);
      const needsAo = mats.some(mat => mat && mat.aoMap);
      const needsNormal = mats.some(materialNeedsNormal);
      const needsColor = mats.some(mat => mat && mat.vertexColors);

      if (needsUv && !geom.attributes.uv) {
        try {
          setGeometryAttributeCompat(geom, 'uv', makeZeroBufferAttribute(attrCount, 2, 0));
          fixed++;
        } catch (_) {}
      }
      if (needsAo && !geom.attributes.uv2) {
        try {
          if (geom.attributes.uv && geom.attributes.uv.array) {
            setGeometryAttributeCompat(geom, 'uv2', new THREE.BufferAttribute(new Float32Array(geom.attributes.uv.array), 2));
          } else {
            setGeometryAttributeCompat(geom, 'uv2', makeZeroBufferAttribute(attrCount, 2, 0));
          }
          fixed++;
        } catch (_) {}
      }
      if (needsNormal && !geom.attributes.normal && geom.computeVertexNormals) {
        try {
          geom.computeVertexNormals();
          fixed++;
        } catch (_) {
          try { setGeometryAttributeCompat(geom, 'normal', makeZeroBufferAttribute(attrCount, 3, 0)); fixed++; } catch (__) {}
        }
      }
      if (needsColor && !geom.attributes.color) {
        try { setGeometryAttributeCompat(geom, 'color', makeZeroBufferAttribute(attrCount, 3, 1)); fixed++; } catch (_) {}
      }
    });

    // Hide only a small number of truly empty renderable objects. If the count is
    // large, it is almost certainly a false-positive guard issue; do not erase the
    // settlement/terrain and turn the world into a grey plane again.
    if (invalidNoPosition.length > 0 && invalidNoPosition.length <= 24) {
      invalidNoPosition.forEach(obj => {
        obj.visible = false;
        obj.frustumCulled = true;
        obj.userData = obj.userData || {};
        obj.userData.disabledByRenderGuard = reason;
        hidden++;
      });
    }

    if ((fixed || hidden || invalidNoPosition.length) && !renderRecoveryWarned) {
      renderRecoveryWarned = true;
      console.warn(`[render] repaired geometry attributes after ${reason}: fixed=${fixed}, hidden=${hidden}, empty=${invalidNoPosition.length}, scanned=${scanned}.`);
    }
    return { fixed, hidden, empty: invalidNoPosition.length, scanned };
  }

  function isKnownThreeGeometryAttributeError(err) {
    const msg = String(err && (err.message || err));
    return msg.includes('isInterleavedBufferAttribute') || msg.includes('Cannot read properties of undefined') || msg.includes('BufferAttribute');
  }

  function safeRenderScene() {
    try {
      renderer.render(scene, camera);
    } catch (err) {
      if (isKnownThreeGeometryAttributeError(err)) {
        normalizeRenderableGeometryAttributes('render-exception');
        try {
          renderer.render(scene, camera);
          return;
        } catch (retryErr) {
          if (!renderRetryFailedWarned) {
            renderRetryFailedWarned = true;
            console.error('[render] retry failed after repairing geometry attributes; frame skipped:', retryErr);
          }
          return;
        }
      }
      if (!renderUnexpectedWarned) {
        renderUnexpectedWarned = true;
        console.error('[render] unexpected render error; frame skipped:', err);
      }
    }
  }

  let mobilePanelStateTimer = 0;
  const MAX_RENDER_FPS = 60;
  const MIN_RENDER_FRAME_MS = 1000 / MAX_RENDER_FPS;
  let nextRenderTs = 0;

  function loop(ts) {
    requestAnimationFrame(loop);

    // v7.19: лимит 100 FPS. Накопительный таймер не просаживает 120 Гц экраны до 60 FPS.
    if (!nextRenderTs) nextRenderTs = ts;
    if (ts + 0.25 < nextRenderTs) return;
    nextRenderTs += MIN_RENDER_FRAME_MS;
    if (ts - nextRenderTs > MIN_RENDER_FRAME_MS * 4) nextRenderTs = ts + MIN_RENDER_FRAME_MS;

    const dt = Math.min(0.05, (ts - lastTime) / 1000 || 0);
    lastTime = ts;

    updateFpsCounter(dt);
    if (typeof updateAdaptiveRenderScale === 'function') updateAdaptiveRenderScale(dt);
    applyDayNightLighting(false);
    mobilePanelStateTimer -= dt;
    if (mobilePanelStateTimer <= 0 && typeof updateMobilePanelState === 'function') {
      mobilePanelStateTimer = IS_MOBILE_DEVICE ? 0.22 : 0.30;
      updateMobilePanelState();
    }
    update(dt);
    maybeAutoOpenGlobalMapForPerfTest();
    maybeDrawHudMinimaps(dt);
    const globalMapModeActive = document.body.classList.contains('global-map-mode') || !!globalMapState?.onWorldMap;
    if (!globalMapModeActive) {
      if (typeof updateAdaptiveShadowBudget === 'function') updateAdaptiveShadowBudget(dt, false);
      safeRenderScene();
    }
  }

  document.getElementById('loot-close').addEventListener('click', closeLootWindow);
  document.getElementById('loot-all').addEventListener('click', takeAllLoot);
  document.getElementById('trader-close').addEventListener('click', closeTraderWindow);
  document.getElementById('storage-close').addEventListener('click', closeStorageWindow);
  document.getElementById('storage-put-all')?.addEventListener('click', putAllToStorage);
  document.getElementById('storage-take-all')?.addEventListener('click', takeAllFromStorage);
  document.getElementById('char-start-btn').addEventListener('click', startCharacterCreationSafe);
  document.getElementById('char-auth-btn').addEventListener('click', requestYandexAuth);
  document.getElementById('server-login-btn').addEventListener('click', handleServerAuth);
  document.getElementById('server-login-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handleServerAuth();
  });
  document.getElementById('open-register-btn').addEventListener('click', () => { setAuthStep('register'); setServerRegisterStatus('После регистрации откроется выбор персонажа.'); });
  document.getElementById('back-login-btn').addEventListener('click', () => { setAuthStep('login'); setServerAuthStatus('Введите логин и пароль для входа.'); });
  document.getElementById('open-password-reset-btn').addEventListener('click', () => { setAuthStep('password-reset'); setPasswordResetStatus('password-reset-status', 'Введите email, указанный при регистрации.'); });
  document.getElementById('password-reset-back-btn').addEventListener('click', () => { setAuthStep('login'); setServerAuthStatus('Введите логин и пароль для входа.'); });
  document.getElementById('password-reset-send-btn').addEventListener('click', handlePasswordResetRequest);
  document.getElementById('password-reset-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handlePasswordResetRequest();
  });
  document.getElementById('password-reset-confirm-btn').addEventListener('click', handlePasswordResetConfirm);
  document.getElementById('password-reset-confirm-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handlePasswordResetConfirm();
  });
  document.getElementById('server-register-btn').addEventListener('click', handleServerRegistration);
  document.getElementById('server-register-form')?.addEventListener('submit', e => {
    e.preventDefault();
    handleServerRegistration();
  });
  document.getElementById('create-new-character-btn').addEventListener('click', startNewCharacterCreation);
  document.getElementById('back-character-select-btn').addEventListener('click', () => showCharacterSelect('Создание отменено. Выберите персонажа или создайте нового.'));
  document.getElementById('server-logout-btn').addEventListener('click', serverLogout);
  document.getElementById('server-password-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleServerAuth();
  });
  document.getElementById('register-password2-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleServerRegistration();
  });
  document.getElementById('char-name-input').addEventListener('input', renderCharacterCreator);
  window.addEventListener('beforeunload', () => { try { saveGame(true); } catch (_) {} });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      try { ysdk?.features?.GameplayAPI?.stop(); gameplayMarked = false; } catch (_) {}
      saveGame(true);
    } else if (gameStarted && ysdk && !gameplayMarked) {
      try { ysdk.features?.GameplayAPI?.start(); gameplayMarked = true; } catch (_) {}
    }
  });

  if (!openPasswordResetFromUrl()) setAuthStep('login');
  renderCharacterCreator();
  renderInventory();
  renderQuickbar();
  updateCamera(1);
  addLog('Добро пожаловать в Realm of Ashes v7.76.4.', null, 'system');
  addLog('Войдите или зарегистрируйтесь на сервере: персонаж, карта, локации, инвентарь и хранилище привязаны к логину.', null, 'system');
  addLog('Стартовая локация: Поселение. Рядом есть торговец и выход в Пепельный лес.', null, 'system');
  addLog('TAB — Пип-бой/статус, I — инвентарь, B — навыки/перки, P — крафт, X — режим стрельбы, C — присесть/встать, M — карта, F — обыск тела, G/E — поднять предмет с земли, E — торговля/переход, Space — забрать весь лут, F1 — подсказки.', null, 'system');
  addLog('Быстрые слоты: перетащите предмет из инвентаря, перенесите между кнопками или вытащите за границы кнопки, чтобы очистить.', null, 'system');
  initQuantityPanel();
  const worldDataReady = loadWorldDataConfig();
  initGlobalMapControls();
  initMobileControls();
  worldDataReady.finally(() => {
    buildWorld();
    return bootstrapProfile();
  });
  setTimeout(resize, 80);
  setTimeout(resize, 350);
  requestAnimationFrame(loop);

  initGraphicsWindowControls();
  applyGraphicsQuality(graphicsQuality, { silent: true });
  setVisibilityFogVisualEnabled(visibilityGridEnabled);
})();
