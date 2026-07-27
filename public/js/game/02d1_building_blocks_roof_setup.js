  function placeTraderTownObject(tx, tz, maker, dx = 0, dz = 0) {
    const p = tileToWorld(tx, tz);
    return maker(p.x + dx, p.z + dz, tx, tz);
  }

  function createBuildingBox(group, x, y, z, sx, sy, sz, material, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    if (opts.rx) mesh.rotation.x = opts.rx;
    if (opts.ry) mesh.rotation.y = opts.ry;
    if (opts.rz) mesh.rotation.z = opts.rz;
    mesh.castShadow = opts.castShadow !== false;
    mesh.receiveShadow = opts.receiveShadow !== false;
    mesh.userData.kind = opts.kind || 'trader-building-part';
    if (opts.name) mesh.name = opts.name;
    group.add(mesh);
    return mesh;
  }

  function isWallBuildingBlockKey(modelKey) {
    return modelKey === 'traderWallBlock'
      || modelKey === 'traderWindowBlock'
      || modelKey === 'wallWoodBlock'
      || modelKey === 'wallBrickBlock'
      || modelKey === 'wallMetalBlock';
  }

  function isFloorBuildingBlockKey(modelKey) {
    return modelKey === 'traderFloorSlab'
      || modelKey === 'floorWoodBlock'
      || modelKey === 'floorTileBlock';
  }

  function isRoofBuildingBlockKey(modelKey) {
    return modelKey === 'traderRoofBlock'
      || modelKey === 'roofWoodBlock'
      || modelKey === 'roofMetalBlock';
  }

  function registerTraderInteriorObject(object) {
    if (!object) return object;
    object.userData = object.userData || {};
    object.userData.traderInterior = true;
    object.userData.traderCachedWorldPosition = object.userData.traderCachedWorldPosition || new THREE.Vector3();
    object.userData.traderOccluderSkip = /floor|npc/i.test(String(object.userData.kind || '')) || !!object.userData.traderNpc;
    const cloneMeshMaterial = (mesh) => {
      if (!mesh || !mesh.material) return;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(mat => (mat && mat.clone ? markDisposableMaterial(mat.clone()) : mat));
      } else if (mesh.material && mesh.material.clone) {
        mesh.material = markDisposableMaterial(mesh.material.clone());
      }
    };
    if (object.isMesh) cloneMeshMaterial(object);
    else if (typeof object.traverse === 'function') object.traverse(child => { if (child && child.isMesh) cloneMeshMaterial(child); });
    traderBuildingInteriorObjects.push(object);
    invalidateTraderShellBoundsCache();
    return object;
  }

  function registerTraderStaticRoof(object) {
    if (!object) return object;
    object.userData = object.userData || {};
    object.userData.traderStaticRoof = true;
    object.userData.forceNoShadow = true;
    object.castShadow = false;
    object.receiveShadow = false;
    object.frustumCulled = false;
    traderBuildingStaticRoofs.push(object);
    return object;
  }

  function forceTraderRoofOpaqueMaterialState(material) {
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    list.forEach(mat => {
      if (!mat) return;
      const shaderDriven = !!mat.userData?.traderVisionRoof;
      const roofMode = mat.userData?.traderVisionRoofMode || 'single';
      mat.transparent = !!shaderDriven;
      mat.opacity = 1.0;
      mat.depthWrite = !shaderDriven;
      mat.depthTest = true;
      mat.alphaTest = 0;
      mat.side = THREE.DoubleSide;
      mat.userData = mat.userData || {};
      mat.userData.traderRoofOpacityDriven = shaderDriven;
    });
  }

  function applyTraderRoofMaterialOpacity(cutawayVisible, force = false) {
    // Compatibility hook for warmup/reset paths. Vision roof materials keep
    // shader-driven per-cell alpha; old static roof meshes remain fully opaque.
    traderRoofCutawayRuntime.roofOpacityCutaway = false;
    traderRoofCutawayRuntime.lastRoofOpacityApplied = 1.0;
    traderBuildingStaticRoofs.forEach(roof => {
      if (!roof) return;
      roof.visible = true;
      roof.castShadow = false;
      roof.receiveShadow = false;
      roof.userData.forceNoShadow = true;
      forceTraderRoofOpaqueMaterialState(roof.material);
    });
    traderBuildingCutawayRoofBatches.forEach(batch => {
      if (!batch || !batch.mesh) return;
      [batch.mesh, batch.ghostMesh].forEach(roofMesh => {
        if (!roofMesh) return;
        roofMesh.visible = true;
        roofMesh.castShadow = false;
        roofMesh.receiveShadow = false;
        roofMesh.frustumCulled = false;
        roofMesh.userData.forceNoShadow = true;
        forceTraderRoofOpaqueMaterialState(roofMesh.material);
      });
    });
    traderBuildingCutawayRoofs.forEach(roof => {
      if (!roof) return;
      roof.visible = true;
      roof.castShadow = false;
      roof.receiveShadow = false;
      roof.userData.forceNoShadow = true;
      forceTraderRoofOpaqueMaterialState(roof.material);
    });
    return !!force;
  }

  function createTraderInteriorLampFixture(group, x, z, opts = {}) {
    const y = Number(opts.y ?? 3.10);
    const lampGroup = new THREE.Group();
    lampGroup.position.set(x, 0, z);
    lampGroup.userData.kind = opts.kind || 'trader-interior-lamp-fixture';

    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.56, 6), mats.darkMetal);
    cord.position.set(0, y + 0.28, 0);
    cord.castShadow = false;
    cord.receiveShadow = false;
    cord.userData.kind = 'trader-interior-lamp-cord';
    lampGroup.add(cord);

    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.22, 14, 1, true), mats.rust);
    shade.position.set(0, y, 0);
    shade.rotation.x = Math.PI;
    shade.castShadow = true;
    shade.receiveShadow = true;
    shade.userData.kind = 'trader-interior-lamp-shade';
    lampGroup.add(shade);

    const bulbMaterial = mats.ember && mats.ember.clone ? markDisposableMaterial(mats.ember.clone()) : mats.ember;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), bulbMaterial);
    bulb.position.set(0, y - 0.14, 0);
    bulb.castShadow = false;
    bulb.receiveShadow = false;
    bulb.userData.kind = 'trader-interior-lamp-bulb';
    lampGroup.add(bulb);

    const glowMaterial = mats.traderWarmGlow && mats.traderWarmGlow.clone ? markDisposableMaterial(mats.traderWarmGlow.clone()) : mats.traderWarmGlow;
    const glow = new THREE.Mesh(detailPlaneGeom, glowMaterial);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.155, 0);
    glow.scale.set(Number(opts.glowScaleX || 2.6), Number(opts.glowScaleZ || 2.0), 1);
    glow.castShadow = false;
    glow.receiveShadow = false;
    glow.renderOrder = 2;
    glow.userData.kind = 'trader-interior-light-floor-glow';
    lampGroup.add(glow);

    const light = new THREE.PointLight(opts.color || 0xffb26a, 0, Number(opts.range || 6.0), Number(opts.decay || 1.85));
    light.position.set(0, y - 0.18, 0);
    light.castShadow = false;
    light.userData.kind = 'trader-interior-point-light';
    lampGroup.add(light);

    group.add(lampGroup);
    registerTraderInteriorObject(lampGroup);
    traderInteriorLightObjects.push({
      group: lampGroup,
      light,
      glowMaterial,
      bulbMaterial,
      minRank: Number(opts.minRank || 0),
      dayIntensity: Number(opts.dayIntensity ?? 0.16),
      nightIntensity: Number(opts.nightIntensity ?? 0.82),
      dayGlow: Number(opts.dayGlow ?? 0.08),
      nightGlow: Number(opts.nightGlow ?? 0.36),
      bulbNight: Number(opts.bulbNight ?? 1.75)
    });
    return lampGroup;
  }

