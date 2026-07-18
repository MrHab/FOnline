  function traderBuildingLocalToWorld(localX, localZ) {
    const c = traderBuildingCenterWorld();
    return { x: c.x + Number(localX || 0), z: c.z + Number(localZ || 0) };
  }

  function traderBuildingWorldToLocal(worldX, worldZ) {
    const c = traderBuildingCenterWorld();
    return { x: Number(worldX || 0) - c.x, z: Number(worldZ || 0) - c.z };
  }

  function traderInteriorLocalBounds() {
    // v7.75.30: building construction rule is one block = 2 x 2 x 1 meter.
    // The trader shell keeps its 20 x 16 m footprint, but wall thickness is
    // two meters instead of a full gameplay TILE. Interior starts behind that
    // two-meter wall shell.
    const tile = Number(TILE || 2.0);
    const block = 1.0;
    const halfW = tile * 5;
    const halfD = tile * 4;
    return {
      minX: -halfW + block + 0.10,
      maxX: halfW - block - 0.10,
      minZ: -halfD + block + 0.10,
      maxZ: halfD - block - 0.10
    };
  }

  function setVisibleStable(object, visible) {
    if (!object || object.visible === visible) return false;
    object.visible = visible;
    return true;
  }

  function applyTraderOccluderOpacity(object, opacity = 1.0) {
    if (!object) return false;
    const baseAlpha = Math.max(0.04, Math.min(1.0, Number(opacity || 0)));
    const windowGlassAlpha = object?.userData?.traderAlwaysTranslucent ? Number(object.userData.traderBaseOpacity || 0.42) : 1.0;
    const alpha = Math.min(baseAlpha, windowGlassAlpha);
    object.userData = object.userData || {};
    const prev = typeof object.userData.traderOccluderOpacity === 'number' ? object.userData.traderOccluderOpacity : 1.0;
    if (Math.abs(prev - alpha) < 0.001) return false;
    if (object.userData.instancedOccluderBatch) {
      return setInstancedModuleOpacity(object, alpha);
    }
    const applyToMesh = (mesh) => {
      if (!mesh || !mesh.material) return;
      const alwaysTranslucent = !!(mesh.userData?.traderAlwaysTranslucent || object.userData?.traderAlwaysTranslucent);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(mat => {
        if (!mat) return;
        mat.transparent = alwaysTranslucent || alpha < 0.999;
        if (typeof mat.opacity === 'number') mat.opacity = alpha;
        if ('depthWrite' in mat) mat.depthWrite = alwaysTranslucent ? false : (alpha >= 0.999);
        if ('depthTest' in mat) mat.depthTest = true;
        if ('needsUpdate' in mat) mat.needsUpdate = true;
      });
      mesh.renderOrder = alwaysTranslucent ? 5 : (alpha < 0.999 ? 18 : 0);
    };
    if (object.isMesh) applyToMesh(object);
    else if (typeof object.traverse === 'function') object.traverse(child => { if (child && child.isMesh) applyToMesh(child); });
    if (Array.isArray(object.userData?.traderLinkedOccluders)) {
      object.userData.traderLinkedOccluders.forEach(child => {
        if (!child) return;
        if (child.isMesh) applyToMesh(child);
        else if (typeof child.traverse === 'function') child.traverse(mesh => { if (mesh && mesh.isMesh) applyToMesh(mesh); });
      });
    }
    object.userData.traderOccluderOpacity = alpha;
    return true;
  }

  function traderCameraToPlayerRaySegment(opts = {}) {
    if (!player || !camera || !camera.position) return null;
    const playerY = Number(opts.playerY ?? 1.12);
    const from = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z);
    const to = new THREE.Vector3(Number(player.x || 0), playerY, Number(player.z || 0));
    const dir = to.clone().sub(from);
    const length = dir.length();
    if (!Number.isFinite(length) || length <= 0.001) return null;
    dir.multiplyScalar(1 / length);
    return { from, to, dir, length };
  }

  function isTraderBoxOccludingPlayer(box, opts = {}) {
    if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return false;
    const raySeg = traderCameraToPlayerRaySegment(opts);
    if (!raySeg) return false;
    const pad = Number(opts.pad ?? 0.02);
    const expanded = box.clone();
    expanded.expandByScalar(pad);
    const hit = new THREE.Vector3();
    const ray = new THREE.Ray(raySeg.from, raySeg.dir);
    const result = ray.intersectBox(expanded, hit);
    if (!result) return false;
    const hitDist = hit.distanceTo(raySeg.from);
    return hitDist > 0.02 && hitDist < raySeg.length - 0.08;
  }

  function isTraderScreenOccludingPlayer(worldX, worldY, worldZ, opts = {}) {
    // Compatibility wrapper: use a tiny box around the point and test the actual
    // camera-to-player ray segment. This is intentionally stricter than the old
    // projected point overlap, so nearby walls do not fade unless they really
    // cover the player.
    if (!Number.isFinite(Number(worldX)) || !Number.isFinite(Number(worldZ))) return false;
    const y = Number.isFinite(Number(worldY)) ? Number(worldY) : Number(opts.y ?? 1.8);
    const radius = Number(opts.radius ?? 0.16);
    const box = new THREE.Box3(
      new THREE.Vector3(Number(worldX) - radius, y - radius, Number(worldZ) - radius),
      new THREE.Vector3(Number(worldX) + radius, y + radius, Number(worldZ) + radius)
    );
    return isTraderBoxOccludingPlayer(box, opts);
  }

  function isTraderAnyScreenSampleOccludingPlayer(samples, opts = {}) {
    if (!samples || !samples.length) return false;
    for (const s of samples) {
      if (!s) continue;
      if (isTraderScreenOccludingPlayer(s.x, s.y, s.z, opts)) return true;
    }
    return false;
  }

  function buildTraderAabbScreenSamples(minX, minY, minZ, maxX, maxY, maxZ, opts = {}) {
    const samples = [];
    const xm = (Number(minX || 0) + Number(maxX || 0)) * 0.5;
    const ym = (Number(minY || 0) + Number(maxY || 0)) * 0.5;
    const zm = (Number(minZ || 0) + Number(maxZ || 0)) * 0.5;
    samples.push({ x: xm, y: ym, z: zm });
    return samples;
  }

  function buildTraderWallBlockBox(block) {
    const ud = block?.userData || {};
    const wx = Number(ud.traderWallWorldX || 0);
    const wz = Number(ud.traderWallWorldZ || 0);
    const sx = Math.max(0.1, Number(ud.traderWallSizeX || TILE || 2.0));
    const sy = Math.max(0.1, Number(ud.traderWallSizeY || 1.3));
    const sz = Math.max(0.1, Number(ud.traderWallSizeZ || TILE || 2.0));
    const bottomY = Number(ud.traderWallBottomY);
    const topY = Number(ud.traderWallTopY);
    const cy = Number.isFinite(bottomY) && Number.isFinite(topY) && topY > bottomY
      ? (bottomY + topY) * 0.5
      : Number(block?.position?.y || sy * 0.5);
    return new THREE.Box3(
      new THREE.Vector3(wx - sx * 0.5, cy - sy * 0.5, wz - sz * 0.5),
      new THREE.Vector3(wx + sx * 0.5, cy + sy * 0.5, wz + sz * 0.5)
    );
  }

  function buildTraderAuthoredRoofBlockBox(block) {
    const ud = block?.userData || {};
    const wx = Number.isFinite(Number(ud.traderRoofWorldX)) ? Number(ud.traderRoofWorldX) : Number(block?.position?.x || 0);
    const wz = Number.isFinite(Number(ud.traderRoofWorldZ)) ? Number(ud.traderRoofWorldZ) : Number(block?.position?.z || 0);
    const sx = Math.max(0.1, Number(ud.traderRoofSizeX || TILE || 2.0));
    const sy = Math.max(0.04, Number(ud.traderRoofSizeY || 0.20));
    const sz = Math.max(0.1, Number(ud.traderRoofSizeZ || TILE || 2.0));
    const cy = Number.isFinite(Number(ud.traderRoofWorldY))
      ? Number(ud.traderRoofWorldY)
      : Number(block?.position?.y || 0) + sy * 0.5;
    const sig = `${wx}|${cy}|${wz}|${sx}|${sy}|${sz}`;
    if (ud.traderRoofWorldBox && ud.traderRoofWorldBoxSig === sig) return ud.traderRoofWorldBox;
    ud.traderRoofWorldBoxSig = sig;
    ud.traderRoofWorldBox = new THREE.Box3(
      new THREE.Vector3(wx - sx * 0.5, cy - sy * 0.5, wz - sz * 0.5),
      new THREE.Vector3(wx + sx * 0.5, cy + sy * 0.5, wz + sz * 0.5)
    );
    return ud.traderRoofWorldBox;
  }

  function traderCutawayShellWorldBounds() {
    const cached = traderRoofCutawayRuntime.shellBoundsCache;
    const wallCount = traderBuildingWallBlocks.length;
    const roofCount = traderBuildingAuthoredRoofBlocks.length;
    const interiorCount = traderBuildingInteriorObjects.length;
    if (cached && cached.wallCount === wallCount && cached.roofCount === roofCount && cached.interiorCount === interiorCount) return cached.bounds;
    const boxes = [];
    traderBuildingWallBlocks.forEach(block => {
      const box = buildTraderWallBlockBox(block);
      if (box && Number.isFinite(box.min?.x) && Number.isFinite(box.max?.x)) boxes.push(box);
    });
    traderBuildingAuthoredRoofBlocks.forEach(block => {
      const box = buildTraderAuthoredRoofBlockBox(block);
      if (box && Number.isFinite(box.min?.x) && Number.isFinite(box.max?.x)) boxes.push(box);
    });
    traderBuildingInteriorObjects.forEach(obj => {
      if (!obj || obj.userData?.traderNpc || !obj.userData?.traderInterior) return;
      const box = typeof buildTraderObjectBox === 'function' ? buildTraderObjectBox(obj) : null;
      if (box && Number.isFinite(box.min?.x) && Number.isFinite(box.max?.x)) boxes.push(box);
    });
    if (!boxes.length) return null;
    const bounds = boxes[0].clone();
    for (let i = 1; i < boxes.length; i++) bounds.union(boxes[i]);
    traderRoofCutawayRuntime.shellBoundsCache = { wallCount, roofCount, interiorCount, bounds };
    return bounds;
  }

  function invalidateTraderShellBoundsCache() {
    traderRoofCutawayRuntime.shellBoundsCache = null;
    traderRoofCutawayRuntime.roofCutawayCache = null;
  }

  function invalidateTraderWallCutawayCache() {
    traderRoofCutawayRuntime.wallCutawayCache = null;
    invalidateTraderShellBoundsCache();
  }

  function getTraderWallCutawayCache() {
    const count = traderBuildingWallBlocks.length;
    const cached = traderRoofCutawayRuntime.wallCutawayCache;
    if (cached && cached.count === count) return cached;
    const rows = traderBuildingWallBlocks
      .map(block => ({ block, box: buildTraderWallBlockBox(block) }))
      .filter(row => row.box && Number.isFinite(row.box.min.x));
    const cellSize = Math.max(0.5, Number(TILE || 2.0));
    const grid = new Map();
    const addGridRow = (gx, gz, row) => {
      const key = `${gx}:${gz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(row);
    };
    rows.forEach(row => {
      const minGX = Math.floor(row.box.min.x / cellSize) - 1;
      const maxGX = Math.floor(row.box.max.x / cellSize) + 1;
      const minGZ = Math.floor(row.box.min.z / cellSize) - 1;
      const maxGZ = Math.floor(row.box.max.z / cellSize) + 1;
      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gz = minGZ; gz <= maxGZ; gz++) addGridRow(gx, gz, row);
      }
    });
    const area = rows.reduce((acc, row) => {
      acc.minX = Math.min(acc.minX, row.box.min.x);
      acc.maxX = Math.max(acc.maxX, row.box.max.x);
      acc.minZ = Math.min(acc.minZ, row.box.min.z);
      acc.maxZ = Math.max(acc.maxZ, row.box.max.z);
      return acc;
    }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const next = { count, rows, area, grid, cellSize };
    traderRoofCutawayRuntime.wallCutawayCache = next;
    return next;
  }

  function getTraderAuthoredRoofCutawayCache() {
    const count = traderBuildingAuthoredRoofBlocks.length;
    const cached = traderRoofCutawayRuntime.roofCutawayCache;
    if (cached && cached.count === count) return cached;
    const rows = traderBuildingAuthoredRoofBlocks
      .map(block => {
        const box = buildTraderAuthoredRoofBlockBox(block);
        return {
          block,
          box,
          cx: box && Number.isFinite(box.min?.x) ? (box.min.x + box.max.x) * 0.5 : 0,
          cz: box && Number.isFinite(box.min?.z) ? (box.min.z + box.max.z) * 0.5 : 0
        };
      })
      .filter(row => row.box && Number.isFinite(row.box.min.x));
    const area = rows.reduce((acc, row) => {
      acc.minX = Math.min(acc.minX, row.box.min.x);
      acc.maxX = Math.max(acc.maxX, row.box.max.x);
      acc.minZ = Math.min(acc.minZ, row.box.min.z);
      acc.maxZ = Math.max(acc.maxZ, row.box.max.z);
      return acc;
    }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const next = { count, rows, area };
    traderRoofCutawayRuntime.roofCutawayCache = next;
    return next;
  }

  function traderDistanceSqToBoxXZ(box, x, z) {
    if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return Infinity;
    const px = Number(x || 0);
    const pz = Number(z || 0);
    const dx = px < box.min.x ? box.min.x - px : (px > box.max.x ? px - box.max.x : 0);
    const dz = pz < box.min.z ? box.min.z - pz : (pz > box.max.z ? pz - box.max.z : 0);
    return dx * dx + dz * dz;
  }

  function traderCutawayNearRadiusWorld() {
    const vision = typeof traderRoofVisionRadiusWorld === 'function' ? Number(traderRoofVisionRadiusWorld() || 0) : 0;
    return Math.max(8.0, vision * 1.35, Number(TILE || 2.0) * 5.0);
  }

  function traderRowsNearWorldPoint(rows = [], x = 0, z = 0, radius = traderCutawayNearRadiusWorld()) {
    const r2 = Math.max(0.1, Number(radius || 0)) ** 2;
    return (rows || []).filter(row => row && traderDistanceSqToBoxXZ(row.box, x, z) <= r2);
  }

  function traderWallRowsAlongSegment(cache, x1, z1, x2, z2) {
    const rows = cache?.rows || [];
    const grid = cache?.grid;
    const area = cache?.area;
    if (!rows.length || !grid || !area || !Number.isFinite(area.minX)) return rows;
    const pad = Math.max(Number(cache.cellSize || TILE || 2.0) * 2.0, 2.0);
    const segMinX = Math.min(Number(x1 || 0), Number(x2 || 0));
    const segMaxX = Math.max(Number(x1 || 0), Number(x2 || 0));
    const segMinZ = Math.min(Number(z1 || 0), Number(z2 || 0));
    const segMaxZ = Math.max(Number(z1 || 0), Number(z2 || 0));
    if (segMaxX < area.minX - pad || segMinX > area.maxX + pad ||
        segMaxZ < area.minZ - pad || segMinZ > area.maxZ + pad) return [];
    const cellSize = Math.max(0.5, Number(cache.cellSize || TILE || 2.0));
    const dx = Number(x2 || 0) - Number(x1 || 0);
    const dz = Number(z2 || 0) - Number(z1 || 0);
    const distance = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.min(96, Math.ceil(distance / Math.max(0.75, cellSize * 0.70))));
    const seen = new Set();
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Number(x1 || 0) + dx * t;
      const z = Number(z1 || 0) + dz * t;
      if (x < area.minX - pad || x > area.maxX + pad || z < area.minZ - pad || z > area.maxZ + pad) continue;
      const gx = Math.floor(x / cellSize);
      const gz = Math.floor(z / cellSize);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = grid.get(`${gx + ox}:${gz + oz}`);
          if (!bucket) continue;
          bucket.forEach(row => {
            if (!row || seen.has(row)) return;
            seen.add(row);
            out.push(row);
          });
        }
      }
    }
    return out.length ? out : rows;
  }

  function buildTraderWallBlockScreenSamples(block) {
    const box = buildTraderWallBlockBox(block);
    const c = box.getCenter(new THREE.Vector3());
    return [{ x: c.x, y: c.y, z: c.z }];
  }

  function buildTraderObjectBox(obj) {
    if (!obj) return null;
    const box = new THREE.Box3();
    try {
      box.setFromObject(obj);
    } catch (e) {
      return null;
    }
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null;
    return box;
  }

  function buildTraderObjectScreenSamples(obj) {
    const box = buildTraderObjectBox(obj);
    if (!box) {
      const p = obj?.userData?.traderCachedWorldPosition || new THREE.Vector3();
      if (obj && typeof obj.getWorldPosition === 'function') obj.getWorldPosition(p);
      return [{ x: Number(p.x || 0), y: Number(p.y || 1.2), z: Number(p.z || 0) }];
    }
    const c = box.getCenter(new THREE.Vector3());
    return [{ x: c.x, y: c.y, z: c.z }];
  }

  function buildTraderRoofCellBox(localX, localZ, sx = TILE, sz = TILE, y = null) {
    const halfX = Math.max(0.08, Number(sx || TILE || 2.0) * 0.5);
    const halfZ = Math.max(0.08, Number(sz || TILE || 2.0) * 0.5);
    const yy = Number.isFinite(Number(y)) ? Number(y) : (5.32 + Math.min(0.38, Math.abs(Number(localZ || 0)) * 0.045));
    const center = traderBuildingLocalToWorld(localX, localZ);
    return new THREE.Box3(
      new THREE.Vector3(Number(center.x || 0) - halfX, yy - 0.18, Number(center.z || 0) - halfZ),
      new THREE.Vector3(Number(center.x || 0) + halfX, yy + 0.18, Number(center.z || 0) + halfZ)
    );
  }

  function buildTraderRoofCellScreenSamples(localX, localZ, sx = TILE, sz = TILE, y = null) {
    const box = buildTraderRoofCellBox(localX, localZ, sx, sz, y);
    const c = box.getCenter(new THREE.Vector3());
    return [{ x: c.x, y: c.y, z: c.z }];
  }

  function isTraderGameplayLocalAreaVisible(localX, localZ, sx = TILE, sz = TILE) {
    const halfX = Math.max(0.08, Number(sx || TILE || 2.0) * 0.49);
    const halfZ = Math.max(0.08, Number(sz || TILE || 2.0) * 0.49);
    const quarterX = halfX * 0.55;
    const quarterZ = halfZ * 0.55;
    const points = [
      { x: Number(localX || 0), z: Number(localZ || 0) },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0) - quarterX, z: Number(localZ || 0) - quarterZ },
      { x: Number(localX || 0) - quarterX, z: Number(localZ || 0) + quarterZ },
      { x: Number(localX || 0) + quarterX, z: Number(localZ || 0) - quarterZ },
      { x: Number(localX || 0) + quarterX, z: Number(localZ || 0) + quarterZ }
    ];
    for (const p of points) {
      if (isTraderLocalPointFogFree(p.x, p.z)) return true;
    }
    return false;
  }

  function isTraderExteriorVisionLocalPoint(localX, localZ) {
    if (!player || !isTraderYardLocation()) return false;
    const localPlayer = traderPlayerLocalPosition();
    if (!localPlayer) return false;
    if (isTraderLocalPointInsideInterior(localPlayer.x, localPlayer.z, 0.35)) return false;
    // Outside the building, the shell opens only over tiles that are actually
    // in rtsFog.visibleTiles, i.e. free from fog of war on the floor overlay.
    return isTraderLocalPointFogFree(localX, localZ);
  }

  function isTraderExteriorVisionLocalAreaVisible(localX, localZ, sx = TILE, sz = TILE) {
    const halfX = Math.max(0.08, Number(sx || TILE || 2.0) * 0.49);
    const halfZ = Math.max(0.08, Number(sz || TILE || 2.0) * 0.49);
    const quarterX = halfX * 0.55;
    const quarterZ = halfZ * 0.55;
    const points = [
      { x: Number(localX || 0), z: Number(localZ || 0) },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0) - quarterX, z: Number(localZ || 0) - quarterZ },
      { x: Number(localX || 0) - quarterX, z: Number(localZ || 0) + quarterZ },
      { x: Number(localX || 0) + quarterX, z: Number(localZ || 0) - quarterZ },
      { x: Number(localX || 0) + quarterX, z: Number(localZ || 0) + quarterZ }
    ];
    for (const p of points) {
      if (isTraderExteriorVisionLocalPoint(p.x, p.z)) return true;
    }
    return false;
  }

  function traderFloorSurfaceYForWorldPoint(worldX, worldZ) {
    // Rendering may raise fog-of-war overlay slightly to avoid z-fighting, but
    // occlusion rays must target the real floor surface. Otherwise a ray to an
    // artificially raised overlay can pass over the lower wall base and the base
    // will not fade even while it hides a visible floor cell.
    let y = 0.035;
    try {
      if (typeof isTraderYardLocation === 'function' && isTraderYardLocation() &&
          typeof traderBuildingWorldToLocal === 'function' && typeof TILE !== 'undefined') {
        const local = traderBuildingWorldToLocal(Number(worldX || 0), Number(worldZ || 0));
        if (Math.abs(local.x) <= TILE * 5.08 && Math.abs(local.z) <= TILE * 4.08) y = 0.125;
      }
    } catch (_) {}
    return y;
  }

  function traderGroundPointUnderScreenPoint(worldX, worldY, worldZ, groundY = 0.16) {
    if (!camera || !renderer || !renderer.domElement || !THREE) return null;
    const ndc = new THREE.Vector3(Number(worldX || 0), Number(worldY || 0), Number(worldZ || 0));
    ndc.project(camera);
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z < -1.2 || ndc.z > 1.2) return null;
    const raycaster = traderGroundPointUnderScreenPoint._raycaster || (traderGroundPointUnderScreenPoint._raycaster = new THREE.Raycaster());
    const plane = traderGroundPointUnderScreenPoint._plane || (traderGroundPointUnderScreenPoint._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -Number(groundY || 0)));
    plane.normal.set(0, 1, 0);
    plane.constant = -Number(groundY || 0);
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = traderGroundPointUnderScreenPoint._hit || (traderGroundPointUnderScreenPoint._hit = new THREE.Vector3());
    const result = raycaster.ray.intersectPlane(plane, hit);
    if (!result) return null;
    return { x: hit.x, z: hit.z };
  }

  function isTraderRoofScreenProjectionCoveringFogFreeGround(localX, localZ, sx = TILE, sz = TILE, roofY = null) {
    if (!player || !camera || !isTraderYardLocation()) return false;
    const halfX = Math.max(0.08, Number(sx || TILE || 2.0) * 0.49);
    const halfZ = Math.max(0.08, Number(sz || TILE || 2.0) * 0.49);
    const y = Number.isFinite(Number(roofY)) ? Number(roofY) : 4.72;
    const localPoints = [
      { x: Number(localX || 0), z: Number(localZ || 0) },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) }
    ];

    for (const p of localPoints) {
      const world = traderBuildingLocalToWorld(p.x, p.z);
      const ground = traderGroundPointUnderScreenPoint(world.x, y, world.z, traderFloorSurfaceYForWorldPoint(world.x, world.z));
      if (!ground) continue;
      if (isTraderWorldPointFogFree(ground.x, ground.z)) return true;
    }
    return false;
  }

  function traderProjectWorldToNdc(worldX, worldY, worldZ) {
    if (!camera || !THREE) return null;
    const ndc = new THREE.Vector3(Number(worldX || 0), Number(worldY || 0), Number(worldZ || 0));
    ndc.project(camera);
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || ndc.z < -1.25 || ndc.z > 1.25) return null;
    return ndc;
  }

  function traderWallFogFreeTileBehindBlock(localPoint, ud, localPlayer, tile) {
    if (!localPoint || !ud || !localPlayer) return false;
    const kind = String(ud.kind || '').toLowerCase();
    const baseX = Number(ud.traderWallLocalX || 0);
    const baseZ = Number(ud.traderWallLocalZ || 0);
    const sx = Math.max(0.1, Number(ud.traderWallSizeX || tile));
    const sz = Math.max(0.1, Number(ud.traderWallSizeZ || tile));
    if (kind.includes('front') || kind.includes('back')) {
      const dirZ = localPlayer.z < baseZ ? 1 : -1;
      if ((Number(localPoint.z || 0) - baseZ) * dirZ < -tile * 0.04) return false;
      return Math.abs(Number(localPoint.x || 0) - baseX) <= sx * 0.72;
    }
    if (kind.includes('left') || kind.includes('right')) {
      const dirX = localPlayer.x < baseX ? 1 : -1;
      if ((Number(localPoint.x || 0) - baseX) * dirX < -tile * 0.04) return false;
      return Math.abs(Number(localPoint.z || 0) - baseZ) <= sz * 0.72;
    }
    return false;
  }

  function isTraderWallScreenBoundsCoveringFogFreeTile(block, box, lowerOnly = false) {
    if (!block || !box || !rtsFog || !rtsFog.visibleTiles || !camera || !isTraderYardLocation()) return false;
    const ud = block.userData || {};
    const localPlayer = traderPlayerLocalPosition();
    if (!localPlayer) return false;
    const tile = Number(TILE || 2.0);
    const height = Math.max(0.05, Number(box.max.y || 0) - Number(box.min.y || 0));
    const yMin = lowerOnly ? Math.max(box.min.y + height * 0.48, box.max.y - height * 0.46) : box.min.y + 0.08;
    const yMax = lowerOnly ? box.max.y + 0.05 : box.max.y;
    const corners = [];
    [box.min.x, box.max.x].forEach(x => [box.min.z, box.max.z].forEach(z => [yMin, yMax].forEach(y => corners.push({ x, y, z }))));
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    corners.forEach(p => {
      const ndc = traderProjectWorldToNdc(p.x, p.y, p.z);
      if (!ndc) return;
      minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x);
      minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y);
    });
    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return false;
    const margin = lowerOnly ? 0.010 : 0.018;
    minX -= margin; maxX += margin; minY -= margin; maxY += margin;

    const baseX = Number(ud.traderWallLocalX || 0);
    const baseZ = Number(ud.traderWallLocalZ || 0);
    const seen = rtsFog.visibleTiles;
    for (const key of seen) {
      const parts = String(key).split(',');
      if (parts.length < 2) continue;
      const tx = Number(parts[0]);
      const tz = Number(parts[1]);
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
      const center = tileToWorld(tx, tz);
      const local = traderBuildingWorldToLocal(center.x, center.z);
      if (lowerOnly) {
        const kind = String(ud.kind || '').toLowerCase();
        if (kind.includes('front') || kind.includes('back')) {
          if (Math.abs(local.x - baseX) > Math.max(tile * 0.95, Number(ud.traderWallSizeX || tile) * 0.62)) continue;
          if (Math.abs(local.z - baseZ) > tile * 2.15) continue;
          if (Math.abs(local.z - baseZ) < tile * 0.16) continue;
        } else if (kind.includes('left') || kind.includes('right')) {
          if (Math.abs(local.z - baseZ) > Math.max(tile * 0.95, Number(ud.traderWallSizeZ || tile) * 0.62)) continue;
          if (Math.abs(local.x - baseX) > tile * 2.15) continue;
          if (Math.abs(local.x - baseX) < tile * 0.16) continue;
        } else {
          continue;
        }
      } else {
        if (!traderWallFogFreeTileBehindBlock(local, ud, localPlayer, tile)) continue;
        if (Math.abs(local.x - baseX) > tile * 2.2 || Math.abs(local.z - baseZ) > tile * 2.2) continue;
      }
      const samples = [
        { x: center.x, z: center.z },
        { x: center.x - tile * 0.34, z: center.z - tile * 0.34 },
        { x: center.x - tile * 0.34, z: center.z + tile * 0.34 },
        { x: center.x + tile * 0.34, z: center.z - tile * 0.34 },
        { x: center.x + tile * 0.34, z: center.z + tile * 0.34 }
      ];
      for (const s of samples) {
        const ndc = traderProjectWorldToNdc(s.x, traderFloorSurfaceYForWorldPoint(s.x, s.z), s.z);
        if (!ndc) continue;
        if (ndc.x >= minX && ndc.x <= maxX && ndc.y >= minY && ndc.y <= maxY) return true;
      }
    }
    return false;
  }

  function isTraderWallRayOccludingFogFreeFloorTile(block, box, lowerOnly = false) {
    if (!block || !box || !rtsFog || !rtsFog.visibleTiles || !camera || !camera.position || !isTraderYardLocation() || !THREE) return false;
    const ud = block.userData || {};
    const localPlayer = traderPlayerLocalPosition();
    if (!localPlayer) return false;
    const tile = Number(TILE || 2.0);
    const baseX = Number(ud.traderWallLocalX || 0);
    const baseZ = Number(ud.traderWallLocalZ || 0);
    const testBox = box.clone();
    // The visible floor/fog overlay sits slightly above the wooden floor. Use a
    // ray from the camera to those floor points; if it intersects this wall box
    // first, the block really hides a fog-free floor cell and must fade.
    if (lowerOnly) {
      testBox.min.y = Math.max(testBox.min.y + 0.025, 0.04);
      testBox.max.y = box.max.y + 0.025;
    } else {
      testBox.expandByScalar(0.015);
    }
    const ray = isTraderWallRayOccludingFogFreeFloorTile._ray || (isTraderWallRayOccludingFogFreeFloorTile._ray = new THREE.Ray());
    const dir = isTraderWallRayOccludingFogFreeFloorTile._dir || (isTraderWallRayOccludingFogFreeFloorTile._dir = new THREE.Vector3());
    const target = isTraderWallRayOccludingFogFreeFloorTile._target || (isTraderWallRayOccludingFogFreeFloorTile._target = new THREE.Vector3());
    const hit = isTraderWallRayOccludingFogFreeFloorTile._hit || (isTraderWallRayOccludingFogFreeFloorTile._hit = new THREE.Vector3());
    const origin = camera.position;
    const seen = rtsFog.visibleTiles;
    for (const key of seen) {
      const parts = String(key).split(',');
      if (parts.length < 2) continue;
      const tx = Number(parts[0]);
      const tz = Number(parts[1]);
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
      const center = tileToWorld(tx, tz);
      const local = traderBuildingWorldToLocal(center.x, center.z);
      if (lowerOnly) {
        // For the base row, use the real camera ray to any nearby fog-free
        // floor tile. The base can cover visible ground on the camera/player
        // side too, so the strict behind-wall filter is too narrow here.
        // The ray intersection below decides whether this block truly hides it.
        const kind = String(ud.kind || '').toLowerCase();
        if (kind.includes('front') || kind.includes('back')) {
          if (Math.abs(local.x - baseX) > Math.max(tile * 0.95, Number(ud.traderWallSizeX || tile) * 0.62)) continue;
          if (Math.abs(local.z - baseZ) > tile * 2.25) continue;
          if (Math.abs(local.z - baseZ) < tile * 0.16) continue;
        } else if (kind.includes('left') || kind.includes('right')) {
          if (Math.abs(local.z - baseZ) > Math.max(tile * 0.95, Number(ud.traderWallSizeZ || tile) * 0.62)) continue;
          if (Math.abs(local.x - baseX) > tile * 2.25) continue;
          if (Math.abs(local.x - baseX) < tile * 0.16) continue;
        } else {
          continue;
        }
      } else {
        if (!traderWallFogFreeTileBehindBlock(local, ud, localPlayer, tile)) continue;
        if (Math.abs(local.x - baseX) > tile * 2.4 || Math.abs(local.z - baseZ) > tile * 2.4) continue;
      }
      const samples = [
        { x: center.x, z: center.z },
        { x: center.x - tile * 0.38, z: center.z - tile * 0.38 },
        { x: center.x - tile * 0.38, z: center.z + tile * 0.38 },
        { x: center.x + tile * 0.38, z: center.z - tile * 0.38 },
        { x: center.x + tile * 0.38, z: center.z + tile * 0.38 },
        { x: center.x, z: center.z - tile * 0.44 },
        { x: center.x, z: center.z + tile * 0.44 },
        { x: center.x - tile * 0.44, z: center.z },
        { x: center.x + tile * 0.44, z: center.z }
      ];
      for (const s of samples) {
        target.set(Number(s.x || 0), traderFloorSurfaceYForWorldPoint(s.x, s.z), Number(s.z || 0));
        dir.copy(target).sub(origin);
        const distToFloor = dir.length();
        if (!Number.isFinite(distToFloor) || distToFloor <= 0.001) continue;
        dir.multiplyScalar(1 / distToFloor);
        ray.set(origin, dir);
        const result = ray.intersectBox(testBox, hit);
        if (!result) continue;
        const hitDist = hit.distanceTo(origin);
        if (hitDist > 0.02 && hitDist < distToFloor - 0.025) return true;
      }
    }
    return false;
  }

  function isTraderWallScreenProjectionCoveringFogFreeGround(block) {
    if (!block || !player || !camera || !isTraderYardLocation()) return false;
    const box = buildTraderWallBlockBox(block);
    if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return false;
    const ud = block.userData || {};
    const row = Number(ud.traderWallRow);
    const isLowerBase = false;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cy = (box.min.y + box.max.y) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const xs = [box.min.x, cx, box.max.x];
    const zs = [box.min.z, cz, box.max.z];
    const kind = String(ud.kind || '').toLowerCase();
    const tile = Number(TILE || 2.0);
    const localPlayer = traderPlayerLocalPosition();

    const points = [];
    if (isLowerBase) {
      // Bottom row is a plinth. Do not sample its bottom/center pixels: those
      // touch the floor and can make the base fade even when it is not hiding
      // useful gameplay space. Sample only the upper lip of the base; if this
      // lip projects over a fog-free cell, then the base really obstructs view.
      const topY = box.max.y + 0.03;
      xs.forEach(x => {
        points.push({ x, y: topY, z: box.min.z });
        points.push({ x, y: topY, z: box.max.z });
      });
      zs.forEach(z => {
        points.push({ x: box.min.x, y: topY, z });
        points.push({ x: box.max.x, y: topY, z });
      });
      points.push({ x: cx, y: topY, z: cz });
    } else {
      const ys = [box.min.y + 0.10, cy, box.max.y];
      // Sample the visible rectangle of a wall block. Higher points are important:
      // they are the parts that visually project down onto floor cells behind the wall.
      xs.forEach(x => ys.forEach(y => {
        points.push({ x, y, z: box.min.z });
        points.push({ x, y, z: box.max.z });
      }));
      zs.forEach(z => ys.forEach(y => {
        points.push({ x: box.min.x, y, z });
        points.push({ x: box.max.x, y, z });
      }));
      points.push({ x: cx, y: box.max.y, z: cz });
      points.push({ x: cx, y: cy, z: cz });
    }

    const seenTiles = new Set();
    for (const p of points) {
      const ground = traderGroundPointUnderScreenPoint(p.x, p.y, p.z, traderFloorSurfaceYForWorldPoint(p.x, p.z));
      if (!ground) continue;
      if (isLowerBase && localPlayer) {
        // For the plinth, ignore projection onto the player's own side of the wall.
        // The base should fade only when it covers a fog-free cell behind/through
        // the wall, not when its lower edge overlaps visible ground in front.
        const localGround = traderBuildingWorldToLocal(ground.x, ground.z);
        if (!traderWallFogFreeTileBehindBlock(localGround, ud, localPlayer, tile)) continue;
      }
      const tt = typeof worldToTile === 'function' ? worldToTile(ground.x, ground.z) : null;
      if (tt) {
        const key = typeof tileKey === 'function' ? tileKey(tt.tx, tt.tz) : `${tt.tx},${tt.tz}`;
        if (seenTiles.has(key)) continue;
        seenTiles.add(key);
      }
      if (isTraderWorldPointFogFree(ground.x, ground.z)) return true;
    }
    // Reverse tests: first cast camera rays to fog-free floor cells behind this
    // wall block. This directly answers whether the block hides visible floor.
    // The screen-bounds check remains as a fallback for edge silhouettes.
    if (isTraderWallRayOccludingFogFreeFloorTile(block, box, isLowerBase)) return true;
    return isTraderWallScreenBoundsCoveringFogFreeTile(block, box, isLowerBase);
  }


  function isTraderRoofFogFreeExpandedLocalAreaVisible(localX, localZ, sx = TILE, sz = TILE) {
    // Roof is a sloped visual shell, so a roof fragment can visually cover the
    // neighbouring fog-free floor tile even when its own centre is one cell away.
    // Use a one-tile expansion only for roof alpha; walls still use exact shell
    // samples. This prevents roof strips from blocking an already-unfogged area.
    const tile = Number(TILE || 2.0);
    const halfX = Math.max(tile * 0.50, Number(sx || tile) * 0.50 + tile * 0.95);
    const halfZ = Math.max(tile * 0.50, Number(sz || tile) * 0.50 + tile * 0.95);
    const points = [
      { x: Number(localX || 0), z: Number(localZ || 0) },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) },
      { x: Number(localX || 0), z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0), z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) - halfX, z: Number(localZ || 0) + halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) - halfZ },
      { x: Number(localX || 0) + halfX, z: Number(localZ || 0) + halfZ }
    ];
    for (const p of points) {
      if (isTraderLocalPointFogFree(p.x, p.z)) return true;
    }
    return false;
  }

  function isTraderBoxGameplayVisible(box) {
    if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return false;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const points = [
      { x: cx, z: cz },
      { x: box.min.x, z: box.min.z },
      { x: box.min.x, z: box.max.z },
      { x: box.max.x, z: box.min.z },
      { x: box.max.x, z: box.max.z },
      { x: cx, z: box.min.z },
      { x: cx, z: box.max.z },
      { x: box.min.x, z: cz },
      { x: box.max.x, z: cz }
    ];
    for (const p of points) {
      if (isTraderWorldPointFogFree(p.x, p.z)) return true;
    }
    return false;
  }

  function isTraderWorldBoxScreenProjectionCoveringFogFreeGround(box) {
    if (!box || !player || !camera || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return false;
    const cx = (box.min.x + box.max.x) * 0.5;
    const cy = (box.min.y + box.max.y) * 0.5;
    const cz = (box.min.z + box.max.z) * 0.5;
    const points = [
      { x: cx, y: cy, z: cz },
      { x: box.min.x, y: cy, z: box.min.z },
      { x: box.min.x, y: cy, z: box.max.z },
      { x: box.max.x, y: cy, z: box.min.z },
      { x: box.max.x, y: cy, z: box.max.z },
      { x: cx, y: box.max.y, z: cz },
      { x: box.min.x, y: box.max.y, z: cz },
      { x: box.max.x, y: box.max.y, z: cz },
      { x: cx, y: box.max.y, z: box.min.z },
      { x: cx, y: box.max.y, z: box.max.z }
    ];
    for (const p of points) {
      const ground = traderGroundPointUnderScreenPoint(p.x, p.y, p.z, traderFloorSurfaceYForWorldPoint(p.x, p.z));
      if (ground && isTraderWorldPointFogFree(ground.x, ground.z)) return true;
    }
    return false;
  }

  function isTraderAuthoredRoofBlockCutaway(block) {
    if (!block || !player || !camera) return false;
    const box = buildTraderAuthoredRoofBlockBox(block);
    if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return false;
    if (isTraderBoxGameplayVisible(box)) return true;
    if (isTraderBoxOccludingPlayer(box, { pad: 0.02, playerY: 1.12 })) return true;
    return isTraderWorldBoxScreenProjectionCoveringFogFreeGround(box);
  }

  function stableTraderAuthoredRoofBlockCutaway(block, rawCutaway = false, forceOpaque = false) {
    if (!block) return false;
    const ud = block.userData || (block.userData = {});
    const now = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    if (forceOpaque) {
      ud.traderRoofCutawayStable = false;
      ud.traderRoofCutawayReleaseSince = 0;
      return false;
    }
    if (rawCutaway) {
      ud.traderRoofCutawayStable = true;
      ud.traderRoofCutawayReleaseSince = 0;
      return true;
    }
    if (ud.traderRoofCutawayStable !== true) {
      ud.traderRoofCutawayStable = false;
      ud.traderRoofCutawayReleaseSince = 0;
      return false;
    }
    const releaseSince = Number(ud.traderRoofCutawayReleaseSince || 0);
    if (!releaseSince) {
      ud.traderRoofCutawayReleaseSince = now;
      return true;
    }
    if (now - releaseSince < 220) return true;
    ud.traderRoofCutawayStable = false;
    ud.traderRoofCutawayReleaseSince = 0;
    return false;
  }

