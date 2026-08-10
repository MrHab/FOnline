  function addGlobalMap3DPointLine(group, fromPoint, toPoint, color = 0xefd078, opacity = 0.46, dashed = false, lift = 0.38) {
    if (!group || !fromPoint || !toPoint || !THREE) return null;
    const from = globalMap3DWorldPoint(clampGlobalMapPoint(fromPoint.x, fromPoint.y), lift);
    const to = globalMap3DWorldPoint(clampGlobalMapPoint(toPoint.x, toPoint.y), lift);
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = dashed && THREE.LineDashedMaterial
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.55, gapSize: 0.35, depthTest: false })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    const line = new THREE.Line(geometry, material);
    if (dashed && typeof line.computeLineDistances === 'function') line.computeLineDistances();
    group.add(line);
    return line;
  }

  function ensureGlobalMap3DDynamicCache() {
    if (!GLOBAL_MAP_3D.dynamicGroup || GLOBAL_MAP_3D.dynamicCache) return GLOBAL_MAP_3D.dynamicCache;
    clearGlobalMap3DGroup(GLOBAL_MAP_3D.dynamicGroup);
    const cache = {};
    cache.currentCircle = makeGlobalMapDynamicLine(0xffffff, 0.86, 80, false);
    cache.selectedCircle = makeGlobalMapDynamicLine(0xefd078, 0.74, 80, false);
    cache.routeLine = makeGlobalMapDynamicLine(0xffdf7d, 0.88, 42, true);
    cache.taskLine = makeGlobalMapDynamicLine(0x8fd7ff, 0.72, 42, true);

    cache.flag = new THREE.Group();
    cache.flag.frustumCulled = false;
    const playerMarkerRadius = globalMapPlayerMarkerCircleRadius();
    cache.flagBaseRing = new THREE.Mesh(
      new THREE.TorusBufferGeometry(playerMarkerRadius, 0.026, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0xefd078, transparent: true, opacity: 0.72, depthTest: false })
    );
    cache.flagBaseRing.rotation.x = Math.PI / 2;
    cache.flagOuterRing = new THREE.Mesh(
      new THREE.TorusBufferGeometry(playerMarkerRadius * 0.68, 0.018, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xefd078, transparent: true, opacity: 0.38, depthTest: false })
    );
    cache.flagOuterRing.rotation.x = Math.PI / 2;
    cache.flagBeacon = new THREE.Mesh(
      new THREE.CylinderBufferGeometry(0.14, 0.18, 0.10, 16),
      new THREE.MeshLambertMaterial({ color: 0xefd078, emissive: 0x4c3306, emissiveIntensity: 0.34 })
    );
    cache.flagBeacon.position.y = 0.055;
    cache.flagColorMeshes = [cache.flagBaseRing, cache.flagOuterRing, cache.flagBeacon];
    cache.flag.add(cache.flagBaseRing, cache.flagOuterRing, cache.flagBeacon);

    cache.playerMarker = buildGlobalMapPlayerModelMarker();
    cache.playerHalo = cache.playerMarker.userData.playerHalo || null;
    cache.taskMarker = new THREE.Group();
    cache.taskMarker.frustumCulled = false;
    cache.taskRing = new THREE.Mesh(
      new THREE.TorusBufferGeometry(0.58, 0.035, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x8fd7ff, transparent: true, opacity: 0.68 })
    );
    cache.taskRing.rotation.x = Math.PI / 2;
    cache.taskPin = new THREE.Mesh(
      new THREE.ConeBufferGeometry(0.28, 0.72, 4),
      new THREE.MeshLambertMaterial({ color: 0x8fd7ff, emissive: 0x143a52, emissiveIntensity: 0.45 })
    );
    cache.taskPin.position.y = 0.48;
    cache.taskPin.rotation.y = Math.PI * 0.25;
    cache.taskMarker.add(cache.taskRing, cache.taskPin);
    cache.factionTerritories = new THREE.Group();
    cache.factionInfluence = new THREE.Group();
    cache.factionFronts = new THREE.Group();
    cache.worldTasks = new THREE.Group();
    cache.settlementStatus = new THREE.Group();
    cache.worldSites = new THREE.Group();
    cache.worldParties = new THREE.Group();

    GLOBAL_MAP_3D.dynamicGroup.add(cache.factionTerritories, cache.factionInfluence, cache.factionFronts, cache.currentCircle, cache.selectedCircle, cache.routeLine, cache.taskLine, cache.flag, cache.playerMarker, cache.taskMarker, cache.worldTasks, cache.settlementStatus, cache.worldSites, cache.worldParties);
    GLOBAL_MAP_3D.dynamicCache = cache;
    return cache;
  }

  function configureGlobalMapCanvasTexture(texture, options = {}) {
    if (!texture || typeof THREE === 'undefined') return texture;
    const mipmaps = options.mipmaps !== false;
    texture.minFilter = mipmaps && THREE.LinearMipmapLinearFilter ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = !!mipmaps;
    const requestedAnisotropy = Math.max(1, Number(options.anisotropy || 1));
    if (requestedAnisotropy > 1) {
      const maxAnisotropy = GLOBAL_MAP_3D.renderer?.capabilities?.getMaxAnisotropy?.() || requestedAnisotropy;
      texture.anisotropy = Math.max(1, Math.min(requestedAnisotropy, maxAnisotropy));
    }
    if ('encoding' in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    texture.needsUpdate = true;
    return texture;
  }

  function makeGlobalMapTextSprite(text = '', color = '#efd078', bg = 'rgba(46,28,13,0.86)') {
    const label = String(text || '').trim().slice(0, 72);
    const fontSize = label.length > 34 ? 26 : 30;
    const padX = 44;
    const notch = 24;
    const height = 112;
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = `900 ${fontSize}px Consolas, monospace`;
    const textWidth = Math.ceil(measureCtx.measureText(label || ' ').width);
    const width = Math.max(220, Math.min(1024, textWidth + padX * 2 + notch * 2));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.strokeStyle = 'rgba(239,208,120,0.88)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(notch + 4, 18);
    ctx.lineTo(width - notch - 4, 18);
    ctx.lineTo(width - 6, 56);
    ctx.lineTo(width - notch - 4, 94);
    ctx.lineTo(notch + 4, 94);
    ctx.lineTo(6, 56);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.font = `900 ${fontSize}px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0,0,0,0.78)';
    ctx.fillStyle = color;
    ctx.strokeText(label, width * 0.5, 56, width - padX * 2);
    ctx.fillText(label, width * 0.5, 56, width - padX * 2);
    const texture = configureGlobalMapCanvasTexture(new THREE.CanvasTexture(canvas), { mipmaps: false });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(Math.max(5.0, Math.min(22.0, 2.3 * (width / height))), 2.3, 1);
    return sprite;
  }

  function makeGlobalMapCompactTextSprite(text = '', color = '#efd078', bg = 'rgba(20,14,8,0.82)') {
    const label = String(text || '').trim().slice(0, 34);
    const fontSize = label.length > 18 ? 24 : 28;
    const height = 82;
    const padX = 28;
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = `900 ${fontSize}px Consolas, monospace`;
    const textWidth = Math.ceil(measureCtx.measureText(label || ' ').width);
    const width = Math.max(160, Math.min(620, textWidth + padX * 2));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = bg;
    ctx.strokeStyle = globalMapColorAlpha(color, 0.88);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect?.(6, 12, width - 12, height - 24, 12);
    if (!ctx.roundRect) ctx.rect(6, 12, width - 12, height - 24);
    ctx.fill();
    ctx.stroke();
    ctx.font = `900 ${fontSize}px Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.82)';
    ctx.fillStyle = color;
    ctx.strokeText(label || ' ', width * 0.5, height * 0.5, width - padX * 2);
    ctx.fillText(label || ' ', width * 0.5, height * 0.5, width - padX * 2);
    const texture = configureGlobalMapCanvasTexture(new THREE.CanvasTexture(canvas), { mipmaps: false });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(Math.max(2.6, Math.min(10.5, 1.35 * (width / height))), 1.35, 1);
    return sprite;
  }

  function globalMapNodeModelKey(node = {}) {
    const aliases = {
      oldKlimYard: 'traderAwning',
      scrapTown: 'scrapWatchTower',
      relayStation: 'relayAntenna',
      caravanCamp: 'brahminPen'
    };
    const raw = String(node.model || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (raw && typeof STATIC_MODEL_URLS !== 'undefined' && STATIC_MODEL_URLS[raw]) return raw;
    if (aliases[raw]) return aliases[raw];
    if (node.id === 'relayStation') return 'relayAntenna';
    if (node.id === 'scrapTown') return 'scrapWatchTower';
    if (node.id === 'settlement') return 'traderAwning';
    if (node.id === 'caravanCamp') return 'brahminPen';
    return 'wastelandShack';
  }

  function globalMapObjectModelKey(object = {}) {
    const aliases = {
      oldKlimYard: 'traderAwning',
      scrapTown: 'scrapWatchTower',
      relayStation: 'relayAntenna'
    };
    const raw = String(object.model || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (raw && typeof STATIC_MODEL_URLS !== 'undefined' && STATIC_MODEL_URLS[raw]) return raw;
    if (aliases[raw]) return aliases[raw];
    return 'wastelandShack';
  }

  function fitGlobalMapStaticModelInstance(model, rotationY = 0, target = 1, lift = 0.04) {
    if (!model || typeof THREE === 'undefined') return;
    model.rotation.set(0, rotationY, 0);
    model.scale.set(1, 1, 1);
    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const longest = Math.max(size.x || 1, size.z || 1, size.y || 1);
    const scale = Math.max(0.01, Number(target || 1) / longest);
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -box.min.y * scale + lift, -center.z * scale);
    model.updateMatrixWorld(true);
  }

  function globalMapRichShadowsEnabled() {
    return !IS_MOBILE_DEVICE && (graphicsQuality === 'high' || graphicsQuality === 'ultra');
  }

  function syncGlobalMapGraphicsQuality() {
    const richShadows = globalMapRichShadowsEnabled();
    const renderer3d = GLOBAL_MAP_3D.renderer;
    if (renderer3d?.shadowMap) {
      renderer3d.shadowMap.enabled = richShadows;
      renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer3d.shadowMap.autoUpdate = false;
      renderer3d.shadowMap.needsUpdate = richShadows;
    }
    if (GLOBAL_MAP_3D.sun) {
      GLOBAL_MAP_3D.sun.castShadow = richShadows;
      const size = graphicsQuality === 'ultra' ? 2048 : 1024;
      GLOBAL_MAP_3D.sun.shadow.mapSize.set(size, size);
      if (GLOBAL_MAP_3D.sun.shadow.map) {
        GLOBAL_MAP_3D.sun.shadow.map.dispose();
        GLOBAL_MAP_3D.sun.shadow.map = null;
      }
      GLOBAL_MAP_3D.sun.shadow.needsUpdate = richShadows;
    }
    [GLOBAL_MAP_3D.staticGroup, GLOBAL_MAP_3D.nodeGroup].forEach(root => root?.traverse?.(part => {
      if (!part || !part.isMesh) return;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      const opaque = materials.every(material => material && (!material.transparent || Number(material.opacity ?? 1) >= 0.98));
      part.castShadow = richShadows && opaque;
      part.receiveShadow = true;
    }));
  }

  function addGlobalMapNodeVisual(group, node = {}) {
    const marker = new THREE.Mesh(
      new THREE.CylinderBufferGeometry(0.36, 0.46, 0.28, 18),
      new THREE.MeshLambertMaterial({ color: node.kind === 'settlement' ? 0x2f9f32 : 0xd5a055, emissive: 0x081605 })
    );
    marker.position.y = 0.18;
    group.add(marker);
    if (node.kind !== 'settlement' || typeof makeStaticModelGroup !== 'function') return;
    const key = globalMapNodeModelKey(node);
    const rotationY = THREE.Math.degToRad(Number(node.rotationY || 0));
    const target = (Number(node.locationCount || 1) > 1 ? 3.2 : 2.1) * Math.max(0.45, Math.min(4, Number(node.modelScale || 1)));
    const model = makeStaticModelGroup(
      key,
      0,
      0,
      0,
      'global-map-city-model',
      {
        scale: 1,
        y: 0,
        castShadow: globalMapRichShadowsEnabled(),
        receiveShadow: true,
        cloneMaterials: true,
        afterApply: (_, root) => fitGlobalMapStaticModelInstance(root, rotationY, target, 0.04)
      }
    );
    group.add(model);
  }

  function addGlobalMapObjectVisual(group, object = {}) {
    if (typeof makeStaticModelGroup !== 'function') return;
    const key = globalMapObjectModelKey(object);
    const rotationY = THREE.Math.degToRad(Number(object.rotationY || 0));
    const target = 1.65 * Math.max(0.2, Math.min(5, Number(object.modelScale || 1)));
    const model = makeStaticModelGroup(
      key,
      0,
      0,
      0,
      'global-map-cell-model',
      {
        scale: 1,
        y: 0,
        castShadow: globalMapRichShadowsEnabled(),
        receiveShadow: true,
        cloneMaterials: true,
        afterApply: (_, root) => fitGlobalMapStaticModelInstance(root, rotationY, target, 0.035)
      }
    );
    group.add(model);
  }

  function globalMap3DWorldPoint(point = {}, lift = 0.16) {
    const w = globalMapWorldFromPoint(point);
    return new THREE.Vector3(w.x, globalMapHeightAtPoint(point.x, point.y) + lift, w.z);
  }

  function globalMap3DInfrastructureWidth(row = {}, scale = 1) {
    return Math.max(0.28, Math.min(1.8, Number(row.width || 6) / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth * scale));
  }

  function globalMap3DInfrastructurePoints(row = {}, spacing = 5, lift = 0.08) {
    return globalMapSampleInfrastructure(row, spacing).map(point => globalMap3DWorldPoint(point, lift));
  }

  function buildGlobalMap3DStripGeometry(points = [], width = 0.7, thickness = 0.08) {
    if (points.length < 2) return null;
    const positions = [];
    const indices = [];
    const halfWidth = width * 0.5;
    points.forEach((point, index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const tangent = new THREE.Vector3(next.x - previous.x, 0, next.z - previous.z);
      if (tangent.lengthSq() < 0.000001) tangent.set(1, 0, 0);
      tangent.normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(halfWidth);
      positions.push(
        point.x + side.x, point.y, point.z + side.z,
        point.x - side.x, point.y, point.z - side.z,
        point.x + side.x, point.y - thickness, point.z + side.z,
        point.x - side.x, point.y - thickness, point.z - side.z
      );
    });
    for (let index = 0; index < points.length - 1; index++) {
      const a = index * 4;
      const b = (index + 1) * 4;
      indices.push(
        a, b, a + 1, a + 1, b, b + 1,
        a + 2, a + 3, b + 2, a + 3, b + 3, b + 2,
        a, a + 2, b, a + 2, b + 2, b,
        a + 1, b + 1, a + 3, a + 3, b + 1, b + 3
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function addGlobalMap3DRoad(group, row = {}) {
    const points = globalMap3DInfrastructurePoints(row, 4.5, 0.095);
    if (points.length < 2) return;
    const width = globalMap3DInfrastructureWidth(row);
    const shoulderGeometry = buildGlobalMap3DStripGeometry(points.map(point => point.clone().setY(point.y - 0.035)), width * 1.35, 0.06);
    const deckGeometry = buildGlobalMap3DStripGeometry(points, width, 0.11);
    const shoulder = new THREE.Mesh(
      shoulderGeometry,
      new THREE.MeshLambertMaterial({ color: 0x342f28 })
    );
    const concrete = row.model === 'concrete_slabs';
    const deck = new THREE.Mesh(
      deckGeometry,
      new THREE.MeshLambertMaterial({ color: concrete ? 0x77756d : 0x4b4a43, emissive: concrete ? 0x090908 : 0x050504 })
    );
    shoulder.receiveShadow = true;
    deck.receiveShadow = true;
    group.add(shoulder, deck);

    const marks = [];
    for (let index = 2; index < points.length - 1; index += 4) {
      const from = points[index - 1];
      const to = points[index];
      marks.push({
        point: new THREE.Vector3((from.x + to.x) * 0.5, (from.y + to.y) * 0.5 + 0.025, (from.z + to.z) * 0.5),
        yaw: -Math.atan2(to.z - from.z, to.x - from.x)
      });
    }
    if (marks.length) {
      const geometry = new THREE.BoxBufferGeometry(Math.max(0.24, width * 0.42), 0.025, Math.max(0.035, width * 0.055));
      const material = new THREE.MeshLambertMaterial({ color: concrete ? 0x3e3b35 : 0xc5b06f, emissive: 0x171207 });
      const mesh = new THREE.InstancedMesh(geometry, material, marks.length);
      const dummy = new THREE.Object3D();
      marks.forEach((mark, index) => {
        dummy.position.copy(mark.point);
        dummy.rotation.set(0, mark.yaw, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }
  }

  function addGlobalMap3DPipeline(group, row = {}) {
    const walkwayPoints = globalMap3DInfrastructurePoints(row, 6, 0.11);
    if (walkwayPoints.length < 2) return;
    const walkwayWidth = globalMap3DInfrastructureWidth(row, 0.88);
    const walkway = new THREE.Mesh(
      buildGlobalMap3DStripGeometry(walkwayPoints, walkwayWidth, 0.075),
      new THREE.MeshLambertMaterial({ color: 0x655541, emissive: 0x0b0805 })
    );
    walkway.receiveShadow = true;
    group.add(walkway);

    const pipePoints = walkwayPoints.map((point, index) => {
      const previous = walkwayPoints[Math.max(0, index - 1)];
      const next = walkwayPoints[Math.min(walkwayPoints.length - 1, index + 1)];
      const tangent = new THREE.Vector3(next.x - previous.x, 0, next.z - previous.z);
      if (tangent.lengthSq() < 0.000001) tangent.set(1, 0, 0);
      tangent.normalize();
      const side = new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(walkwayWidth * 0.72);
      return point.clone().add(side).setY(point.y + 0.24);
    });
    const segmentCount = pipePoints.length - 1;
    const pipeGeometry = new THREE.CylinderBufferGeometry(0.105, 0.105, 1, 10, 1, false);
    const pipeMaterial = new THREE.MeshLambertMaterial({ color: 0x8a5333, emissive: 0x130704 });
    const pipes = new THREE.InstancedMesh(pipeGeometry, pipeMaterial, segmentCount);
    const dummy = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < segmentCount; index++) {
      const from = pipePoints[index];
      const to = pipePoints[index + 1];
      const direction = new THREE.Vector3().subVectors(to, from);
      const length = direction.length();
      dummy.position.copy(from).add(to).multiplyScalar(0.5);
      dummy.quaternion.setFromUnitVectors(up, direction.normalize());
      dummy.scale.set(1, length, 1);
      dummy.updateMatrix();
      pipes.setMatrixAt(index, dummy.matrix);
    }
    pipes.instanceMatrix.needsUpdate = true;
    group.add(pipes);

    const supportRows = pipePoints.filter((_, index) => index % 3 === 0);
    if (supportRows.length) {
      const supportGeometry = new THREE.BoxBufferGeometry(0.10, 0.34, walkwayWidth * 1.55);
      const supportMaterial = new THREE.MeshLambertMaterial({ color: 0x4a4037 });
      const supports = new THREE.InstancedMesh(supportGeometry, supportMaterial, supportRows.length);
      supportRows.forEach((point, index) => {
        dummy.position.set(point.x, point.y - 0.17, point.z);
        dummy.quaternion.identity();
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        supports.setMatrixAt(index, dummy.matrix);
      });
      supports.instanceMatrix.needsUpdate = true;
      group.add(supports);
    }
  }

  function addGlobalMap3DInfrastructure(group, row = {}) {
    if (row.type === 'pipeline') addGlobalMap3DPipeline(group, row);
    else addGlobalMap3DRoad(group, row);
  }

  function addGlobalMap3DMountainChain(group, points) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x5f5846 });
    points.forEach((row, index) => {
      const point = { x: row[0] * GLOBAL_MAP_SIZE.width, y: row[1] * GLOBAL_MAP_SIZE.height };
      const pos = globalMap3DWorldPoint(point, 0.05);
      const scale = 0.75 + (index % 4) * 0.16;
      const cone = new THREE.Mesh(new THREE.ConeBufferGeometry(scale, 1.5 + scale, 4), mat);
      cone.position.set(pos.x, pos.y + 0.62 + scale * 0.32, pos.z);
      cone.rotation.y = index * 0.57;
      group.add(cone);
    });
  }

  function buildGlobalMap3DTerrainGeometry() {
    const segX = GLOBAL_MAP_3D_TERRAIN_SEGMENTS;
    const segZ = GLOBAL_MAP_3D_TERRAIN_SEGMENTS;
    const positions = [];
    const uvs = [];
    const indices = [];
    for (let z = 0; z <= segZ; z++) {
      const v = z / segZ;
      for (let x = 0; x <= segX; x++) {
        const u = x / segX;
        const pointX = u * GLOBAL_MAP_SIZE.width;
        const pointY = v * GLOBAL_MAP_SIZE.height;
        positions.push(
          (u - 0.5) * GLOBAL_MAP_3D.worldWidth,
          globalMapHeightAtPoint(pointX, pointY),
          (v - 0.5) * GLOBAL_MAP_3D.worldDepth
        );
        uvs.push(u, 1 - v);
      }
    }
    for (let z = 0; z < segZ; z++) {
      for (let x = 0; x < segX; x++) {
        const a = z * (segX + 1) + x;
        const b = a + 1;
        const c = a + (segX + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function rebuildGlobalMap3DStatic() {
    if (!GLOBAL_MAP_3D.scene || !GLOBAL_MAP_3D.staticGroup || !GLOBAL_MAP_3D.nodeGroup) return;
    if (GLOBAL_MAP_3D.terrain) {
      GLOBAL_MAP_3D.scene.remove(GLOBAL_MAP_3D.terrain);
      disposeGlobalMap3DObject(GLOBAL_MAP_3D.terrain);
      GLOBAL_MAP_3D.terrain = null;
    }
    clearGlobalMap3DGroup(GLOBAL_MAP_3D.staticGroup);
    clearGlobalMap3DGroup(GLOBAL_MAP_3D.nodeGroup);
    if (GLOBAL_MAP_3D.texture?.dispose) GLOBAL_MAP_3D.texture.dispose();
    GLOBAL_MAP_3D.texture = configureGlobalMapCanvasTexture(
      new THREE.CanvasTexture(globalMapBuildTextureCanvas()),
      { mipmaps: true, anisotropy: 16 }
    );
    GLOBAL_MAP_3D.terrain = new THREE.Mesh(
      buildGlobalMap3DTerrainGeometry(),
      new THREE.MeshStandardMaterial({
        map: GLOBAL_MAP_3D.texture,
        color: 0xf2e5c9,
        roughness: 0.92,
        metalness: 0.015,
        dithering: true
      })
    );
    GLOBAL_MAP_3D.terrain.receiveShadow = true;
    GLOBAL_MAP_3D.scene.add(GLOBAL_MAP_3D.terrain);

    const borderPts = [
      new THREE.Vector3(-46, 0.24, -46), new THREE.Vector3(46, 0.24, -46),
      new THREE.Vector3(46, 0.24, 46), new THREE.Vector3(-46, 0.24, 46),
      new THREE.Vector3(-46, 0.24, -46)
    ];
    GLOBAL_MAP_3D.staticGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(borderPts),
      new THREE.LineBasicMaterial({ color: 0xcaa24b, transparent: true, opacity: 0.72 })
    ));
    GLOBAL_MAP_INFRASTRUCTURE.forEach(row => addGlobalMap3DInfrastructure(GLOBAL_MAP_3D.staticGroup, row));
    addGlobalMap3DMountainChain(GLOBAL_MAP_3D.staticGroup, [[0.58,0.06],[0.66,0.16],[0.72,0.27],[0.78,0.42],[0.85,0.58],[0.91,0.76]]);
    addGlobalMap3DMountainChain(GLOBAL_MAP_3D.staticGroup, [[0.36,0.08],[0.45,0.19],[0.49,0.33],[0.52,0.49]]);

    GLOBAL_MAP_OBJECTS.forEach(object => {
      if (!object || !object.model) return;
      const p = globalMap3DWorldPoint(object, 0.12);
      const group = new THREE.Group();
      group.position.set(p.x, p.y, p.z);
      group.userData.globalMapObjectId = object.id;
      addGlobalMapObjectVisual(group, object);
      GLOBAL_MAP_3D.staticGroup.add(group);
    });

    const ringMat = new THREE.LineBasicMaterial({ color: 0x7fd65c, transparent: true, opacity: 0.58 });
    GLOBAL_MAP_NODES.forEach(node => {
      const p = globalMap3DWorldPoint(node, 0.12);
      const group = new THREE.Group();
      group.position.set(p.x, p.y, p.z);
      if (node.kind === 'settlement') {
        const radius = globalMapSettlementRadius(node) / GLOBAL_MAP_SIZE.width * GLOBAL_MAP_3D.worldWidth;
        const ringPts = [];
        for (let i = 0; i <= 80; i++) {
          const a = i / 80 * Math.PI * 2;
          ringPts.push(new THREE.Vector3(Math.cos(a) * radius, 0.02, Math.sin(a) * radius));
        }
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat));
      }
      addGlobalMapNodeVisual(group, node);
      const label = makeGlobalMapTextSprite(globalMapLocationName(node.id), '#ffe38b');
      label.position.set(0, 2.5, -1.05);
      group.add(label);
      GLOBAL_MAP_3D.nodeGroup.add(group);
    });
    const richShadows = globalMapRichShadowsEnabled();
    [GLOBAL_MAP_3D.staticGroup, GLOBAL_MAP_3D.nodeGroup].forEach(root => root.traverse(part => {
      if (!part || !part.isMesh) return;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      const opaque = materials.every(material => material && (!material.transparent || Number(material.opacity ?? 1) >= 0.98));
      part.castShadow = richShadows && opaque;
      part.receiveShadow = true;
    }));
    if (GLOBAL_MAP_3D.renderer?.shadowMap) GLOBAL_MAP_3D.renderer.shadowMap.needsUpdate = richShadows;
    GLOBAL_MAP_3D.builtRevision = GLOBAL_MAP_3D.revision;
  }

  function ensureGlobalMap3D() {
    if (GLOBAL_MAP_3D.failed || !globalMap3dCanvas || typeof THREE === 'undefined') return false;
    if (GLOBAL_MAP_3D.renderer) return true;
    try {
      GLOBAL_MAP_3D.renderer = new THREE.WebGLRenderer({ canvas: globalMap3dCanvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
      if ('outputColorSpace' in GLOBAL_MAP_3D.renderer && THREE.SRGBColorSpace) GLOBAL_MAP_3D.renderer.outputColorSpace = THREE.SRGBColorSpace;
      else if ('outputEncoding' in GLOBAL_MAP_3D.renderer && THREE.sRGBEncoding) GLOBAL_MAP_3D.renderer.outputEncoding = THREE.sRGBEncoding;
      if (THREE.ACESFilmicToneMapping) GLOBAL_MAP_3D.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      else if (THREE.CineonToneMapping) GLOBAL_MAP_3D.renderer.toneMapping = THREE.CineonToneMapping;
      GLOBAL_MAP_3D.renderer.toneMappingExposure = 1.08;
      if ('physicallyCorrectLights' in GLOBAL_MAP_3D.renderer) GLOBAL_MAP_3D.renderer.physicallyCorrectLights = true;
      if ('useLegacyLights' in GLOBAL_MAP_3D.renderer) GLOBAL_MAP_3D.renderer.useLegacyLights = false;
      GLOBAL_MAP_3D.renderer.shadowMap.enabled = globalMapRichShadowsEnabled();
      GLOBAL_MAP_3D.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      GLOBAL_MAP_3D.renderer.shadowMap.autoUpdate = false;
      GLOBAL_MAP_3D.renderer.shadowMap.needsUpdate = globalMapRichShadowsEnabled();
      applyGlobalMap3DPixelRatio(true);
      GLOBAL_MAP_3D.renderer.setClearColor(0x050806, 1);
      GLOBAL_MAP_3D.scene = new THREE.Scene();
      GLOBAL_MAP_3D.scene.fog = new THREE.Fog(0x050806, 92, 210);
      GLOBAL_MAP_3D.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);
      GLOBAL_MAP_3D.raycaster = new THREE.Raycaster();
      GLOBAL_MAP_3D.staticGroup = new THREE.Group();
      GLOBAL_MAP_3D.nodeGroup = new THREE.Group();
      GLOBAL_MAP_3D.dynamicGroup = new THREE.Group();
      GLOBAL_MAP_3D.scene.add(GLOBAL_MAP_3D.staticGroup, GLOBAL_MAP_3D.nodeGroup, GLOBAL_MAP_3D.dynamicGroup);
      GLOBAL_MAP_3D.scene.add(new THREE.HemisphereLight(0xf2dfac, 0x273320, 1.18));
      const sun = new THREE.DirectionalLight(0xffd58a, 1.65);
      sun.position.set(-24, 42, 30);
      sun.castShadow = globalMapRichShadowsEnabled();
      sun.shadow.mapSize.width = graphicsQuality === 'ultra' ? 2048 : 1024;
      sun.shadow.mapSize.height = graphicsQuality === 'ultra' ? 2048 : 1024;
      sun.shadow.camera.left = -56;
      sun.shadow.camera.right = 56;
      sun.shadow.camera.top = 56;
      sun.shadow.camera.bottom = -56;
      sun.shadow.camera.near = 4;
      sun.shadow.camera.far = 132;
      sun.shadow.bias = -0.00022;
      sun.shadow.normalBias = 0.045;
      GLOBAL_MAP_3D.sun = sun;
      GLOBAL_MAP_3D.scene.add(sun);
      const fill = new THREE.DirectionalLight(0x95b9ff, 0.42);
      fill.position.set(38, 22, -34);
      GLOBAL_MAP_3D.scene.add(fill);
      globalMap3dCanvas.parentElement?.classList.add('global-map-3d-ready');
      rebuildGlobalMap3DStatic();
      return true;
    } catch (err) {
      console.warn('[global-map-3d] failed to initialize', err);
      GLOBAL_MAP_3D.failed = true;
      globalMap3dCanvas.parentElement?.classList.remove('global-map-3d-ready');
      return false;
    }
  }

  function globalMap3DBasePixelRatio() {
    const raw = Math.max(1, Number(window.devicePixelRatio || 1));
    const desktopQualityFloor = 1.35;
    return Math.min(Math.max(raw, IS_MOBILE_DEVICE ? 1.0 : desktopQualityFloor), IS_MOBILE_DEVICE ? 1.25 : 2.0);
  }

  function globalMap3DMinPixelScale() {
    return IS_MOBILE_DEVICE ? 0.80 : 0.82;
  }

  function applyGlobalMap3DPixelRatio(force = false) {
    if (!GLOBAL_MAP_3D.renderer) return;
    const scale = Math.max(globalMap3DMinPixelScale(), Math.min(1.0, Number(GLOBAL_MAP_3D.pixelScale || 1)));
    const next = Math.max(0.65, globalMap3DBasePixelRatio() * scale);
    if (!force && Math.abs(next - Number(GLOBAL_MAP_3D.appliedPixelRatio || 0)) < 0.015) return;
    GLOBAL_MAP_3D.appliedPixelRatio = next;
    GLOBAL_MAP_3D.renderer.setPixelRatio(next);
    GLOBAL_MAP_3D.resizeTimer = 0;
    GLOBAL_MAP_3D.lastPixelRatio = 0;
  }

  function updateGlobalMap3DAdaptivePixelRatio(dt = 0) {
    if (!GLOBAL_MAP_3D.renderer || !document.body.classList.contains('global-map-mode')) return;
    if (!Number.isFinite(fpsValue) || fpsValue <= 0) return;
    GLOBAL_MAP_3D.pixelTimer = Number(GLOBAL_MAP_3D.pixelTimer || 0) + Math.max(0, Number(dt || 0));
    if (GLOBAL_MAP_3D.pixelTimer < 1.0) return;
    GLOBAL_MAP_3D.pixelTimer = 0;
    const minScale = globalMap3DMinPixelScale();
    let next = Number(GLOBAL_MAP_3D.pixelScale || 1);
    if (fpsValue < 52) next = Math.max(minScale, next - (fpsValue < 44 ? 0.055 : 0.03));
    else if (fpsValue >= 59 && next < 0.999) next = Math.min(1.0, next + 0.035);
    if (Math.abs(next - Number(GLOBAL_MAP_3D.pixelScale || 1)) < 0.002) return;
    GLOBAL_MAP_3D.pixelScale = next;
    applyGlobalMap3DPixelRatio(false);
  }

  function resizeGlobalMap3D(dt = 0, force = false) {
    if (!GLOBAL_MAP_3D.renderer || !globalMap3dCanvas) return;
    GLOBAL_MAP_3D.resizeTimer = Math.max(0, Number(GLOBAL_MAP_3D.resizeTimer || 0) - Math.max(0, Number(dt || 0)));
    if (!force && GLOBAL_MAP_3D.resizeTimer > 0) return;
    GLOBAL_MAP_3D.resizeTimer = 0.35;
    const rect = globalMap3dCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const ratio = GLOBAL_MAP_3D.renderer.getPixelRatio?.() || 1;
    const nextW = Math.floor(w * ratio);
    const nextH = Math.floor(h * ratio);
    const sameSize = GLOBAL_MAP_3D.lastCanvasW === w
      && GLOBAL_MAP_3D.lastCanvasH === h
      && Math.abs(Number(GLOBAL_MAP_3D.lastPixelRatio || 0) - ratio) < 0.001
      && globalMap3dCanvas.width === nextW
      && globalMap3dCanvas.height === nextH;
    if (sameSize) return;
    GLOBAL_MAP_3D.lastCanvasW = w;
    GLOBAL_MAP_3D.lastCanvasH = h;
    GLOBAL_MAP_3D.lastPixelRatio = ratio;
    if (globalMap3dCanvas.width !== Math.floor(w * (GLOBAL_MAP_3D.renderer.getPixelRatio?.() || 1)) ||
        globalMap3dCanvas.height !== Math.floor(h * (GLOBAL_MAP_3D.renderer.getPixelRatio?.() || 1))) {
      GLOBAL_MAP_3D.renderer.setSize(w, h, false);
    }
    GLOBAL_MAP_3D.camera.aspect = w / h;
    GLOBAL_MAP_3D.camera.updateProjectionMatrix();
  }

  function clampGlobalMap3DCameraTarget(x = 0, z = 0) {
    const margin = 10;
    GLOBAL_MAP_3D.targetX = Math.max(-GLOBAL_MAP_3D.worldWidth * 0.5 - margin, Math.min(GLOBAL_MAP_3D.worldWidth * 0.5 + margin, x));
    GLOBAL_MAP_3D.targetZ = Math.max(-GLOBAL_MAP_3D.worldDepth * 0.5 - margin, Math.min(GLOBAL_MAP_3D.worldDepth * 0.5 + margin, z));
  }

  function focusGlobalMapCameraOnRoute() {
    const playerPoint = globalMapState.travel ? globalMapTravelCurrentPoint(globalMapState.travel) : globalMapPlayerPoint();
    const destinationPoint = globalMapState.travel?.toPoint || globalMapSelectedPoint();
    const hasDestination = globalMapPointDistance(playerPoint, destinationPoint) > 0.35;
    const targetPoint = hasDestination
      ? { x: (playerPoint.x + destinationPoint.x) * 0.5, y: (playerPoint.y + destinationPoint.y) * 0.5 }
      : playerPoint;
    const target = globalMapWorldFromPoint(targetPoint);
    GLOBAL_MAP_3D.userPanned = false;
    GLOBAL_MAP_3D.dragging = false;
    clampGlobalMap3DCameraTarget(target.x, target.z);
  }

  function keepGlobalMapCameraAfterManualDestination() {
    if (!document.body.classList.contains('global-map-mode') || !ensureGlobalMap3D()) return;
    GLOBAL_MAP_3D.userPanned = true;
    GLOBAL_MAP_3D.dragging = false;
  }

  function clearGlobalMapCameraKeys() {
    GLOBAL_MAP_3D.keyPan = {};
  }

  function isGlobalMapCameraKey(code = '') {
    return code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD';
  }

  function handleGlobalMapCameraKey(e, down = false) {
    if (!document.body.classList.contains('global-map-mode')) return false;
    if (!isGlobalMapCameraKey(e.code)) return false;
    if (typeof isKeyboardTextEntryTarget === 'function' && isKeyboardTextEntryTarget(e.target)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (down) GLOBAL_MAP_3D.keyPan[e.code] = true;
    else delete GLOBAL_MAP_3D.keyPan[e.code];
    if (down) {
      GLOBAL_MAP_3D.userPanned = true;
      scheduleGlobalMap3DRender();
    }
    return true;
  }

  function updateGlobalMapKeyboardCamera(dt = 0) {
    if (!document.body.classList.contains('global-map-mode') || !ensureGlobalMap3D()) return false;
    const pan = GLOBAL_MAP_3D.keyPan || {};
    let dx = 0;
    let dz = 0;
    if (pan.KeyA) dx -= 1;
    if (pan.KeyD) dx += 1;
    if (pan.KeyW) dz -= 1;
    if (pan.KeyS) dz += 1;
    if (!dx && !dz) return false;
    const len = Math.hypot(dx, dz) || 1;
    const speed = Math.max(8, Math.min(24, Number(GLOBAL_MAP_3D.zoom || 90) * 0.16));
    const step = speed * Math.max(0.001, Math.min(0.08, Number(dt || 0)));
    GLOBAL_MAP_3D.userPanned = true;
    clampGlobalMap3DCameraTarget(
      GLOBAL_MAP_3D.targetX + (dx / len) * step,
      GLOBAL_MAP_3D.targetZ + (dz / len) * step
    );
    return true;
  }

  function updateGlobalMap3DCameraTarget() {
    if (!GLOBAL_MAP_3D.userPanned) {
      const playerPoint = globalMapState.travel ? globalMapTravelCurrentPoint(globalMapState.travel) : globalMapPlayerPoint();
      const destinationPoint = globalMapState.travel?.toPoint || globalMapSelectedPoint();
      const hasDestination = globalMapPointDistance(playerPoint, destinationPoint) > 0.35;
      const targetPoint = hasDestination
        ? { x: (playerPoint.x + destinationPoint.x) * 0.5, y: (playerPoint.y + destinationPoint.y) * 0.5 }
        : playerPoint;
      const target = globalMapWorldFromPoint(targetPoint);
      clampGlobalMap3DCameraTarget(target.x, target.z);
    }
    const zoom = GLOBAL_MAP_3D.zoom;
    const tx = GLOBAL_MAP_3D.targetX;
    const tz = GLOBAL_MAP_3D.targetZ;
    GLOBAL_MAP_3D.camera.position.set(tx, zoom * 0.62, tz + zoom * 0.72);
    GLOBAL_MAP_3D.camera.lookAt(tx, globalMapHeightAtWorld(tx, tz) - 0.2, tz);
  }

