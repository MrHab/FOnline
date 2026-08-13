  // ===== UPDATE =====
  let lastTime = 0;
  let spawnTimer = 0;

  function updateTouchFire(dt) {
    if (hudEditMode) { touchFireHeld = false; touchAimFireHeld = false; setTouchButtonActive('touch-fire', false); return; }
    if (!(touchFireHeld || touchAimFireHeld) || !gameStarted || paused || anyWindowOpen() || activeLootEnemy || activeWorldContainer || traderWindowOpen || storageWindowOpen) return;
    touchFireTimer -= dt;
    if (touchFireTimer > 0) return;
    const w = currentWeapon();
    const autoDelay = w && w.automatic && getWeaponModeInfo(w).id === 'auto' ? Math.max(0.35, (w.fireRate || 0.7) * 0.75) : 0.24;
    touchFireTimer = autoDelay;
    if (player.fireCooldown <= 0 && player.reloadTimer <= 0) shootFromCurrentAim();
  }


  let hudRenderTimer = 0;
  function maybeRenderUI(dt, force = false) {
    // v7.63: DOM + minimap drawing every render frame was the main cause of
    // movement stutter. WebGL can render at up to 100 FPS, while HUD/minimap
    // updates are paced separately. Event handlers may still call renderUI()
    // directly when an immediate UI refresh is needed.
    hudRenderTimer -= Math.max(0, Number(dt || 0));
    if (!force && hudRenderTimer > 0) return;
    const globalMapModeActive = document.body.classList.contains('global-map-mode') || !!globalMapState?.onWorldMap;
    if (globalMapModeActive && !force) {
      hudRenderTimer = 0.40;
      return;
    }
    const interval = anyWindowOpen() || traderWindowOpen || storageWindowOpen || activeLootEnemy || activeWorldContainer
      ? 0.10
      : (IS_MOBILE_DEVICE ? 0.24 : 0.14);
    hudRenderTimer = interval;
    renderUI(dt, force);
  }

  function perceptionVisionSettings() {
    const per = Math.max(1, Math.min(15, Number(statValue('per') || 5)));
    // Чем выше Восприятие, тем больше чистая зона в центре и мягче затемнение краёв.
    const clear = Math.max(34, Math.min(70, 34 + per * 2.35));
    const soft = Math.max(clear + 13, Math.min(94, clear + 22));
    const edgeOpacity = Math.max(0.46, Math.min(0.78, 0.80 - per * 0.018));
    const midOpacity = Math.max(0.18, Math.min(0.46, edgeOpacity - 0.25));
    return { clear, soft, edgeOpacity, midOpacity };
  }

  function updateVisionShade() {
    if (!visionShade) return;
    // v7.5: убираем экранную виньетку. Видимость определяется реальными объектами,
    // которые перекрывают обзор, а не затемнением краёв экрана.
    visionShade.style.opacity = '0';
  }

  let visibilityRefreshTimer = 0;
  let visibilitySafetyRefreshTimer = 0;
  let entityVisibilityRefreshTimer = 0;
  let lastRtsFogStateKey = '';
  let lastRtsFogHardStateKey = '';
  let rtsFogObserverEpoch = 0;
  // v7.74.92: rtsFog/rtsFogVisibilityVersion are declared during bootstrap so
  // createTraderRoofAlphaMask()/isPointVisibleForGameplay() can be called while
  // the client chunks are still initializing. Here we only validate/reuse the
  // same shared state instead of redeclaring it with const/let and creating a
  // temporal-dead-zone crash.
  if (!rtsFog || !rtsFog.visibleTiles || !rtsFog.exploredTiles) {
    rtsFog = {
      visibleTiles: new Set(),
      exploredTiles: new Set(),
      radius: 0,
      visibleSignature: ''
    };
  }
  if (typeof rtsFogVisibilityVersion !== 'number') rtsFogVisibilityVersion = 0;
  // v7.74.69: fog visibility is tile-based. Dynamic entities can reuse the
  // previous result while they stay in the same tile and the fog field was not
  // rebuilt. This avoids repeated LOS checks for every mob/player/item.

  function tileKey(tx, tz) {
    return `${tx},${tz}`;
  }

  function resetRtsFogRuntimeCaches(reason = '') {
    if (!rtsFog || !rtsFog.visibleTiles || !rtsFog.exploredTiles) return;
    rtsFog.visibleTiles.clear();
    rtsFog.exploredTiles.clear();
    rtsFog.visibleSignature = '';
    rtsFog.radius = 0;
    rtsFogVisibilityVersion++;
    lastRtsFogStateKey = '';
    lastRtsFogHardStateKey = '';
    rtsFogObserverEpoch++;
    visibilityRefreshTimer = 0;
    visibilitySafetyRefreshTimer = 0;
    entityVisibilityRefreshTimer = 0;
    if (typeof invalidateStaticRenderCulling === 'function') invalidateStaticRenderCulling(`fog-reset:${reason || 'world'}`);
  }

  function isVisionBlockingTileForObserver(tx, tz, observerCrouching = false) {
    if (isFullVisionBlockingTile(tx, tz)) return true;
    return !!observerCrouching && isLowVisionCoverTile(tx, tz);
  }

  function isVisionBlockingTile(tx, tz) {
    return isVisionBlockingTileForObserver(tx, tz, !!player?.crouching);
  }

  function lineTilesBetween(startTx, startTz, endTx, endTz) {
    const tiles = [];
    let x0 = startTx;
    let z0 = startTz;
    const x1 = endTx;
    const z1 = endTz;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    while (true) {
      if (x0 === x1 && z0 === z1) return tiles;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
      if (!inBounds(x0, z0)) return tiles;
      tiles.push({ tx: x0, tz: z0 });
    }
  }

  function visibilityTileWorldPoint(tx, tz, startTx, startTz) {
    const center = tileToWorld(tx, tz);
    if (!player || !Number.isFinite(Number(player.x)) || !Number.isFinite(Number(player.z))) return center;
    const playerTile = worldToTile(Number(player.x), Number(player.z));
    if (playerTile.tx !== startTx || playerTile.tz !== startTz) return center;
    const startCenter = tileToWorld(startTx, startTz);
    const maxOffset = TILE * 0.48;
    const offsetX = Math.max(-maxOffset, Math.min(maxOffset, Number(player.x) - startCenter.x));
    const offsetZ = Math.max(-maxOffset, Math.min(maxOffset, Number(player.z) - startCenter.z));
    return { x: center.x + offsetX, z: center.z + offsetZ };
  }

  function isCrouchedTargetHiddenByLowCover(startTx, startTz, targetTx, targetTz, options = {}) {
    if (startTx === targetTx && startTz === targetTz) return false;
    if (typeof isAuthoredExactLowCoverHidingCrouchedTargetWorldLine === 'function') {
      const startWorld = visibilityTileWorldPoint(startTx, startTz, startTx, startTz);
      const targetWorld = {
        x: Number.isFinite(Number(options.targetWorldX))
          ? Number(options.targetWorldX)
          : visibilityTileWorldPoint(targetTx, targetTz, startTx, startTz).x,
        z: Number.isFinite(Number(options.targetWorldZ))
          ? Number(options.targetWorldZ)
          : visibilityTileWorldPoint(targetTx, targetTz, startTx, startTz).z
      };
      if (isAuthoredExactLowCoverHidingCrouchedTargetWorldLine(
        startWorld.x,
        startWorld.z,
        targetWorld.x,
        targetWorld.z,
        true
      )) return true;
    }
    const line = lineTilesBetween(startTx, startTz, targetTx, targetTz);
    // Низкое укрытие не скрывает карту и не режет обзор. Оно скрывает только
    // присевшего персонажа, если этот персонаж находится в первой клетке сразу
    // за укрытием относительно наблюдателя.
    for (let i = 0; i < line.length; i++) {
      const tile = line[i];
      if (tile.tx === targetTx && tile.tz === targetTz) return false;
      if (!isLowVisionCoverTile(tile.tx, tile.tz)) continue;
      const next = line[i + 1];
      if (next && next.tx === targetTx && next.tz === targetTz) return true;
    }
    return false;
  }


  function segmentIntersectsAabb2D(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    let tMin = 0;
    let tMax = 1;
    if (Math.abs(dx) < 0.00001) {
      if (x1 < minX || x1 > maxX) return false;
    } else {
      const inv = 1 / dx;
      let t1 = (minX - x1) * inv;
      let t2 = (maxX - x1) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
    if (Math.abs(dz) < 0.00001) {
      if (z1 < minZ || z1 > maxZ) return false;
    } else {
      const inv = 1 / dz;
      let t1 = (minZ - z1) * inv;
      let t2 = (maxZ - z1) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
    return tMax >= 0 && tMin <= 1;
  }

  function currentLocationUsesAuthoredVisionLayout() {
    return typeof locationUsesAuthoredLayout === 'function' && locationUsesAuthoredLayout(currentLocation);
  }

  function traderBuildingAuthoredVisionWalls() {
    if (typeof traderBuildingWallBlocks === 'undefined' || !Array.isArray(traderBuildingWallBlocks)) return [];
    const firstKind = String(traderBuildingWallBlocks[0]?.userData?.kind || '');
    const lastKind = String(traderBuildingWallBlocks[traderBuildingWallBlocks.length - 1]?.userData?.kind || '');
    const signature = `${currentLocation?.id || ''}|${traderBuildingWallBlocks.length}|${firstKind}|${lastKind}`;
    const cached = traderBuildingAuthoredVisionWalls._cache;
    if (cached && cached.signature === signature) return cached.walls;
    const walls = traderBuildingWallBlocks
      .filter(block => block && block.userData?.traderWallBlock && !block.userData?.traderWindowWallBlock)
      .map((block, i) => {
        const ud = block.userData || {};
        const cx = Number.isFinite(Number(ud.traderWallWorldX)) ? Number(ud.traderWallWorldX) : Number(block.position?.x || 0);
        const cz = Number.isFinite(Number(ud.traderWallWorldZ)) ? Number(ud.traderWallWorldZ) : Number(block.position?.z || 0);
        const width = Math.max(0.1, Number(ud.traderWallSizeX || TILE || 2.0));
        const depth = Math.max(0.1, Number(ud.traderWallSizeZ || TILE || 2.0));
        return {
          id: ud.kind || `authored-wall-${i}`,
          minX: cx - width / 2,
          maxX: cx + width / 2,
          minZ: cz - depth / 2,
          maxZ: cz + depth / 2
        };
      })
      .filter(w => Number.isFinite(w.minX) && Number.isFinite(w.maxX) && Number.isFinite(w.minZ) && Number.isFinite(w.maxZ));
    attachTraderVisionWallSpatialIndex(walls);
    traderBuildingAuthoredVisionWalls._cache = { signature, walls };
    return walls;
  }

  function attachTraderVisionWallSpatialIndex(walls) {
    if (!walls || !walls.length) return walls;
    const cellSize = Math.max(0.5, Number(TILE || 2.0));
    const grid = new Map();
    const add = (gx, gz, wall) => {
      const key = `${gx}:${gz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(wall);
    };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    walls.forEach(w => {
      minX = Math.min(minX, w.minX);
      maxX = Math.max(maxX, w.maxX);
      minZ = Math.min(minZ, w.minZ);
      maxZ = Math.max(maxZ, w.maxZ);
      const minGX = Math.floor(w.minX / cellSize) - 1;
      const maxGX = Math.floor(w.maxX / cellSize) + 1;
      const minGZ = Math.floor(w.minZ / cellSize) - 1;
      const maxGZ = Math.floor(w.maxZ / cellSize) + 1;
      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gz = minGZ; gz <= maxGZ; gz++) add(gx, gz, w);
      }
    });
    walls._spatial = { grid, cellSize, minX, maxX, minZ, maxZ };
    return walls;
  }

  function traderVisionWallCandidatesForSegment(walls, x1, z1, x2, z2) {
    const spatial = walls?._spatial;
    if (!walls || !walls.length || !spatial?.grid) return walls || [];
    const pad = Math.max(2.0, Number(spatial.cellSize || TILE || 2.0) * 2.0);
    const segMinX = Math.min(Number(x1 || 0), Number(x2 || 0));
    const segMaxX = Math.max(Number(x1 || 0), Number(x2 || 0));
    const segMinZ = Math.min(Number(z1 || 0), Number(z2 || 0));
    const segMaxZ = Math.max(Number(z1 || 0), Number(z2 || 0));
    if (segMaxX < spatial.minX - pad || segMinX > spatial.maxX + pad ||
        segMaxZ < spatial.minZ - pad || segMinZ > spatial.maxZ + pad) return [];
    const cellSize = Math.max(0.5, Number(spatial.cellSize || TILE || 2.0));
    const dx = Number(x2 || 0) - Number(x1 || 0);
    const dz = Number(z2 || 0) - Number(z1 || 0);
    const steps = Math.max(1, Math.min(96, Math.ceil(Math.hypot(dx, dz) / Math.max(0.75, cellSize * 0.70))));
    const seen = new Set();
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Number(x1 || 0) + dx * t;
      const z = Number(z1 || 0) + dz * t;
      if (x < spatial.minX - pad || x > spatial.maxX + pad || z < spatial.minZ - pad || z > spatial.maxZ + pad) continue;
      const gx = Math.floor(x / cellSize);
      const gz = Math.floor(z / cellSize);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = spatial.grid.get(`${gx + ox}:${gz + oz}`);
          if (!bucket) continue;
          bucket.forEach(wall => {
            if (!wall || seen.has(wall)) return;
            seen.add(wall);
            out.push(wall);
          });
        }
      }
    }
    return out.length ? out : walls;
  }

  function traderBuildingVisionWalls() {
    if (typeof isTraderYardLocation !== 'function' || !isTraderYardLocation()) return null;
    if (currentLocationUsesAuthoredVisionLayout()) return traderBuildingAuthoredVisionWalls();
    const c = typeof traderBuildingCenterWorld === 'function' ? traderBuildingCenterWorld() : tileToWorld(15, 20);
    const tile = Number(TILE || 2.0);
    const block = tile; // Rule: wall footprint block = 2 x 2 meters, height rows stay 1 meter.
    const halfW = tile * 5;
    const halfD = tile * 4;
    const frontWallZ = halfD - block / 2;
    const sideWallX = halfW - block / 2;
    const walls = [];
    const add = (id, cx, cz, width = block, depth = block) => walls.push({
      id,
      minX: cx - width / 2,
      maxX: cx + width / 2,
      minZ: cz - depth / 2,
      maxZ: cz + depth / 2
    });
    const isDoorX = (lx) => Math.abs(lx) < block;
    const isFrontWindowX = (lx) => Math.abs(lx + 7.0) <= block * 0.55 || Math.abs(lx - 7.0) <= block * 0.55;
    const isBackWindowX = (lx) => Math.abs(lx + 5.0) <= block * 0.55 || Math.abs(lx - 5.0) <= block * 0.55;
    const isSideWindowZ = (lz) => Math.abs(lz + 3.0) <= block * 0.55 || Math.abs(lz - 3.0) <= block * 0.55;

    // v7.75.30: wall blockers match the 2 x 2 meter visual/collision blocks.
    // Door and window openings are excluded from full LOS blocking.
    const frontBackCount = Math.round((halfW * 2) / block);
    for (let i = 0; i < frontBackCount; i++) {
      const lx = -halfW + block / 2 + i * block;
      if (!isDoorX(lx) && !isFrontWindowX(lx)) add(`front-${i}`, c.x + lx, c.z - frontWallZ);
      if (!isBackWindowX(lx)) add(`back-${i}`, c.x + lx, c.z + frontWallZ);
    }
    const sideCount = Math.round((halfD * 2) / block);
    for (let i = 1; i < sideCount - 1; i++) {
      const lz = -halfD + block / 2 + i * block;
      if (!isSideWindowZ(lz)) add(`left-${i}`, c.x - sideWallX, c.z + lz);
      if (!isSideWindowZ(lz)) add(`right-${i}`, c.x + sideWallX, c.z + lz);
    }
    return walls;
  }

  function isTraderBuildingWallBlockingWorldLine(x1, z1, x2, z2) {
    const walls = traderBuildingVisionWalls();
    if (!walls) return false;
    const candidates = traderVisionWallCandidatesForSegment(walls, x1, z1, x2, z2);
    for (const w of candidates) {
      if (segmentIntersectsAabb2D(x1, z1, x2, z2, w.minX, w.maxX, w.minZ, w.maxZ)) return true;
    }
    return false;
  }

  function isTraderBuildingWallBlockingTileLine(startTx, startTz, endTx, endTz) {
    if (startTx === endTx && startTz === endTz) return false;
    const a = tileToWorld(startTx, startTz);
    const b = tileToWorld(endTx, endTz);
    return isTraderBuildingWallBlockingWorldLine(a.x, a.z, b.x, b.z);
  }

  function segmentAabbFirstHitT(x1, z1, x2, z2, minX, maxX, minZ, maxZ) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    let tMin = 0;
    let tMax = 1;
    if (Math.abs(dx) < 0.00001) {
      if (x1 < minX || x1 > maxX) return null;
    } else {
      const inv = 1 / dx;
      let t1 = (minX - x1) * inv;
      let t2 = (maxX - x1) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
    if (Math.abs(dz) < 0.00001) {
      if (z1 < minZ || z1 > maxZ) return null;
    } else {
      const inv = 1 / dz;
      let t1 = (minZ - z1) * inv;
      let t2 = (maxZ - z1) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
    if (tMax < 0 || tMin > 1) return null;
    return Math.max(0, tMin);
  }

  function traderBuildingLowCoverVolumes() {
    if (typeof isTraderYardLocation !== 'function' || !isTraderYardLocation()) return [];
    const authoredVisionLayout = currentLocationUsesAuthoredVisionLayout();
    const wallBlocks = typeof traderBuildingWallBlocks !== 'undefined' && Array.isArray(traderBuildingWallBlocks) ? traderBuildingWallBlocks : [];
    const interiorObjects = typeof traderBuildingInteriorObjects !== 'undefined' && Array.isArray(traderBuildingInteriorObjects) ? traderBuildingInteriorObjects : [];
    const wallCount = wallBlocks.length;
    const interiorCount = interiorObjects.length;
    const firstWall = String(wallBlocks[0]?.userData?.kind || '');
    const lastWall = String(wallBlocks[wallCount - 1]?.userData?.kind || '');
    const signature = `${currentLocation?.id || ''}|${authoredVisionLayout ? 1 : 0}|${wallCount}|${interiorCount}|${firstWall}|${lastWall}`;
    const cached = traderBuildingLowCoverVolumes._cache;
    if (cached && cached.signature === signature) return cached.volumes;
    const volumes = [];
    const push = (id, minX, maxX, minZ, maxZ, height = 1.24) => volumes.push({ id, minX, maxX, minZ, maxZ, height });
    const wallDepth = 0.26;
    // Windows act like low cover, similar to rocks/ore: they should not fully
    // seal visibility like a wall, but crouched vision/shooting should be blocked.
    if (!authoredVisionLayout && typeof traderVisionPortalDefinitions === 'function' && typeof traderBuildingLocalToWorld === 'function') {
      (traderVisionPortalDefinitions() || []).forEach(portal => {
        if (!portal || !String(portal.kind || '').includes('window')) return;
        if (portal.wall === 'front' || portal.wall === 'back') {
          const a = traderBuildingLocalToWorld(portal.min, portal.z);
          const b = traderBuildingLocalToWorld(portal.max, portal.z);
          push(`low-cover-${portal.kind}`, Math.min(a.x, b.x), Math.max(a.x, b.x), a.z - wallDepth * 0.5, a.z + wallDepth * 0.5, 1.24);
        } else if (portal.wall === 'left' || portal.wall === 'right') {
          const a = traderBuildingLocalToWorld(portal.x, portal.min);
          const b = traderBuildingLocalToWorld(portal.x, portal.max);
          push(`low-cover-${portal.kind}`, a.x - wallDepth * 0.5, a.x + wallDepth * 0.5, Math.min(a.z, b.z), Math.max(a.z, b.z), 1.24);
        }
      });
    }
    if (authoredVisionLayout && wallBlocks.length) {
      wallBlocks.forEach((block, i) => {
        if (!block?.userData?.traderWindowWallBlock) return;
        const ud = block.userData || {};
        const cx = Number.isFinite(Number(ud.traderWallWorldX)) ? Number(ud.traderWallWorldX) : Number(block.position?.x || 0);
        const cz = Number.isFinite(Number(ud.traderWallWorldZ)) ? Number(ud.traderWallWorldZ) : Number(block.position?.z || 0);
        const width = Math.max(0.1, Number(ud.traderWallSizeX || TILE || 2.0));
        const depth = Math.max(0.1, Number(ud.traderWallSizeZ || TILE || 2.0));
        const height = Math.max(0.1, Number(ud.traderWallSizeY || 1.24));
        push(ud.kind || `low-cover-authored-window-${i}`, cx - width / 2, cx + width / 2, cz - depth / 2, cz + depth / 2, height);
      });
    }
    // Only low-height interior props behave as cover. Tall shelves/cabinets keep
    // their own silhouette and are not remapped into low cover.
    if (interiorObjects.length && typeof buildTraderObjectBox === 'function') {
      interiorObjects.forEach(obj => {
        if (!obj || obj.userData?.traderNpc) return;
        const kind = String(obj.userData?.kind || '');
        if (/floor|shelf|lamp/i.test(kind)) return;
        const box = buildTraderObjectBox(obj);
        if (!box || !Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;
        const height = Number(box.max.y || 0);
        if (height > 1.45) return;
        push(`low-cover-${kind || 'interior'}`, box.min.x, box.max.x, box.min.z, box.max.z, height);
      });
    }
    traderBuildingLowCoverVolumes._cache = { signature, volumes };
    return volumes;
  }

  function traderBuildingLowCoverHitDistanceOnWorldSegment(x1, z1, x2, z2, observerCrouching = false) {
    if (!observerCrouching) return null;
    const volumes = traderBuildingLowCoverVolumes();
    if (!volumes || !volumes.length) return null;
    const segLen = Math.hypot(x2 - x1, z2 - z1);
    if (segLen <= 0.0001) return null;
    let best = null;
    for (const v of volumes) {
      const t = segmentAabbFirstHitT(x1, z1, x2, z2, v.minX, v.maxX, v.minZ, v.maxZ);
      if (t === null) continue;
      const dist = t * segLen;
      if (best === null || dist < best) best = dist;
    }
    return best;
  }

  function isTraderBuildingLowCoverBlockingWorldLine(x1, z1, x2, z2, observerCrouching = false) {
    return traderBuildingLowCoverHitDistanceOnWorldSegment(x1, z1, x2, z2, observerCrouching) !== null;
  }

  function isTraderBuildingLowCoverBlockingTileLine(startTx, startTz, endTx, endTz, observerCrouching = false) {
    if (!observerCrouching || (startTx === endTx && startTz === endTz)) return false;
    const a = tileToWorld(startTx, startTz);
    const b = tileToWorld(endTx, endTz);
    return isTraderBuildingLowCoverBlockingWorldLine(a.x, a.z, b.x, b.z, observerCrouching);
  }

  function perceptionTileVisionRadius() {
    const per = Math.max(1, Math.min(15, Number(statValue('per') || 5)));
    let radius = 5.5 + per * 0.7 + talentLevel('vigilance');
    // Времени суток нет, поэтому ночного штрафа к обзору тоже нет.
    if (player?.crouching) radius -= 1;
    if (hasInjury('concussion')) radius -= 2;
    if (hasInjury('infection')) radius -= 0.5;
    // Обзор вдвое меньше прежнего: камера подведена к модели в два раза
    // ближе, и прежний радиус открывал карту далеко за краем экрана.
    // Границы тоже уполовинены, иначе нижний порог не дал бы радиусу упасть.
    return Math.max(3, Math.min(9, Math.round(radius / 2)));
  }

  function hasStrictTileLineOfSight(startTx, startTz, endTx, endTz, options = {}) {
    if (isTraderBuildingWallBlockingTileLine(startTx, startTz, endTx, endTz)) return false;
    if (isTraderBuildingLowCoverBlockingTileLine(startTx, startTz, endTx, endTz, !!player?.crouching)) return false;
    if (typeof isAuthoredExactVisionBlockingWorldLine === 'function') {
      const startWorld = visibilityTileWorldPoint(startTx, startTz, startTx, startTz);
      const defaultEndWorld = visibilityTileWorldPoint(endTx, endTz, startTx, startTz);
      const endWorld = {
        x: Number.isFinite(Number(options.targetWorldX)) ? Number(options.targetWorldX) : defaultEndWorld.x,
        z: Number.isFinite(Number(options.targetWorldZ)) ? Number(options.targetWorldZ) : defaultEndWorld.z
      };
      if (isAuthoredExactVisionBlockingWorldLine(startWorld.x, startWorld.z, endWorld.x, endWorld.z, !!player?.crouching)) return false;
    }
    let x0 = startTx;
    let z0 = startTz;
    const x1 = endTx;
    const z1 = endTz;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    while (true) {
      if (!inBounds(x0, z0)) return false;
      if (x0 === x1 && z0 === z1) return true;

      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }

      // Проверяем уже следующий тайл. Если это тайл цели, он может быть видимым.
      // Если препятствие стоит ДО цели — обзор закрыт.
      if (!inBounds(x0, z0)) return false;
      if (x0 === x1 && z0 === z1) return true;
      if (isVisionBlockingTile(x0, z0)) return false;
    }
  }

  function markVisibilityRay(startTx, startTz, endTx, endTz) {
    if (isTraderBuildingWallBlockingTileLine(startTx, startTz, endTx, endTz)) return;
    if (isTraderBuildingLowCoverBlockingTileLine(startTx, startTz, endTx, endTz, !!player?.crouching)) return;
    let x0 = startTx;
    let z0 = startTz;
    const x1 = endTx;
    const z1 = endTz;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    while (true) {
      if (!inBounds(x0, z0)) return;
      const key = tileKey(x0, z0);
      rtsFog.visibleTiles.add(key);
      rtsFog.exploredTiles.add(key);

      if (x0 === x1 && z0 === z1) return;
      if (!(x0 === startTx && z0 === startTz) && isVisionBlockingTile(x0, z0)) return;

      const previousTx = x0;
      const previousTz = z0;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
      if (typeof isAuthoredExactVisionBlockingWorldLine === 'function') {
        // Preserve the player's sub-tile offset along the whole ray. Thin GLB
        // doorways can be genuinely open even when a tile-center ray clips a
        // jamb; snapping fog rays to centers would seal those entrances.
        const previousWorld = visibilityTileWorldPoint(previousTx, previousTz, startTx, startTz);
        const nextWorld = visibilityTileWorldPoint(x0, z0, startTx, startTz);
        if (isAuthoredExactVisionBlockingWorldLine(
          previousWorld.x,
          previousWorld.z,
          nextWorld.x,
          nextWorld.z,
          !!player?.crouching
        )) {
          if (inBounds(x0, z0)) {
            const wallTileKey = tileKey(x0, z0);
            rtsFog.visibleTiles.add(wallTileKey);
            rtsFog.exploredTiles.add(wallTileKey);
          }
          return;
        }
      }
    }
  }

  function rebuildRtsFogOfWar() {
    if (!map || !player) return;
    const previousVisibleSignature = rtsFog.visibleSignature || '';
    const pt = worldToTile(player.x, player.z);
    const startTx = Math.max(0, Math.min(MAP_W - 1, pt.tx));
    const startTz = Math.max(0, Math.min(MAP_H - 1, pt.tz));
    const radius = perceptionTileVisionRadius();
    rtsFog.radius = radius;
    rtsFog.visibleTiles.clear();

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const tx = startTx + dx;
        const tz = startTz + dz;
        if (!inBounds(tx, tz)) continue;
        if (dx * dx + dz * dz > radius * radius) continue;
        markVisibilityRay(startTx, startTz, tx, tz);
      }
    }
    const nextVisibleSignature = Array.from(rtsFog.visibleTiles).sort().join('|');
    const changed = nextVisibleSignature !== previousVisibleSignature;
    rtsFog.visibleSignature = nextVisibleSignature;
    if (changed) {
      rtsFogVisibilityVersion++;
      updateVisibilityGridVisual();
      applyStaticRenderCulling();
    }
  }

  function ensureVisibilityShadeMeshes() {
    if (visibilityFogMesh && visibilitySeenMesh && visibilityBlockMesh) return true;
    // TILE уже объявлен к моменту первого вызова updateVisibilityGridVisual().
    if (typeof TILE === 'undefined') return false;
    visibilityShadeGeometry = new THREE.PlaneGeometry(TILE * 0.985, TILE * 0.985);
    visibilityFogMesh = new THREE.InstancedMesh(visibilityShadeGeometry, visibilityFogTileMaterial, visibilityShadeCapacity);
    visibilitySeenMesh = new THREE.InstancedMesh(visibilityShadeGeometry, visibilitySeenTileMaterial, visibilityShadeCapacity);
    visibilityBlockMesh = new THREE.InstancedMesh(visibilityShadeGeometry, visibilityBlockTileMaterial, visibilityShadeCapacity);
    [visibilityFogMesh, visibilitySeenMesh, visibilityBlockMesh].forEach(mesh => {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      visibilityGridGroup.add(mesh);
    });
    return true;
  }

  function clearVisibilityGrid() {
    if (!ensureVisibilityShadeMeshes()) return;
    if (visibilityFogMesh) { visibilityFogMesh.count = 0; visibilityFogMesh.instanceMatrix.needsUpdate = true; }
    if (visibilitySeenMesh) { visibilitySeenMesh.count = 0; visibilitySeenMesh.instanceMatrix.needsUpdate = true; }
    if (visibilityBlockMesh) { visibilityBlockMesh.count = 0; visibilityBlockMesh.instanceMatrix.needsUpdate = true; }
  }

  function visibilityTileOverlayYForWorldPoint(p, defaultY = 0.032) {
    let y = Number(defaultY || 0.032);
    // Trader building floor is a real mesh with top around y=0.12. The generic
    // fog overlay used to sit below it, so fog-of-war squares were invisible on
    // the building floor. Raise only those overlay tiles above the floor surface.
    try {
      if (typeof isTraderYardLocation === 'function' && isTraderYardLocation() &&
          typeof traderBuildingWorldToLocal === 'function' && typeof TILE !== 'undefined') {
        const local = traderBuildingWorldToLocal(Number(p.x || 0), Number(p.z || 0));
        if (Math.abs(local.x) <= TILE * 5.08 && Math.abs(local.z) <= TILE * 4.08) {
          y = Math.max(y, 0.145);
        }
      }
    } catch (_) {}
    return y;
  }

  function setVisibilityTileInstance(mesh, index, tx, tz, y = 0.032, scale = 1.0) {
    if (!mesh || index >= visibilityShadeCapacity) return false;
    const p = tileToWorld(tx, tz);
    _visibilityTilePos.set(p.x, visibilityTileOverlayYForWorldPoint(p, y), p.z);
    _visibilityTileScale.set(scale, scale, 1);
    _visibilityTileMatrix.compose(_visibilityTilePos, _visibilityTileQuat, _visibilityTileScale);
    mesh.setMatrixAt(index, _visibilityTileMatrix);
    return true;
  }

  function updateVisibilityGridVisual() {
    if (!ensureVisibilityShadeMeshes()) return;
    if (!visibilityGridGroup || !visibilityGridEnabled) {
      if (visibilityGridGroup) visibilityGridGroup.visible = false;
      clearVisibilityGrid();
      return;
    }
    visibilityGridGroup.visible = true;

    const pt = worldToTile(player.x, player.z);
    const radius = perceptionTileVisionRadius();
    const cullRadius = radius + 4;
    const simpleVisualFog = (graphicsSettings?.fogVisual || 'normal') === 'light';
    const seenOverlayEnabled = Number(graphicsSettings?.fogSeenOpacity ?? 0) > 0.001;
    let fogCount = 0;
    let seenCount = 0;
    let blockCount = 0;

    // v7.11: больше не создаём сотни Mesh/Geometry каждый тик.
    // Используем InstancedMesh: меняем только матрицы экземпляров.
    for (let dz = -cullRadius; dz <= cullRadius; dz++) {
      for (let dx = -cullRadius; dx <= cullRadius; dx++) {
        const tx = pt.tx + dx;
        const tz = pt.tz + dz;
        if (!inBounds(tx, tz)) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 > cullRadius * cullRadius) continue;
        if (rtsFog.visibleTiles.has(tileKey(tx, tz))) continue;
        // Неизведанная зона теперь заметно темнее на всех пресетах.
        // Видимая зона не подсвечивается жёлтым overlay — её освещает только солнце/время суток.
        if (fogCount < Number(graphicsSettings?.shadeCapacity || 700) && setVisibilityTileInstance(visibilityFogMesh, fogCount, tx, tz, 0.030, 1.0)) fogCount++;
      }
    }

    rtsFog.visibleTiles.forEach(key => {
      const [txs, tzs] = key.split(',');
      const tx = Number(txs);
      const tz = Number(tzs);
      if (!Number.isFinite(tx) || !Number.isFinite(tz) || !inBounds(tx, tz)) return;
      const dx = tx - pt.tx;
      const dz = tz - pt.tz;
      if (dx * dx + dz * dz > cullRadius * cullRadius) return;
      // Видимые тайлы больше не подсвечиваются отдельной жёлтой плёнкой.
      // Иначе высокий пресет казался дневным, а средний/низкий — ночным.
      if (isVisionBlockingTile(tx, tz)) {
        if (!simpleVisualFog && blockCount < Number(graphicsSettings?.shadeCapacity || 700) && setVisibilityTileInstance(visibilityBlockMesh, blockCount, tx, tz, 0.034, 0.94)) blockCount++;
        else if (seenOverlayEnabled && seenCount < Number(graphicsSettings?.shadeCapacity || 700) && setVisibilityTileInstance(visibilitySeenMesh, seenCount, tx, tz, 0.033, 0.94)) seenCount++;
      } else if (seenOverlayEnabled) {
        if (seenCount < Number(graphicsSettings?.shadeCapacity || 700) && setVisibilityTileInstance(visibilitySeenMesh, seenCount, tx, tz, 0.033, 0.94)) seenCount++;
      }
    });

    visibilityFogMesh.count = fogCount;
    visibilitySeenMesh.count = seenCount;
    visibilityBlockMesh.count = blockCount;
    visibilityFogMesh.instanceMatrix.needsUpdate = true;
    visibilitySeenMesh.instanceMatrix.needsUpdate = true;
    visibilityBlockMesh.instanceMatrix.needsUpdate = true;
  }

  function applyStaticRenderCulling() {
    if (!staticCullObjects.length || !player) return;

    // v7.66: торговая локация — ручная диорама, а не бесконечная случайная карта.
    // Ради стабильной картинки не скрываем её статичные группы во время ходьбы.
    // Это убирает исчезновение окружения, теней и крупных слоёв при пересчёте
    // видимости на границе технических клеток. Для остальных локаций culling сохранён.
    if (typeof isTraderYardLocation === 'function' && isTraderYardLocation() &&
        !(typeof locationUsesAuthoredLayout === 'function' && locationUsesAuthoredLayout(currentLocation))) {
      staticCullObjects.forEach(row => {
        if (row && row.object) row.object.visible = true;
      });
      return;
    }

    const pt = worldToTile(player.x, player.z);
    const r = perceptionTileVisionRadius() + 5 + Math.max(0, Number(graphicsSettings?.staticCullExtra ?? 2));
    const r2 = r * r;
    staticCullObjects.forEach(row => {
      if (!row || !row.object) return;
      // Пол не скрываем графическим culling, иначе низкий/средний пресет на ПК выглядит как ночь.
      if (row.kind === 'floor' || row.kind === 'floor-detail'
          || row.object.userData?.noRuntimeCull || row.object.userData?.noDistanceCull) {
        row.object.visible = true;
        return;
      }
      const dx = Number(row.tx || 0) - pt.tx;
      const dz = Number(row.tz || 0) - pt.tz;
      // Оптимизация: не отрисовываем дальнюю статику вне области вокруг игрока.
      // Серверное состояние и массивы объектов не меняются.
      row.object.visible = dx * dx + dz * dz <= r2;
    });
  }


  function isPointVisibleForGameplay(worldX, worldZ, options = {}) {
    if (!map || !player) return true;

    const pt = worldToTile(player.x, player.z);
    const tt = worldToTile(Number(worldX || 0), Number(worldZ || 0));
    if (!inBounds(tt.tx, tt.tz)) return false;

    const radius = perceptionTileVisionRadius();
    const dx = tt.tx - pt.tx;
    const dz = tt.tz - pt.tz;
    if (dx * dx + dz * dz > radius * radius) return false;

    // One gameplay visibility source for the whole project. Buildings, roof
    // alpha masks, NPCs, other players, loot and interactable objects all use
    // this same tile radius + strict LOS result. The trader building walls are
    // already included in hasStrictTileLineOfSight()/markVisibilityRay(), so
    // there is no separate indoor visibility system anymore.
    const baseVisible = rtsFog.visibleTiles.has(tileKey(tt.tx, tt.tz)) &&
      hasStrictTileLineOfSight(pt.tx, pt.tz, tt.tx, tt.tz, {
        targetWorldX: Number(worldX || 0),
        targetWorldZ: Number(worldZ || 0)
      });
    if (!baseVisible) return false;
    if (options.crouching && isCrouchedTargetHiddenByLowCover(pt.tx, pt.tz, tt.tx, tt.tz, {
      targetWorldX: Number(worldX || 0),
      targetWorldZ: Number(worldZ || 0)
    })) return false;
    return true;
  }

  function isWorldPointVisibleByRtsFog(worldX, worldZ, options = {}) {
    return isPointVisibleForGameplay(worldX, worldZ, options);
  }

  function updateEntityRtsFogVisibility(obj3d, worldX, worldZ, options = {}) {
    if (!obj3d) return;
    const targetX = Number(worldX || 0);
    const targetZ = Number(worldZ || 0);
    const tt = worldToTile(targetX, targetZ);
    const crouchBit = options.crouching ? 1 : 0;
    // Exact OBB cover can change visibility inside one tile. A small 0.1 m
    // quantization keeps the cache useful without making a target remain
    // hidden after it steps sideways from behind GLB low cover.
    const targetSubTileX = Math.round(targetX * 10);
    const targetSubTileZ = Math.round(targetZ * 10);
    const cacheKey = `${rtsFogVisibilityVersion}:${rtsFogObserverEpoch}|${tt.tx},${tt.tz}|${targetSubTileX},${targetSubTileZ}|${crouchBit}`;
    if (obj3d.userData && obj3d.userData.rtsFogCacheKey === cacheKey) {
      if (typeof obj3d.userData.rtsFogVisible === 'boolean') {
        if (typeof setNetworkRevealVisibility === 'function') setNetworkRevealVisibility(obj3d, obj3d.userData.rtsFogVisible);
        else obj3d.visible = obj3d.userData.rtsFogVisible;
      }
      return;
    }
    const visible = isWorldPointVisibleByRtsFog(worldX, worldZ, options);
    if (typeof setNetworkRevealVisibility === 'function') setNetworkRevealVisibility(obj3d, visible);
    else obj3d.visible = visible;
    if (obj3d.userData) {
      obj3d.userData.rtsFogVisible = visible;
      obj3d.userData.rtsFogCacheKey = cacheKey;
    }
  }

  function updateOccludedEntityVisibility(dt) {
    if (!gameStarted || !player) return;

    // v7.63: fog/culling was recalculated every few frames even when the player
    // stayed inside the same logic tile. With relief terrain this caused small
    // movement hitches. Rebuild the visibility field only when gameplay state
    // actually changes: tile, crouch state, radius, or a slow safety refresh.
    visibilityRefreshTimer -= dt;
    visibilitySafetyRefreshTimer -= dt;
    entityVisibilityRefreshTimer -= dt;
    const pt = worldToTile(player.x, player.z);
    const radius = perceptionTileVisionRadius();
    const tileCenter = tileToWorld(pt.tx, pt.tz);
    // Rebuild only after a meaningful 0.1 m sub-tile move. This preserves the
    // event-driven fog budget while keeping narrow GLB doorways responsive.
    const subTileX = Math.round((Number(player.x) - tileCenter.x) * 10);
    const subTileZ = Math.round((Number(player.z) - tileCenter.z) * 10);
    const hardStateKey = `${pt.tx},${pt.tz}|${radius}|${player.crouching ? 1 : 0}`;
    const stateKey = `${pt.tx},${pt.tz}|${subTileX},${subTileZ}|${radius}|${player.crouching ? 1 : 0}`;
    const hardFogStateChanged = hardStateKey !== lastRtsFogHardStateKey;
    const fogStateChanged = stateKey !== lastRtsFogStateKey;
    // Tile/crouch/radius changes apply immediately. Sub-tile doorway changes
    // are rate-limited by the existing vision budget instead of rebuilding
    // every 0.1 m (which would turn ordinary running into ~40 full fog passes/s).
    const needFogRefresh = hardFogStateChanged
      || (fogStateChanged && visibilityRefreshTimer <= 0)
      || visibilitySafetyRefreshTimer <= 0;

    if (needFogRefresh) {
      lastRtsFogHardStateKey = hardStateKey;
      lastRtsFogStateKey = stateKey;
      // Entity LOS also depends on the observer's exact position. Advance an
      // independent epoch even if the resulting visible tile set is unchanged.
      rtsFogObserverEpoch++;
      // Doorway/sub-tile motion has its own short cooldown; an independent slow
      // timer still repairs dynamic world changes while idle. This avoids both
      // per-frame rebuilds and a 2.4 s wake-from-idle visibility delay.
      visibilityRefreshTimer = Math.max(0.12, Number(graphicsSettings?.visionRefresh || 0.14));
      visibilitySafetyRefreshTimer = 2.40;
      rebuildRtsFogOfWar();
    }

    const entityInterval = IS_MOBILE_DEVICE ? 0.32 : 0.20;
    if (!needFogRefresh && entityVisibilityRefreshTimer > 0) return;
    entityVisibilityRefreshTimer = entityInterval;

    enemies.forEach(enemy => {
      if (!enemy || !enemy.mesh || enemy._removed) return;
      updateEntityRtsFogVisibility(enemy.mesh, enemy.x, enemy.z);
    });

    multiplayer.remotePlayers.forEach(row => {
      if (!row || !row.group) return;
      const x = Number(row.group.position?.x ?? row.x ?? 0);
      const z = Number(row.group.position?.z ?? row.z ?? 0);
      updateEntityRtsFogVisibility(row.group, x, z, { crouching: !!row.data?.crouching || !!row.group.userData.crouching });
    });

    multiplayer.groundItems.forEach(row => {
      if (!row || !row.mesh) return;
      updateEntityRtsFogVisibility(row.mesh, Number(row.x || 0), Number(row.z || 0));
    });

    multiplayer.worldContainers.forEach(row => {
      if (!row || !row.mesh) return;
      updateEntityRtsFogVisibility(row.mesh, Number(row.x || 0), Number(row.z || 0));
    });

    resourceNodes.forEach(node => {
      if (!node || !node.mesh) return;
      const pos = tileToWorld(node.tx, node.tz);
      updateEntityRtsFogVisibility(node.mesh, pos.x, pos.z);
    });
  }



  function graphicsEffectLimit() {
    const limit = Number(graphicsSettings?.effectLimit || 34);
    return IS_MOBILE_DEVICE ? Math.max(8, Math.round(limit * 0.55)) : limit;
  }

  function markSceneMaterialsDirty() {
    // Changing real-time shadow quality changes Three.js shader defines.
    // Force recompilation so the sunlight/color path remains identical between presets.
    scene.traverse(obj => {
      if (!obj || !obj.material) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      list.forEach(mat => { if (mat) mat.needsUpdate = true; });
    });
  }

  function applyGraphicsQuality(id, options = {}) {
    const next = GRAPHICS_PRESETS[id] ? id : (IS_MOBILE_DEVICE ? 'medium' : 'high');
    graphicsQuality = next;
    graphicsSettings = GRAPHICS_PRESETS[next];

    try { localStorage.setItem(GRAPHICS_STORAGE_KEY, next); } catch (_) {}

    if (typeof resetAdaptiveRenderScale === 'function') resetAdaptiveRenderScale('graphics-quality');
    else renderer.setPixelRatio(graphicsPixelRatio());
    if (renderer) renderer.toneMappingExposure = IS_MOBILE_DEVICE ? 1.02 : (graphicsQuality === 'ultra' ? 1.075 : 1.055);
    // Real shadow maps are reserved for desktop High/Ultra; Low/Medium and
    // mobile retain baked contact shadows so the quality jump stays scalable.
    if (typeof configureShadowQuality === 'function') configureShadowQuality(true);
    else {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      if (sun) sun.castShadow = false;
    }
    if (typeof applyShadowCasterBudget === 'function') applyShadowCasterBudget();
    if (sun) {
      if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
      else if (sun.shadow && typeof REAL_SHADOWS_TEMP_DISABLED !== 'undefined' && !REAL_SHADOWS_TEMP_DISABLED) sun.shadow.needsUpdate = true;
    }
    markSceneMaterialsDirty();
    // Освещение и атмосферный туман зависят только от игрового времени, а не от качества графики.
    applyDayNightLighting(true);
    if (typeof refreshStaticModelVisualQuality === 'function') refreshStaticModelVisualQuality();
    if (typeof syncGlobalMapGraphicsQuality === 'function') syncGlobalMapGraphicsQuality();

    syncVisibilityFogMaterialOpacity();
    updateVisibilityGridVisual();

    if (sun && sun.shadow && sun.shadow.mapSize && typeof configureShadowQuality !== 'function') {
      const size = Number(graphicsSettings.shadowMap || 1024);
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }

    document.body.classList.toggle('graphics-low', graphicsQuality === 'low');
    document.body.classList.toggle('graphics-medium', graphicsQuality === 'medium');
    document.body.classList.toggle('graphics-high', graphicsQuality === 'high');
    document.body.classList.toggle('graphics-ultra', graphicsQuality === 'ultra');

    if (typeof resize === 'function') resize();
    renderGraphicsWindow();

    if (!options.silent) {
      setReadout(`Графика: ${graphicsSettings.label}.`);
      addLog(`Графика: ${graphicsSettings.label}.`, null, 'system');
    }
  }

  function openGraphicsWindow() {
    const win = document.getElementById('graphics-window');
    if (!win) return;
    win.classList.add('visible');
    win.style.display = 'block';
    document.body.classList.add('graphics-window-open');
    renderGraphicsWindow();
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function closeGraphicsWindow() {
    const win = document.getElementById('graphics-window');
    if (!win) return;
    win.classList.remove('visible');
    win.style.display = 'none';
    document.body.classList.remove('graphics-window-open');
    if (typeof updateMobilePanelState === 'function') updateMobilePanelState();
  }

  function toggleGraphicsWindow() {
    const win = document.getElementById('graphics-window');
    if (win && (win.classList.contains('visible') || win.style.display === 'block')) closeGraphicsWindow();
    else openGraphicsWindow();
  }

  function renderGraphicsWindow() {
    const preset = graphicsSettings || GRAPHICS_PRESETS.medium;
    document.querySelectorAll('.graphics-preset-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.graphicsQuality === graphicsQuality);
    });
    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    setText('graphics-current', `Текущий режим: ${preset.label}`);
    const pixelRatioText = typeof effectiveGraphicsPixelRatio === 'function'
      ? `${effectiveGraphicsPixelRatio().toFixed(2)}x`
      : `${graphicsPixelRatio().toFixed(2)}x`;
    setText('gfx-pixel-ratio', pixelRatioText);
    setText('gfx-shadows', 'псевдо-тени');
    setText('gfx-fog', 'единое тёмное затенение');
    setText('gfx-culling', preset.staticCullExtra === 0 ? 'жёсткая' : `+${preset.staticCullExtra} тайл.`);
    setText('gfx-vision-rate', `${Math.round((preset.visionRefresh || 0.14) * 1000)} мс`);
    setText('gfx-effects', preset.renderEffects === 'ultra' ? 'ультра' : preset.renderEffects === 'high' ? 'высокие' : preset.renderEffects === 'minimal' ? 'минимальные' : 'обычные');
  }

  function initGraphicsWindowControls() {
    document.querySelectorAll('.graphics-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => applyGraphicsQuality(btn.dataset.graphicsQuality || 'medium'));
    });
    const closeBtn = document.getElementById('graphics-close');
    if (closeBtn && closeBtn.dataset.boundGraphicsClose !== '1') {
      closeBtn.dataset.boundGraphicsClose = '1';
      const closeGraphicsHandler = e => {
        e.preventDefault();
        e.stopPropagation();
        closeGraphicsWindow();
      };
      closeBtn.addEventListener('click', closeGraphicsHandler);
      closeBtn.addEventListener('pointerdown', closeGraphicsHandler);
      closeBtn.addEventListener('touchend', closeGraphicsHandler, { passive: false });
    }
    if (!document.body.dataset.boundGraphicsCloseDelegated) {
      document.body.dataset.boundGraphicsCloseDelegated = '1';
      document.addEventListener('pointerdown', function handleGraphicsCloseDelegated(e) {
        const target = e.target;
        if (target && target.id === 'graphics-close') {
          e.preventDefault();
          e.stopPropagation();
          closeGraphicsWindow();
        }
      }, true);
    }
  }


  function update(dt) {
    if (!gameStarted || paused) return;

    if (typeof clientGameplayIsBlocked === 'function' && clientGameplayIsBlocked()) {
      const blockedInputArmed = mouseFireHeld
        || touchFireHeld
        || touchAimFireHeld
        || virtualMove.active
        || Object.keys(keys).some(code => !!keys[code])
        || !!player.attackTarget;
      if (blockedInputArmed && typeof clearAllGameplayInput === 'function') {
        clearAllGameplayInput('authority-blocked', { sendIdle: false });
      }
      updateEffects(dt);
      updateCamera(dt);
      updateRemotePlayers(dt);
      maybeRenderUI(dt);
      return;
    }

    if (locationTransitionActive) {
      Object.keys(keys).forEach(code => { keys[code] = false; });
      if (typeof stopAutoFire === 'function') stopAutoFire();
      if (typeof stopTouchAim === 'function') stopTouchAim();
      updateEffects(dt);
      updateCamera(dt);
      updateRemotePlayers(dt);
      return;
    }

    if (isProgressionWindowOpen()) {
      Object.keys(keys).forEach(code => { keys[code] = false; });
      stopAutoFire();
      stopTouchAim();
      updateEffects(dt);
      updateCamera(dt);
      updateRemotePlayers(dt);
      sendMultiplayerState(dt);
      return;
    }

    player.fireCooldown = Math.max(0, player.fireCooldown - dt);
    player.reloadTimer = Math.max(0, player.reloadTimer - dt);
    player.invincible = Math.max(0, player.invincible - dt);
    player.ap = Math.min(player.maxAp, player.ap + dt * (1.8 + talentLevel('actionBoy') * 0.35));
    updateBaseStorageRestock(dt);
    if (typeof updateTraderMarketRestock === 'function') updateTraderMarketRestock(dt);
    updateMedicalEffects(dt);
    if (typeof updateGlobalTravel === 'function' && updateGlobalTravel(dt)) {
      const globalMapModeActive = document.body.classList.contains('global-map-mode') || !!globalMapState?.onWorldMap;
      if (!globalMapModeActive) {
        updateEffects(dt);
        updateCamera(dt);
        updateRemotePlayers(dt);
        maybeRenderUI(dt);
      }
      updateAutosave(dt);
      return;
    }

    updatePlayerMovement(dt);
    if (typeof updateWorldMapEdgeExit === 'function' && updateWorldMapEdgeExit()) {
      updateEffects(dt);
      updateCamera(dt);
      updateRemotePlayers(dt);
      // Позиция обязана уходить на сервер и в этом кадре: именно её он ждёт,
      // чтобы согласиться с выходом на карту. Без этого получалась взаимная
      // блокировка — сервер отказывал из-за устаревшей позиции, а клиент
      // переставал её слать.
      sendMultiplayerState(dt);
      maybeRenderUI(dt);
      return;
    }
    if (typeof updateMobilePlayerTreatmentRangeGate === 'function') updateMobilePlayerTreatmentRangeGate();
    updateAutomaticFire();
    updateTouchFire(dt);
    if (activeLootEnemy && Math.hypot(activeLootEnemy.x - player.x, activeLootEnemy.z - player.z) > 4.2) closeLootWindow();
    if (activeWorldContainer && Math.hypot(Number(activeWorldContainer.x || 0) - player.x, Number(activeWorldContainer.z || 0) - player.z) > 4.2) closeLootWindow();
    if (traderWindowOpen && !findNearbyTrader(4.2)) closeTraderWindow();
    if (storageWindowOpen && (!storageBox || Math.hypot(storageBox.x - player.x, storageBox.z - player.z) > 4.2)) closeStorageWindow();
    updateEnemies(dt);
    updateProximityHints();
    updateEffects(dt);
    updateCamera(dt);
    updateVisionShade();
    updateSelectedTargetTracking();
    updateHpBars();
    updateRemotePlayers(dt);
    updateOccludedEntityVisibility(dt);
    if (typeof updateNetworkRevealTransitions === 'function') updateNetworkRevealTransitions(dt);
    if (typeof updateTraderBuildingRoofCutaway === 'function') updateTraderBuildingRoofCutaway(dt);
    sendMultiplayerState(dt);

    const canSpawnLocalEnemies = typeof clientEnemyStateMayUseLocalFallback === 'function'
      ? clientEnemyStateMayUseLocalFallback()
      : !enemiesAreServerAuthoritative();
    if (canSpawnLocalEnemies) {
      spawnTimer += dt;
      if (spawnTimer > 14) {
        spawnTimer = 0;
        if (!currentLocation.safe) spawnEnemy();
      }
    }

    maybeRenderUI(dt);
    updateAutosave(dt);
  }

  function getAimForwardWorld() {
    let fx = 0;
    let fz = 1;

    if (pointerHasWorld) {
      fx = pointerWorld.x - player.x;
      fz = pointerWorld.z - player.z;
    }

    let len = Math.hypot(fx, fz);
    if (len < 0.08) {
      fx = Math.sin(player.angle);
      fz = Math.cos(player.angle);
      len = Math.hypot(fx, fz) || 1;
    }

    return { x: fx / len, z: fz / len };
  }

  function screenDeltaForWorldDirection(dir) {
    const rect = canvas.getBoundingClientRect();
    playerScreenPoint.set(player.x, 0, player.z).project(camera);
    fallbackScreenPoint.set(player.x + dir.x, 0, player.z + dir.z).project(camera);
    return {
      x: (fallbackScreenPoint.x - playerScreenPoint.x) * rect.width * 0.5,
      y: -(fallbackScreenPoint.y - playerScreenPoint.y) * rect.height * 0.5
    };
  }

  function getRightFromForward(forward) {
    // Два возможных перпендикуляра к направлению взгляда.
    // Выбираем тот, который на экране уводит вправо. Так D всегда ощущается как движение вправо,
    // независимо от того, смотрит персонаж вверх, вниз или по диагонали.
    const a = { x: forward.z, z: -forward.x };
    const b = { x: -forward.z, z: forward.x };
    const da = screenDeltaForWorldDirection(a);
    const db = screenDeltaForWorldDirection(b);

    if (Math.abs(da.x - db.x) > 0.001) return da.x > db.x ? a : b;
    return da.y > db.y ? a : b;
  }


  function groundPointFromScreen(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    return rc.ray.intersectPlane(groundPlane, point) ? point : null;
  }

  function normalizeGroundDir(dx, dz, fallback) {
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return fallback;
    return { x: dx / len, z: dz / len };
  }

  function getDeviceScreenMovementAxes() {
    // Фиксированные оси для неизменной изометрической камеры.
    // Без raycast по экрану: стик больше никак не связан с объектами карты.
    return {
      forward: { x: Math.SQRT1_2, z: -Math.SQRT1_2 },
      right: { x: Math.SQRT1_2, z: Math.SQRT1_2 }
    };
  }

  function getMovementVectorFromKeys() {
    if (hudEditMode) return null;
    const forwardPressed = keys['KeyW'] || keys['ArrowUp'];
    const backPressed = keys['KeyS'] || keys['ArrowDown'];
    const rightPressed = keys['KeyD'] || keys['ArrowRight'];
    const leftPressed = keys['KeyA'] || keys['ArrowLeft'];
    const hasKeyboard = !!(forwardPressed || backPressed || rightPressed || leftPressed);
    const hasVirtual = !!(virtualMove.active && Math.hypot(virtualMove.forward, virtualMove.right) > 0.04);
    if (!hasKeyboard && !hasVirtual) return null;

    const fixedScreenMove = (isMobileControlsEnabled() && hasVirtual) || hasKeyboard;
    // v7.3: WASD/стрелки на ПК и левый стик на мобильных работают по экранным осям.
    // W/↑ всегда ведёт вверх экрана, S/↓ вниз, A/← влево, D/→ вправо,
    // независимо от направления взгляда персонажа или положения мыши.
    let forward, right;
    if (fixedScreenMove) {
      const axes = getDeviceScreenMovementAxes();
      forward = axes.forward;
      right = axes.right;
    } else {
      forward = getAimForwardWorld();
      right = getRightFromForward(forward);
    }

    let mx = 0;
    let mz = 0;
    if (forwardPressed) { mx += forward.x; mz += forward.z; }
    if (backPressed) { mx -= forward.x; mz -= forward.z; }
    if (rightPressed) { mx += right.x; mz += right.z; }
    if (leftPressed) { mx -= right.x; mz -= right.z; }
    if (hasVirtual) {
      mx += forward.x * virtualMove.forward + right.x * virtualMove.right;
      mz += forward.z * virtualMove.forward + right.z * virtualMove.right;
    }

    const len = Math.hypot(mx, mz);
    if (len < 0.001) return null;
    const forwardAmount = (forwardPressed ? 1 : 0) - (backPressed ? 1 : 0) + (hasVirtual ? virtualMove.forward : 0);
    const sidewaysAmount = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0) + (hasVirtual ? virtualMove.right : 0);
    const backwardFactor = (!fixedScreenMove && forwardAmount < -0.15) ? 0.58 : 1;
    const mobileAutoTurn = isMobileControlsEnabled() && hasVirtual && Math.hypot(forwardAmount, sidewaysAmount) > 0.12 && touchAimPointerId === null;
    return { x: mx / len, z: mz / len, intensity: hasVirtual ? 1 : 1, speedFactor: backwardFactor, autoTurn: mobileAutoTurn };
  }

  function updatePlayerMovement(dt) {
    playerDynamicObstacleFrameToken++;
    const animationStartX = Number(player.x || 0);
    const animationStartZ = Number(player.z || 0);
    refreshPointerWorldFromLastScreen();
    if (!isMobileControlsEnabled() && pointerHasWorld) {
      const lookDx = pointerWorld.x - player.x;
      const lookDz = pointerWorld.z - player.z;
      if (Math.hypot(lookDx, lookDz) > 0.18) facePoint(pointerWorld.x, pointerWorld.z);
    }

    const move = getMovementVectorFromKeys();
    const keyboardMoving = !!move;
    const speed = (player.speed + speedBonus()) * injurySpeedMultiplier() * (player.crouching ? 0.62 : 1);
    if (keyboardMoving) {
      const autoTarget = isMobileControlsEnabled() ? getActiveAutoTarget() : null;
      // При активном мобильном стике направление стика всегда главнее автоцели.
      // Так персонаж смотрит туда, куда ведёт левый стик.
      if (move.autoTurn) facePoint(player.x + move.x, player.z + move.z);
      else if (autoTarget) facePoint(autoTarget.x, autoTarget.z);
      const moveIntensity = move.intensity || 1;
      const moveSpeedFactor = move.speedFactor || 1;
      movePlayerBy(move.x * speed * moveIntensity * moveSpeedFactor * dt, move.z * speed * moveIntensity * moveSpeedFactor * dt);
    }

    playerGroup.position.set(player.x, 0, player.z);
    playerGroup.rotation.y = player.angle + Math.PI;
    applyCharacterCrouchVisual(playerGroup, player.crouching, dt);
    const animationMoveX = player.x - animationStartX;
    const animationMoveZ = player.z - animationStartZ;
    const animationDistance = Math.hypot(animationMoveX, animationMoveZ);
    updateCharacterLocomotionAnimation(playerGroup, dt, {
      moving: animationDistance > 0.0005,
      speed: animationDistance / Math.max(0.001, Number(dt || 0.016)),
      crouching: player.crouching,
      moveX: animationMoveX,
      moveZ: animationMoveZ,
      facingAngle: player.angle
    });
    applyCharacterInjuryVisual(playerGroup, player.injuries || {}, dt);
    updateWeaponVisualAnimation(playerParts.weaponGroup, dt, player);
    updateWeaponVisualAnimation(playerParts.offhandWeaponGroup, dt, player);
    updateCharacterMeleeAnimation(playerGroup, dt);
  }

  const PLAYER_DYNAMIC_BLOCK_RADIUS = PLAYER_COLLISION_RADIUS;
  let playerDynamicObstacleFrameToken = 0;
  const playerDynamicObstacleFrameCache = {
    token: -1,
    list: []
  };

  function finiteWorldNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function dynamicActorModelKey(actor = {}) {
    return String(
      actor.modelKey
      || actor.mesh?.userData?.staticModelKey
      || actor.mesh?.userData?.actorParts?.staticModel?.userData?.staticModelKey
      || ''
    );
  }

  function dynamicActorCollisionRadius(actor = {}) {
    const key = dynamicActorModelKey(actor);
    const modelRadius = key ? staticModelColliderRadius(key, Number(actor.scale || 1) || 1) : 0;
    if (modelRadius > 0) return modelRadius;
    const explicit = Number(actor.collisionRadius ?? actor.bodyRadius ?? actor.radius);
    if (Number.isFinite(explicit) && explicit > 0) return Math.max(0.28, Math.min(1.35, explicit));
    const scale = Math.max(0.65, Math.min(1.55, Number(actor.scale || actor.mesh?.scale?.x || 1) || 1));
    const visual = String(actor.visual || actor.mesh?.userData?.enemyVisual || actor.kind || '').toLowerCase();
    let base = 0.52;
    if (visual.includes('mutant') || visual.includes('super')) base = 0.72;
    else if (visual.includes('radscorpion')) base = 0.78;
    else if (visual.includes('ant')) base = 0.62;
    else if (visual.includes('gecko')) base = 0.58;
    else if (visual.includes('wolf')) base = 0.48;
    return Math.max(0.38, Math.min(1.08, base * scale));
  }

  function dynamicActorCollisionBoxes(actor = {}, x = 0, z = 0) {
    const key = dynamicActorModelKey(actor);
    if (!key) return [];
    const scale = Math.max(0.1, Number(actor.scale || 1) || 1);
    const rotationY = Number(actor.mesh?.rotation?.y || 0);
    return staticModelCollisionTransforms(key, x, z, rotationY, { scaleX: scale, scaleZ: scale });
  }

  function collectPlayerDynamicObstaclesForFrame() {
    if (playerDynamicObstacleFrameCache.token === playerDynamicObstacleFrameToken) return playerDynamicObstacleFrameCache.list;
    const list = [];
    if (Array.isArray(enemies)) {
      enemies.forEach(enemy => {
        if (!enemy || enemy.dead || enemy._removed) return;
        const cx = finiteWorldNumber(enemy.x ?? enemy.visualX ?? enemy.mesh?.position?.x, NaN);
        const cz = finiteWorldNumber(enemy.z ?? enemy.visualZ ?? enemy.mesh?.position?.z, NaN);
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) return;
        const modelBoxes = dynamicActorCollisionBoxes(enemy, cx, cz);
        if (modelBoxes.length) {
          modelBoxes.forEach(box => list.push({ type: 'box', ...box }));
        } else {
          list.push({ type: 'circle', x: cx, z: cz, radius: dynamicActorCollisionRadius(enemy) });
        }
      });
    }
    // Loot containers are interaction targets, not actors or walls. Keeping
    // them in the dynamic blocker list caused a visible push-back while the
    // player was trying to get close enough to open them.
    playerDynamicObstacleFrameCache.token = playerDynamicObstacleFrameToken;
    playerDynamicObstacleFrameCache.list = list;
    return list;
  }

  function circleDynamicPenaltyAt(x, z, cx, cz, blockerRadius, playerRadius = PLAYER_DYNAMIC_BLOCK_RADIUS) {
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return 0;
    const radius = playerRadius + blockerRadius;
    const dx = x - cx;
    const dz = z - cz;
    if (Math.abs(dx) >= radius || Math.abs(dz) >= radius) return 0;
    const overlap = radius - Math.hypot(dx, dz);
    return overlap > 0 ? overlap : 0;
  }

  function boxDynamicPenaltyAt(x, z, cx, cz, halfX, halfZ, rotationY = 0, playerRadius = PLAYER_DYNAMIC_BLOCK_RADIUS) {
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return 0;
    const worldDx = x - cx;
    const worldDz = z - cz;
    const cos = Math.cos(Number(rotationY || 0));
    const sin = Math.sin(Number(rotationY || 0));
    const dx = Math.abs(worldDx * cos + worldDz * sin);
    const dz = Math.abs(-worldDx * sin + worldDz * cos);
    const outsideX = Math.max(0, dx - halfX);
    const outsideZ = Math.max(0, dz - halfZ);
    const outsideDistance = Math.hypot(outsideX, outsideZ);
    if (outsideDistance > 0) return Math.max(0, playerRadius - outsideDistance);
    return playerRadius + Math.min(halfX - dx, halfZ - dz);
  }

  function playerDynamicObstaclePenaltyAt(x, z) {
    let penalty = 0;
    const blockers = collectPlayerDynamicObstaclesForFrame();
    for (let i = 0; i < blockers.length; i += 1) {
      const b = blockers[i];
      if (b.type === 'box') penalty = Math.max(penalty, boxDynamicPenaltyAt(x, z, b.x, b.z, b.halfX, b.halfZ, b.rotationY));
      else penalty = Math.max(penalty, circleDynamicPenaltyAt(x, z, b.x, b.z, b.radius));
      if (penalty >= PLAYER_DYNAMIC_BLOCK_RADIUS + 1.35) break;
    }
    return penalty;
  }

  function canPlayerMoveToWorldPoint(x, z, currentDynamicPenalty = 0) {
    if (!isWalkableWorld(x, z)) return false;
    const nextDynamicPenalty = playerDynamicObstaclePenaltyAt(x, z);
    if (nextDynamicPenalty <= 0.001) return true;
    return currentDynamicPenalty > 0.001 && nextDynamicPenalty < currentDynamicPenalty - 0.0005;
  }

  function canPlayerEscapeStaticBlockTo(x, z, currentStaticPenalty = 0, currentDynamicPenalty = 0) {
    if (!isWorldTerrainWalkable(x, z)) return false;
    const nextStaticPenalty = staticCollisionPenaltyAt(x, z, PLAYER_COLLISION_RADIUS);
    if (nextStaticPenalty > 0.001 && !(currentStaticPenalty > 0.001 && nextStaticPenalty < currentStaticPenalty - 0.0005)) return false;
    const nextDynamicPenalty = playerDynamicObstaclePenaltyAt(x, z);
    if (nextDynamicPenalty <= 0.001) return true;
    return currentDynamicPenalty > 0.001 && nextDynamicPenalty < currentDynamicPenalty - 0.0005;
  }

  function movePlayerBy(dx, dz) {
    const staticPenaltyAtStart = staticCollisionPenaltyAt(player.x, player.z, PLAYER_COLLISION_RADIUS);
    const blockedByStaticAtStart = staticPenaltyAtStart > 0.001;
    const nx = player.x + dx;
    const nz = player.z + dz;
    const dynamicPenaltyAtStart = playerDynamicObstaclePenaltyAt(player.x, player.z);
    if (canPlayerMoveToWorldPoint(nx, player.z, dynamicPenaltyAtStart) || (blockedByStaticAtStart && canPlayerEscapeStaticBlockTo(nx, player.z, staticPenaltyAtStart, dynamicPenaltyAtStart))) player.x = nx;
    const staticPenaltyAfterX = staticCollisionPenaltyAt(player.x, player.z, PLAYER_COLLISION_RADIUS);
    const dynamicPenaltyAfterX = playerDynamicObstaclePenaltyAt(player.x, player.z);
    if (canPlayerMoveToWorldPoint(player.x, nz, dynamicPenaltyAfterX) || (staticPenaltyAfterX > 0.001 && canPlayerEscapeStaticBlockTo(player.x, nz, staticPenaltyAfterX, dynamicPenaltyAfterX))) player.z = nz;
  }


  function applyEnemyFlashVisual(enemy, dt) {
    if (!enemy || !enemy.mesh) return;
    const active = Number(enemy.flash || 0) > 0;
    if (active) enemy.flash = Math.max(0, Number(enemy.flash || 0) - Math.max(0, Number(dt || 0)));
    const stillActive = Number(enemy.flash || 0) > 0;
    const wasApplied = !!enemy.mesh.userData?.enemyFlashApplied;
    if (!stillActive && !wasApplied) return;
    enemy.mesh.traverse(m => {
      if (!m || !m.isMesh || !m.material) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      if (!m.userData.baseMaterialColors) m.userData.baseMaterialColors = list.map(mat => mat && mat.color ? mat.color.getHex() : null);
      if (!m.userData.baseMaterialEmissives) m.userData.baseMaterialEmissives = list.map(mat => mat && mat.emissive ? mat.emissive.getHex() : null);
      list.forEach((mat, i) => {
        if (!mat) return;
        if (stillActive) {
          if (mat.emissive) mat.emissive.setHex(0x441111);
        } else {
          const c = m.userData.baseMaterialColors[i];
          const e = m.userData.baseMaterialEmissives[i];
          if (mat.color && c !== null && c !== undefined) mat.color.setHex(c);
          if (mat.emissive) mat.emissive.setHex(e !== null && e !== undefined ? e : 0x000000);
        }
      });
    });
    enemy.mesh.userData.enemyFlashApplied = stillActive;
  }

  function rotateEnemyMeshByVector(enemy, dx, dz, dt, rate = 12) {
    if (!enemy?.mesh) return false;
    const targetRot = RealmActorFacing.actorFacingYaw(enemy, dx, dz);
    if (!Number.isFinite(targetRot)) return false;
    const currentRot = Number(enemy.mesh.rotation.y || 0);
    const diff = Math.atan2(Math.sin(targetRot - currentRot), Math.cos(targetRot - currentRot));
    enemy.mesh.rotation.y = currentRot + diff * Math.min(1, Math.max(0.001, Number(dt || 0.016)) * rate);
    return true;
  }

  function rotateEnemyMeshForState(enemy, movementDx, movementDz, dt, rate = 12, fallbackTarget = null) {
    const intent = RealmActorFacing.actorFacingIntent(enemy, movementDx, movementDz, {
      epsilon: 0.006,
      fallbackX: fallbackTarget?.x,
      fallbackZ: fallbackTarget?.z
    });
    return intent ? rotateEnemyMeshByVector(enemy, intent.dx, intent.dz, dt, rate) : false;
  }

  function updateEnemies(dt) {
    if (typeof refreshActorAnimationViewFrustum === 'function') refreshActorAnimationViewFrustum();
    const animationBudget = typeof actorAnimationQualityBudget === 'function'
      ? actorAnimationQualityBudget()
      : null;
    const animationFrameContext = typeof createEnemyAnimationFrameContext === 'function'
      ? createEnemyAnimationFrameContext(
          enemies,
          traderNpc,
          typeof fpsValue === 'number' ? fpsValue : 0
        )
      : null;
    if (typeof beginActorAnimationDiagnostics === 'function') {
      beginActorAnimationDiagnostics(
        animationFrameContext?.heavyActorCount || 0,
        animationFrameContext?.crowdPressure === true
      );
    }
    if (traderNpc?.mesh?.userData?.actorParts?.unifiedHumanoidNpc) {
      const traderTalking = !!String(traderNpc.speechText || '').trim();
      const traderDistance = player
        ? Math.hypot(Number(player.x || 0) - Number(traderNpc.x || 0), Number(player.z || 0) - Number(traderNpc.z || 0))
        : Infinity;
      const traderNow = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const traderAttack = typeof actorAttackAnimationPulseState === 'function'
        ? actorAttackAnimationPulseState(traderNpc.mesh, String(traderNpc.aiState || '').toLowerCase() === 'attack')
        : { active: String(traderNpc.aiState || '').toLowerCase() === 'attack', token: 0 };
      const traderMelee = traderNpc.mesh.userData?.meleeAnim;
      const traderMeleeActive = Number(traderMelee?.startedAt || 0) > 0
        && traderNow < Number(traderMelee.startedAt || 0) + Math.max(0.18, Number(traderMelee.duration || 0.32)) * 1000;
      const traderHitReaction = traderNpc.mesh.userData?.hitReactionAnim;
      const traderHitReactionActive = Number(traderHitReaction?.startedAt || 0) > 0
        && traderNow < Number(traderHitReaction.startedAt || 0) + Math.max(0.22, Number(traderHitReaction.duration || 0.34)) * 1000;
      const traderSelected = !!player && player.attackTarget === traderNpc;
      const traderHovered = (typeof hoveredEnemy !== 'undefined' && hoveredEnemy === traderNpc)
        || (typeof activeWorldContextTarget !== 'undefined' && activeWorldContextTarget?.trader === traderNpc);
      const traderImportant = traderTalking
        || traderWindowOpen
        || traderAttack.active
        || traderMeleeActive
        || traderHitReactionActive
        || Number(traderNpc.flash || 0) > 0.02
        || traderSelected
        || traderHovered;
      const traderVisible = traderNpc.mesh.visible !== false
        && (typeof actorAnimationInView !== 'function' || actorAnimationInView(traderNpc.mesh));
      const traderBaseInterval = enemyAnimationLodInterval(
        traderDistance,
        traderVisible,
        traderImportant,
        animationBudget
      );
      const traderAnimationInterval = enemyAnimationCrowdAdjustedInterval(traderBaseInterval, {
        crowdPressure: animationFrameContext?.crowdPressure === true,
        heavy: true,
        idle: !traderImportant,
        important: traderImportant,
        settings: animationBudget
      });
      const traderAnimationDt = consumeEnemyAnimationLodDt(
        traderNpc,
        dt,
        traderAnimationInterval,
        [
          traderVisible ? 1 : 0,
          String(animationBudget?.id || ''),
          traderTalking ? 1 : 0,
          traderWindowOpen ? 1 : 0,
          traderAttack.active ? 1 : 0,
          Number(traderAttack.token || 0),
          Number(traderMelee?.startedAt || 0),
          Number(traderHitReaction?.startedAt || 0),
          Number(traderNpc.flash || 0) > 0.02 ? 1 : 0,
          traderSelected ? 1 : 0,
          traderHovered ? 1 : 0
        ].join('|')
      );
      if (typeof recordActorAnimationDiagnostic === 'function') {
        const traderTier = typeof actorAnimationBudgetTier === 'function'
          ? actorAnimationBudgetTier(traderDistance, traderVisible, traderImportant, animationBudget)
          : (traderVisible ? 'near' : 'offscreen');
        recordActorAnimationDiagnostic(
          'enemy',
          traderTier,
          traderAnimationDt > 0,
          animationFrameContext?.crowdPressure === true
        );
      }
      if (traderAnimationDt > 0) {
        updateCharacterLocomotionAnimation(traderNpc.mesh, traderAnimationDt, {
          moving: false,
          speed: 0,
          facingAngle: Number(traderNpc.mesh.rotation.y || 0) - Math.PI,
          attacking: traderAttack.active,
          attackToken: traderAttack.token,
          hurt: Number(traderNpc.flash || 0) > 0.02 || traderHitReactionActive,
          talking: traderTalking,
          footIk: typeof actorAnimationDetailEnabled === 'function'
            ? actorAnimationDetailEnabled('footIk', traderDistance, traderImportant, animationBudget)
            : traderImportant || traderDistance <= 6
        });
        if (traderNpc.mesh.userData.enemyWeaponGroup) {
          updateWeaponVisualAnimation(traderNpc.mesh.userData.enemyWeaponGroup, traderAnimationDt, traderNpc);
        }
      }
    }
    if (enemiesAreServerAuthoritative()) {
      enemies.forEach(e => {
        if (!e || !e.mesh) return;
        if (!e.dead) {
          const tx = Number.isFinite(Number(e.serverTargetX)) ? Number(e.serverTargetX) : Number(e.x || 0);
          const tz = Number.isFinite(Number(e.serverTargetZ)) ? Number(e.serverTargetZ) : Number(e.z || 0);
          if (e.mesh.visible === false) {
            // Fog-hidden actors do not need interpolation, rotation or skeletal
            // work. Keep the authoritative anchor current so reveal has no pop.
            e.visualX = tx;
            e.visualZ = tz;
            e.x = tx;
            e.z = tz;
            e.prevVisualX = tx;
            e.prevVisualZ = tz;
            e.mesh.position.set(tx, 0, tz);
            const hiddenHeavyActor = typeof enemyActorUsesHeavyAnimation === 'function'
              && enemyActorUsesHeavyAnimation(e, false);
            if (hiddenHeavyActor) {
              if (typeof consumeEnemyAnimationLodDt === 'function') {
                consumeEnemyAnimationLodDt(e, dt, Infinity, 'fog-hidden');
              }
              if (typeof recordActorAnimationDiagnostic === 'function') {
                recordActorAnimationDiagnostic(
                  'enemy',
                  'offscreen',
                  false,
                  animationFrameContext?.crowdPressure === true
                );
              }
            }
            applyEnemyFlashVisual(e, dt);
            return;
          }
          const stepDt = Math.max(0.001, Math.min(0.05, Number(dt || 0.016)));
          let vx = Number(e.netVx || 0);
          let vz = Number(e.netVz || 0);
          const baseSpeed = Math.max(0.15, Number(e.enemyVisualSpeed || Math.hypot(vx, vz) || e.speed || 2.4));
          const maxFrameMove = Math.max(0.02, baseSpeed * 1.18 * stepDt);

          if (!Number.isFinite(Number(e.visualX))) e.visualX = Number(e.x || tx || 0);
          if (!Number.isFinite(Number(e.visualZ))) e.visualZ = Number(e.z || tz || 0);

          let nx = Number(e.visualX || 0) + vx * stepDt;
          let nz = Number(e.visualZ || 0) + vz * stepDt;
          const ax = tx - nx;
          const az = tz - nz;
          const anchorDist = Math.hypot(ax, az);

          if (anchorDist > 6.5) {
            nx = tx;
            nz = tz;
          } else if (anchorDist > 0.015) {
            // Soft server anchor: fast enough to remove drift, but capped so a
            // network packet cannot visibly pull the mob backward/sideways.
            const anchorK = 1 - Math.pow(0.055, stepDt);
            let cx = ax * anchorK;
            let cz = az * anchorK;
            const corrLen = Math.hypot(cx, cz);
            const corrCap = Math.max(0.025, baseSpeed * 0.42 * stepDt);
            if (corrLen > corrCap) {
              const k = corrCap / corrLen;
              cx *= k;
              cz *= k;
            }
            nx += cx;
            nz += cz;
          }

          const frameDx = nx - Number(e.visualX || 0);
          const frameDz = nz - Number(e.visualZ || 0);
          const frameLen = Math.hypot(frameDx, frameDz);
          if (frameLen > maxFrameMove) {
            const k = maxFrameMove / frameLen;
            nx = Number(e.visualX || 0) + frameDx * k;
            nz = Number(e.visualZ || 0) + frameDz * k;
          }

          e.visualX = nx;
          e.visualZ = nz;
          e.x = nx;
          e.z = nz;
          e.mesh.position.set(nx, 0, nz);

          const actualDx = nx - Number(e.prevVisualX ?? nx);
          const actualDz = nz - Number(e.prevVisualZ ?? nz);
          const hasActualMovement = Math.hypot(actualDx, actualDz) > 0.006;
          const movementDx = hasActualMovement ? actualDx : Number(e.netVx || 0);
          const movementDz = hasActualMovement ? actualDz : Number(e.netVz || 0);
          const fallbackTarget = (e.aiState === 'chase' || e.aiState === 'attack') ? player : null;
          rotateEnemyMeshForState(e, movementDx, movementDz, stepDt, 12, fallbackTarget);
          e.prevVisualX = nx;
          e.prevVisualZ = nz;
          if (typeof animateEnemyVisual === 'function') animateEnemyVisual(e, dt, animationFrameContext);
        }
        applyEnemyFlashVisual(e, dt);
      });
      return;
    }
    if (typeof clientEnemyStateMayUseLocalFallback === 'function' && !clientEnemyStateMayUseLocalFallback()) return;
    enemies.forEach(e => {
      if (e.dead || (e.mesh && e.mesh.visible === false)) return;
      const previousX = Number(e.x || 0);
      const previousZ = Number(e.z || 0);
      const dist = Math.hypot(player.x - e.x, player.z - e.z);
      let detectRange = 15;
      if (player.crouching) {
        const stealthReduction = skillNorm('stealth') * 0.44 + talentLevel('ghost') * 0.11;
        detectRange *= Math.max(0.35, 1 - stealthReduction);
      } else {
        detectRange *= Math.max(0.78, 1 - skillNorm('stealth') * 0.08);
      }
      const detected = dist < 1.6 || dist < detectRange;
      e.aiState = detected ? (dist <= 1.35 ? 'attack' : 'chase') : 'wander';
      let vx = 0, vz = 0;
      if (detected) {
        vx = (player.x - e.x) / Math.max(dist, 0.01);
        vz = (player.z - e.z) / Math.max(dist, 0.01);
      } else {
        e.wanderTimer -= dt;
        if (e.wanderTimer <= 0) {
          e.wanderTimer = 1.5 + Math.random() * 2.0;
          const a = Math.random() * Math.PI * 2;
          e.vx = Math.cos(a);
          e.vz = Math.sin(a);
        }
        vx = e.vx || 0; vz = e.vz || 0;
      }

      if (dist > 1.35) {
        const speed = e.speed * (detected ? 1 : 0.35);
        const nx = e.x + vx * speed * dt;
        const nz = e.z + vz * speed * dt;
        if (isWalkableWorld(nx, e.z, 0.32)) e.x = nx;
        if (isWalkableWorld(e.x, nz, 0.32)) e.z = nz;
      } else {
        e.attackTimer -= dt;
        if (e.attackTimer <= 0) {
          e.attackTimer = 1.25;
          if (typeof triggerMeleeAttackVisual === 'function') triggerMeleeAttackVisual(e.mesh, e.weapon || e.equipment?.weapon || 'fists');
          const raw = e.atk;
          const attackProfile = enemyAttackProfile(e);
          const incoming = mitigateIncomingDamage(raw, attackProfile.damageType || 'ballistic');
          const reduced = incoming.damage;
          if (player.invincible <= 0) {
            const savedBySecondChance = player.hp - reduced <= 0 && typeof trySecondChance === 'function' && trySecondChance(reduced, e.name || 'смертельный удар');
            if (!savedBySecondChance) player.hp = Math.max(0, player.hp - reduced);
            player.invincible = 0.25;
            createFloatingText(player.x, player.z, '-' + reduced, '#ff5b4a');
            const absorbedText = incoming.absorbed > 0 ? `, броня поглотила ${incoming.absorbed}` : '';
            addLog(`${e.name} атакует (${damageTypeLabel(incoming.type)}): -${reduced} HP${absorbedText}.`, null, 'combat');
            rollInjuryFromHit(reduced, incoming.type, attackProfile.injurySource || e.name);
            if (player.hp <= 0) playerDeath();
          }
        }
      }

      e.mesh.position.set(e.x, 0, e.z);
      const fallbackTarget = (e.aiState === 'chase' || e.aiState === 'attack') ? player : null;
      rotateEnemyMeshForState(e, Number(e.x || 0) - previousX, Number(e.z || 0) - previousZ, dt, 14, fallbackTarget);
      if (typeof animateEnemyVisual === 'function') animateEnemyVisual(e, dt, animationFrameContext);
      applyEnemyFlashVisual(e, dt);
    });
  }

  function playerDeath() {
    const lost = Math.min(inventory.get('silver') || 0, Math.ceil((inventory.get('silver') || 0) * 0.15));
    if (lost > 0) removeItem('silver', lost);
    player.hp = Math.ceil(player.maxHp * 0.55);
    player.invincible = 1.5;
    player.injuries = {};
    player.infectionTimer = 0;
    saveCurrentLocationState();
    closeLootWindow();
    closeTraderWindow();
    closeStorageWindow();
    closeAllWindows();
    clearEnemies();
    const respawnLocationId = typeof normalizeLastVisitedSettlementId === 'function'
      ? normalizeLastVisitedSettlementId(characterProfile?.lastVisitedSettlementId || 'settlement')
      : 'settlement';
    currentLocation = LOCATIONS[respawnLocationId] || LOCATIONS.settlement;
    if (typeof rememberCurrentSettlementLocation === 'function') rememberCurrentSettlementLocation(currentLocation.id);
    buildWorld();
    restoreEnemiesFromState();
    setPlayerToSpawn(currentLocation.spawn);
    addLog(`☠ Вы потеряли сознание. Потеряно ${lost} крышек.`, null, 'combat');
    setReadout('Вы очнулись в поселении.');
    drawMinimap();
    queueSave(true);
    // Важно: после смерти нужно сменить сетевую комнату. Иначе старый клиент
    // остаётся в комнате пустоши и другие игроки продолжают видеть «труп» модели.
    if (multiplayer.socket && multiplayer.socket.connected && multiplayer.joined) {
      changeMultiplayerLocation();
    } else {
      connectMultiplayer();
    }
  }

  function updateEffects(dt) {
    const maxFx = graphicsEffectLimit();
    // v7.14.1: массив эффектов в разных сборках может называться по-разному.
    // Проверяем через try/catch, чтобы не получить ReferenceError/TDZ.
    let fxList = null;
    try {
      if (Array.isArray(effects)) fxList = effects;
    } catch (_) {
      fxList = null;
    }
    if (fxList) {
      while (fxList.length > maxFx) {
        const old = fxList.shift();
        if (old && old.mesh) scene.remove(old.mesh);
      }
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      const t = tracers[i];
      t.life -= dt;
      t.mat.opacity = Math.max(0, t.life / t.maxLife);
      if (t.life <= 0) {
        if (typeof releaseCombatTracer === 'function') releaseCombatTracer(t);
        else {
          scene.remove(t.line);
          t.line.geometry.dispose();
          t.mat.dispose();
        }
        tracers.splice(i, 1);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      const ratio = Math.max(0, s.life / s.maxLife);
      if (typeof s.vx === 'number') s.obj.position.x += s.vx * dt;
      if (typeof s.vy === 'number') s.obj.position.y += s.vy * dt;
      if (typeof s.vz === 'number') s.obj.position.z += s.vz * dt;
      if (s.obj.isLight) s.obj.intensity = 1.8 * ratio;
      else {
        if (s.obj.material) s.obj.material.opacity = ratio * 0.95;
        const baseScale = Number(s.baseScale || 1);
        const peakScale = Number(s.peakScale || baseScale);
        const currentScale = baseScale + (peakScale - baseScale) * (1 - ratio);
        s.obj.scale.setScalar(currentScale);
      }
      if (s.life <= 0) {
        if (typeof releaseCombatSpark === 'function') releaseCombatSpark(s);
        else {
          scene.remove(s.obj);
          if (s.obj.geometry && s.obj.geometry.dispose) s.obj.geometry.dispose();
          if (s.obj.material && s.obj.material.dispose) s.obj.material.dispose();
        }
        sparks.splice(i, 1);
      }
    }
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const f = floatingTexts[i];
      f.life -= dt;
      f.sprite.position.y += dt * 1.1;
      f.mat.opacity = Math.max(0, f.life / f.maxLife);
      if (f.life <= 0) {
        scene.remove(f.sprite);
        f.tex.dispose();
        f.mat.dispose();
        floatingTexts.splice(i, 1);
      }
    }
    if (typeof updateNpcSpeechBubbles === 'function') updateNpcSpeechBubbles(dt);
  }

  let lastCameraFocusX = NaN;
  let lastCameraFocusZ = NaN;
  function updateCamera(dt, force = false) {
    // v7.13: единая камера для ПК и мобильной версии.
    // Положение, высота и угол одинаковые на всех устройствах.
    const modelPos = playerGroup && playerGroup.position ? playerGroup.position : null;
    const focusX = Number.isFinite(modelPos?.x) ? modelPos.x : player.x;
    const focusZ = Number.isFinite(modelPos?.z) ? modelPos.z : player.z;
    if (!force && Math.abs(focusX - lastCameraFocusX) < 0.001 && Math.abs(focusZ - lastCameraFocusZ) < 0.001) return;
    lastCameraFocusX = focusX;
    lastCameraFocusZ = focusZ;
    camera.position.set(focusX - 20, 29, focusZ + 20);
    camera.lookAt(focusX, 0.15, focusZ);
    camera.updateMatrixWorld(true);
  }

  // Подписи над моделями: имя и здоровье. Показываются у именных персонажей
  // (тех, с кем можно говорить) и у других игроков. Точное число HP видно
  // только с перком «Осведомлённость», иначе — словесное состояние.
  const NAMEPLATE_MAX_DISTANCE = 26;
  const NAMEPLATE_HEIGHT = 2.05;
  const nameplatePool = [];
  let nameplateLayer = null;
  const nameplateProjected = new THREE.Vector3();

  function nameplateLayerElement() {
    if (nameplateLayer && nameplateLayer.isConnected) return nameplateLayer;
    nameplateLayer = document.getElementById('actor-nameplates');
    // Раскладку слоя и плашек задаём прямо в элементах, а не только в таблице
    // стилей: у игрока она может лежать в кэше со старой версией, и тогда
    // подписи без position сваливаются потоком в левый верхний угол экрана.
    if (nameplateLayer) {
      const style = nameplateLayer.style;
      style.position = 'fixed';
      style.left = '0';
      style.top = '0';
      style.right = '0';
      style.bottom = '0';
      style.pointerEvents = 'none';
      style.overflow = 'hidden';
    }
    return nameplateLayer;
  }

  function acquireNameplate(index) {
    if (nameplatePool[index]) return nameplatePool[index];
    const layer = nameplateLayerElement();
    if (!layer) return null;
    const node = document.createElement('div');
    node.className = 'actor-nameplate';
    node.style.position = 'absolute';
    node.style.left = '0';
    node.style.top = '0';
    node.style.willChange = 'transform';
    node.style.whiteSpace = 'nowrap';
    node.style.textAlign = 'center';
    const name = document.createElement('span');
    name.className = 'plate-name';
    const health = document.createElement('span');
    health.className = 'plate-health';
    // Перенос строки живёт вместе с именем: у зверья и рядовых врагов имени
    // нет, и пустая строка над здоровьем поднимала бы плашку над пустотой.
    const nameBreak = document.createElement('br');
    node.appendChild(name);
    node.appendChild(nameBreak);
    node.appendChild(health);
    layer.appendChild(node);
    const entry = { node, name, nameBreak, health, nameText: '', healthText: '', tone: '', kind: '' };
    nameplatePool[index] = entry;
    return entry;
  }

  function nameplateHealthText(actor) {
    // Своё здоровье игрок знает и без перка — он видит его в панели.
    const aware = actor?.self === true
      || (typeof talentLevel === 'function' && talentLevel('awareness') > 0);
    const hp = Math.max(0, Math.ceil(Number(actor?.hp || 0)));
    const maxHp = Math.max(1, Math.ceil(Number(actor?.maxHp || hp || 1)));
    if (aware) return `${hp}/${maxHp}`;
    return typeof enemyHealthStateText === 'function' ? enemyHealthStateText(actor) : '';
  }

  function nameplateTone(actor) {
    const hp = Math.max(0, Number(actor?.hp || 0));
    const maxHp = Math.max(1, Number(actor?.maxHp || hp || 1));
    const ratio = hp / maxHp;
    if (ratio <= 0.34) return 'plate-critical';
    if (ratio <= 0.72) return 'plate-hurt';
    return '';
  }

  // Роли, ради которых игрок вообще подходит к НПС. Охрана, рабочие и прочая
  // массовка живут толпами: если подписывать и их, над лагерем встаёт стена
  // текста вместо мира.
  const NAMEPLATE_ROLES = new Set(['merchant', 'trader', 'quartermaster', 'shopkeeper']);

  function isNameplateNpc(enemy) {
    if (!enemy || enemy.canDialogue !== true) return false;
    if (typeof traderNpc !== 'undefined' && traderNpc && enemy === traderNpc) return true;
    // Отбор идёт строго по роли. Торговые поля тут не годятся: у охраны и
    // рабочих стоянки тоже есть traderId, traderProfile и dialogueProfile —
    // у них можно покупать патроны, — поэтому по ним подписывалась вся толпа.
    return NAMEPLATE_ROLES.has(String(enemy.role || enemy.encounterRole || '').toLowerCase());
  }

  function collectNameplateActors() {
    const rows = [];
    const px = Number(player?.x || 0);
    const pz = Number(player?.z || 0);
    // Свой персонаж подписан наравне с остальными: игрок должен видеть, где он
    // в толпе и что с его здоровьем, не отводя взгляд на панель.
    if (player) {
      const drawnSelf = player.mesh?.position;
      rows.push({
        name: String(characterProfile?.name || player.name || 'Странник'),
        hp: player.hp,
        maxHp: player.maxHp,
        x: Number(drawnSelf?.x ?? px),
        z: Number(drawnSelf?.z ?? pz),
        scale: 1,
        kind: 'plate-player',
        self: true
      });
    }
    if (Array.isArray(enemies)) {
      for (const enemy of enemies) {
        if (!enemy || enemy.dead || enemy._removed) continue;
        if (!enemy.mesh || enemy.mesh.visible === false) continue;
        if (Math.hypot(Number(enemy.x || 0) - px, Number(enemy.z || 0) - pz) > NAMEPLATE_MAX_DISTANCE) continue;
        // Здоровье показываем у всех — и у зверья, и у рядовых врагов. Имя
        // получают только важные персонажи: у массовки имена вида «Караванный
        // двор Старого Клима: охрана», и стена такого текста закрывает игру.
        const drawn = enemy.mesh.position;
        rows.push({
          name: isNameplateNpc(enemy) ? String(enemy.name || '') : '',
          hp: enemy.hp,
          maxHp: enemy.maxHp,
          x: Number(drawn?.x ?? enemy.visualX ?? enemy.x ?? 0),
          z: Number(drawn?.z ?? enemy.visualZ ?? enemy.z ?? 0),
          scale: Number(enemy.scale || 1),
          kind: enemy.hostileToPlayer === false ? '' : 'plate-hostile'
        });
      }
    }
    const remote = multiplayer?.remotePlayers;
    if (remote && typeof remote.forEach === 'function') {
      remote.forEach(row => {
        const data = row?.data || {};
        if (!row?.group || row.group.visible === false) return;
        const drawn = row.group.position;
        const x = Number(drawn?.x ?? row.visualX ?? data.x ?? 0);
        const z = Number(drawn?.z ?? row.visualZ ?? data.z ?? 0);
        if (Math.hypot(x - px, z - pz) > NAMEPLATE_MAX_DISTANCE) return;
        rows.push({
          name: String(data.name || 'Игрок'),
          hp: data.hp,
          maxHp: data.maxHp,
          x,
          z,
          scale: 1,
          kind: 'plate-player'
        });
      });
    }
    return rows;
  }

  function updateHpBars() {
    const layer = nameplateLayerElement();
    if (!layer || typeof camera === 'undefined' || !camera) return;
    const rows = collectNameplateActors();
    const rect = canvas.getBoundingClientRect();
    let used = 0;
    for (const row of rows) {
      nameplateProjected.set(row.x, NAMEPLATE_HEIGHT * row.scale, row.z).project(camera);
      if (nameplateProjected.z > 1) continue;
      const left = rect.left + (nameplateProjected.x + 1) * rect.width * 0.5;
      const top = rect.top + (1 - nameplateProjected.y) * rect.height * 0.5;
      if (left < -120 || top < -60 || left > window.innerWidth + 120 || top > window.innerHeight + 60) continue;
      const entry = acquireNameplate(used);
      if (!entry) break;
      used += 1;
      const healthText = nameplateHealthText(row);
      if (entry.nameText !== row.name) {
        entry.name.textContent = row.name;
        entry.nameText = row.name;
        // Без имени плашка сжимается до одной строки со здоровьем.
        const nameDisplay = row.name ? 'inline' : 'none';
        entry.name.style.display = nameDisplay;
        entry.nameBreak.style.display = nameDisplay;
      }
      if (entry.healthText !== healthText) {
        entry.health.textContent = healthText;
        entry.healthText = healthText;
      }
      const tone = nameplateTone(row);
      const className = `actor-nameplate ${row.kind} ${tone}`.replace(/\s+/g, ' ').trim();
      if (entry.node.className !== className) entry.node.className = className;
      entry.node.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0) translate(-50%, -100%)`;
      if (entry.node.style.display !== 'block') entry.node.style.display = 'block';
    }
    for (let index = used; index < nameplatePool.length; index += 1) {
      const entry = nameplatePool[index];
      if (entry && entry.node.style.display !== 'none') entry.node.style.display = 'none';
    }
  }
