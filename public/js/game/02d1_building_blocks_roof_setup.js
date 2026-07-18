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

  function modelScaleForBuildingBlock(modelKey, sx, sy, sz) {
    const tile = Number(TILE || 2);
    if (isWallBuildingBlockKey(modelKey)) {
      return {
        x: Math.max(0.001, Number(sx || tile) / tile),
        y: Math.max(0.001, Number(sy || 1)),
        z: Math.max(0.001, Number(sz || tile) / tile)
      };
    }
    if (isFloorBuildingBlockKey(modelKey)) {
      return {
        x: Math.max(0.001, Number(sx || tile) / tile),
        y: Math.max(0.001, Number(sy || 0.12) / 0.12),
        z: Math.max(0.001, Number(sz || tile) / tile)
      };
    }
    if (isRoofBuildingBlockKey(modelKey)) {
      return {
        x: Math.max(0.001, Number(sx || tile) / tile),
        y: Math.max(0.001, Number(sy || 0.20) / 0.20),
        z: Math.max(0.001, Number(sz || tile) / tile)
      };
    }
    return {
      x: Math.max(0.001, Number(sx || 1)),
      y: Math.max(0.001, Number(sy || 1)),
      z: Math.max(0.001, Number(sz || 1))
    };
  }

  function modelHasGroundOrigin(modelKey) {
    return isWallBuildingBlockKey(modelKey)
      || isFloorBuildingBlockKey(modelKey)
      || isRoofBuildingBlockKey(modelKey);
  }

  function createBuildingModelBlock(group, modelKey, x, y, z, sx, sy, sz, opts = {}) {
    const scale = modelScaleForBuildingBlock(modelKey, sx, sy, sz);
    const placementY = modelHasGroundOrigin(modelKey)
      ? Number(y || 0) - Math.max(0.001, Number(sy || 1)) * 0.5
      : Number(y || 0);
    const block = makeStaticModelGroup(modelKey, x, z, opts.ry || 0, opts.kind || modelKey, {
      ...opts,
      y: placementY,
      scaleX: scale.x,
      scaleY: scale.y,
      scaleZ: scale.z,
      cloneMaterials: opts.cloneMaterials !== false
    });
    if (opts.rx) block.rotation.x = opts.rx;
    if (opts.rz) block.rotation.z = opts.rz;
    block.userData.kind = opts.kind || 'trader-building-model-part';
    if (opts.name) block.name = opts.name;
    group.add(block);
    return block;
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

  function cacheTraderInteriorWorldPositions(root = null) {
    if (root && typeof root.updateMatrixWorld === 'function') root.updateMatrixWorld(true);
    traderBuildingInteriorObjects.forEach(obj => {
      if (!obj) return;
      if (!obj.userData.traderCachedWorldPosition) obj.userData.traderCachedWorldPosition = new THREE.Vector3();
      if (typeof obj.getWorldPosition === 'function') obj.getWorldPosition(obj.userData.traderCachedWorldPosition);
    });
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

  function createTraderVisionRoofMaterial(baseMaterial, maskTexture = null, maskBounds = null, opts = {}) {
    // Single-pass roof material. The roof texture may use its own repeated UVs,
    // while the cutaway mask is sampled from local roof coordinates. This avoids
    // both shader compile errors and wrong mask sampling when the roof texture repeats.
    const sourceMap = baseMaterial && baseMaterial.map ? baseMaterial.map : null;
    const material = markDisposableMaterial(new THREE.MeshBasicMaterial({
      map: sourceMap,
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      depthTest: true,
      alphaTest: 0,
      side: THREE.DoubleSide
    }));
    material.userData = material.userData || {};
    material.userData.traderVisionRoof = true;
    material.userData.traderVisionRoofMode = 'single';
    material.userData.traderRoofOpacityDriven = true;
    material.userData.traderRoofVisionMaskTexture = maskTexture || null;
    material.userData.traderRoofVisionMaskBounds = maskBounds || { minX: -1, minZ: -1, width: 2, depth: 2 };
    material.userData.traderRoofOpenOpacity = Number(opts.openOpacity ?? 0.24);
    material.userData.traderRoofClosedOpacity = 1.0;
    material.onBeforeCompile = (shader) => {
      const bounds = material.userData.traderRoofVisionMaskBounds || { minX: -1, minZ: -1, width: 2, depth: 2 };
      shader.uniforms.traderRoofVisionMask = { value: material.userData.traderRoofVisionMaskTexture || null };
      shader.uniforms.traderRoofOpenOpacity = { value: material.userData.traderRoofOpenOpacity };
      shader.uniforms.traderRoofMaskMin = { value: new THREE.Vector2(Number(bounds.minX || 0), Number(bounds.minZ || 0)) };
      shader.uniforms.traderRoofMaskSize = { value: new THREE.Vector2(Math.max(0.001, Number(bounds.width || 1)), Math.max(0.001, Number(bounds.depth || 1))) };
      material.userData.traderRoofShader = shader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
uniform vec2 traderRoofMaskMin;
uniform vec2 traderRoofMaskSize;
varying vec2 vTraderRoofMaskUv;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vTraderRoofMaskUv = clamp((position.xz - traderRoofMaskMin) / traderRoofMaskSize, vec2(0.001), vec2(0.999));`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
uniform sampler2D traderRoofVisionMask;
uniform float traderRoofOpenOpacity;
varying vec2 vTraderRoofMaskUv;`
      );
      const beforeAlphaPatch = shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        /vec4\s+diffuseColor\s*=\s*vec4\(\s*diffuse\s*,\s*opacity\s*\)\s*;/,
        `vec4 diffuseColor = vec4( diffuse, opacity );
float traderRoofCutaway = texture2D(traderRoofVisionMask, vTraderRoofMaskUv).r;
float traderRoofCellOpen = step(0.5, traderRoofCutaway);
diffuseColor.a *= mix(1.0, traderRoofOpenOpacity, traderRoofCellOpen);`
      );
      if (shader.fragmentShader === beforeAlphaPatch) {
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor\s*=\s*vec4\(\s*outgoingLight\s*,\s*diffuseColor\.a\s*\)\s*;/,
          `float traderRoofCutaway = texture2D(traderRoofVisionMask, vTraderRoofMaskUv).r;
float traderRoofCellOpen = step(0.5, traderRoofCutaway);
gl_FragColor = vec4( outgoingLight, diffuseColor.a * mix(1.0, traderRoofOpenOpacity, traderRoofCellOpen) );`
        );
      }
    };
    material.customProgramCacheKey = () => 'trader-wood-roof-local-mask-v77535';
    material.needsUpdate = true;
    return material;
  }

  function createTraderRoofMaskTexture(width, height, data) {
    const safeW = Math.max(1, Math.floor(Number(width || 1)));
    const safeH = Math.max(1, Math.floor(Number(height || 1)));
    const safeData = data instanceof Uint8Array && data.length >= safeW * safeH ? data : new Uint8Array(safeW * safeH);
    const format = THREE.LuminanceFormat || THREE.RedFormat || THREE.AlphaFormat;
    const texture = markDisposableTexture(new THREE.DataTexture(safeData, safeW, safeH, format, THREE.UnsignedByteType));
    texture.needsUpdate = true;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.magFilter = THREE.NearestFilter || THREE.LinearFilter;
    texture.minFilter = THREE.NearestFilter || THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1;
    return texture;
  }

  function createTraderContinuousRoofPanelGeometry(cells, opts = {}) {
    const safeCells = (cells || []).filter(Boolean);
    const bounds = safeCells.reduce((acc, cell) => {
      const x0 = Number(cell.x || 0) - Number(cell.sx || 0) / 2;
      const x1 = Number(cell.x || 0) + Number(cell.sx || 0) / 2;
      const z0 = Number(cell.z || 0) - Number(cell.sz || 0) / 2;
      const z1 = Number(cell.z || 0) + Number(cell.sz || 0) / 2;
      acc.minX = Math.min(acc.minX, x0);
      acc.maxX = Math.max(acc.maxX, x1);
      acc.minZ = Math.min(acc.minZ, z0);
      acc.maxZ = Math.max(acc.maxZ, z1);
      return acc;
    }, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.minZ) || !Number.isFinite(bounds.maxZ)) {
      bounds.minX = -1; bounds.maxX = 1; bounds.minZ = -1; bounds.maxZ = 1;
    }
    const yBase = Number(opts.yBase ?? 5.32);
    const ySlope = Number(opts.ySlope ?? 0.045);
    const yMaxLift = Number(opts.yMaxLift ?? 0.38);
    const fixedY = opts.y !== undefined ? Number(opts.y) : null;
    const yAt = (z) => Number.isFinite(fixedY) ? fixedY : (yBase + Math.min(yMaxLift, Math.abs(Number(z || 0)) * ySlope));
    const x0 = bounds.minX;
    const x1 = bounds.maxX;
    const z0 = bounds.minZ;
    const z1 = bounds.maxZ;
    const repeatU = Math.max(1.6, (x1 - x0) / 3.0);
    const repeatV = Math.max(1.0, (z1 - z0) / 2.2);
    const positions = new Float32Array([
      x0, yAt(z0), z0,   x0, yAt(z1), z1,   x1, yAt(z0), z0,
      x0, yAt(z1), z1,   x1, yAt(z1), z1,   x1, yAt(z0), z0
    ]);
    const uvs = new Float32Array([
      0, 0,  0, 1,  1, 0,
      0, 1,  1, 1,  1, 0
    ]);
    const geometry = new THREE.BufferGeometry();
    setGeometryAttributeCompat(geometry, 'position', new THREE.BufferAttribute(positions, 3));
    setGeometryAttributeCompat(geometry, 'uv', new THREE.BufferAttribute(uvs, 2));
    if (typeof geometry.computeVertexNormals === 'function') geometry.computeVertexNormals();
    if (typeof geometry.computeBoundingSphere === 'function') geometry.computeBoundingSphere();
    geometry.userData = geometry.userData || {};
    geometry.userData.traderRoofBounds = {
      minX: x0,
      minZ: z0,
      width: Math.max(0.001, x1 - x0),
      depth: Math.max(0.001, z1 - z0)
    };
    geometry.userData.traderRoofMaskBounds = opts.maskBounds || geometry.userData.traderRoofBounds;
    return geometry;
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

  function createTraderRoofSquareCells(xMin, xMax, zMin, zMax, opts = {}) {
    // Roof transparency is aligned to the same world TILE grid as fog-of-war.
    // One gameplay-visible world tile must open the matching roof area as one
    // block; the roof must not use its own smaller local grid.
    const cells = [];
    const center = traderBuildingCenterWorld();
    const sy = Number(opts.sy || 0.20);
    const rx = Number(opts.rx || 0);
    const yBase = Number(opts.yBase || 5.32);
    const ySlope = Number(opts.ySlope || 0.045);
    const yMaxLift = Number(opts.yMaxLift || 0.38);
    const worldXMin = center.x + Number(xMin || 0);
    const worldXMax = center.x + Number(xMax || 0);
    const worldZMin = center.z + Number(zMin || 0);
    const worldZMax = center.z + Number(zMax || 0);
    const clampTileX = (tx) => Math.max(0, Math.min(MAP_W - 1, tx));
    const clampTileZ = (tz) => Math.max(0, Math.min(MAP_H - 1, tz));
    const txMin = clampTileX(Math.floor(worldXMin / TILE + MAP_W / 2));
    const txMax = clampTileX(Math.floor((worldXMax - 0.001) / TILE + MAP_W / 2));
    const tzMin = clampTileZ(Math.floor(worldZMin / TILE + MAP_H / 2));
    const tzMax = clampTileZ(Math.floor((worldZMax - 0.001) / TILE + MAP_H / 2));
    const maskMinWorld = tileToWorld(txMin, tzMin);
    const maskMaxWorld = tileToWorld(txMax, tzMax);
    const maskBounds = {
      minX: maskMinWorld.x - center.x - TILE / 2,
      minZ: maskMinWorld.z - center.z - TILE / 2,
      width: Math.max(TILE, (txMax - txMin + 1) * TILE),
      depth: Math.max(TILE, (tzMax - tzMin + 1) * TILE)
    };
    const grid = {
      txMin,
      tzMin,
      txMax,
      tzMax,
      width: Math.max(1, txMax - txMin + 1),
      height: Math.max(1, tzMax - tzMin + 1),
      maskBounds
    };
    for (let tz = tzMin; tz <= tzMax; tz++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const tileCenter = tileToWorld(tx, tz);
        const tileLocalX = tileCenter.x - center.x;
        const tileLocalZ = tileCenter.z - center.z;
        const tileX0 = tileLocalX - TILE / 2;
        const tileX1 = tileLocalX + TILE / 2;
        const tileZ0 = tileLocalZ - TILE / 2;
        const tileZ1 = tileLocalZ + TILE / 2;
        const x0 = Math.max(Number(xMin || 0), tileX0);
        const x1 = Math.min(Number(xMax || 0), tileX1);
        const z0 = Math.max(Number(zMin || 0), tileZ0);
        const z1 = Math.min(Number(zMax || 0), tileZ1);
        if (x1 <= x0 + 0.001 || z1 <= z0 + 0.001) continue;
        const x = (x0 + x1) / 2;
        const z = (z0 + z1) / 2;
        cells.push({
          x,
          z,
          sx: Math.max(0.12, x1 - x0),
          sy,
          sz: Math.max(0.12, z1 - z0),
          rx,
          tx,
          tz,
          maskCol: tx - txMin,
          maskRow: tz - tzMin,
          y: Number(opts.y !== undefined ? opts.y : (yBase + Math.min(yMaxLift, Math.abs(z) * ySlope))),
          hidden: false,
          // Use the actual clipped roof fragment size for visual occluder fading.
          // This lets wide roof cells fade whenever any part of the cell covers the player.
          samples: [{ x, z, sx: Math.max(0.12, x1 - x0), sz: Math.max(0.12, z1 - z0), y: Number(opts.y !== undefined ? opts.y : (yBase + Math.min(yMaxLift, Math.abs(z) * ySlope))) }]
        });
      }
    }
    cells.grid = grid;
    cells.maskBounds = maskBounds;
    return cells;
  }

  function createTraderVisionRoofGrid(group, w, d, h, roofMaterial, ridgeMaterial) {
    const halfW = w / 2;
    const halfD = d / 2;
    // v7.75.18: flat roof. One roof plane equals the building footprint and
    // maps directly to the fog-of-war tile grid. No slope, no ridge, no visual
    // overhang over neighbouring cells.
    const xMin = -halfW;
    const xMax = halfW;
    const zMin = -halfD;
    const zMax = halfD;
    const roofY = h + 0.10;
    const flatCells = createTraderRoofSquareCells(xMin, xMax, zMin, zMax, {
      sy: 0.20,
      rx: 0,
      y: roofY,
      yBase: roofY,
      ySlope: 0,
      yMaxLift: 0
    });
    createTraderRoofGridBatch(group, 'flat-vision-cutaway', flatCells, roofMaterial, {
      y: roofY,
      yBase: roofY,
      ySlope: 0,
      yMaxLift: 0,
      grid: flatCells.grid,
      maskBounds: flatCells.maskBounds
    });
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

