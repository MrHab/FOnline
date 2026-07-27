  function createTraderNpc(tx, tz) {
    const traderProfile = currentLocation.trader || {};
    const authoredPos = traderProfile.position && typeof traderProfile.position === 'object' ? traderProfile.position : traderProfile;
    const fallbackPos = tileToWorld(tx, tz);
    const pos = Number.isFinite(Number(authoredPos.x)) && Number.isFinite(Number(authoredPos.z))
      ? { x: Number(authoredPos.x), z: Number(authoredPos.z) }
      : fallbackPos;
    const angle = Number(traderProfile.rotation?.y ?? traderProfile.rotationY ?? 0);
    const group = makeStaticModelGroup('traderNpc', pos.x, pos.z, angle, 'trader-npc');
    const sign = makeLabelSprite(traderProfile.name || '\u0422\u043e\u0440\u0433\u043e\u0432\u0435\u0446', '#e6c979');
    sign.position.set(0, 2.35, 0);
    group.add(sign);
    group.userData = group.userData || {};
    group.userData.kind = 'trader-npc';
    group.userData.traderOccluderSkip = true;
    markNoRuntimeCull(group, 'trader-npc');
    worldGroup.add(group);
    addStaticModelCollision('traderNpc', pos.x, pos.z, angle, {}, 'trader-npc');
    const crateA = createCrate(pos.x - 1.1, pos.z + 0.25, 0.8, 0.8);
    const crateB = createCrate(pos.x + 1.05, pos.z + 0.15, 0.7, 1.0);
    registerTraderInteriorObject(group);
    registerTraderInteriorObject(crateA);
    registerTraderInteriorObject(crateB);
    const profiledStock = null;
    const traderId = String(traderProfile.id || traderProfile.traderId || `${currentLocation.id || 'location'}_trader`)
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64) || 'location_trader';
    const dialogueProfile = String(traderProfile.dialogueProfile || traderProfile.profile || currentLocation.id || 'klim')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64) || 'klim';
    const traderQuests = Array.isArray(traderProfile.quests)
      ? traderProfile.quests.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    traderNpc = {
      id: traderId,
      x: pos.x,
      z: pos.z,
      mesh: group,
      name: traderProfile.name || '\u0422\u043e\u0440\u0433\u043e\u0432\u0435\u0446',
      locationId: currentLocation.id,
      traderId,
      dialogueProfile,
      traderQuests,
      traderCaps: undefined,
      inventory: []
    };
    if (profiledStock) traderNpc.traderStock = profiledStock;
    if (Array.isArray(traderProfile.buyInterests)) {
      traderNpc.traderBuyInterests = traderProfile.buyInterests.map(x => String(x || '')).filter(Boolean);
    }
    group.userData.traderNpc = traderNpc;
    group.traverse(child => {
      child.userData = child.userData || {};
      child.userData.traderNpc = traderNpc;
      child.userData.traderOccluderSkip = true;
    });
  }


  function createStorageChest(tx, tz) {
    const pos = tileToWorld(tx, tz);
    const group = makeStaticModelGroup('storageChest', pos.x, pos.z, -0.08, 'trader-storage');
    const storageName = currentLocation.storage?.name || '\u0425\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435';
    const sign = makeLabelSprite(storageName, '#d8bd6e');
    sign.position.set(0, 1.65, 0);
    group.add(sign);
    markNoRuntimeCull(group, 'trader-storage');
    worldGroup.add(group);
    storageBox = { x: pos.x, z: pos.z, mesh: group, name: storageName };
    group.userData.allowsPlayerOverlap = true;
    group.userData.storageBox = storageBox;
    group.traverse(child => { child.userData.storageBox = storageBox; });
    return group;
  }

  function shouldCreateStaticLocationTrader() {
    if (!currentLocation?.trader) return false;
    return !(locationUsesAuthoredLayout(currentLocation) && currentLocation.trader.authoredActor);
  }

  function createExitPortal(tx, tz, label) {
    const pos = tileToWorld(tx, tz);
    const group = new THREE.Group();
    group.position.set(pos.x, 0, pos.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.035, 8, 42), new THREE.MeshBasicMaterial({ color: 0xd8bd6e, transparent: true, opacity: 0.72 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);
    const postA = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.1, 8), mats.trunk);
    postA.position.set(-0.65, 0.55, 0);
    postA.castShadow = true;
    const postB = postA.clone();
    postB.position.x = 0.65;
    group.add(postA, postB);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.26, 0.12), mats.leather);
    board.position.y = 1.18;
    board.castShadow = true;
    group.add(board);
    // Надписи в мире оставляем только для торговца и хранилища.
    // У перехода остаётся визуальный маркер без постоянного текста над объектом.
    if (isTraderYardLocation()) markNoRuntimeCull(group, 'trader-yard-exit');
    worldGroup.add(group);
    exitPortal = { x: pos.x, z: pos.z, to: currentLocation.exit.to, label, mesh: group };
  }

  function createWorldMapExitZoneVisuals() {
    if (!currentLocation) return;
    const group = new THREE.Group();
    group.userData.kind = 'world-map-exit-zone';

    const mapWidth = MAP_W * TILE;
    const mapDepth = MAP_H * TILE;
    const bandWidth = TILE * 2;
    const northZ = tileToWorld(0, 0).z + TILE * 0.5;
    const southZ = tileToWorld(0, MAP_H - 1).z - TILE * 0.5;
    const westX = tileToWorld(0, 0).x + TILE * 0.5;
    const eastX = tileToWorld(MAP_W - 1, 0).x - TILE * 0.5;
    const innerNorthZ = tileToWorld(0, 2).z - TILE * 0.5;
    const innerSouthZ = tileToWorld(0, MAP_H - 3).z + TILE * 0.5;
    const innerWestX = tileToWorld(2, 0).x - TILE * 0.5;
    const innerEastX = tileToWorld(MAP_W - 3, 0).x + TILE * 0.5;

    const zoneMat = new THREE.MeshBasicMaterial({
      color: 0xd8bd6e,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xffd36d,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const arrowMat = new THREE.MeshBasicMaterial({
      color: 0xffd36d,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const addFlatPlane = (w, h, x, z, mat, y = 0.038) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, z);
      mesh.receiveShadow = false;
      group.add(mesh);
      return mesh;
    };

    addFlatPlane(mapWidth, bandWidth, 0, northZ, zoneMat);
    addFlatPlane(mapWidth, bandWidth, 0, southZ, zoneMat);
    addFlatPlane(bandWidth, mapDepth, westX, 0, zoneMat);
    addFlatPlane(bandWidth, mapDepth, eastX, 0, zoneMat);
    addFlatPlane(mapWidth, 0.16, 0, innerNorthZ, lineMat, 0.052);
    addFlatPlane(mapWidth, 0.16, 0, innerSouthZ, lineMat, 0.052);
    addFlatPlane(0.16, mapDepth, innerWestX, 0, lineMat, 0.052);
    addFlatPlane(0.16, mapDepth, innerEastX, 0, lineMat, 0.052);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0.58);
    shape.lineTo(-0.42, -0.36);
    shape.lineTo(0.42, -0.36);
    shape.lineTo(0, 0.58);
    const arrowGeom = new THREE.ShapeGeometry(shape);
    const addArrow = (x, z, rotY = 0) => {
      const arrow = new THREE.Mesh(arrowGeom, arrowMat);
      arrow.rotation.x = -Math.PI / 2;
      arrow.rotation.y = rotY;
      arrow.position.set(x, 0.07, z);
      arrow.scale.set(1.25, 1.25, 1);
      group.add(arrow);
      return arrow;
    };
    [-24, -8, 8, 24].forEach(x => {
      addArrow(x, innerNorthZ - 1.2, 0);
      addArrow(x, innerSouthZ + 1.2, Math.PI);
    });
    [-24, -8, 8, 24].forEach(z => {
      addArrow(innerWestX - 1.2, z, -Math.PI / 2);
      addArrow(innerEastX + 1.2, z, Math.PI / 2);
    });

    const addSign = (text, x, z) => {
      const sprite = makeLabelSprite(text, '#ffd36d');
      sprite.position.set(x, 1.45, z);
      sprite.scale.set(5.2, 0.92, 1);
      group.add(sprite);
      return sprite;
    };
    addSign('ГЛОБАЛЬНАЯ КАРТА', 0, innerNorthZ + 1.15);
    addSign('ГЛОБАЛЬНАЯ КАРТА', 0, innerSouthZ - 1.15);
    addSign('ГЛОБАЛЬНАЯ КАРТА', innerWestX + 1.15, 0);
    addSign('ГЛОБАЛЬНАЯ КАРТА', innerEastX - 1.15, 0);

    markNoRuntimeCull(group, 'world-map-exit-zone');
    worldGroup.add(group);
  }

  function createScrapWreck(x, z, angle = 0) {
    return createStaticSetDressing('carWreck', x, z, angle, 'scrap-wreck');
  }

  function createBarrelCluster(x, z, angle = 0) {
    return createStaticSetDressing('barrelCluster', x, z, angle, 'barrel-cluster');
  }

  function createOilNode(x, z, angle = 0) {
    return createStaticObstacleModel('oilPumpJack', x, z, angle, 'oil-resource', 'static-resource', { scale: 1.0 });
  }


  function registerSetDressingGroup(group, x, z, kind = 'set-dressing') {
    if (isTraderYardLocation() && !locationUsesAuthoredLayout(currentLocation)) markNoRuntimeCull(group, 'trader-yard-set-dressing');
    worldGroup.add(group);
    const tt = worldToTile(x, z);
    staticCullObjects.push({ object: group, tx: tt.tx, tz: tt.tz, kind });
    return group;
  }

  function createDeadTree(x, z, angle = 0) {
    const variants = ['deadTreeA', 'deadTreeB', 'deadTreeC'];
    const key = variants[Math.floor(Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * variants.length) % variants.length];
    return createStaticSetDressing(key, x, z, angle, 'dead-tree');
  }

  function createCactus(x, z, angle = 0) {
    return createStaticSetDressing('cactus', x, z, angle, 'cactus');
  }

  function createTireStack(x, z, angle = 0) {
    return createStaticSetDressing('tireStack', x, z, angle, 'tire-stack');
  }

  function createWastelandShack(x, z, angle = 0) {
    return createStaticSetDressing('wastelandShack', x, z, angle, 'wasteland-shack');
  }

  function createScrapNest(x, z, angle = 0) {
    return createStaticSetDressing('scrapHeap', x, z, angle, 'scrap-nest');
  }

  function createHighwaySign(x, z, angle = 0) {
    return createStaticSetDressing('highwaySign', x, z, angle, 'prewar-highway-sign');
  }

  function createRuinedBillboard(x, z, angle = 0) {
    return createStaticSetDressing('ruinedBillboard', x, z, angle, 'ruined-billboard');
  }

  function createUtilityPole(x, z, angle = 0) {
    return createStaticSetDressing('utilityPole', x, z, angle, 'dead-utility-pole');
  }

  function createRoadblockBarricade(x, z, angle = 0) {
    return createStaticSetDressing('roadblockBarricade', x, z, angle, 'roadblock-barricade');
  }

  function createDryBush(x, z, angle = 0) {
    return createStaticSetDressing('dryBush', x, z, angle, 'dry-bush');
  }

  function createAsphaltSlab(x, z, angle = 0) {
    return createStaticSetDressing('asphaltSlab', x, z, angle, 'broken-asphalt-slab');
  }

  function createFenceSegment(x, z, angle = 0, length = 2.0) {
    return createStaticSetDressing('fenceSegment', x, z, angle, 'fence-segment', { scaleX: Math.max(0.35, length / 2.0) });
  }

  function createDioramaGroundBlend(tx, tz, size = 2.3, angle = 0) {
    if (!inBounds(tx, tz)) return;
    const p = tileToWorld(tx, tz);
    createTerrainPatch(tx, tz, p, mats.groundDust, size, size * 0.72, angle, 0.004, 0.20);
    if (graphicsDecalDensity() > 0.45) {
      createGroundDecal(tx, tz, p, mats.groundCrack, size * 0.42, angle + 0.35, 0.006);
    }
  }

  function createPlank(group, x, y, z, sx, sy, sz, mat = mats.trunk, ry = 0, rz = 0) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    plank.position.set(x, y, z);
    plank.rotation.y = ry;
    plank.rotation.z = rz;
    plank.castShadow = true;
    plank.receiveShadow = true;
    group.add(plank);
    return plank;
  }

  function createTraderAwning(x, z, angle = 0) {
    const group = createStaticSetDressing('traderAwning', x, z, angle, 'trader-awning');
    const lantern = new THREE.PointLight(0xffb86b, 0.95, 5.2, 2.0);
    lantern.position.set(0.78, 1.22, -0.62);
    group.add(lantern);
    return group;
  }

  function createStorageLeanTo(x, z, angle = 0) {
    return createStaticSetDressing('storageLeanTo', x, z, angle, 'storage-lean-to');
  }

  function createPerimeterDebris(x, z, angle = 0, kind = 'scrap') {
    return createStaticSetDressing('perimeterDebris', x, z, angle, kind === 'bones' ? 'perimeter-debris-bones' : 'perimeter-debris');
  }

  function createLowRuinedWall(x, z, angle = 0, length = 2.2) {
    return createStaticSetDressing('lowRuinedWall', x, z, angle, 'low-ruined-wall', { scaleX: Math.max(0.35, length / 2.2) });
  }

  function createWatchPost(x, z, angle = 0) {
    return createStaticSetDressing('watchPost', x, z, angle, 'watch-post');
  }


  function createScrapWallSegment(x, z, angle = 0, length = 6.8, height = 2.15) {
    return createStaticSetDressing('scrapWallSegment', x, z, angle, 'scrap-wall', {
      scaleX: Math.max(0.35, length / 6.8),
      scaleY: Math.max(0.35, height / 2.15)
    });
  }

  function createScrapWatchTower(x, z, angle = 0, beamYaw = 0) {
    const group = createStaticSetDressing('scrapWatchTower', x, z, angle, 'scrap-watch-tower');
    if (!IS_MOBILE_DEVICE && graphicsDetailLevel() >= 0.40) {
      const light = new THREE.SpotLight(0xffd690, 0.75, 14, 0.50, 0.6, 1.5);
      light.position.set(0, 2.18, -0.38);
      light.target.position.set(Math.sin(beamYaw) * 4.5, 0.8, -6.2);
      light.castShadow = false;
      group.add(light);
      group.add(light.target);
    }
    return group;
  }

  function createOpenScrapGate(x, z, angle = 0) {
    return createStaticSetDressing('openScrapGate', x, z, angle, 'open-scrap-gate');
  }


  function createTraderOuterWastelandBackdrop() {
    // Пространство за стенами должно читаться как живая пустошь, а не как пустота.
    createGroundLayerTile(19, 4, mats.traderLayerSand, 28, 8.6, 0.02, 0.44, 0.010);
    createGroundLayerTile(19, 4, mats.traderLayerCracks, 24, 7.4, -0.04, 0.24, 0.014);
    createGroundLayerTile(19, 5, mats.traderLayerRoad, 8.0, 8.8, 0.02, 0.62, 0.012);
    createGroundLayerTile(4, 19, mats.traderLayerSand, 8.5, 22, Math.PI / 2, 0.22, 0.010);
    createGroundLayerTile(34, 19, mats.traderLayerSand, 8.5, 22, Math.PI / 2, 0.22, 0.010);

    [[14, 3, -0.12], [24, 3, 0.24]].forEach(([tx, tz, a]) => {
      const p = tileToWorld(tx, tz);
      createScrapWreck(p.x, p.z, a);
    });
    [[6, 12, -0.35, 2.8], [32, 12, 0.28, 2.8], [6, 28, 0.18, 2.4], [32, 28, -0.18, 2.4]].forEach(([tx, tz, a, l]) => {
      const p = tileToWorld(tx, tz);
      createLowRuinedWall(p.x, p.z, a, l);
    });
  }

  function createTraderMapEdgeBuffer() {
    // v7.75.53: edge fog/sandstorm removed by request.
    // Keep only the enlarged wasteland backplate from v7.75.48.
    if (traderEdgeDustHazeRuntime && Array.isArray(traderEdgeDustHazeRuntime.items)) {
      traderEdgeDustHazeRuntime.items.length = 0;
      traderEdgeDustHazeRuntime.time = 0;
    }
  }

  function updateTraderEdgeDustHaze(dt = 0) {
    // Edge haze disabled.
  }

  function createTraderFortWalls() {
    const place = (tx, tz, angle, length) => {
      const p = tileToWorld(tx, tz);
      createScrapWallSegment(p.x, p.z, angle, length);
    };

    // Северная стена с разрывом под ворота.
    place(10, 8, 0, 8.4);
    place(27.5, 8, 0, 8.8);

    // Южная стена.
    place(10, 31, 0, 9.2);
    place(19, 31, 0, 8.8);
    place(28, 31, 0, 9.2);

    // Западная и восточная стены.
    [12, 18, 24, 29].forEach(tz => place(5, tz, Math.PI / 2, tz === 18 ? 7.6 : 6.8));
    [12, 18, 24, 29].forEach(tz => place(33, tz, Math.PI / 2, tz === 18 ? 7.6 : 6.8));
  }


