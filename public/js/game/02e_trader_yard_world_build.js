  function createTraderBuilding(x, z, angle = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = angle;
    group.userData.kind = 'trader-building-block-shell-v77498';

    // v7.74.97: trader building rebuilt as a strict 10 x 8 TILE grid.
    // No half cells, no missing corner cells: walls, roof mask, collision and LOS
    // share the same world tile footprint.
    addEllipseShadow(group, 10.2, 8.1, 0.34);

    const tile = Number(TILE || 2.0);
    const blockSize = tile;  // Rule: one visible building block = 2 x 2 x 1 meters.
    const w = tile * 10;     // 20.0 m footprint, built from 10 two-meter blocks.
    const d = tile * 8;      // 16.0 m footprint, built from 8 two-meter blocks.
    const h = 3.0;           // Building height: 3 meters = 3 vertical one-meter rows.
    const wallT = blockSize; // Wall footprint depth/width stays 2 meters.
    const rowCount = 3;
    const rowH = 1.0;
    const halfW = w / 2;
    const halfD = d / 2;
    const blockGap = 0.018;
    const wallMat = mats.realScaleOldBrickWall;
    const concreteMat = mats.realScaleBrokenConcrete;
    const floorMat = mats.realScaleWoodFloor && mats.realScaleWoodFloor.clone
      ? markDisposableMaterial(mats.realScaleWoodFloor.clone())
      : mats.realScaleWoodFloor;
    if (floorMat) {
      if (floorMat.color && typeof floorMat.color.setHex === 'function') floorMat.color.setHex(0xc9aa78);
      if ('roughness' in floorMat) floorMat.roughness = 0.90;
      if ('metalness' in floorMat) floorMat.metalness = 0.0;
      if ('transparent' in floorMat) floorMat.transparent = false;
      if ('opacity' in floorMat) floorMat.opacity = 1.0;
      if ('depthWrite' in floorMat) floorMat.depthWrite = true;
      if ('depthTest' in floorMat) floorMat.depthTest = true;
      if ('needsUpdate' in floorMat) floorMat.needsUpdate = true;
    }
    const trimMat = mats.realScaleRoofWood;
    const roofMat = mats.traderRoofRenderFast || mats.realScaleRoofWood || mats.traderBuildingRoofRedWhite || mats.traderRoofCleanCorrugated;

    const frontBackCenters = [];
    for (let i = 0; i < Math.round(w / blockSize); i++) frontBackCenters.push(-halfW + blockSize / 2 + i * blockSize);
    const sideCenters = [];
    for (let i = 1; i < Math.round(d / blockSize) - 1; i++) sideCenters.push(-halfD + blockSize / 2 + i * blockSize);
    const frontWallZ = halfD - blockSize / 2;
    const sideWallX = halfW - blockSize / 2;

    const rowY = (row) => rowH * row + rowH / 2;
    const brickLengthM = 0.60;
    const brickHeightM = 0.20;
    const createTraderBrickFaceTexture = (faceW, faceH) => {
      const safeW = Math.max(0.1, Number(faceW || blockSize));
      const safeH = Math.max(0.1, Number(faceH || rowH));
      const key = `trader-brick-face-v77535-${safeW.toFixed(2)}x${safeH.toFixed(2)}`;
      const cols = Math.max(2, Math.round(safeW / brickLengthM));
      const rows = Math.max(2, Math.round(safeH / brickHeightM));
      return canvasTextureFrom(key, (ctx, s) => {
        ctx.fillStyle = '#6f6251';
        ctx.fillRect(0, 0, s, s);
        const rowHpx = s / rows;
        for (let r = 0; r < rows; r++) {
          const offset = (r % 2) * 0.5;
          const brickWpx = s / Math.max(1, safeW / brickLengthM);
          for (let c = -1; c <= cols + 1; c++) {
            const x0 = (c + offset) * brickWpx;
            const y0 = r * rowHpx;
            const n = hash01(c * 19 + r * 7, r * 31 + c * 3, 77535);
            const shade = 0.86 + n * 0.24;
            const rr = Math.max(48, Math.min(155, Math.round(112 * shade)));
            const gg = Math.max(44, Math.min(140, Math.round(94 * shade)));
            const bb = Math.max(38, Math.min(126, Math.round(76 * shade)));
            ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
            ctx.fillRect(x0 + 1, y0 + 1, brickWpx - 2, rowHpx - 2);
            ctx.globalAlpha = 0.14;
            ctx.fillStyle = '#1b1712';
            ctx.fillRect(x0 + 1, y0 + rowHpx - 3, brickWpx - 2, 2);
            ctx.fillRect(x0 + brickWpx - 3, y0 + 1, 2, rowHpx - 2);
            ctx.globalAlpha = 1.0;
          }
        }
        ctx.globalAlpha = 0.10;
        ctx.fillStyle = '#d4c0a2';
        for (let i = 0; i < 90; i++) {
          const px = Math.floor(hash01(i, 77535, 1) * s);
          const py = Math.floor(hash01(i, 77535, 2) * s);
          ctx.fillRect(px, py, 1, 1);
        }
        ctx.globalAlpha = 1.0;
      }, 256, 1);
    };
    const wallBlockMaterial = (sx, sy, sz) => markDisposableMaterial(new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createTraderBrickFaceTexture(Math.max(Number(sx || blockSize), Number(sz || wallT)), Number(sy || rowH)),
      roughness: 0.97,
      metalness: 0.0,
      side: THREE.DoubleSide
    }));
    const glassWallBlockMaterial = () => {
      const base = mats.traderBuildingWindowDark && mats.traderBuildingWindowDark.clone
        ? mats.traderBuildingWindowDark.clone()
        : new THREE.MeshStandardMaterial({ color: 0x9fb2c2, roughness: 0.18, metalness: 0.0, side: THREE.DoubleSide });
      const mat = markDisposableMaterial(base);
      mat.transparent = true;
      mat.opacity = 0.42;
      if ('depthWrite' in mat) mat.depthWrite = false;
      if ('side' in mat) mat.side = THREE.DoubleSide;
      if ('roughness' in mat) mat.roughness = Math.min(0.25, Number(mat.roughness || 0.18));
      if ('metalness' in mat) mat.metalness = 0.0;
      if ('needsUpdate' in mat) mat.needsUpdate = true;
      return mat;
    };
    const addWallBlock = (cx, cz, sx, sz, row, mat, kind) => {
      const block = createBuildingModelBlock(group, 'traderWallBlock', cx, rowY(row), cz, Math.max(0.05, sx - blockGap), Math.max(0.05, rowH - blockGap), Math.max(0.05, sz - blockGap), {
        kind,
        castShadow: true,
        receiveShadow: true,
        cloneMaterials: true
      });
      block.userData.traderWallBlock = true;
      block.userData.traderWorldTileSized = true;
      block.userData.traderWallLocalX = Number(cx || 0);
      block.userData.traderWallLocalZ = Number(cz || 0);
      block.userData.traderWallWorldX = Number(x || 0) + Number(cx || 0);
      block.userData.traderWallWorldZ = Number(z || 0) + Number(cz || 0);
      block.userData.traderWallSizeX = Math.max(0.05, sx - blockGap);
      block.userData.traderWallSizeZ = Math.max(0.05, sz - blockGap);
      block.userData.traderWallSizeY = Math.max(0.05, rowH - blockGap);
      block.userData.traderWallBlockSize = blockSize;
      block.userData.traderWallRow = Number(row || 0);
      block.userData.traderWallBottomY = Math.max(0, rowY(row) - Math.max(0.05, rowH - blockGap) * 0.5);
      block.userData.traderWallTopY = rowY(row) + Math.max(0.05, rowH - blockGap) * 0.5;
      block.userData.traderWallOpacity = 1.0;
      traderBuildingWallBlocks.push(block);
      invalidateTraderWallCutawayCache();
      return block;
    };
    const addGlassWallBlock = (cx, cz, sx, sz, row, kind) => {
      const block = createBuildingModelBlock(group, 'traderWindowBlock', cx, rowY(row), cz, Math.max(0.05, sx - blockGap), Math.max(0.05, rowH - blockGap), Math.max(0.05, sz - blockGap), {
        kind,
        castShadow: false,
        receiveShadow: true,
        cloneMaterials: true
      });
      block.userData.traderWallBlock = true;
      block.userData.traderWindowWallBlock = true;
      block.userData.traderAlwaysTranslucent = true;
      block.userData.traderBaseOpacity = 0.42;
      block.userData.traderWorldTileSized = true;
      block.userData.traderWallLocalX = Number(cx || 0);
      block.userData.traderWallLocalZ = Number(cz || 0);
      block.userData.traderWallWorldX = Number(x || 0) + Number(cx || 0);
      block.userData.traderWallWorldZ = Number(z || 0) + Number(cz || 0);
      block.userData.traderWallSizeX = Math.max(0.05, sx - blockGap);
      block.userData.traderWallSizeZ = Math.max(0.05, sz - blockGap);
      block.userData.traderWallSizeY = Math.max(0.05, rowH - blockGap);
      block.userData.traderWallBlockSize = blockSize;
      block.userData.traderWallRow = Number(row || 0);
      block.userData.traderWallBottomY = Math.max(0, rowY(row) - Math.max(0.05, rowH - blockGap) * 0.5);
      block.userData.traderWallTopY = rowY(row) + Math.max(0.05, rowH - blockGap) * 0.5;
      block.userData.traderWallOpacity = 1.0;
      traderBuildingWallBlocks.push(block);
      invalidateTraderWallCutawayCache();
      return block;
    };
    const addTileWindow = (cx, cy, cz, sx, sy, sz, opts = {}) => {
      const startRow = Math.max(0, Math.floor((Number(cy || 0) - Number(sy || 0) * 0.5) / Math.max(0.1, rowH)));
      const rows = Math.max(1, Math.round(Number(sy || rowH) / Math.max(0.1, rowH)));
      let last = null;
      for (let i = 0; i < rows; i++) {
        const row = startRow + i;
        last = addGlassWallBlock(cx, cz, sx, wallT, row, `${opts.kind || 'trader-block-window'}-glass-row-${row}`);
      }
      return last;
    };

    // Floor, porch and step are also snapped to full tile widths.
    const traderBlockFloor = registerTraderInteriorObject(createBuildingModelBlock(group, 'traderFloorSlab', 0, 0.06, 0, w, 0.12, d, {
      castShadow: false,
      receiveShadow: false,
      kind: 'trader-block-floor-10x8',
      cloneMaterials: true
    }));
    if (traderBlockFloor) {
      traderBlockFloor.frustumCulled = false;
      traderBlockFloor.renderOrder = 0;
      traderBlockFloor.userData.traderOccluderSkip = true;
      traderBlockFloor.userData.noRuntimeCull = true;
      const floorMaterials = Array.isArray(traderBlockFloor.material) ? traderBlockFloor.material : [traderBlockFloor.material];
      floorMaterials.forEach(mat => {
        if (!mat) return;
        mat.transparent = false;
        if (typeof mat.opacity === 'number') mat.opacity = 1.0;
        if ('depthWrite' in mat) mat.depthWrite = true;
        if ('depthTest' in mat) mat.depthTest = true;
        if ('needsUpdate' in mat) mat.needsUpdate = true;
      });
    }

    // Front/back walls are voxelized into 2 x 2 x 1 m brick blocks.
    // Door is 4 m wide x 3 m high; windows are 2 m wide x 2 m high and sit inside the opening.
    frontBackCenters.forEach((cx) => {
      const isDoorCell = Math.abs(cx) < blockSize;
      const isFrontWindowCell = Math.abs(cx + 7.0) <= blockSize * 0.55 || Math.abs(cx - 7.0) <= blockSize * 0.55;
      const isBackWindowCell = Math.abs(cx + 5.0) <= blockSize * 0.55 || Math.abs(cx - 5.0) <= blockSize * 0.55;
      for (let row = 0; row < rowCount; row++) {
        if (isDoorCell && row <= 2) continue;
        if (isFrontWindowCell && (row === 1 || row === 2)) continue;
        addWallBlock(cx, -frontWallZ, blockSize, blockSize, row, wallMat, `trader-block-front-wall-${cx}-${row}`);
      }

      for (let row = 0; row < rowCount; row++) {
        if (isBackWindowCell && (row === 1 || row === 2)) continue;
        addWallBlock(cx, frontWallZ, blockSize, blockSize, row, wallMat, `trader-block-back-wall-${cx}-${row}`);
      }
    });
    addTileWindow(-7.0, 2.0, -frontWallZ, 2.0, 2.0, 0.10, { kind: 'trader-block-front-window', frameMat: trimMat, frameDepth: wallT * 0.82 });
    addTileWindow(7.0, 2.0, -frontWallZ, 2.0, 2.0, 0.10, { kind: 'trader-block-front-window', frameMat: trimMat, frameDepth: wallT * 0.82 });
    addTileWindow(-5.0, 2.0, frontWallZ, 2.0, 2.0, 0.10, { kind: 'trader-block-back-window', frameMat: trimMat, frameDepth: wallT * 0.82 });
    addTileWindow(5.0, 2.0, frontWallZ, 2.0, 2.0, 0.10, { kind: 'trader-block-back-window', frameMat: trimMat, frameDepth: wallT * 0.82 });

    // Side walls: 2 x 2 x 1 m blocks. Corners are already occupied by front/back rows.
    sideCenters.forEach((cz) => {
      const isLeftWindowCell = Math.abs(cz + 3.0) <= blockSize * 0.55 || Math.abs(cz - 3.0) <= blockSize * 0.55;
      const isRightWindowCell = Math.abs(cz + 3.0) <= blockSize * 0.55 || Math.abs(cz - 3.0) <= blockSize * 0.55;
      for (let row = 0; row < rowCount; row++) {
        if (isLeftWindowCell && (row === 1 || row === 2)) continue;
        addWallBlock(-sideWallX, cz, blockSize, blockSize, row, wallMat, `trader-block-left-wall-${cz}-${row}`);
      }

      for (let row = 0; row < rowCount; row++) {
        if (isRightWindowCell && (row === 1 || row === 2)) continue;
        addWallBlock(sideWallX, cz, blockSize, blockSize, row, wallMat, `trader-block-right-wall-${cz}-${row}`);
      }
    });
    addTileWindow(-sideWallX, 2.0, -3.0, 2.0, 2.0, 0.10, { kind: 'trader-block-left-window', ry: Math.PI / 2, frameMat: trimMat, frameDepth: wallT * 0.82 });
    addTileWindow(-sideWallX, 2.0, 3.0, 2.0, 2.0, 0.10, { kind: 'trader-block-left-window', ry: Math.PI / 2, frameMat: trimMat, frameDepth: wallT * 0.82 });
    addTileWindow(sideWallX, 2.0, -3.0, 2.0, 2.0, 0.10, { kind: 'trader-block-right-window', ry: Math.PI / 2, frameMat: trimMat, frameDepth: wallT * 0.82 });
    addTileWindow(sideWallX, 2.0, 3.0, 2.0, 2.0, 0.10, { kind: 'trader-block-right-window', ry: Math.PI / 2, frameMat: trimMat, frameDepth: wallT * 0.82 });

    // Front entrance stays as a simple open doorway: no door leaves or jamb meshes.

    // No interior props or light fixtures in this version.
    updateTraderInteriorLightLevels(true);

    createTraderVisionRoofGrid(group, w, d, h, roofMat, roofMat);
    cacheTraderInteriorWorldPositions(group);
    requestTraderRoofCutawayRefresh('trader-block-building-built');


    markNoRuntimeCull(group, 'trader-building-block-shell-v77498');
    return registerSetDressingGroup(group, x, z, 'trader-building-block-shell');
  }

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
    if (isTraderYardLocation()) markNoRuntimeCull(mesh, 'trader-yard-layer');
    worldGroup.add(mesh);
    const tt = worldToTile(x, z);
    staticCullObjects.push({ object: mesh, tx: tt.tx, tz: tt.tz, kind: 'floor-detail' });
    return mesh;
  }

  function createGroundLayerTile(tx, tz, material, sx = 4, sz = 4, rot = 0, opacity = null, y = 0.010) {
    const p = tileToWorld(tx, tz);
    return createGroundLayerWorld(p.x, p.z, material, sx, sz, rot, opacity, y);
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
      [15.0, 20.0, 5.0, 2.9, -0.08, 0.72], // trader_shop / лавка Старого Клима
      [24.0, 20.0, 5.2, 3.0, 0.10, 0.68], // player_storage + storage lean-to
      [24.0, 16.5, 6.2, 3.4, 0.18, 0.70], // main_storage / склад
      [19.0, 8.2, 10.4, 2.3, 0.02, 0.58], // main_gate
      [16.0, 10.2, 3.2, 2.4, 0.20, 0.56], // gate_tower_left
      [22.0, 10.2, 3.2, 2.4, -0.20, 0.56], // gate_tower_right
      [28.0, 13.4, 6.4, 3.8, 0.02, 0.48], // brahmin_pen
      [10.0, 28.0, 6.6, 3.7, -0.10, 0.38], // armory + gardens
      [24.0, 26.0, 5.4, 2.8, 0.25, 0.42], // workshop
      [17.0, 19.0, 3.2, 2.0, 0.0, 0.46], // well/water tank
      [7.0, 12.0, 2.6, 2.0, -0.08, 0.42]  // latrine
    ];
    spots.forEach(([tx, tz, sx, sz, rot, op]) => createGroundLayerTile(tx, tz, ao, sx, sz, rot, op, 0.026));
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

    // Чистая база двора без хаотичного мусора.
    createGroundLayerTile(19, 20, mats.traderLayerSand, 28, 21.0, 0.01, 0.76, 0.011);
    createGroundLayerTile(19, 20, mats.traderLayerCracks, 24, 16.8, -0.04, 0.28, 0.014);

    // Главный караванный путь: северные ворота -> двор -> торговец/склад.
    createGroundLayerTile(19, 18, mats.traderLayerRoad, 8.8, 24.5, 0.015, 0.80, 0.012);
    createGroundLayerTile(19, 13, mats.traderLayerTire, 7.4, 10.2, 0.02, 0.52, 0.016);
    createGroundLayerTile(17, 15, mats.traderLayerTire, 5.6, 5.4, -0.18, 0.30, 0.016);

    // Функциональные зоны: лавка, склад, брамины, жильё, мастерская, огород.
    createGroundLayerTile(15, 20, mats.traderLayerRoad, 5.8, 3.8, -0.12, 0.58, 0.014); // trader_shop
    createGroundLayerTile(24, 19, mats.traderLayerGravel, 6.6, 5.2, 0.10, 0.50, 0.018); // storage
    createGroundLayerTile(28, 13, mats.traderLayerRoad, 6.0, 3.8, 0.04, 0.46, 0.014); // brahmin_pen
    createGroundLayerTile(10, 28, mats.traderLayerSand, 6.8, 4.0, 0.02, 0.40, 0.012); // gardens/armory
    createGroundLayerTile(24, 26, mats.traderLayerOil, 5.4, 2.6, -0.02, 0.34, 0.018); // workshop
    createGroundLayerTile(12, 16, mats.traderLayerOil, 3.6, 2.5, 0.18, 0.28, 0.018); // campfire
    createGroundLayerTile(7, 12, mats.traderLayerShadow, 2.8, 2.2, -0.12, 0.26, 0.016); // latrine

    // Края двора и фоновая пустошь за стенами.
    createGroundLayerTile(19, 31, mats.traderLayerSand, 28, 7.4, 0.02, 0.42, 0.012);
    createGroundLayerTile(9, 20, mats.traderLayerSand, 8.2, 22.0, Math.PI / 2, 0.18, 0.010);
    createGroundLayerTile(30, 20, mats.traderLayerSand, 8.2, 22.0, Math.PI / 2, 0.18, 0.010);

    if (extra) createGroundLayerTile(19, 20, mats.traderLayerShadow, 18, 10.6, 0.00, 0.13, 0.017);

    createTraderReliefCrackRidges();
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
    if (typeof requestDynamicShadowRefresh === 'function') requestDynamicShadowRefresh();
    scheduleTraderRoofCutawayWarmup('world-built-idle');
  }
