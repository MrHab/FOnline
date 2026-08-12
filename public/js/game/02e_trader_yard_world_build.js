  function updateTraderBuildingRoofCutaway(dt = 0) {
    const hasShaderRoof = !!(traderBuildingStaticRoofs.length || traderBuildingCutawayRoofs.length || traderBuildingCutawayRoofBatches.length);
    const hasAuthoredShell = !!(traderBuildingWallBlocks.length || traderBuildingAuthoredRoofBlocks.length || traderBuildingInteriorObjects.length);
    if ((!hasShaderRoof && !hasAuthoredShell) || !player) return;
    const shouldUpdateRoofMask = hasShaderRoof && isTraderYardLocation() ? shouldEvaluateTraderRoofCutaway(dt) : false;
    maybeUpdateTraderWallBlockTransparency(dt, shouldUpdateRoofMask);
    if (!hasShaderRoof || !isTraderYardLocation()) return;
    if (!shouldUpdateRoofMask) return;

    // Roof cutaway is now per-cell: the material stays opaque and textured, and
    // only the instanced roofCutaway attribute changes for cells currently in the
    // player's normal gameplay visibility. Fogged cells remain solid roof panels.
    const roofCutawayVisible = traderRoofCutawayRuntime.evaluatedFullRoofCutawayVisible === true;
    const anyVisibleInteriorZone = roofCutawayVisible;
    applyTraderRoofMaterialOpacity(false, false);
    if (updateTraderRoofVisionCells(null, false)) traderRoofCutawayRuntime.roofVisibilityChanged = true;

    traderBuildingStaticRoofs.forEach(roof => {
      if (!roof) return;
      roof.castShadow = false;
      roof.receiveShadow = false;
      roof.userData.forceNoShadow = true;
      roof.frustumCulled = false;
      setVisibleStable(roof, true);
    });

    traderBuildingCutawayRoofBatches.forEach(batch => {
      if (!batch || !batch.mesh) return;
      [batch.mesh, batch.ghostMesh].forEach(roofMesh => {
        if (!roofMesh) return;
        roofMesh.castShadow = false;
        roofMesh.receiveShadow = false;
        roofMesh.userData.forceNoShadow = true;
        roofMesh.frustumCulled = false;
        setVisibleStable(roofMesh, true);
        if (roofMesh.instanceMatrix) roofMesh.instanceMatrix.needsUpdate = false;
      });
    });

    traderBuildingCutawayRoofs.forEach(roof => {
      if (!roof) return;
      roof.castShadow = false;
      roof.receiveShadow = false;
      roof.userData.forceNoShadow = true;
      roof.frustumCulled = false;
      setVisibleStable(roof, true);
    });

    traderRoofCutawayRuntime.lastAnyVisibleInteriorZone = anyVisibleInteriorZone;

    traderBuildingOcclusionVolumes.forEach(fog => {
      if (!fog) return;
      fog.castShadow = false;
      fog.receiveShadow = false;
      setVisibleStable(fog, false);
    });

    traderBuildingInteriorObjects.forEach(obj => {
      if (!obj) return;
      // Static environment under the roof is no longer part of fog-of-war
      // visibility. The roof itself is the visual blocker. Only dynamic actors
      // and interactable objects should be hidden by interior fog rules.
      obj.frustumCulled = false;
      setVisibleStable(obj, true);
    });


    if (traderNpc && traderNpc.mesh) {
      setVisibleStable(traderNpc.mesh, roofCutawayVisible && isTraderWorldPointVisible(traderNpc.x, traderNpc.z));
    }
    if (traderRoofCutawayRuntime.roofVisibilityChanged || traderRoofCutawayRuntime.force) {
      updateTraderInteriorLightLevels(true);
    }
  }

  function createPbrWaterTank(x, z, angle = 0) {
    return createStaticSetDressing('waterTank', x, z, angle, 'well-water-tank');
  }

  function createArmoryRack(x, z, angle = 0) {
    return createStaticSetDressing('armoryRack', x, z, angle, 'armory');
  }

  function createWorkshopBench(x, z, angle = 0) {
    return createStaticSetDressing('workshopBench', x, z, angle, 'workshop');
  }

  function createGardenPatch(x, z, angle = 0) {
    return createStaticSetDressing('gardenPatch', x, z, angle, 'survival-garden');
  }

  function createLatrineOuthouse(x, z, angle = 0) {
    return createStaticSetDressing('latrineOuthouse', x, z, angle, 'latrine');
  }

  function createCampfireRestArea(x, z, angle = 0) {
    const group = createStaticSetDressing('campfireRest', x, z, angle, 'campfire-rest-area');
    const glow = new THREE.PointLight(0xffa64a, 1.25, 7.5, 2.2);
    glow.position.set(0, 1.05, 0);
    group.add(glow);
    return group;
  }

  function createCargoStack(x, z, angle = 0) {
    return createStaticSetDressing('cargoStack', x, z, angle, 'caravan-cargo');
  }

  function createBrahmin(x, z, angle = 0, loaded = true) {
    return createStaticSetDressing('brahmin', x, z, angle, loaded ? 'brahmin' : 'brahmin-unloaded');
  }

  function createBrahminPen(x, z, angle = 0) {
    return createStaticSetDressing('brahminPen', x, z, angle, 'brahmin-pen');
  }

  function createTraderTownFunctionalZones() {
    // v7.68: все координаты ниже соответствуют текстовой подсказке из patch notes.
    // Здесь поселение собирается не случайным декором, а бытовой логикой караванщиков.
    [[17,13,-0.12],[20,14,0.16],[22,16,-0.22]].forEach(([tx,tz,a]) => placeTraderTownObject(tx, tz, (x,z) => createCargoStack(x, z, a)));

    placeTraderTownObject(28, 13, (x,z) => createBrahminPen(x, z, 0.02));
    placeTraderTownObject(27, 13, (x,z) => createBrahmin(x - 0.35, z - 0.15, -0.22, true));
    placeTraderTownObject(30, 14, (x,z) => createBrahmin(x + 0.10, z + 0.12, 0.18, false));

    placeTraderTownObject(12, 16, (x,z) => createCampfireRestArea(x, z, -0.04));
    placeTraderTownObject(17, 19, (x,z) => createPbrWaterTank(x, z, 0.0));
    placeTraderTownObject(7, 12, (x,z) => createLatrineOuthouse(x, z, -0.12));

    placeTraderTownObject(9, 27, (x,z) => createGardenPatch(x, z, 0.02));
    placeTraderTownObject(11, 28, (x,z) => createGardenPatch(x, z, -0.03));
    placeTraderTownObject(10, 29, (x,z) => createFenceSegment(x, z, 0, 2.8));

    placeTraderTownObject(10, 28, (x,z) => createArmoryRack(x, z, 0.08));
    placeTraderTownObject(24, 26, (x,z) => createWorkshopBench(x, z, -0.08));
    [[23,18,0.10],[25,18,-0.16],[26,20,0.22]].forEach(([tx,tz,a]) => placeTraderTownObject(tx, tz, (x,z) => createCargoStack(x, z, a)));
  }


  function createGroundLayerWorld(x, z, material, sx = 4, sz = 4, rot = 0, opacity = null, y = 0.010, kind = 'trader-ground-layer') {
    if (!material) return null;
    const layerMaterial = material.clone ? markDisposableMaterial(material.clone()) : material;
    const mesh = new THREE.Mesh(detailPlaneGeom, layerMaterial);
    if (opacity !== null && mesh.material) mesh.material.opacity = opacity;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = rot;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sz, 1);
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    mesh.userData.kind = kind;
    worldGroup.add(mesh);
    const tt = worldToTile(x, z);
    staticCullObjects.push({ object: mesh, tx: tt.tx, tz: tt.tz, kind: 'floor-detail' });
    return mesh;
  }

  function createGroundLayerTile(tx, tz, material, sx = 4, sz = 4, rot = 0, opacity = null, y = 0.010) {
    const p = tileToWorld(tx, tz);
    return createGroundLayerWorld(p.x, p.z, material, sx, sz, rot, opacity, y);
  }

  function createGroundLayerBatchWorld(material, spots = [], kind = 'trader-ground-layer-batch') {
    const rows = Array.isArray(spots) ? spots.filter(row => Array.isArray(row) && row.length >= 2) : [];
    if (!material || !rows.length) return null;
    if (!THREE.InstancedMesh || typeof enableInstanceOpacityMaterial !== 'function') {
      rows.forEach(([x, z, sx = 4, sz = 4, rot = 0, opacity = null, y = 0.010]) => {
        createGroundLayerWorld(x, z, material, sx, sz, rot, opacity, y, kind);
      });
      return null;
    }

    // The authored yard used to clone one transparent material and submit one draw
    // call for every ground patch. Keep the same transforms and per-patch opacity,
    // but submit every patch sharing a material as one instanced draw call.
    const geometry = detailPlaneGeom.clone ? markDisposableGeometry(detailPlaneGeom.clone()) : detailPlaneGeom;
    // Share shader programs across batches with the same material feature set;
    // textures stay separate uniforms and do not need separate compilations.
    const batchMaterial = enableInstanceOpacityMaterial(material, 'trader-ground-layer-batch');
    const baseOpacity = Math.max(0, Math.min(1, Number(material.opacity ?? 1)));
    batchMaterial.opacity = 1;

    const mesh = new THREE.InstancedMesh(geometry, batchMaterial, rows.length);
    const opacityArray = new Float32Array(rows.length);
    const InstancedAttribute = THREE.InstancedBufferAttribute || THREE.BufferAttribute;
    const opacityAttribute = new InstancedAttribute(opacityArray, 1);
    if (geometry && typeof geometry.setAttribute === 'function') {
      geometry.setAttribute('instanceOpacity', opacityAttribute);
    } else if (typeof setGeometryAttributeCompat === 'function') {
      setGeometryAttributeCompat(geometry, 'instanceOpacity', opacityAttribute);
    }

    const dummy = new THREE.Object3D();
    rows.forEach(([x, z, sx = 4, sz = 4, rot = 0, opacity = null, y = 0.010], index) => {
      dummy.position.set(Number(x || 0), Number(y || 0), Number(z || 0));
      dummy.rotation.set(-Math.PI / 2, 0, Number(rot || 0));
      dummy.scale.set(Number(sx || 4), Number(sz || 4), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      opacityArray[index] = opacity === null ? baseOpacity : Math.max(0, Math.min(1, Number(opacity || 0)));
    });

    if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
    opacityAttribute.needsUpdate = true;
    mesh.name = `${kind}_${currentLocation?.id || 'location'}`;
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.userData.kind = kind;
    mesh.userData.groundLayerInstanceCount = rows.length;
    worldGroup.add(mesh);
    staticCullObjects.push({
      object: mesh,
      tx: Math.floor(MAP_W / 2),
      tz: Math.floor(MAP_H / 2),
      kind: 'floor-detail'
    });
    return mesh;
  }

  function createTraderReliefPebbleField() {
    // Настоящий микрорельеф поверх PBR-земли: мелкие камни и сухие пучки не рисуются
    // текстурой, а являются instanced 3D-объектами. Это даёт объём без сотен draw calls.
    const detail = graphicsDetailLevel();
    if (detail < 0.22) return;
    const count = Math.floor((IS_MOBILE_DEVICE ? 42 : 120) * Math.max(0.35, detail));
    const pebble = new THREE.InstancedMesh(pebbleGeom, mats.rockLight, count);
    pebble.castShadow = true;
    pebble.receiveShadow = true;
    pebble.userData.kind = 'trader-relief-pebbles';
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count * 3 && placed < count; i++) {
      const h1 = hash01(i, currentLocation.seed, 7601);
      const h2 = hash01(i, currentLocation.seed, 7603);
      const tx = 4 + Math.floor(h1 * 30);
      const tz = 5 + Math.floor(h2 * 28);
      // Двор и дорога должны быть читаемыми: камни чаще по краям, реже в центре.
      const nearCenter = Math.abs(tx - 19) < 6 && Math.abs(tz - 20) < 5;
      if (nearCenter && hash01(i, 0, 7605) < 0.58) continue;
      const p = tileToWorld(tx, tz);
      dummy.position.set(p.x + (hash01(i, 0, 7607) - 0.5) * 1.75, 0.035, p.z + (hash01(i, 0, 7609) - 0.5) * 1.75);
      const s = 0.48 + hash01(i, 0, 7611) * 0.82;
      dummy.scale.set(s * (1.0 + hash01(i, 0, 7613) * 1.2), s * 0.38, s * (0.8 + hash01(i, 0, 7615) * 0.8));
      dummy.rotation.set(hash01(i, 0, 7617) * Math.PI, hash01(i, 0, 7619) * Math.PI * 2, hash01(i, 0, 7621) * Math.PI);
      dummy.updateMatrix();
      pebble.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    pebble.count = placed;
    worldGroup.add(pebble);
    staticCullObjects.push({ object: pebble, tx: Math.floor(MAP_W / 2), tz: Math.floor(MAP_H / 2), kind: 'floor-detail' });
  }

  function createTraderReliefCrackRidges() {
    const detail = graphicsDetailLevel();
    if (detail < 0.48) return;
    const mat = mats.rock || mats.darkMetal;
    const ridgeGeom = new THREE.BoxGeometry(1, 0.018, 0.026);
    const segments = IS_MOBILE_DEVICE ? 18 : 42;
    const ridges = new THREE.InstancedMesh(ridgeGeom, mat, segments);
    ridges.castShadow = false;
    ridges.receiveShadow = true;
    ridges.userData.kind = 'trader-relief-crack-ridges';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < segments; i++) {
      const tx = 7 + Math.floor(hash01(i, 17, 7631) * 25);
      const tz = 8 + Math.floor(hash01(i, 19, 7633) * 24);
      const p = tileToWorld(tx, tz);
      dummy.position.set(p.x + (hash01(i, 0, 7635) - 0.5) * 1.5, 0.026, p.z + (hash01(i, 0, 7637) - 0.5) * 1.5);
      dummy.rotation.set(0, hash01(i, 0, 7639) * Math.PI * 2, 0);
      dummy.scale.set(0.35 + hash01(i, 0, 7641) * 1.3, 1, 1);
      dummy.updateMatrix();
      ridges.setMatrixAt(i, dummy.matrix);
    }
    worldGroup.add(ridges);
    staticCullObjects.push({ object: ridges, tx: Math.floor(MAP_W / 2), tz: Math.floor(MAP_H / 2), kind: 'floor-detail' });
  }

  function createTraderBakedContactAO() {
    // v7.61: cheap baked contact AO. Instead of realtime SSAO/deferred shading, which is
    // expensive in WebGL, every important prop cluster gets a hand-placed dark contact decal.
    const ao = mats.traderContactAO;
    if (!ao) return;
    const spots = [
      [-14.3, 3.2, 11.6, 5.4, 0.00, 0.72], // GLB trade hall
      [-12.0, -5.0, 12.0, 6.6, 0.00, 0.58], // six-station workshop
      [-5.0, 11.0, 4.2, 3.0, 0.08, 0.56], // capital storage
      [2.0, 1.0, 4.0, 3.0, 0.12, 0.42], // plaza fire
      [13.0, 1.0, 6.0, 3.3, 0.26, 0.48], // caravan
      [18.0, 18.0, 5.3, 3.7, 0.00, 0.48], // loading canopy
      [15.0, 11.0, 8.0, 5.5, -0.08, 0.42], // cargo/loading stacks
      [1.0, -21.0, 11.0, 2.8, 0.00, 0.44] // southern gate
    ];
    createGroundLayerBatchWorld(
      ao,
      spots.map(([x, z, sx, sz, rot, op]) => [x, z, sx, sz, rot, op, 0.026]),
      'trader-contact-ao-batch'
    );
  }

  function createTraderInstancedDryGrassField() {
    // Thousands of individual grass meshes would kill draw calls. Use two InstancedMesh
    // batches with the same cone geometry, so the location gains detail for almost no CPU cost.
    const detail = graphicsDetailLevel();
    if (detail < 0.34) return;
    const count = Math.floor((IS_MOBILE_DEVICE ? 56 : 180) * Math.max(0.40, detail));
    const matsForGrass = [mats.dryGrass, mats.scrub];
    const batches = matsForGrass.map(mat => new THREE.InstancedMesh(grassBladeGeom, mat, count));
    const dummy = new THREE.Object3D();
    const placed = [0, 0];
    for (let i = 0; i < count * 4 && (placed[0] + placed[1]) < count; i++) {
      const tx = 4 + Math.floor(hash01(i, 0, 7681) * 30);
      const tz = 5 + Math.floor(hash01(i, 0, 7683) * 29);
      // Keep the main path and trader square readable; grass lives on edges and around ruins.
      if (Math.abs(tx - 19) < 5 && tz > 12 && tz < 24 && hash01(i, 0, 7685) < 0.80) continue;
      if (Math.abs(tx - 19) < 3 && tz < 13 && hash01(i, 0, 7687) < 0.65) continue;
      const p = tileToWorld(tx, tz);
      const b = hash01(i, 0, 7689) > 0.48 ? 0 : 1;
      if (placed[b] >= count) continue;
      dummy.position.set(p.x + (hash01(i, 0, 7691) - 0.5) * 1.8, 0.18, p.z + (hash01(i, 0, 7693) - 0.5) * 1.8);
      dummy.rotation.set((hash01(i, 0, 7695) - 0.5) * 0.26, hash01(i, 0, 7697) * Math.PI * 2, (hash01(i, 0, 7699) - 0.5) * 0.26);
      const s = 0.75 + hash01(i, 0, 7701) * 1.25;
      dummy.scale.set(s * 0.75, s * (0.75 + hash01(i, 0, 7703) * 0.70), s * 0.75);
      dummy.updateMatrix();
      batches[b].setMatrixAt(placed[b], dummy.matrix);
      placed[b] += 1;
    }
    batches.forEach((batch, idx) => {
      batch.count = placed[idx];
      if (!batch.count) return;
      batch.castShadow = !!graphicsSettings.shadows && !IS_MOBILE_DEVICE;
      batch.receiveShadow = true;
      batch.userData.kind = 'trader-instanced-dry-grass';
      worldGroup.add(batch);
      staticCullObjects.push({ object: batch, tx: Math.floor(MAP_W / 2), tz: Math.floor(MAP_H / 2), kind: 'floor-detail' });
    });
  }

  function createTraderLanternGlow(tx, tz, dx = 0, dz = 0, y = 0.95) {
    const p = tileToWorld(tx, tz);
    const group = new THREE.Group();
    group.position.set(p.x + dx, y, p.z + dz);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), mats.ember);
    bulb.castShadow = false;
    group.add(bulb);
    const glow = new THREE.Mesh(detailPlaneGeom, mats.traderWarmGlow);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, -y + 0.034, 0);
    glow.scale.set(2.8, 1.5, 1);
    glow.renderOrder = 2;
    group.add(glow);
    if (!IS_MOBILE_DEVICE && graphicsDetailLevel() >= 0.64) {
      const light = new THREE.PointLight(0xffa358, 0.42, 7.5, 2.0);
      light.position.set(0, 0.10, 0);
      group.add(light);
    }
    worldGroup.add(group);
    staticCullObjects.push({ object: group, tx, tz, kind: 'floor-detail' });
    return group;
  }





  function addTraderTownCollisionVolumes() {
    if (!isTraderYardLocation()) return;
    if (locationUsesAuthoredLayout(currentLocation)) return;
    const shop = traderBuildingCenterWorld();
    const tile = Number(TILE || 2.0);
    const blockSize = tile;
    const halfW = tile * 5;
    const halfD = tile * 4;
    const frontWallZ = halfD - blockSize / 2;
    const sideWallX = halfW - blockSize / 2;
    const frontBackCenters = [];
    for (let i = 0; i < Math.round((halfW * 2) / blockSize); i++) frontBackCenters.push(-halfW + blockSize / 2 + i * blockSize);
    const sideCenters = [];
    for (let i = 1; i < Math.round((halfD * 2) / blockSize) - 1; i++) sideCenters.push(-halfD + blockSize / 2 + i * blockSize);

    frontBackCenters.forEach(cx => {
      const isDoorCell = Math.abs(cx) < blockSize;
      if (!isDoorCell) addStaticModelCollision('traderWallBlock', shop.x + cx, shop.z - frontWallZ, 0, {}, 'trader-block-front-wall');
      addStaticModelCollision('traderWallBlock', shop.x + cx, shop.z + frontWallZ, 0, {}, 'trader-block-back-wall');
    });
    sideCenters.forEach(cz => {
      addStaticModelCollision('traderWallBlock', shop.x - sideWallX, shop.z + cz, Math.PI / 2, {}, 'trader-block-left-wall');
      addStaticModelCollision('traderWallBlock', shop.x + sideWallX, shop.z + cz, Math.PI / 2, {}, 'trader-block-right-wall');
    });
  }

  function createTraderYardTerrainLayers() {
    // v7.68: террейн очищен и распределён по бытовым зонам караванного двора.
    // Центр остаётся проходимым, а следы, гравий и AO объясняют, где ходят люди,
    // где заходят караваны, где стоят брамины и где начинается внешний мир.
    const detail = graphicsDetailLevel();
    const extra = detail >= 0.64;

    // Each material is one draw call. Individual patches retain the exact authored
    // position, scale, rotation, height and alpha through instance attributes.
    createGroundLayerBatchWorld(mats.traderLayerSand, [
      [0, 2, 28, 22, 0.01, 0.76, 0.011],
      [0, 22, 28, 4.0, 0.02, 0.42, 0.012],
      [-25, 2, 4.0, 21.0, Math.PI / 2, 0.18, 0.010],
      [25, 2, 4.0, 21.0, Math.PI / 2, 0.18, 0.010]
    ], 'trader-ground-sand-batch');
    createGroundLayerBatchWorld(mats.traderLayerCracks, [
      [0, 1, 24, 17, -0.04, 0.28, 0.014]
    ], 'trader-ground-cracks-batch');

    // Главный караванный путь и функциональные зоны двора.
    createGroundLayerBatchWorld(mats.traderLayerRoad, [
      [1, -10, 9.5, 29.0, 0.015, 0.80, 0.012],
      [-13.0, 3.0, 13.5, 7.2, -0.02, 0.58, 0.014], // trade hall
      [2.0, 1.0, 12.0, 9.0, 0.04, 0.44, 0.014] // plaza
    ], 'trader-ground-road-batch');
    createGroundLayerBatchWorld(mats.traderLayerTire, [
      [3, -8, 7.4, 16.0, 0.02, 0.52, 0.016],
      [11, 4, 15.0, 6.0, -0.18, 0.30, 0.016]
    ], 'trader-ground-tire-batch');
    createGroundLayerBatchWorld(mats.traderLayerOil, [
      [-12.0, -5.0, 13.0, 8.0, -0.02, 0.40, 0.018], // workshop
      [13.0, 1.0, 7.0, 4.0, 0.18, 0.28, 0.018] // caravan service patch
    ], 'trader-ground-oil-batch');
    createGroundLayerBatchWorld(mats.traderLayerGravel, [
      [15.0, 10.0, 15.0, 15.0, 0.10, 0.50, 0.018], // loading yard
      [-5.0, 11.0, 5.0, 4.0, -0.08, 0.38, 0.018] // storage
    ], 'trader-ground-gravel-batch');

    if (extra) {
      createGroundLayerBatchWorld(mats.traderLayerShadow, [
        [0, 1, 18, 11, 0.00, 0.13, 0.017]
      ], 'trader-ground-shadow-batch');
    }

    createTraderBakedContactAO();
  }


  function createHandbuiltTraderLocation() {
    return null;
  }

  function createDioramaSettlementCamp() {
    return null;
  }

  function createRelayAntenna(x, z, angle = 0) {
    const group = createStaticSetDressing('relayAntenna', x, z, angle, 'relay-antenna');
    const signal = new THREE.PointLight(0x76e1ff, 0.7, 6, 2.2);
    signal.position.set(0.1, 2.9, 0);
    group.add(signal);
    return group;
  }


  function createWorldSetDressing() {
    const detail = graphicsDetailLevel();
    const allowRichProps = detail >= 0.38;
    const allowExtraProps = detail >= 0.66;
    const placeIfFree = (tx, tz, fn, angle = 0, requireRich = false) => {
      if (requireRich && !allowRichProps) return;
      if (!inBounds(tx, tz) || isMovementBlockingTile(tx, tz)) return;
      const p = tileToWorld(tx, tz);
      fn(p.x, p.z, angle);
    };
    const placeMany = (rows, fn, requireRich = false) => rows.forEach(([tx, tz, a]) => placeIfFree(tx, tz, fn, a, requireRich));
    const placeRoadsideAge = (rows, requireRich = false) => rows.forEach(([tx, tz, a, kind]) => {
      const maker = kind === 'sign' ? createHighwaySign
        : kind === 'billboard' ? createRuinedBillboard
          : kind === 'pole' ? createUtilityPole
            : kind === 'barricade' ? createRoadblockBarricade
              : kind === 'asphalt' ? createAsphaltSlab
                : createDryBush;
      placeIfFree(tx, tz, maker, a, requireRich);
    });

    if (currentLocation.id === 'scrapTown') {
      placeMany([[8, 11, 0.15], [30, 13, 0.7]], createScrapWreck);
      placeMany([[28, 20, 1.1]], createTireStack, true);
      placeMany([[15, 16, 0.2], [31, 18, 1.1]], createBarrelCluster);
      placeRoadsideAge([[7, 14, 0.2, 'billboard'], [26, 15, 0.8, 'barricade'], [31, 23, 0.1, 'sign']], true);
      if (allowExtraProps) placeMany([[11, 28, 0.5]], createScrapNest);
    } else if (currentLocation.id === 'relayStation') {
      placeMany([[18, 15, 0], [23, 17, 0.55]], createRelayAntenna);
      placeMany([[27, 25, 0.45]], createWastelandShack, true);
      placeMany([[12, 12, 0.3]], createBarrelCluster);
      placeMany([[31, 11, 0.25]], createDeadTree);
      placeRoadsideAge([[10, 14, 0.1, 'pole'], [25, 21, 0.25, 'pole'], [29, 14, -0.2, 'billboard']], true);
    } else if (currentLocation.id === 'randomEncounter') {
      placeMany([[28, 20, 0.55]], createScrapWreck);
      placeMany([[13, 14, 0.2]], createBarrelCluster);
      placeMany([[6, 8, -0.55]], createDeadTree);
      placeRoadsideAge([[12, 22, 0.4, 'barricade'], [29, 13, 0.25, 'bush']], true);
    } else if (currentLocation.id === 'randomAshGrove') {
      placeMany([[6, 8, -0.55], [13, 12, 0.25], [31, 29, 0.35]], createDeadTree);
      placeMany([[26, 20, -0.5]], createBarrelCluster);
      placeRoadsideAge([[10, 16, 0.4, 'bush'], [29, 18, 0.25, 'bush']], true);
      if (allowRichProps) placeMany([[24, 25, -0.65]], createTireStack, true);
    } else if (currentLocation.id === 'randomDryBasin') {
      placeMany([[5, 16, 0.1], [33, 27, 0.5]], createCactus, true);
      placeMany([[29, 23, 0.55]], createScrapWreck);
      placeMany([[24, 12, -0.45]], createBarrelCluster);
      placeRoadsideAge([[12, 16, 0.15, 'bush'], [27, 17, -0.2, 'sign']], true);
    } else if (currentLocation.id === 'randomRuinedRoad') {
      placeMany([[7, 20, -0.28], [28, 16, 1.85]], createScrapWreck);
      placeMany([[30, 22, 1.1]], createTireStack, true);
      placeMany([[13, 14, 0.2]], createBarrelCluster);
      placeRoadsideAge([[6, 17, 0.4, 'asphalt'], [10, 19, 0.2, 'barricade'], [21, 20, -0.2, 'sign'], [33, 22, -0.45, 'billboard']], true);
    } else if (currentLocation.id === 'wasteland') {
      [[28, 12, 0.55]].forEach(([tx, tz, a]) => {
        if (!inBounds(tx, tz) || isMovementBlockingTile(tx, tz)) return;
        const p = tileToWorld(tx, tz);
        createScrapWreck(p.x, p.z, a);
        createGroundDecal(tx, tz, p, mats.tireTrack, 1.7, a, 0.004);
      });
      [[10, 13, 0.2]].forEach(([tx, tz, a]) => placeIfFree(tx, tz, createBarrelCluster, a));

      // Силуэты из референса: сухие деревья, кактусы, груды шин и маленькая ржавая постройка.
      [[6, 8, -0.55], [33, 20, -0.15]].forEach(([tx, tz, a]) => placeIfFree(tx, tz, createDeadTree, a));
      [[31, 14, -0.2]].forEach(([tx, tz, a]) => placeIfFree(tx, tz, createCactus, a, true));
      [[29, 25, -0.8]].forEach(([tx, tz, a]) => placeIfFree(tx, tz, createTireStack, a, true));
      placeRoadsideAge([[5, 22, 0.35, 'sign'], [32, 11, -0.25, 'billboard']], true);
      if (allowExtraProps) {
        [[17, 11, -0.4]].forEach(([tx, tz, a]) => placeIfFree(tx, tz, createScrapNest, a));
      }
    } else {
      // v7.57: первая локация полностью собирается вручную в createSettlementProps().
      // Старый процедурный набор поселения отключён, чтобы не возвращались
      // случайные ящики, конические деревья и пустые одинаковые углы.
    }
  }

  function createSettlementProps() {
    return null;
    // Дополнительные случайные ящики больше не добавляем: каждый предмет первой
    // локации задан вручную в createHandbuiltTraderLocation().
  }

  function createLocationExit() {
    if (!currentLocation || !currentLocation.exit) return;
    createExitPortal(currentLocation.exit.tx, currentLocation.exit.tz, currentLocation.exit.label);
  }

  function clearWorld() {
    prepareWorldGroupForRebuild();
    clearWorldGroupWithDispose();
    floorMeshes.length = 0;
    obstacleMeshes.length = 0;
    staticCullObjects.length = 0;
    staticCollisionBoxes.length = 0;
    locationJobBoards.length = 0;
    locationCraftingStations.length = 0;
    locationTradeMachines.length = 0;
    clearAuthoredTileLayers();
    resourceNodes.length = 0;
    map.length = 0;
    traderNpc = null;
    storageBox = null;
    traderBuildingCutawayRoofs.length = 0;
    traderBuildingStaticRoofs.length = 0;
    traderBuildingCutawayRoofBatches.length = 0;
    traderBuildingInteriorObjects.length = 0;
    traderBuildingWallBlocks.length = 0;
    traderBuildingAuthoredRoofBlocks.length = 0;
    traderBuildingOcclusionVolumes.length = 0;
    traderInteriorLightObjects.length = 0;
    requestTraderRoofCutawayRefresh('world-clear');
    traderRoofCutawayRuntime.elapsed = 999;
    traderRoofCutawayRuntime.lastPlayerX = NaN;
    traderRoofCutawayRuntime.lastPlayerZ = NaN;
    traderRoofCutawayRuntime.lastTileX = NaN;
    traderRoofCutawayRuntime.lastTileZ = NaN;
    traderRoofCutawayRuntime.lastInside = false;
    traderRoofCutawayRuntime.lastAnyVisibleInteriorZone = false;
    traderRoofCutawayRuntime.lastRoofGateKey = '';
    traderRoofCutawayRuntime.lastRoofGateVisible = false;
    traderRoofCutawayRuntime.lastInteriorVisibilityKey = '';
    traderRoofCutawayRuntime.lastRoofVisibilityApplied = null;
    traderRoofCutawayRuntime.roofOpacityCutaway = false;
    traderRoofCutawayRuntime.lastRoofOpacityApplied = null;
    traderRoofCutawayRuntime.lastRoofCellGateKey = '';
    traderRoofCutawayRuntime.lastFogVisibilityVersion = -1;
    traderRoofCutawayRuntime.wallTransparencyElapsed = 999;
    traderRoofCutawayRuntime.lastWallTransparencyKey = '';
    traderRoofCutawayRuntime.fadedWallBlocks = new Set();
    traderRoofCutawayRuntime.fadedRoofBlocks = new Set();
    traderRoofCutawayRuntime.roofReleasePending = false;
    invalidateTraderWallCutawayCache();
    traderRoofCutawayRuntime.cutawayWarmupDone = false;
    traderRoofCutawayRuntime.cutawayWarmupScheduled = false;
    traderRoofCutawayRuntime.cutawayWarmupToken += 1;
    exitPortal = null;
    clearGroundItemsVisuals();
    clearWorldContainersVisuals();
    if (typeof resetRtsFogRuntimeCaches === 'function') resetRtsFogRuntimeCaches('clear-world');
  }

  function buildWorld() {
    const latestLocation = currentLocation?.id ? LOCATIONS[currentLocation.id] : null;
    if (latestLocation && latestLocation !== currentLocation) currentLocation = latestLocation;
    clearWorld();
    generateMap();
    if (typeof invalidateMinimapStaticCache === 'function') invalidateMinimapStaticCache('build-world');
    createWastelandBackplate();
    for (let z = 0; z < MAP_H; z++) {
      for (let x = 0; x < MAP_W; x++) {
        const type = map[z][x];
        const pos = tileToWorld(x, z);
        createTile(x, z, type);
        const settlementHandbuiltObstacle = currentLocation.id === 'settlement' &&
          (type === TILE_TYPES.TREE || type === TILE_TYPES.ROCK || type === TILE_TYPES.RUIN);
        if (settlementHandbuiltObstacle) {
          // v7.57: клетка блокирует движение, но не рисует стандартный куб/камень/дерево.
          // Уникальный визуал первой локации создаётся ниже в createSettlementProps().
        }
        else if (type === TILE_TYPES.TREE) createTree(pos.x, pos.z);
        else if (type === TILE_TYPES.ROCK) createRock(pos.x, pos.z, false);
        else if (type === TILE_TYPES.ORE) {
          const node = resourceNodes.find(r => r.tx === x && r.tz === z);
          node.mesh = createRock(pos.x, pos.z, true);
          node.mesh.userData.resource = node;
        }
        else if (type === TILE_TYPES.WOOD) {
          const node = resourceNodes.find(r => r.tx === x && r.tz === z);
          node.mesh = createWoodNode(pos.x, pos.z);
          node.mesh.userData.resource = node;
        }
        else if (type === TILE_TYPES.OIL) {
          const node = resourceNodes.find(r => r.tx === x && r.tz === z);
          node.mesh = createOilNode(pos.x, pos.z);
          node.mesh.userData.resource = node;
        }
        else if (type === TILE_TYPES.RUIN) createRuin(pos.x, pos.z);
      }
    }

    // The authored Old Klim yard already has a lightweight PBR ground pass:
    // coherent caravan lanes, gravel/service zones and baked contact AO. It was
    // previously never attached to the scene, leaving only the noisy base tile.
    // Keep it location-specific and build it before GLBs so all props sit on the
    // same readable ground composition.
    if (isTraderYardLocation()) createTraderYardTerrainLayers();

    const authoredLayout = locationUsesAuthoredLayout(currentLocation);
    if (authoredLayout) {
      createAuthoredLocationObjects();
      if (shouldCreateStaticLocationTrader()) createTraderNpc(currentLocation.trader.tx, currentLocation.trader.tz);
      if (currentLocation.storage) createStorageChest(currentLocation.storage.tx, currentLocation.storage.tz);
    } else if (currentLocation.id === 'settlement' && !clientLocationConfigLoaded) {
      createSettlementProps();
    } else {
      createCampfireRestArea(-2.6, 2.2, 0);
      if (shouldCreateStaticLocationTrader()) createTraderNpc(currentLocation.trader.tx, currentLocation.trader.tz);
      if (currentLocation.storage) createStorageChest(currentLocation.storage.tx, currentLocation.storage.tz);
    }
    if (!authoredLayout) createWorldSetDressing();
    createWorldMapExitZoneVisuals();
    createLocationExit();
    freezeStaticWorldTransforms();
    if (typeof applyDayNightLighting === 'function') applyDayNightLighting(true);
    if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
    scheduleTraderRoofCutawayWarmup('world-built-idle');
  }
