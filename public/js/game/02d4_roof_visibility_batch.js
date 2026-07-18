  function isGameplayWorldPointVisibleCompat(worldX, worldZ, options = {}) {
    if (typeof isPointVisibleForGameplay === 'function') {
      return !!isPointVisibleForGameplay(worldX, worldZ, options);
    }
    if (typeof isWorldPointVisibleByRtsFog === 'function') {
      return !!isWorldPointVisibleByRtsFog(worldX, worldZ, options);
    }
    if (!player || typeof worldToTile !== 'function' || typeof hasStrictTileLineOfSight !== 'function') return true;
    const a = worldToTile(player.x || 0, player.z || 0);
    const b = worldToTile(Number(worldX || 0), Number(worldZ || 0));
    const dx = b.tx - a.tx;
    const dz = b.tz - a.tz;
    const radius = typeof perceptionTileVisionRadius === 'function' ? perceptionTileVisionRadius() : 10;
    return dx * dx + dz * dz <= radius * radius && hasStrictTileLineOfSight(a.tx, a.tz, b.tx, b.tz);
  }

  function isGameplayLocalPointVisible(localX, localZ, options = {}) {
    const p = traderBuildingLocalToWorld(localX, localZ);
    return isGameplayWorldPointVisibleCompat(p.x, p.z, options);
  }

  function isTraderWorldPointFogFree(worldX, worldZ) {
    if (!player || typeof worldToTile !== 'function') return false;
    if (!rtsFog || !rtsFog.visibleTiles) return isGameplayWorldPointVisibleCompat(worldX, worldZ);
    const tt = worldToTile(Number(worldX || 0), Number(worldZ || 0));
    const key = typeof tileKey === 'function' ? tileKey(tt.tx, tt.tz) : `${tt.tx},${tt.tz}`;
    return !!rtsFog.visibleTiles.has(key);
  }

  function isTraderLocalPointFogFree(localX, localZ) {
    const p = traderBuildingLocalToWorld(localX, localZ);
    return isTraderWorldPointFogFree(p.x, p.z);
  }

  function traderRoofGateKey(localPlayer = traderPlayerLocalPosition()) {
    // v7.74.24: cheap, stable gate. The roof renderer must not do LOS/probe work
    // every frame while the player walks. A small quantized local key is enough
    // to decide whether the full roof should be open/closed; NPCs/items still
    // have their own visibility checks when the state actually refreshes.
    if (!localPlayer) return 'no-player';
    const qx = Math.floor(Number(localPlayer.x || 0) / 1.0);
    const qz = Math.floor(Number(localPlayer.z || 0) / 1.0);
    const inside = isTraderLocalPointInsideInterior(localPlayer.x, localPlayer.z, 0.30) ? 1 : 0;
    const portal = inside ? 0 : (isTraderPlayerInFastPortalCutawayZone(localPlayer) ? 1 : 0);
    return `${qx}:${qz}:${inside}:${portal}`;
  }

  function shouldEvaluateTraderRoofCutaway(dt = 0) {
    traderRoofCutawayRuntime.elapsed += Math.max(0, Number(dt || 0));
    if (!player) return false;

    const localPlayer = traderPlayerLocalPosition();
    if (!localPlayer) return false;
    const gateKey = traderRoofGateKey(localPlayer);
    const force = !!traderRoofCutawayRuntime.force;
    const fogVersion = typeof rtsFogVisibilityVersion === 'number' ? rtsFogVisibilityVersion : 0;
    const fogChanged = fogVersion !== traderRoofCutawayRuntime.lastFogVisibilityVersion;

    // Refresh when the fog-of-war visible tile set changes. This is the real
    // source of truth for the shell; player-local quantization alone can leave
    // roof/wall alpha stale while floor fog has already changed.
    if (!force && !fogChanged && gateKey === traderRoofCutawayRuntime.lastRoofGateKey) return false;

    const roofCutawayVisible = true;
    const roofStateChanged = roofCutawayVisible !== traderRoofCutawayRuntime.lastFullRoofCutawayVisible;

    traderRoofCutawayRuntime.force = false;
    traderRoofCutawayRuntime.elapsed = 0;
    traderRoofCutawayRuntime.lastPlayerX = Number(player.x || 0);
    traderRoofCutawayRuntime.lastPlayerZ = Number(player.z || 0);
    const tile = typeof worldToTile === 'function' ? worldToTile(player.x || 0, player.z || 0) : { tx: 0, tz: 0 };
    traderRoofCutawayRuntime.lastTileX = tile.tx;
    traderRoofCutawayRuntime.lastTileZ = tile.tz;
    traderRoofCutawayRuntime.lastInside = isTraderLocalPointInsideInterior(localPlayer.x, localPlayer.z, 0.30);
    traderRoofCutawayRuntime.lastRoofGateKey = gateKey;
    traderRoofCutawayRuntime.lastFogVisibilityVersion = fogVersion;
    traderRoofCutawayRuntime.lastFullRoofCutawayVisible = roofCutawayVisible;
    traderRoofCutawayRuntime.evaluatedFullRoofCutawayVisible = roofCutawayVisible;
    traderRoofCutawayRuntime.roofVisibilityChanged = roofStateChanged;

    return force || roofStateChanged || roofCutawayVisible;
  }

  function isTraderLocalPointInsideInterior(localX, localZ, pad = 0) {
    const b = traderInteriorLocalBounds();
    return Number(localX) >= b.minX - pad && Number(localX) <= b.maxX + pad &&
      Number(localZ) >= b.minZ - pad && Number(localZ) <= b.maxZ + pad;
  }

  function traderPlayerLocalPosition() {
    if (!player) return null;
    return traderBuildingWorldToLocal(player.x || 0, player.z || 0);
  }

  function isTraderPlayerInsideInterior() {
    const p = traderPlayerLocalPosition();
    return !!p && isTraderLocalPointInsideInterior(p.x, p.z, 0.30);
  }

  function traderRoofVisionRadiusWorld() {
    const tileRadius = typeof perceptionTileVisionRadius === 'function' ? perceptionTileVisionRadius() : 10;
    return Math.max(6.0, Math.min(18.0, Number(tileRadius || 10) * TILE + 1.75));
  }

  function isTraderPlayerNearRoofEvaluation() {
    const p = traderPlayerLocalPosition();
    if (!p) return false;
    if (isTraderLocalPointInsideInterior(p.x, p.z, 0.30)) return true;
    const b = traderInteriorLocalBounds();
    const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
    const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
    const r = traderRoofVisionRadiusWorld();
    return dx * dx + dz * dz <= r * r;
  }

  function isTraderRoofCutawayContextActive() {
    // The roof/wall shell now reads the already-built fog-of-war field directly.
    // Do not add a second distance gate here, otherwise visible floor tiles can
    // remain covered by roof/wall cells.
    return !!(player && isTraderYardLocation());
  }

  function traderVisionPortalDefinitions() {
    const tile = Number(TILE || 2.0);
    const block = 1.0;
    const halfW = tile * 5;
    const halfD = tile * 4;
    const frontZ = -halfD + block * 0.5;
    const backZ = halfD - block * 0.5;
    const leftX = -halfW + block * 0.5;
    const rightX = halfW - block * 0.5;
    return [
      { wall: 'front', z: frontZ, min: -1.05, max: 1.05, kind: 'front-door' },
      { wall: 'front', z: frontZ, min: -8.05, max: -5.95, kind: 'front-left-window' },
      { wall: 'front', z: frontZ, min: 5.95, max: 8.05, kind: 'front-right-window' },
      { wall: 'back', z: backZ, min: -6.05, max: -3.95, kind: 'back-left-window' },
      { wall: 'back', z: backZ, min: 3.95, max: 6.05, kind: 'back-right-window' },
      { wall: 'left', x: leftX, min: -4.05, max: -1.95, kind: 'left-window' },
      { wall: 'right', x: rightX, min: 1.95, max: 4.05, kind: 'right-window' }
    ];
  }

  function traderPortalRevealDepth(portal) {
    if (!portal) return 0;
    if (portal.kind === 'front-door') return 7.4;
    if (String(portal.kind || '').includes('window')) return 4.2;
    return 5.0;
  }

  function isTraderTargetBehindPortal(target, portal) {
    if (!target || !portal) return false;
    const maxDepth = traderPortalRevealDepth(portal);
    if (portal.wall === 'front') return target.z >= portal.z - 0.08 && target.z <= portal.z + maxDepth;
    if (portal.wall === 'back') return target.z <= portal.z + 0.08 && target.z >= portal.z - maxDepth;
    if (portal.wall === 'left') return target.x >= portal.x - 0.08 && target.x <= portal.x + maxDepth;
    if (portal.wall === 'right') return target.x <= portal.x + 0.08 && target.x >= portal.x - maxDepth;
    return false;
  }

  function lineCrossesTraderPortal(from, to, portal) {
    if (!from || !to || !portal) return false;
    const tolerance = 0.10;
    if (portal.wall === 'front') {
      if (!(from.z < portal.z - tolerance && to.z >= portal.z - tolerance)) return false;
      const dz = to.z - from.z;
      if (Math.abs(dz) < 0.001) return false;
      const t = (portal.z - from.z) / dz;
      if (t < 0 || t > 1) return false;
      const crossX = from.x + (to.x - from.x) * t;
      return crossX >= portal.min - tolerance && crossX <= portal.max + tolerance;
    }
    if (portal.wall === 'back') {
      if (!(from.z > portal.z + tolerance && to.z <= portal.z + tolerance)) return false;
      const dz = to.z - from.z;
      if (Math.abs(dz) < 0.001) return false;
      const t = (portal.z - from.z) / dz;
      if (t < 0 || t > 1) return false;
      const crossX = from.x + (to.x - from.x) * t;
      return crossX >= portal.min - tolerance && crossX <= portal.max + tolerance;
    }
    if (portal.wall === 'left') {
      if (!(from.x < portal.x - tolerance && to.x >= portal.x - tolerance)) return false;
      const dx = to.x - from.x;
      if (Math.abs(dx) < 0.001) return false;
      const t = (portal.x - from.x) / dx;
      if (t < 0 || t > 1) return false;
      const crossZ = from.z + (to.z - from.z) * t;
      return crossZ >= portal.min - tolerance && crossZ <= portal.max + tolerance;
    }
    if (portal.wall === 'right') {
      if (!(from.x > portal.x + tolerance && to.x <= portal.x + tolerance)) return false;
      const dx = to.x - from.x;
      if (Math.abs(dx) < 0.001) return false;
      const t = (portal.x - from.x) / dx;
      if (t < 0 || t > 1) return false;
      const crossZ = from.z + (to.z - from.z) * t;
      return crossZ >= portal.min - tolerance && crossZ <= portal.max + tolerance;
    }
    return false;
  }

  function isTraderLocalPointVisibleThroughPortal(localX, localZ) {
    const p = traderPlayerLocalPosition();
    if (!p || isTraderLocalPointInsideInterior(p.x, p.z, 0.30)) return false;
    if (!isTraderPlayerNearRoofEvaluation()) return false;
    if (!isTraderLocalPointInsideInterior(localX, localZ, 0.18)) return false;
    const target = { x: Number(localX || 0), z: Number(localZ || 0) };
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const r = traderRoofVisionRadiusWorld();
    if (dx * dx + dz * dz > r * r) return false;
    const portals = traderVisionPortalDefinitions();
    for (const portal of portals) {
      if (!isTraderTargetBehindPortal(target, portal)) continue;
      if (lineCrossesTraderPortal(p, target, portal)) return true;
    }
    return false;
  }


  function isTraderExteriorOccluderLocalPoint(localX, localZ, opts = {}) {
    if (!player || !camera || !isTraderYardLocation()) return false;
    const localPlayer = traderPlayerLocalPosition();
    if (!localPlayer) return false;
    const tile = Number(TILE || 2.0);
    const nearBuilding = isTraderPlayerNearRoofEvaluation() || Math.abs(localPlayer.x) <= tile * 6.0 && Math.abs(localPlayer.z) <= tile * 5.0;
    if (!nearBuilding) return false;
    const kind = String(opts.kind || 'roof');
    const sx = Number(opts.sx || tile);
    const sz = Number(opts.sz || tile);
    const roofY = kind === 'roof'
      ? Number(opts.y ?? (5.32 + Math.min(0.38, Math.abs(Number(localZ || 0)) * 0.045)))
      : Number(opts.y ?? 1.8);
    return isTraderBoxOccludingPlayer(buildTraderRoofCellBox(localX, localZ, sx, sz, roofY), {
      pad: 0.00,
      playerY: 1.12
    });
  }

  function isTraderRoofLocalPointVisible(localX, localZ) {
    if (!isTraderRoofCutawayContextActive()) return false;
    return isGameplayLocalPointVisible(localX, localZ);
  }

  function traderRoofPanelCutawayRadiusWorld() {
    // v7.74.90: the roof cutaway uses the same perception budget as normal
    // fog-of-war. Indoor and outdoor visibility must feel identical; the roof
    // only changes opacity for cells that the character could normally see.
    return traderRoofVisionRadiusWorld();
  }

  function isTraderRoofPanelLocalPointCutaway(localX, localZ, opts = {}) {
    if (!isTraderRoofCutawayContextActive()) return false;
    const sx = opts.sx || TILE;
    const sz = opts.sz || TILE;
    // Flat roof: first follow exact fog-of-war cells. Then also open a roof
    // fragment if its actual screen projection covers a fog-free ground cell.
    // This catches camera-overlap cases without returning to sloped-roof margins.
    if (isTraderGameplayLocalAreaVisible(localX, localZ, sx, sz)) return true;
    return isTraderRoofScreenProjectionCoveringFogFreeGround(localX, localZ, sx, sz, opts.y);
  }

  function anyTraderRoofPanelSamplesCutaway(samples) {
    if (!samples || !samples.length) return false;
    for (const s of samples) {
      if (!s) continue;
      if (isTraderRoofPanelLocalPointCutaway(s.x, s.z, { sx: s.sx, sz: s.sz, y: s.y })) return true;
    }
    return false;
  }

  function isTraderLocalPointVisibleFromInside(localX, localZ) {
    return isGameplayLocalPointVisible(localX, localZ);
  }

  function isTraderBuildingLocalPointVisible(localX, localZ) {
    if (!player || !isTraderYardLocation()) return false;
    return isGameplayLocalPointVisible(localX, localZ);
  }

  function isTraderWorldPointVisible(worldX, worldZ) {
    if (!player || !isTraderYardLocation()) return false;
    return isGameplayWorldPointVisibleCompat(worldX, worldZ);
  }

  function anyTraderLocalSamplesVisible(samples) {
    if (!samples || !samples.length) return false;
    for (const s of samples) {
      if (isGameplayLocalPointVisible(s.x, s.z)) return true;
    }
    return false;
  }

  function traderRoofCutawayProbeSamples() {
    // A tiny logical grid used only to decide whether the whole roof should
    // hide. It is not rendered and it is intentionally small so entering the
    // building never updates dozens of roof meshes. NPCs/items/lights still use
    // exact object visibility checks after the roof state is chosen.
    const b = traderInteriorLocalBounds();
    const samples = [
      { x: 0.0, z: b.minZ + 1.20 },
      { x: -1.4, z: b.minZ + 2.45 },
      { x: 1.4, z: b.minZ + 2.45 },
      { x: -5.65, z: b.minZ + 1.85 },
      { x: 5.65, z: b.minZ + 1.85 },
      { x: 0.0, z: 0.0 },
      { x: -3.20, z: 0.35 },
      { x: 3.20, z: 0.35 },
      { x: -2.40, z: b.maxZ - 1.65 },
      { x: 2.40, z: b.maxZ - 1.65 },
      { x: b.minX + 1.35, z: -2.00 },
      { x: b.maxX - 1.35, z: 2.00 }
    ];
    return samples;
  }

  function isTraderPlayerInFastPortalCutawayZone(localPlayer = traderPlayerLocalPosition()) {
    if (!localPlayer || !isTraderPlayerNearRoofEvaluation()) return false;
    const p = localPlayer;
    const portals = traderVisionPortalDefinitions();
    for (const portal of portals) {
      const isDoor = portal.kind === 'front-door';
      const maxDepth = isDoor ? 6.2 : 3.0;
      let normalDistance = Infinity;
      let lateral = 0;
      if (portal.wall === 'front') {
        if (p.z > portal.z + 0.18) continue;
        normalDistance = portal.z - p.z;
        lateral = p.x < portal.min ? portal.min - p.x : (p.x > portal.max ? p.x - portal.max : 0);
      } else if (portal.wall === 'back') {
        if (p.z < portal.z - 0.18) continue;
        normalDistance = p.z - portal.z;
        lateral = p.x < portal.min ? portal.min - p.x : (p.x > portal.max ? p.x - portal.max : 0);
      } else if (portal.wall === 'left') {
        if (p.x > portal.x + 0.18) continue;
        normalDistance = portal.x - p.x;
        lateral = p.z < portal.min ? portal.min - p.z : (p.z > portal.max ? p.z - portal.max : 0);
      } else if (portal.wall === 'right') {
        if (p.x < portal.x - 0.18) continue;
        normalDistance = p.x - portal.x;
        lateral = p.z < portal.min ? portal.min - p.z : (p.z > portal.max ? p.z - portal.max : 0);
      }
      if (normalDistance < -0.18 || normalDistance > maxDepth) continue;
      // Wider cones near doors, narrower cones near windows. This is only the
      // roof-open switch; NPC/item visibility is still checked separately.
      const lateralAllowance = (isDoor ? 0.95 : 0.45) + normalDistance * (isDoor ? 0.45 : 0.22);
      if (lateral <= lateralAllowance) return true;
    }
    return false;
  }

  function isTraderFullRoofCutawayVisible() {
    const p = traderPlayerLocalPosition();
    if (!p) return false;
    if (isTraderLocalPointInsideInterior(p.x, p.z, 0.30)) return true;
    // v7.74.23: the whole-roof cutaway no longer probes a logical grid while
    // the player moves. It uses cheap local zones only as a refresh gate, not as a visibility source.
    return isTraderPlayerInFastPortalCutawayZone(p);
  }

  function createTraderRoofGridSamples(x, z, sx, sz) {
    // v7.74.17: one roof cell equals one world-grid cell, so one centre sample
    // is enough and avoids hundreds of LOS checks when the cutaway changes.
    return [{ x, z }];
  }

  function createTraderRoofSegment(group, id, x, z, sx, sz, rx, material, samples) {
    const roofY = 5.32 + Math.min(0.38, Math.abs(z) * 0.045);
    const roof = createBuildingBox(group, x, roofY, z, sx, 0.20, sz, material, { kind: `trader-shell-roof-grid-${id}`, rx });
    roof.userData.traderRoofPanel = true;
    roof.userData.traderRoofGridCell = true;
    roof.userData.forceNoShadow = true;
    roof.castShadow = false;
    roof.receiveShadow = false;
    roof.frustumCulled = false;
    roof.userData.traderRoofHidden = false;
    roof.userData.traderRoofSamples = samples && samples.length ? samples : createTraderRoofGridSamples(x, z, sx, sz);
    traderBuildingCutawayRoofs.push(roof);
    return roof;
  }


  function traderRoofCellMatrix(cell, target) {
    const y = Number(cell.y ?? (5.32 + Math.min(0.38, Math.abs(cell.z) * 0.045)));
    traderRoofCutawayRuntime.batchedRoofPosition.set(cell.x, y, cell.z);
    traderRoofCutawayRuntime.batchedRoofQuaternion.setFromEuler(new THREE.Euler(cell.rx || 0, 0, 0));
    traderRoofCutawayRuntime.batchedRoofScale.set(cell.sx + 0.018, 1, cell.sz + 0.018);
    target.compose(
      traderRoofCutawayRuntime.batchedRoofPosition,
      traderRoofCutawayRuntime.batchedRoofQuaternion,
      traderRoofCutawayRuntime.batchedRoofScale
    );
    return target;
  }

  function updateTraderRoofCellInstance(batch, cell) {
    // Geometry transforms are immutable after roof construction. Changing matrix
    // data while walking near the door caused mobile stalls; runtime cutaway now
    // touches only a tiny Float32 instanced attribute.
    if (!batch || !batch.mesh || !cell || cell.instanceIndex === undefined) return;
    batch.mesh.visible = true;
    if (batch.ghostMesh) batch.ghostMesh.visible = true;
  }

  function rebuildTraderRoofBatch(batch) {
    if (!batch || !batch.mesh || !batch.cells) return;
    batch.cells.forEach((cell, index) => { if (cell) cell.instanceIndex = index; });
    updateTraderRoofVisionCells(batch, true);
    batch.mesh.visible = true;
    if (batch.ghostMesh) batch.ghostMesh.visible = true;
  }

  function inferTraderRoofGridDimensions(cells) {
    const xs = [];
    const zs = [];
    (cells || []).forEach(cell => {
      if (!cell) return;
      const x = Number(cell.x || 0);
      const z = Number(cell.z || 0);
      if (!xs.some(v => Math.abs(v - x) < 0.01)) xs.push(x);
      if (!zs.some(v => Math.abs(v - z) < 0.01)) zs.push(z);
    });
    xs.sort((a, b) => a - b);
    zs.sort((a, b) => a - b);
    return { xs, zs, width: Math.max(1, xs.length), height: Math.max(1, zs.length) };
  }

  function createTraderRoofGridBatch(group, id, cells, material, panelOpts = {}) {
    const safeCells = (cells || []).filter(Boolean);
    const inferredGrid = inferTraderRoofGridDimensions(safeCells);
    const grid = panelOpts.grid || cells.grid || inferredGrid;
    const maskData = new Uint8Array(Math.max(1, Number(grid.width || 1)) * Math.max(1, Number(grid.height || 1)));
    const maskTexture = createTraderRoofMaskTexture(grid.width, grid.height, maskData);
    const geometry = createTraderContinuousRoofPanelGeometry(safeCells, panelOpts);
    const bounds = geometry.userData?.traderRoofMaskBounds || panelOpts.maskBounds || geometry.userData?.traderRoofBounds || { minX: -1, minZ: -1, width: 2, depth: 2 };
    const roofMaterial = createTraderVisionRoofMaterial(material, maskTexture, bounds, { openOpacity: 0.24 });
    const mesh = new THREE.Mesh(geometry, roofMaterial);
    mesh.name = `trader-roof-wood-single-mask-${id}`;
    mesh.userData.kind = `trader-shell-roof-wood-single-mask-${id}`;
    mesh.userData.traderRoofPanel = true;
    mesh.userData.traderRoofGridBatch = true;
    mesh.userData.forceNoShadow = true;
    mesh.userData.roofCutawayArray = maskData;
    mesh.userData.roofCutawayTexture = maskTexture;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    safeCells.forEach((cell, index) => {
      cell.instanceIndex = index;
      cell.cutaway = false;
      const col = Number.isFinite(Number(cell.maskCol)) ? Number(cell.maskCol) : grid.xs.findIndex(v => Math.abs(v - Number(cell.x || 0)) < 0.01);
      const row = Number.isFinite(Number(cell.maskRow)) ? Number(cell.maskRow) : grid.zs.findIndex(v => Math.abs(v - Number(cell.z || 0)) < 0.01);
      cell.maskIndex = Math.max(0, row) * Math.max(1, Number(grid.width || 1)) + Math.max(0, col);
    });
    const batch = { id, mesh, ghostMesh: null, cells: safeCells, dirty: true, grid, maskData, maskTexture };
    traderBuildingCutawayRoofBatches.push(batch);
    group.add(mesh);
    rebuildTraderRoofBatch(batch);
    return batch;
  }

  function setTraderRoofBatchCellCutaway(batch, cell, cutaway) {
    if (!batch || !batch.mesh || !cell) return false;
    const next = !!cutaway;
    if (cell.cutaway === next) return false;
    cell.cutaway = next;
    cell.hidden = false;
    const array = batch.maskData || batch.mesh.userData?.roofCutawayArray;
    const index = Number(cell.maskIndex ?? cell.instanceIndex ?? -1);
    if (array && index >= 0 && index < array.length) array[index] = next ? 255 : 0;
    return true;
  }

  function updateTraderRoofVisionCells(batch = null, force = false) {
    const batches = batch ? [batch] : traderBuildingCutawayRoofBatches;
    let changed = false;
    batches.forEach(item => {
      if (!item || !item.mesh || !item.cells) return;
      let itemChanged = false;
      const array = item.maskData || item.mesh.userData?.roofCutawayArray;
      item.cells.forEach(cell => {
        if (!cell) return;
        // The roof never disappears. A logical cell that is inside the player's
        // current vision becomes almost transparent in the mask; fogged cells
        // stay opaque and textured.
        const cutaway = anyTraderRoofPanelSamplesCutaway(cell.samples || cell.traderRoofSamples || [{ x: cell.x, z: cell.z }]);
        const index = Number(cell.maskIndex ?? cell.instanceIndex ?? -1);
        if (force) {
          if (array && index >= 0 && index < array.length) array[index] = cutaway ? 255 : 0;
          if (cell.cutaway !== cutaway) itemChanged = true;
          cell.cutaway = cutaway;
          cell.hidden = false;
        } else if (setTraderRoofBatchCellCutaway(item, cell, cutaway)) {
          itemChanged = true;
        }
      });
      if ((force || itemChanged) && item.maskTexture) item.maskTexture.needsUpdate = true;
      item.mesh.visible = true;
      if (item.ghostMesh) item.ghostMesh.visible = true;
      changed = changed || itemChanged || force;
    });
    return changed;
  }

  function createTraderFogSegment(group, id, x, z, sx, sz, material, samples) {
    // Interior hiding is logical, not a visible square overlay.
    // The roof cell itself is the visual blocker for unseen room cells; NPCs,
    // corpses, dropped items and lights are hidden by LOS. Rendering extra dark
    // floor quads under the roof created grey square artefacts and extra drawcalls.
    return null;
  }

  function createBuildingWindow(group, x, y, z, sx, sy, sz = 0.045, opts = {}) {
    const glass = createBuildingBox(group, x, y, z, sx, sy, sz, mats.traderBuildingWindowDark, {
      castShadow: false,
      receiveShadow: false,
      kind: 'trader-building-window',
      name: opts.name || 'trader-window'
    });
    if (opts.ry) glass.rotation.y = opts.ry;
    const frameMat = opts.frameMat || mats.darkMetal;
    const frameDepth = sz * 1.35;
    createBuildingBox(group, x, y + sy * 0.52, z, sx + 0.12, 0.055, frameDepth, frameMat, { castShadow: true, kind: 'trader-window-frame' });
    createBuildingBox(group, x, y - sy * 0.52, z, sx + 0.12, 0.055, frameDepth, frameMat, { castShadow: true, kind: 'trader-window-frame' });
    createBuildingBox(group, x - sx * 0.52, y, z, 0.055, sy + 0.12, frameDepth, frameMat, { castShadow: true, kind: 'trader-window-frame' });
    createBuildingBox(group, x + sx * 0.52, y, z, 0.055, sy + 0.12, frameDepth, frameMat, { castShadow: true, kind: 'trader-window-frame' });

    if (opts.grille) {
      const grilleMat = opts.grilleMat || mats.darkMetal;
      const verticalBars = opts.verticalBars || 3;
      const horizontalBars = opts.horizontalBars || 1;
      const barW = opts.barWidth || 0.05;
      const barDepth = frameDepth * 1.25;
      const grilleInset = opts.grilleInset || 0.02;
      const isSide = !!opts.ry;
      const grilleZ = isSide ? z : z + (opts.grilleFacingBack ? -grilleInset : grilleInset);
      const grilleX = isSide ? x + (Math.cos(opts.ry) > 0 ? grilleInset : -grilleInset) : x;
      for (let i = 1; i <= verticalBars; i++) {
        const t = i / (verticalBars + 1);
        if (isSide) {
          const pz = z - sx * 0.5 + sx * t;
          createBuildingBox(group, grilleX, y, pz, barDepth, sy + 0.02, barW, grilleMat, { castShadow: true, kind: 'trader-window-grille' });
        } else {
          const px = x - sx * 0.5 + sx * t;
          createBuildingBox(group, px, y, grilleZ, barW, sy + 0.02, barDepth, grilleMat, { castShadow: true, kind: 'trader-window-grille' });
        }
      }
      for (let i = 1; i <= horizontalBars; i++) {
        const t = i / (horizontalBars + 1);
        if (isSide) {
          const py = y - sy * 0.5 + sy * t;
          createBuildingBox(group, grilleX, py, z, barDepth, barW, sx + 0.02, grilleMat, { castShadow: true, kind: 'trader-window-grille' });
        } else {
          const py = y - sy * 0.5 + sy * t;
          createBuildingBox(group, x, py, grilleZ, sx + 0.02, barW, barDepth, grilleMat, { castShadow: true, kind: 'trader-window-grille' });
        }
      }
    }
    return glass;
  }

