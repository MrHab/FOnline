  // ===== MATERIALS =====
  // v7.51: процедурные текстуры вместо плоских цветов. Все создаётся в браузере,
  // поэтому патч не добавляет тяжёлые картинки и остаётся быстрым на мобильных.
  const worldTextureCache = {};

  function splitHexColor(hex) {
    const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function mixRgb(a, b, t) {
    return {
      r: Math.round(a.r + (b.r - a.r) * t),
      g: Math.round(a.g + (b.g - a.g) * t),
      b: Math.round(a.b + (b.b - a.b) * t)
    };
  }

  function hash01(a, b = 0, c = 0) {
    let x = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
    x ^= Math.imul((b | 0) + 0xc2b2ae35, 0x27d4eb2d);
    x ^= Math.imul((c | 0) + 0x165667b1, 0x9e3779b1);
    x ^= x >>> 15;
    return ((x >>> 0) % 100000) / 100000;
  }

  function canvasTextureFrom(name, drawFn, size = 192, repeat = 1) {
    const cacheKey = `${name}:${size}:${repeat}`;
    if (worldTextureCache[cacheKey]) return worldTextureCache[cacheKey];
    const canvasTex = document.createElement('canvas');
    canvasTex.width = size;
    canvasTex.height = size;
    const ctx = canvasTex.getContext('2d');
    drawFn(ctx, size);
    const texture = new THREE.CanvasTexture(canvasTex);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else if ('encoding' in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    worldTextureCache[cacheKey] = texture;
    return texture;
  }

  function nearestPowerOfTwoAtMost(value) {
    const n = Math.max(1, Math.floor(Number(value || 1)));
    return Math.pow(2, Math.floor(Math.log2(n)));
  }

  function optimizeLoadedTextureImage(texture, isDataTexture) {
    if (!texture || !texture.image) return;
    const img = texture.image;
    const width = img.naturalWidth || img.videoWidth || img.width || 0;
    const height = img.naturalHeight || img.videoHeight || img.height || 0;
    if (!width || !height) return;
    const budget = graphicsTextureBudget();
    const maxSide = isDataTexture ? budget.maxData : budget.maxColor;
    const longest = Math.max(width, height);
    // Three/WebGL stores decoded textures as RGBA. Downsampling before upload is
    // much cheaper for RAM than decoding 4K maps and keeping them alive.
    if (longest <= maxSide) return;
    const scale = maxSide / longest;
    const targetW = nearestPowerOfTwoAtMost(width * scale);
    const targetH = nearestPowerOfTwoAtMost(height * scale);
    const canvasTex = document.createElement('canvas');
    canvasTex.width = Math.max(64, targetW);
    canvasTex.height = Math.max(64, targetH);
    const ctx = canvasTex.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    try {
      ctx.drawImage(img, 0, 0, canvasTex.width, canvasTex.height);
      texture.image = canvasTex;
      texture.needsUpdate = true;
      texture.userData.ramBudgetDownsampled = `${width}x${height}->${canvasTex.width}x${canvasTex.height}`;
    } catch (_) {}
  }

  function configureWorldTexture(texture, repeat = 1, isDataTexture = false) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(isDataTexture ? 8 : 16, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    if (!isDataTexture) {
      if ('colorSpace' in texture && THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
      else if ('encoding' in texture && THREE.sRGBEncoding) texture.encoding = THREE.sRGBEncoding;
    }
    return texture;
  }

  function loadWorldImageTexture(name, url, repeat = 1) {
    const budget = graphicsTextureBudget();
    const cacheKey = `image:${budget.tier}:${name}:${url}:${repeat}`;
    if (worldTextureCache[cacheKey]) return worldTextureCache[cacheKey];
    const texture = new THREE.TextureLoader().load(url, tex => {
      optimizeLoadedTextureImage(tex, false);
      configureWorldTexture(tex, repeat, false);
    });
    configureWorldTexture(texture, repeat, false);
    worldTextureCache[cacheKey] = texture;
    return texture;
  }

  function loadWorldDataTexture(name, url, repeat = 1) {
    const budget = graphicsTextureBudget();
    const cacheKey = `data-image:${budget.tier}:${name}:${url}:${repeat}`;
    if (worldTextureCache[cacheKey]) return worldTextureCache[cacheKey];
    const texture = new THREE.TextureLoader().load(url, tex => {
      optimizeLoadedTextureImage(tex, true);
      configureWorldTexture(tex, repeat, true);
    });
    configureWorldTexture(texture, repeat, true);
    worldTextureCache[cacheKey] = texture;
    return texture;
  }
  function setMaxTextureAnisotropy(texture, preferred = 16) {
    if (!texture) return texture;
    texture.anisotropy = Math.min(preferred, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
    return texture;
  }

  function setGeometryAttributeCompat(geometry, name, attribute) {
    if (!geometry || !name || !attribute) return false;
    if (typeof geometry.setAttribute === 'function') {
      geometry.setAttribute(name, attribute);
      return true;
    }
    if (typeof geometry.addAttribute === 'function') {
      geometry.addAttribute(name, attribute);
      return true;
    }
    return false;
  }

  function getGeometryAttributeCompat(geometry, name) {
    if (!geometry || !name) return null;
    if (typeof geometry.getAttribute === 'function') return geometry.getAttribute(name);
    return geometry.attributes ? geometry.attributes[name] : null;
  }

  function ensureBufferGeometryCompat(geometry) {
    if (!geometry) return geometry;
    if (geometry.isBufferGeometry) return geometry;
    if (THREE.BufferGeometry && typeof THREE.BufferGeometry.prototype.fromGeometry === 'function') {
      const converted = new THREE.BufferGeometry().fromGeometry(geometry);
      converted.userData = Object.assign({}, geometry.userData || {}, converted.userData || {});
      return converted;
    }
    return geometry;
  }

  function cloneBufferGeometryCompat(geometry) {
    const clone = geometry && typeof geometry.clone === 'function' ? geometry.clone() : geometry;
    return ensureBufferGeometryCompat(clone);
  }

  function createTraderRoofBatchUnitGeometry() {
    // A single roof cell is a very cheap XZ plane, not a box. It removes the dark
    // vertical seams between cells and keeps the roof visually continuous while
    // still allowing per-cell alpha from the fog-of-war shader.
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array([
      -0.5, 0, -0.5,  -0.5, 0,  0.5,   0.5, 0, -0.5,
      -0.5, 0,  0.5,   0.5, 0,  0.5,   0.5, 0, -0.5
    ]);
    const normals = new Float32Array([
      0, 1, 0,  0, 1, 0,  0, 1, 0,
      0, 1, 0,  0, 1, 0,  0, 1, 0
    ]);
    const uvs = new Float32Array([
      0, 0,  0, 1,  1, 0,
      0, 1,  1, 1,  1, 0
    ]);
    setGeometryAttributeCompat(geometry, 'position', new THREE.BufferAttribute(positions, 3));
    setGeometryAttributeCompat(geometry, 'normal', new THREE.BufferAttribute(normals, 3));
    setGeometryAttributeCompat(geometry, 'uv', new THREE.BufferAttribute(uvs, 2));
    if (typeof geometry.computeBoundingSphere === 'function') geometry.computeBoundingSphere();
    return ensureBufferGeometryCompat(geometry);
  }

  function prepareGroundUv2(mesh) {
    if (!mesh || !mesh.geometry || !mesh.geometry.attributes || !mesh.geometry.attributes.uv) return mesh;
    if (!mesh.geometry.attributes.uv2) {
      setGeometryAttributeCompat(mesh.geometry, 'uv2', new THREE.BufferAttribute(mesh.geometry.attributes.uv.array, 2));
    }
    return mesh;
  }

  const sharedWorldGeometries = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  const sharedWorldMaterials = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

  // v7.67: some trader-yard terrain/decal materials are intentionally cheap
  // MeshBasic/transparent overlays or very bright PBR layers. They do not always
  // read the day-night cycle strongly enough through lights alone, so the time
  // system applies a soft material tint to terrain-only materials. This keeps
  // the night readable, but the ground no longer looks like daytime at 02:00.
  const dayNightTintedTerrainMaterials = [];

  function registerDayNightTerrainMaterial(material, opts = {}) {
    if (!material || !material.isMaterial) return material;
    const startColor = material.color && material.color.isColor ? material.color.getHex() : 0xffffff;
    material.userData = material.userData || {};
    material.userData.dayNightTerrainTint = {
      dayColor: new THREE.Color(opts.dayColor !== undefined ? opts.dayColor : startColor),
      nightColor: new THREE.Color(opts.nightColor !== undefined ? opts.nightColor : 0xb79a70),
      dayOpacity: Number.isFinite(Number(opts.dayOpacity)) ? Number(opts.dayOpacity) : (Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : 1),
      nightOpacity: Number.isFinite(Number(opts.nightOpacity)) ? Number(opts.nightOpacity) : (Number.isFinite(Number(material.opacity)) ? Number(material.opacity) : 1)
    };
    if (!dayNightTintedTerrainMaterials.includes(material)) dayNightTintedTerrainMaterials.push(material);
    return material;
  }

  const _terrainTintColor = new THREE.Color();

  function applyTerrainNightTint(nightAmount = 0, twilightAmount = 0) {
    const t = smooth01(Math.max(0, Math.min(1, nightAmount)));
    const twilightLift = Math.max(0, Math.min(1, twilightAmount || 0)) * 0.18;
    dayNightTintedTerrainMaterials.forEach(material => {
      const cfg = material && material.userData ? material.userData.dayNightTerrainTint : null;
      if (!cfg || !material.color || !material.color.isColor) return;
      // Do not push the tint to full black. Fallout-like night should be warm,
      // dusty and readable, especially on mobile screens.
      const tintMix = Math.max(0, Math.min(0.68, t * 0.58 - twilightLift));
      _terrainTintColor.copy(cfg.dayColor).lerp(cfg.nightColor, tintMix);
      material.color.copy(_terrainTintColor);
      if (typeof material.opacity === 'number') {
        material.opacity = lerpNumber(cfg.dayOpacity, cfg.nightOpacity, Math.max(0, Math.min(1, t)));
      }
    });
  }

  function markSharedGeometry(geometry) {
    if (!geometry) return geometry;
    geometry.userData = geometry.userData || {};
    geometry.userData.sharedWorldGeometry = true;
    if (sharedWorldGeometries) sharedWorldGeometries.add(geometry);
    return geometry;
  }

  function markDisposableGeometry(geometry) {
    if (!geometry) return geometry;
    geometry.userData = geometry.userData || {};
    geometry.userData.sharedWorldGeometry = false;
    geometry.userData.disposableWorldGeometry = true;
    return geometry;
  }

  function markSharedMaterial(material) {
    if (!material || !material.isMaterial) return material;
    material.userData = material.userData || {};
    material.userData.sharedWorldMaterial = true;
    if (sharedWorldMaterials) sharedWorldMaterials.add(material);
    return material;
  }

  function markDisposableMaterial(material) {
    if (!material || !material.isMaterial) return material;
    material.userData = material.userData || {};
    material.userData.sharedWorldMaterial = false;
    material.userData.disposableWorldMaterial = true;
    return material;
  }

  function markDisposableTexture(texture) {
    if (!texture) return texture;
    texture.userData = texture.userData || {};
    texture.userData.disposableWorldTexture = true;
    return texture;
  }

  function isSharedWorldGeometry(geometry) {
    return !!(geometry && ((sharedWorldGeometries && sharedWorldGeometries.has(geometry)) || geometry.userData?.sharedWorldGeometry));
  }

  function isSharedWorldMaterial(material) {
    return !!(material && ((sharedWorldMaterials && sharedWorldMaterials.has(material)) || material.userData?.sharedWorldMaterial));
  }

  function disposeWorldObjectTree(root) {
    if (!root || !root.traverse) return;
    root.traverse(obj => {
      if (!obj) return;
      if (obj.geometry && !isSharedWorldGeometry(obj.geometry) && obj.geometry.dispose) {
        obj.geometry.dispose();
      }
      if (obj.material) {
        const list = Array.isArray(obj.material) ? obj.material : [obj.material];
        list.forEach(mat => {
          if (!mat || isSharedWorldMaterial(mat) || !mat.dispose) return;
          mat.dispose();
        });
      }
    });
  }

  function clearWorldGroupWithDispose() {
    worldGroup.children.slice().forEach(child => {
      disposeWorldObjectTree(child);
      worldGroup.remove(child);
    });
  }


  function makeNoiseTexture(name, baseHex, highHex, lowHex, options = {}) {
    const presetSize = Number((graphicsSettings || GRAPHICS_PRESETS.medium).textureSize || 192);
    const size = options.size || presetSize;
    const repeat = options.repeat || 1;
    const base = splitHexColor(baseHex);
    const high = splitHexColor(highHex);
    const low = splitHexColor(lowHex);
    const flat = mixRgb(base, mixRgb(high, low, 0.5), 0.12);
    return canvasTextureFrom(name, (ctx, s) => {
      ctx.fillStyle = `rgb(${flat.r},${flat.g},${flat.b})`;
      ctx.fillRect(0, 0, s, s);
    }, size, repeat);
  }

  function makeDecalTexture(name, color = 'rgba(0,0,0,0.55)', style = 'crack') {
    return canvasTextureFrom(`decal-${name}-${style}`, (ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      if (style === 'dust') {
        const grd = ctx.createRadialGradient(s * 0.5, s * 0.5, s * 0.05, s * 0.5, s * 0.5, s * 0.48);
        grd.addColorStop(0, color);
        grd.addColorStop(0.58, color.replace(/0\.[0-9]+\)/, '0.18)'));
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = 'rgba(255,226,170,0.10)';
        for (let i = 0; i < 30; i++) {
          ctx.beginPath();
          ctx.arc(hash01(i, 2, 5) * s, hash01(i, 7, 9) * s, 0.9 + hash01(i, 3, 1) * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      if (style === 'tire') {
        ctx.strokeStyle = color;
        ctx.lineWidth = s * 0.045;
        ctx.globalAlpha = 0.52;
        [0.38, 0.62].forEach(x => {
          ctx.beginPath();
          ctx.moveTo(s * x, s * 0.05);
          ctx.bezierCurveTo(s * (x - 0.07), s * 0.35, s * (x + 0.07), s * 0.65, s * x, s * 0.95);
          ctx.stroke();
        });
        ctx.globalAlpha = 0.22;
        for (let y = 10; y < s; y += 18) {
          ctx.beginPath();
          ctx.moveTo(s * 0.34, y);
          ctx.lineTo(s * 0.66, y + 8);
          ctx.stroke();
        }
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, s * 0.018);
      ctx.beginPath();
      ctx.moveTo(s * 0.18, s * 0.62);
      ctx.bezierCurveTo(s * 0.34, s * 0.48, s * 0.43, s * 0.36, s * 0.58, s * 0.22);
      ctx.bezierCurveTo(s * 0.65, s * 0.34, s * 0.78, s * 0.40, s * 0.86, s * 0.55);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, s * 0.010);
      [[0.43,0.37,0.32,0.21],[0.53,0.27,0.49,0.12],[0.66,0.39,0.79,0.25],[0.32,0.51,0.21,0.42]].forEach(p => {
        ctx.beginPath(); ctx.moveTo(s*p[0], s*p[1]); ctx.lineTo(s*p[2], s*p[3]); ctx.stroke();
      });
    }, 128, 1);
  }

  function matStandard(opts) {
    const mat = new THREE.MeshStandardMaterial(opts);
    // v7.61: all new world materials follow one PBR contract: high roughness for
    // dust/stone, explicit metalness for scrap, no accidental glossy plastic.
    if (typeof mat.envMapIntensity === 'number') mat.envMapIntensity = opts && opts.metalness > 0.2 ? 0.42 : 0.14;
    if (mat.roughness === undefined || mat.roughness === null) mat.roughness = 0.92;
    if (mat.metalness === undefined || mat.metalness === null) mat.metalness = 0.0;
    return markSharedMaterial(mat);
  }

  function matGroundDecal(opts) {
    const mat = matStandard(Object.assign({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      roughness: 0.96,
      metalness: 0.0
    }, opts || {}));
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -1;
    mat.polygonOffsetUnits = -1;
    return mat;
  }

  function matPsxBuilding(id, opts = {}) {
    const basePath = 'assets/textures/psx_buildings/';
    const repeat = Number(opts.repeat || 1);
    const normalAmount = Number(opts.normalAmount || 0.72);
    const material = matStandard({
      color: opts.color !== undefined ? opts.color : 0xffffff,
      map: loadWorldImageTexture(`psx-${id}-base-v769`, `${basePath}${id}_base_v769.webp`, repeat),
      normalMap: loadWorldDataTexture(`psx-${id}-normal-v769`, `${basePath}${id}_normal_v769.webp`, repeat),
      roughnessMap: loadWorldDataTexture(`psx-${id}-roughness-v769`, `${basePath}${id}_roughness_v769.webp`, repeat),
      aoMap: loadWorldDataTexture(`psx-${id}-ao-v769`, `${basePath}${id}_ao_v769.webp`, repeat),
      aoMapIntensity: Number(opts.aoMapIntensity || 0.86),
      normalScale: new THREE.Vector2(normalAmount, normalAmount),
      roughness: opts.roughness !== undefined ? opts.roughness : 0.92,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.0,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1.0,
      side: THREE.DoubleSide
    });
    material.userData = material.userData || {};
    material.userData.sourceArchive = 'PSXBuildings.zip';
    material.userData.pbrMaterial = true;
    return material;
  }

  function matWoodBricksMaterial(id, opts = {}) {
    const basePath = 'assets/textures/materials_wood_bricks_01/';
    const repeat = Number(opts.repeat || 1);
    const normalAmount = Number(opts.normalAmount || 0.72);
    const material = matStandard({
      color: opts.color !== undefined ? opts.color : 0xffffff,
      map: loadWorldImageTexture(`woodbricks-${id}-base-v770`, `${basePath}${id}_base_v770.webp`, repeat),
      normalMap: loadWorldDataTexture(`woodbricks-${id}-normal-v770`, `${basePath}${id}_normal_v770.webp`, repeat),
      roughnessMap: loadWorldDataTexture(`woodbricks-${id}-roughness-v770`, `${basePath}${id}_roughness_v770.webp`, repeat),
      aoMap: loadWorldDataTexture(`woodbricks-${id}-ao-v770`, `${basePath}${id}_ao_v770.webp`, repeat),
      bumpMap: opts.useHeight === false ? null : loadWorldDataTexture(`woodbricks-${id}-height-v770`, `${basePath}${id}_height_v770.webp`, repeat),
      bumpScale: opts.bumpScale !== undefined ? opts.bumpScale : 0.055,
      aoMapIntensity: Number(opts.aoMapIntensity || 0.96),
      normalScale: new THREE.Vector2(normalAmount, normalAmount),
      roughness: opts.roughness !== undefined ? opts.roughness : 0.94,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.0,
      transparent: !!opts.transparent,
      opacity: opts.opacity !== undefined ? opts.opacity : 1.0,
      side: opts.side || THREE.DoubleSide
    });
    material.userData = material.userData || {};
    material.userData.sourceArchive = 'Materials_WoodAndBricks_01(1).zip';
    material.userData.pbrMaterial = true;
    material.userData.realScaleCaravanTown = true;
    return material;
  }

  const groundTextureRepeat = 1.15;
  const nextGenGroundTextureRepeat = IS_MOBILE_DEVICE ? 10.5 : 14.0;
  const archiveGroundTextureRepeat = IS_MOBILE_DEVICE ? 7.25 : 10.75;
  const reliefGroundTextureRepeat = IS_MOBILE_DEVICE ? 9.5 : 15.5;
  const reliefTextureBudget = graphicsTextureBudget();
  const reliefGroundSegments = reliefTextureBudget.terrainSegments;
  const useReliefPbrMaps = !!reliefTextureBudget.pbrMaps;
  const useReliefLayerNormals = !!reliefTextureBudget.layerNormals;
  const useReliefDisplacement = !!reliefTextureBudget.displacement;
  const reliefGroundDisplacementScale = useReliefDisplacement ? (graphicsQuality === 'ultra' ? 0.155 : 0.112) : 0.0;
  const mats = {
    // v7.52: гамма переведена в сухую диорамную пустошь как на референсе.
    // Разные технические типы клеток больше не дают шахматный рисунок: базовая
    // земля почти единая, а различия создаются декалями, дорогами, водой и объектами.
    // v7.55: базовая земля теперь идёт от референсной песочно-треснувшей текстуры,
    // а не от крупного пятнистого шума. Это убирает "грязную кашу" и приближает
    // карту к диорамной пустоши со скриншота.
    grassA: matStandard({ color: 0xf4dfb2, map: makeNoiseTexture('wasteland-earth-a-v755', 0xb28f5d, 0xd3b47d, 0x705033, { seed: 3, repeat: groundTextureRepeat, lines: 11, specks: 62, lineAlpha: 0.075, speckAlpha: 0.10, speckRadius: 1.25 }), roughness: 0.985 }),
    grassB: matStandard({ color: 0xe7c990, map: makeNoiseTexture('wasteland-earth-b-v755', 0xa98255, 0xc7a56e, 0x60452e, { seed: 5, repeat: groundTextureRepeat, lines: 9, specks: 58, lineAlpha: 0.070, speckAlpha: 0.09, speckRadius: 1.20 }), roughness: 0.985 }),
    darkGrass: matStandard({ color: 0xb1865a, map: makeNoiseTexture('scorched-wasteland-v755', 0x7a5b3b, 0x9a744c, 0x3f2d1f, { seed: 7, repeat: 1.05, lines: 9, specks: 48, lineAlpha: 0.085, speckAlpha: 0.10, speckRadius: 1.35 }), roughness: 0.99 }),
    path: matStandard({ color: 0xe0bd81, map: makeNoiseTexture('dusty-road-v755', 0xba925f, 0xd7b176, 0x6c4d32, { seed: 11, repeat: 1.05, lines: 18, specks: 52, lineAlpha: 0.12, speckAlpha: 0.09, speckRadius: 1.15 }), roughness: 0.99 }),
    water: matStandard({ color: 0x103949, map: makeNoiseTexture('stagnant-water', 0x103949, 0x286b78, 0x061b23, { seed: 13, repeat: 1.25, lines: 2, specks: 30, speckAlpha: 0.10 }), roughness: 0.42, metalness: 0.02, emissive: 0x051119, emissiveIntensity: 0.10 }),
    rock: matStandard({
      color: 0x7b7467,
      map: loadWorldImageTexture('archive-stone-base-v759', 'assets/textures/materials_ground_dirt_01/stone_wall_base_v759.webp', 2.4),
      normalMap: loadWorldDataTexture('archive-stone-normal-v759', 'assets/textures/materials_ground_dirt_01/stone_wall_normal_v759.webp', 2.4),
      normalScale: new THREE.Vector2(0.16, 0.16),
      roughness: 0.94
    }),
    rockLight: matStandard({
      color: 0xa08f75,
      map: loadWorldImageTexture('archive-stone-light-base-v759', 'assets/textures/materials_ground_dirt_01/stone_wall_base_v759.webp', 2.1),
      normalMap: loadWorldDataTexture('archive-stone-light-normal-v759', 'assets/textures/materials_ground_dirt_01/stone_wall_normal_v759.webp', 2.1),
      normalScale: new THREE.Vector2(0.12, 0.12),
      roughness: 0.92
    }),
    trunk: matStandard({ color: 0x8a6840, map: loadWorldImageTexture('cc0-style-dry-wood-v756', 'assets/textures/cc0/cc0_style_dry_wood.png', 1.6), roughness: 0.94 }),
    leaves: matStandard({ color: 0x4c4f30, map: makeNoiseTexture('dusty-leaves-a', 0x4c4f30, 0x68643c, 0x292818, { seed: 29, repeat: 1.0, lines: 0, lineAlpha: 0, specks: 66, noModelStrokes: true }), roughness: 0.95 }),
    leaves2: matStandard({ color: 0x6a663e, map: makeNoiseTexture('dusty-leaves-b', 0x6a663e, 0x807849, 0x383421, { seed: 31, repeat: 1.0, lines: 0, lineAlpha: 0, specks: 66, noModelStrokes: true }), roughness: 0.95 }),
    metal: matStandard({ color: 0x8d8064, map: loadWorldImageTexture('cc0-style-rusty-metal-v756', 'assets/textures/cc0/cc0_style_rusty_metal.png', 1.35), roughness: 0.63, metalness: 0.38 }),
    darkMetal: matStandard({ color: 0x373a37, map: makeNoiseTexture('dark-scratched-metal', 0x373a37, 0x57564c, 0x171919, { seed: 41, repeat: 1.0, lines: 0, specks: 66, lineAlpha: 0, noModelStrokes: true }), roughness: 0.57, metalness: 0.50 }),
    rust: matStandard({ color: 0x8f4c2a, map: loadWorldImageTexture('cc0-style-rust-v756', 'assets/textures/cc0/cc0_style_rusty_metal.png', 1.8), roughness: 0.84, metalness: 0.26 }),
    leather: matStandard({ color: 0x704d2c, map: makeNoiseTexture('worn-leather', 0x704d2c, 0x8a653d, 0x362315, { seed: 47, repeat: 1.0, lines: 0, specks: 48, lineAlpha: 0, noModelStrokes: true }), roughness: 0.83 }),
    cloth: matStandard({ color: 0x32495f, map: makeNoiseTexture('worn-cloth-blue', 0x32495f, 0x506a82, 0x172533, { seed: 53, repeat: 1.0, lines: 0, specks: 38, lineAlpha: 0, noModelStrokes: true }), roughness: 0.86 }),
    skin: matStandard({ color: 0xb98d68, roughness: 0.72 }),
    enemy: matStandard({ color: 0x66714d, map: makeNoiseTexture('enemy-hide-a', 0x66714d, 0x879260, 0x343b28, { seed: 59, repeat: 1.0, lines: 0, specks: 50, lineAlpha: 0, noModelStrokes: true }), roughness: 0.84 }),
    enemy2: matStandard({ color: 0x804d3b, map: makeNoiseTexture('enemy-hide-b', 0x804d3b, 0x9d634e, 0x3f241d, { seed: 61, repeat: 1.0, lines: 0, specks: 50, lineAlpha: 0, noModelStrokes: true }), roughness: 0.84 }),
    enemy3: matStandard({ color: 0x6f647a, map: makeNoiseTexture('enemy-hide-c', 0x6f647a, 0x88809a, 0x36303f, { seed: 67, repeat: 1.0, lines: 0, specks: 50, lineAlpha: 0, noModelStrokes: true }), roughness: 0.84 }),
    dryGrass: matStandard({ color: 0xb89a5b, roughness: 0.96 }),
    scrub: matStandard({ color: 0x756640, roughness: 0.97 }),
    bone: matStandard({ color: 0xc4b891, roughness: 0.82 }),
    ember: matStandard({ color: 0xff7b33, emissive: 0xff4a18, emissiveIntensity: 1.2, roughness: 0.55 }),
    wastelandBack: matStandard({
      color: 0xe9dfcf,
      map: setMaxTextureAnisotropy(loadWorldImageTexture('wasteland-ground-albedo-v777', 'assets/textures/wasteland/wasteland_ground_albedo_v777.webp', nextGenGroundTextureRepeat), 16),
      normalMap: useReliefPbrMaps ? loadWorldDataTexture('wasteland-ground-detail-normal-v777', getReliefTexturePath('normal'), nextGenGroundTextureRepeat) : null,
      normalScale: new THREE.Vector2(0.24, 0.24),
      roughnessMap: useReliefPbrMaps ? loadWorldDataTexture('wasteland-ground-detail-roughness-v777', getReliefTexturePath('roughness'), nextGenGroundTextureRepeat) : null,
      aoMap: useReliefPbrMaps ? loadWorldDataTexture('wasteland-ground-detail-ao-v777', getReliefTexturePath('ao'), nextGenGroundTextureRepeat) : null,
      aoMapIntensity: 0.62,
      roughness: 0.985,
      metalness: 0.0
    }),
    // v7.58: первая локация больше не опирается на одну растянутую картинку земли.
    // База — спокойный цветной материал, а разрешение и детали дают отдельные
    // высокие слои: песок, трещины, гравий, следы шин, масло и мягкие тени.
    settlementBack: matStandard({
      // v7.60: первая локация получила настоящий relief-material: 4K albedo +
      // 2K normal/roughness/height/AO. Это не просто картинка на плоскости:
      // геометрия backplate имеет сегменты и получает displacement, чтобы земля
      // стала объёмной и ловила свет как в классической изометрической диораме.
      color: 0xd8b981,
      map: setMaxTextureAnisotropy(loadWorldImageTexture(`relief-ground-base-v762-${reliefTextureBudget.tier}`, getReliefTexturePath('base'), reliefGroundTextureRepeat), reliefTextureBudget.maxColor >= 1536 ? 16 : 8),
      normalMap: useReliefPbrMaps ? setMaxTextureAnisotropy(loadWorldDataTexture(`relief-ground-normal-v762-${reliefTextureBudget.tier}`, getReliefTexturePath('normal'), reliefGroundTextureRepeat), reliefTextureBudget.maxData >= 1536 ? 16 : 8) : null,
      roughnessMap: useReliefPbrMaps ? loadWorldDataTexture(`relief-ground-roughness-v762-${reliefTextureBudget.tier}`, getReliefTexturePath('roughness'), reliefGroundTextureRepeat) : null,
      aoMap: useReliefPbrMaps ? loadWorldDataTexture(`relief-ground-ao-v762-${reliefTextureBudget.tier}`, getReliefTexturePath('ao'), reliefGroundTextureRepeat) : null,
      aoMapIntensity: useReliefPbrMaps ? 1.18 : 0.0,
      displacementMap: useReliefDisplacement ? loadWorldDataTexture(`relief-ground-height-v762-${reliefTextureBudget.tier}`, getReliefTexturePath('height'), reliefGroundTextureRepeat) : null,
      displacementScale: reliefGroundDisplacementScale,
      displacementBias: -reliefGroundDisplacementScale * 0.74,
      normalScale: new THREE.Vector2(0.78, 0.78),
      roughness: 0.98,
      metalness: 0.0
    }),
    groundDust: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('cc0-style-dust-decal-v756', 'assets/textures/cc0/cc0_style_dust_decal.png', 1), color: 0xe8c995, transparent: true, opacity: 0.20, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    groundCrack: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('cc0-style-crack-decal-v756', 'assets/textures/cc0/cc0_style_crack_decal.png', 1), color: 0x3b2a1a, transparent: true, opacity: 0.34, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    tireTrack: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('cc0-style-tire-tracks-v756', 'assets/textures/cc0/cc0_style_tire_tracks.png', 1), color: 0x3f2e1d, transparent: true, opacity: 0.26, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    scrapScatter: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('cc0-style-scrap-scatter-v756', 'assets/textures/cc0/cc0_style_scrap_scatter.png', 1), color: 0x8f5a37, transparent: true, opacity: 0.28, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    pathDust: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('cc0-style-dust-path-v756', 'assets/textures/cc0/cc0_style_dust_decal.png', 1), color: 0xd4b175, transparent: true, opacity: 0.24, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    scorchedPatch: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('cc0-style-scorch-v756', 'assets/textures/cc0/cc0_style_scorch_decal.png', 1), color: 0x33261b, transparent: true, opacity: 0.25, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    waterPatch: new THREE.MeshBasicMaterial({ map: makeDecalTexture('water-soft-v754', 'rgba(12,42,52,0.72)', 'dust'), color: 0x1c5361, transparent: true, opacity: 0.45, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    waterEdgePatch: new THREE.MeshBasicMaterial({ map: makeDecalTexture('water-edge-v754', 'rgba(61,49,31,0.40)', 'dust'), color: 0x695334, transparent: true, opacity: 0.19, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    traderLayerSand: matGroundDecal({ map: loadWorldImageTexture('archive-layer-sand-v759', 'assets/textures/materials_ground_dirt_01/layer_sand_from_archive_v759.webp', 1), normalMap: useReliefLayerNormals ? loadWorldDataTexture('sand-micro-normal-v761', 'assets/textures/materials_ground_dirt_01/layer_sand_micro_normal_v761.webp', 1) : null, normalScale: new THREE.Vector2(0.18, 0.18), color: 0xffffff, opacity: 0.86, roughness: 0.99 }),
    traderLayerCracks: matGroundDecal({ map: loadWorldImageTexture('relief-cracked-patch-rgba-v760', 'assets/textures/materials_ground_dirt_01/relief_cracked_patch_rgba_v760.webp', 1), normalMap: useReliefLayerNormals ? loadWorldDataTexture('relief-cracked-patch-normal-v761', 'assets/textures/materials_ground_dirt_01/relief_cracked_patch_normal_v761.webp', 1) : null, normalScale: new THREE.Vector2(0.62, 0.62), color: 0xffffff, opacity: 0.76, roughness: 1.0 }),
    traderLayerGravel: matGroundDecal({ map: loadWorldImageTexture('relief-gravel-pebbles-rgba-v760', 'assets/textures/materials_ground_dirt_01/relief_gravel_pebbles_rgba_v760.webp', 1), normalMap: useReliefLayerNormals ? loadWorldDataTexture('relief-gravel-pebbles-normal-v761', 'assets/textures/materials_ground_dirt_01/relief_gravel_pebbles_normal_v761.webp', 1) : null, normalScale: new THREE.Vector2(0.48, 0.48), color: 0xffffff, opacity: 0.80, roughness: 0.94 }),
    traderLayerTire: matGroundDecal({ map: loadWorldImageTexture('archive-layer-tire-v759', 'assets/textures/materials_ground_dirt_01/layer_tire_tracks_from_archive_v759.webp', 1), normalMap: useReliefLayerNormals ? loadWorldDataTexture('tire-tracks-normal-v761', 'assets/textures/materials_ground_dirt_01/layer_tire_tracks_normal_v761.webp', 1) : null, normalScale: new THREE.Vector2(0.42, 0.42), color: 0xffffff, opacity: 0.72, roughness: 0.98 }),
    traderLayerOil: matGroundDecal({ map: loadWorldImageTexture('relief-mud-scorch-rgba-v760', 'assets/textures/materials_ground_dirt_01/relief_mud_scorch_rgba_v760.webp', 1), normalMap: useReliefLayerNormals ? loadWorldDataTexture('mud-scorch-normal-v761', 'assets/textures/materials_ground_dirt_01/relief_mud_scorch_normal_v761.webp', 1) : null, normalScale: new THREE.Vector2(0.30, 0.30), color: 0xffffff, opacity: 0.58, roughness: 0.84, metalness: 0.02 }),
    traderLayerRoad: matGroundDecal({ map: loadWorldImageTexture('archive-layer-straw-road-v759', 'assets/textures/materials_ground_dirt_01/layer_straw_dry_grass_from_archive_v759.webp', 1), normalMap: useReliefLayerNormals ? loadWorldDataTexture('straw-road-normal-v761', 'assets/textures/materials_ground_dirt_01/layer_straw_dry_grass_normal_v761.webp', 1) : null, normalScale: new THREE.Vector2(0.24, 0.24), color: 0xffffff, opacity: 0.70, roughness: 0.99 }),
    traderLayerShadow: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('trader-layer-shadow-v758', 'assets/textures/wasteland/layers/soft_shadow_blob_v758.webp', 1), color: 0xffffff, transparent: true, opacity: 0.58, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    traderContactAO: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('baked-contact-ao-v761', 'assets/textures/wasteland/layers/baked_contact_ao_blob_v761.webp', 1), color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false, depthTest: true, side: THREE.DoubleSide }),
    traderWarmGlow: new THREE.MeshBasicMaterial({ map: loadWorldImageTexture('warm-bloom-blob-v761', 'assets/textures/wasteland/layers/warm_bloom_blob_v761.webp', 1), color: 0xffb45d, transparent: true, opacity: 0.52, depthWrite: false, depthTest: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
    traderBuildingWallMetal: matPsxBuilding('trader_wall_metal_blue', { repeat: 1.1, normalAmount: 0.92, roughness: 0.88, metalness: 0.18 }),
    traderBuildingCorrugatedRust: matPsxBuilding('trader_wall_corrugated_rust', { repeat: 1.2, normalAmount: 1.05, roughness: 0.94, metalness: 0.30 }),
    traderBuildingCorrugatedWhite: matPsxBuilding('trader_wall_corrugated_white', { repeat: 1.1, normalAmount: 0.84, roughness: 0.92, metalness: 0.14 }),
    traderBuildingBrickWindow: matPsxBuilding('trader_wall_brick_window', { repeat: 1.0, normalAmount: 0.76, roughness: 0.96, metalness: 0.0 }),
    traderBuildingConcreteWindow: matPsxBuilding('trader_wall_concrete_window', { repeat: 1.0, normalAmount: 0.72, roughness: 0.98, metalness: 0.0 }),
    traderBuildingDoorGrey: matPsxBuilding('trader_door_grey', { repeat: 1.0, normalAmount: 0.68, roughness: 0.82, metalness: 0.18 }),
    traderBuildingRollupDoor: matPsxBuilding('trader_rollup_door', { repeat: 1.0, normalAmount: 0.90, roughness: 0.78, metalness: 0.32 }),
    traderBuildingFloorConcrete: matPsxBuilding('trader_floor_concrete', { repeat: 2.2, normalAmount: 0.58, roughness: 0.98, metalness: 0.0 }),
    traderBuildingRoofRedWhite: matPsxBuilding('trader_roof_red_white', { repeat: 1.15, normalAmount: 0.92, roughness: 0.90, metalness: 0.22 }),
    traderRoofCleanCorrugated: matStandard({
      color: 0xffffff,
      map: loadWorldImageTexture('trader-roof-clean-corrugated-v77487', 'assets/textures/psx_buildings/trader_roof_clean_corrugated_v77487.webp', 2.65),
      roughness: 0.92,
      metalness: 0.04,
      emissive: 0x24170f,
      emissiveIntensity: 0.06
    }),
    traderBuildingWindowDark: matStandard({ map: loadWorldImageTexture('psx-trader-window-dark-v769', 'assets/textures/psx_buildings/trader_window_dark_v769.webp', 1), color: 0x9fb1b1, transparent: true, opacity: 0.66, roughness: 0.42, metalness: 0.02, emissive: 0x111c1d, emissiveIntensity: 0.10 }),
    // v7.70: real-scale caravan-town construction no longer stretches a ready-made building atlas.
    // Walls, floors and roofs use separate uploaded PBR materials with normal/roughness/AO/height.
    realScaleOldBrickWall: matWoodBricksMaterial('oldbricks', { repeat: 2.7, normalAmount: 0.92, bumpScale: 0.038, roughness: 0.98 }),
    realScaleBrokenConcrete: matWoodBricksMaterial('destroyed_concrete', { repeat: 2.15, normalAmount: 1.05, bumpScale: 0.050, roughness: 0.99 }),
    realScaleWoodFloor: matWoodBricksMaterial('wood_floor_02', { repeat: 2.6, normalAmount: 0.72, bumpScale: 0.035, roughness: 0.86 }),
    realScaleRoofWood: matWoodBricksMaterial('wood_floor_04', { repeat: 2.3, normalAmount: 0.86, bumpScale: 0.040, roughness: 0.90 }),
    // v7.74.24: the cutaway roof is frequently toggled when entering the trader building.
    // Keep that mesh on a cheap shader: map + light response only, no normal/roughness/AO/bump.
    // Detailed PBR wood still remains for counters, shelves and other close interior parts.
    traderRoofRenderFast: matStandard({
      color: 0xffffff,
      map: loadWorldImageTexture('trader-roof-wood-planks-v77490', 'assets/textures/psx_buildings/trader_roof_wood_planks_v77490.webp', 3.45),
      roughness: 0.92,
      metalness: 0.0,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    }),
    realScaleMixedFloor: matWoodBricksMaterial('wood_bricks_floor', { repeat: 2.2, normalAmount: 0.78, bumpScale: 0.034, roughness: 0.93 }),
    red: new THREE.MeshBasicMaterial({ color: 0xd64a35 }),
    green: new THREE.MeshBasicMaterial({ color: 0x74bf47 }),
    black: new THREE.MeshBasicMaterial({ color: 0x090909 }),
    marker: new THREE.MeshBasicMaterial({ color: 0xd8bd6e, transparent: true, opacity: 0.55, depthWrite: false })
  };

  Object.values(mats).forEach(markSharedMaterial);

  const STATIC_MODEL_URLS = {
    barrel: '/assets/models/wasteland/rust_barrel_v1.glb',
    rustBarrel: '/assets/models/wasteland/rust_barrel_v1.glb',
    deadTreeA: '/assets/models/wasteland/dead_tree_a.glb',
    deadTreeB: '/assets/models/wasteland/dead_tree_b.glb',
    deadTreeC: '/assets/models/wasteland/dead_tree_c.glb',
    rubbleRock: '/assets/models/wasteland/rubble_rock.glb',
    oreOutcrop: '/assets/models/wasteland/ore_outcrop.glb',
    oilPumpJack: '/assets/models/wasteland/oil_pump_jack.glb',
    deadwood: '/assets/models/wasteland/deadwood.glb',
    carWreck: '/assets/models/wasteland/car_wreck.glb',
    concreteWall: '/assets/models/wasteland/concrete_wall.glb',
    barrelCluster: '/assets/models/wasteland/barrel_cluster.glb',
    tireStack: '/assets/models/wasteland/tire_stack.glb',
    scrapHeap: '/assets/models/wasteland/scrap_heap.glb',
    crate: '/assets/models/wasteland/crate.glb',
    tradeMachine: '/assets/models/wasteland/trade_machine.glb',
    storageChest: '/assets/models/wasteland/storage_chest.glb',
    jobBoard: '/assets/models/wasteland/job_board.glb',
    cactus: '/assets/models/wasteland/cactus.glb',
    wastelandShack: '/assets/models/wasteland/wasteland_shack.glb',
    fenceSegment: '/assets/models/wasteland/fence_segment.glb',
    perimeterDebris: '/assets/models/wasteland/perimeter_debris.glb',
    lowRuinedWall: '/assets/models/wasteland/low_ruined_wall.glb',
    watchPost: '/assets/models/wasteland/watch_post.glb',
    relayAntenna: '/assets/models/wasteland/relay_antenna.glb',
    waterTank: '/assets/models/wasteland/water_tank.glb',
    armoryRack: '/assets/models/wasteland/armory_rack.glb',
    cotBed: '/assets/models/wasteland/cot_bed.glb',
    workshopBench: '/assets/models/wasteland/workshop_bench.glb',
    craftStationAmmo: '/assets/models/wasteland/craft_station_ammo.glb',
    craftStationWeapon: '/assets/models/wasteland/craft_station_weapon.glb',
    craftStationTools: '/assets/models/wasteland/craft_station_tools.glb',
    craftStationRepair: '/assets/models/wasteland/craft_station_repair.glb',
    craftStationEnergy: '/assets/models/wasteland/craft_station_energy.glb',
    craftStationChem: '/assets/models/wasteland/craft_station_chem.glb',
    gardenPatch: '/assets/models/wasteland/garden_patch.glb',
    latrineOuthouse: '/assets/models/wasteland/latrine_outhouse.glb',
    campfireRest: '/assets/models/wasteland/campfire_rest.glb',
    brahmin: '/assets/models/wasteland/brahmin.glb',
    friendlyBrahmin: '/assets/models/wasteland/brahmin.glb',
    brahminPen: '/assets/models/wasteland/brahmin_pen.glb',
    cargoStack: '/assets/models/wasteland/cargo_stack.glb',
    traderNpc: '/assets/models/wasteland/trader_npc.glb',
    caravanMerchant: '/assets/models/wasteland/npc_caravan_trader.glb',
    caravanGuard: '/assets/models/wasteland/npc_caravan_guard.glb',
    klimPatrolGuard: '/assets/models/wasteland/npc_klim_guard.glb',
    wastelandSettler: '/assets/models/wasteland/npc_wasteland_settler.glb',
    enemyRaider: '/assets/models/wasteland/npc_raider.glb',
    enemyGhoul: '/assets/models/wasteland/npc_ghoul.glb',
    enemySuperMutant: '/assets/models/wasteland/npc_super_mutant.glb',
    enemyAshWolf: '/assets/models/wasteland/npc_ash_wolf.glb',
    enemyRadscorpion: '/assets/models/wasteland/npc_radscorpion.glb',
    enemyMutantAnt: '/assets/models/wasteland/npc_mutant_ant.glb',
    enemyGecko: '/assets/models/wasteland/npc_gecko.glb',
    enemyFireGecko: '/assets/models/wasteland/npc_fire_gecko.glb',
    traderAwning: '/assets/models/wasteland/trader_awning.glb',
    traderWallBlock: '/assets/models/wasteland/trader_wall_block.glb',
    traderWindowBlock: '/assets/models/wasteland/trader_window_block.glb',
    traderFloorSlab: '/assets/models/wasteland/trader_floor_slab.glb',
    traderRoofBlock: '/assets/models/wasteland/trader_roof_block.glb',
    wallWoodBlock: '/assets/models/wasteland/mod_wall_wood.glb',
    wallBrickBlock: '/assets/models/wasteland/mod_wall_brick.glb',
    wallMetalBlock: '/assets/models/wasteland/mod_wall_metal.glb',
    roofWoodBlock: '/assets/models/wasteland/mod_roof_wood.glb',
    roofMetalBlock: '/assets/models/wasteland/mod_roof_metal.glb',
    floorWoodBlock: '/assets/models/wasteland/mod_floor_wood.glb',
    floorTileBlock: '/assets/models/wasteland/mod_floor_tile.glb',
    storageLeanTo: '/assets/models/wasteland/storage_lean_to.glb',
    scrapWallSegment: '/assets/models/wasteland/scrap_wall_segment.glb',
    scrapWatchTower: '/assets/models/wasteland/scrap_watch_tower.glb',
    openScrapGate: '/assets/models/wasteland/open_scrap_gate.glb',
    highwaySign: '/assets/models/wasteland/highway_sign.glb',
    ruinedBillboard: '/assets/models/wasteland/ruined_billboard.glb',
    utilityPole: '/assets/models/wasteland/utility_pole.glb',
    roadblockBarricade: '/assets/models/wasteland/roadblock_barricade.glb',
    dryBush: '/assets/models/wasteland/dry_bush.glb',
    asphaltSlab: '/assets/models/wasteland/asphalt_slab.glb'
  };

  function staticModelFileName(value = '') {
    const normalized = String(value || '').replace(/\\/g, '/').split('?')[0].split('#')[0];
    return normalized.split('/').pop().toLowerCase();
  }

  function staticModelCatalogEntry(keyOrUrl = '') {
    const url = STATIC_MODEL_URLS[keyOrUrl] || keyOrUrl;
    return MODEL_COLLIDER_CATALOG[staticModelFileName(url)] || null;
  }

  function staticModelColliderBounds(keyOrUrl = '') {
    const entry = staticModelCatalogEntry(keyOrUrl);
    const bounds = entry?.collision?.mode === 'solid' ? entry.collision : (entry?.collision ? null : entry);
    if (!bounds?.size || !bounds?.center) return null;
    const values = [bounds.size.x, bounds.size.z, bounds.center.x, bounds.center.z].map(Number);
    if (!values.every(Number.isFinite) || values[0] <= 0 || values[1] <= 0) return null;
    return bounds;
  }

  function staticModelColliderParts(keyOrUrl = '') {
    const bounds = staticModelColliderBounds(keyOrUrl);
    if (!bounds) return [];
    return Array.isArray(bounds.parts) && bounds.parts.length ? bounds.parts : [bounds];
  }

  function staticBoundsCollisionTransform(bounds, x = 0, z = 0, angle = 0, opts = {}) {
    if (!bounds?.size || !bounds?.center) return null;
    const uniformScale = Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1;
    const scaleX = Number.isFinite(Number(opts.scaleX)) ? Number(opts.scaleX) : uniformScale;
    const scaleZ = Number.isFinite(Number(opts.scaleZ)) ? Number(opts.scaleZ) : uniformScale;
    const rotationY = Number(angle || 0);
    const localCenterX = Number(bounds.center.x) * scaleX;
    const localCenterZ = Number(bounds.center.z) * scaleZ;
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    return {
      x: Number(x || 0) + localCenterX * cos - localCenterZ * sin,
      z: Number(z || 0) + localCenterX * sin + localCenterZ * cos,
      halfX: Number(bounds.size.x) * Math.abs(scaleX) * 0.5,
      halfZ: Number(bounds.size.z) * Math.abs(scaleZ) * 0.5,
      rotationY
    };
  }

  function staticModelCollisionTransform(keyOrUrl, x = 0, z = 0, angle = 0, opts = {}) {
    return staticBoundsCollisionTransform(staticModelColliderBounds(keyOrUrl), x, z, angle, opts);
  }

  function staticModelCollisionTransforms(keyOrUrl, x = 0, z = 0, angle = 0, opts = {}) {
    return staticModelColliderParts(keyOrUrl)
      .map(bounds => staticBoundsCollisionTransform(bounds, x, z, angle, opts))
      .filter(Boolean);
  }

  function addStaticModelCollision(keyOrUrl, x = 0, z = 0, angle = 0, opts = {}, label = keyOrUrl) {
    const colliders = staticModelCollisionTransforms(keyOrUrl, x, z, angle, opts);
    if (!colliders.length) return null;
    return colliders.map((collider, partIndex) => addStaticCollisionBox(
      collider.x,
      collider.z,
      collider.halfX * 2,
      collider.halfZ * 2,
      `${label || keyOrUrl || 'static-model'}:${partIndex}`,
      collider.rotationY
    )).filter(Boolean);
  }

  function staticModelColliderRadius(keyOrUrl, scale = 1) {
    const bounds = staticModelColliderBounds(keyOrUrl);
    if (!bounds) return 0;
    const scaleX = Number.isFinite(Number(scale?.x)) ? Number(scale.x) : Number(scale || 1);
    const scaleZ = Number.isFinite(Number(scale?.z)) ? Number(scale.z) : Number(scale || 1);
    return Math.max(
      Math.abs(Number(bounds.min.x) * scaleX),
      Math.abs(Number(bounds.max.x) * scaleX),
      Math.abs(Number(bounds.min.z) * scaleZ),
      Math.abs(Number(bounds.max.z) * scaleZ)
    );
  }

  const STATIC_MODEL_VISION_RULES = {
    traderWallBlock: { mode: 'block' },
    wallWoodBlock: { mode: 'block' },
    wallBrickBlock: { mode: 'block' },
    wallMetalBlock: { mode: 'block' },
    wastelandShack: { mode: 'block' },
    storageLeanTo: { mode: 'block' },
    scrapWatchTower: { mode: 'block' },
    latrineOuthouse: { mode: 'block' },
    waterTank: { mode: 'block' },
    traderWindowBlock: { mode: 'none' },
    traderFloorSlab: { mode: 'none' },
    traderRoofBlock: { mode: 'none' },
    roofWoodBlock: { mode: 'none' },
    roofMetalBlock: { mode: 'none' },
    floorWoodBlock: { mode: 'none' },
    floorTileBlock: { mode: 'none' },
    asphaltSlab: { mode: 'none' },
    traderAwning: { mode: 'none' },
    openScrapGate: { mode: 'cover' },
    watchPost: { mode: 'cover' },
    scrapWallSegment: { mode: 'cover' },
    fenceSegment: { mode: 'cover' },
    concreteWall: { mode: 'cover' },
    lowRuinedWall: { mode: 'cover' },
    roadblockBarricade: { mode: 'cover' },
    crate: { mode: 'cover' },
    tradeMachine: { mode: 'cover' },
    storageChest: { mode: 'cover' },
    jobBoard: { mode: 'cover' },
    barrel: { mode: 'cover' },
    rustBarrel: { mode: 'cover' },
    barrelCluster: { mode: 'cover' },
    cargoStack: { mode: 'cover' },
    armoryRack: { mode: 'cover' },
    cotBed: { mode: 'none' },
    workshopBench: { mode: 'cover' },
    craftStationAmmo: { mode: 'cover' },
    craftStationWeapon: { mode: 'cover' },
    craftStationTools: { mode: 'cover' },
    craftStationRepair: { mode: 'cover' },
    craftStationEnergy: { mode: 'cover' },
    craftStationChem: { mode: 'cover' },
    carWreck: { mode: 'cover' },
    oreOutcrop: { mode: 'cover' },
    oilPumpJack: { mode: 'cover' },
    deadwood: { mode: 'cover' },
    relayAntenna: { mode: 'cover' },
    brahminPen: { mode: 'cover' }
  };
  const staticModelStates = {};

  function clearObjectChildren(object) {
    while (object.children && object.children.length) object.remove(object.children[0]);
  }

  function staticModelState(key) {
    if (!staticModelStates[key]) {
      staticModelStates[key] = { source: null, loading: false, failed: false, pending: [] };
    }
    return staticModelStates[key];
  }

  function staticModelMaterialProfile(name = '') {
    const id = String(name || '').toLowerCase();
    if (!id || /shadow|glow|screen|glass|liquid|flame|ember|light|label/.test(id)) return null;
    if (/wood|plank|timber|branch|twig|pole|stock|handle|canvas/.test(id)) {
      return { kind: 'wood', colorBlend: 0.48, roughnessMin: 0.86, roughnessMax: 0.96, bumpScale: 0.026 };
    }
    if (/concrete|stone|rock|rubble|brick|asphalt|clay/.test(id)) {
      return { kind: 'stone', colorBlend: 0.38, roughnessMin: 0.88, roughnessMax: 0.98, normalAmount: 0.24 };
    }
    if (/rust|metal|steel|iron|scrap|brass|copper|pipe|wire|chain|gear|barrel|plate|machine/.test(id)) {
      return { kind: 'metal', colorBlend: 0.46, roughnessMin: 0.58, roughnessMax: 0.88, metalnessMin: 0.28, bumpScale: 0.018 };
    }
    if (/dust|sand|earth|soil|ground|ore/.test(id)) {
      return { kind: 'ground', colorBlend: 0.42, roughnessMin: 0.92, roughnessMax: 1.0, normalAmount: 0.18 };
    }
    return null;
  }

  const staticModelNeutralAlbedo = new THREE.Color(0xffffff);

  function staticModelProfileTextures(profile) {
    if (!profile) return null;
    if (profile.kind === 'wood') {
      return {
        map: loadWorldImageTexture('model-detail-wood-base-v778', 'assets/textures/cc0/cc0_style_dry_wood.png', 1.85),
        bumpMap: loadWorldDataTexture('model-detail-wood-height-v778', 'assets/textures/cc0/cc0_style_dry_wood.png', 1.85)
      };
    }
    if (profile.kind === 'stone') {
      return {
        map: loadWorldImageTexture('model-detail-stone-base-v778', 'assets/textures/materials_ground_dirt_01/stone_wall_base_v759.webp', 2.15),
        normalMap: loadWorldDataTexture('model-detail-stone-normal-v778', 'assets/textures/materials_ground_dirt_01/stone_wall_normal_v759.webp', 2.15)
      };
    }
    if (profile.kind === 'metal') {
      return {
        map: loadWorldImageTexture('model-detail-rust-base-v778', 'assets/textures/cc0/cc0_style_rusty_metal.png', 2.0),
        bumpMap: loadWorldDataTexture('model-detail-rust-height-v778', 'assets/textures/cc0/cc0_style_rusty_metal.png', 2.0)
      };
    }
    if (profile.kind === 'ground') {
      return {
        map: loadWorldImageTexture('model-detail-ground-base-v778', 'assets/textures/wasteland/wasteland_ground_albedo_v777.webp', 2.2),
        normalMap: loadWorldDataTexture('model-detail-ground-normal-v778', getReliefTexturePath('normal'), 2.2)
      };
    }
    return null;
  }

  function enhanceStaticModelMaterial(material, geometry) {
    if (!material) return material;
    const useRichMaps = !IS_MOBILE_DEVICE && (graphicsQuality === 'high' || graphicsQuality === 'ultra');
    const visualTier = useRichMaps ? 'v7.76-rich' : 'v7.76-lite';
    if (material.userData?.realmVisualUpgrade === visualTier) return material;
    material.userData = material.userData || {};
    const profile = staticModelMaterialProfile(material.name || '');
    const hasUv = !!getGeometryAttributeCompat(geometry, 'uv');
    if (profile && material.isMeshStandardMaterial) {
      material.roughness = Math.max(profile.roughnessMin, Math.min(profile.roughnessMax, Number(material.roughness ?? profile.roughnessMax)));
      if (profile.metalnessMin !== undefined) material.metalness = Math.max(profile.metalnessMin, Number(material.metalness || 0));
      if (typeof material.envMapIntensity === 'number') material.envMapIntensity = profile.kind === 'metal' ? 0.62 : 0.20;
      if (useRichMaps && hasUv) {
        const textures = staticModelProfileTextures(profile);
        if (!material.map && textures?.map) {
          material.map = textures.map;
          if (material.color) material.color.lerp(staticModelNeutralAlbedo, profile.colorBlend || 0.4);
        }
        if (!material.normalMap && textures?.normalMap) {
          material.normalMap = textures.normalMap;
          const amount = Number(profile.normalAmount || 0.20);
          material.normalScale = new THREE.Vector2(amount, amount);
        }
        if (!material.normalMap && !material.bumpMap && textures?.bumpMap) {
          material.bumpMap = textures.bumpMap;
          material.bumpScale = Number(profile.bumpScale || 0.018);
        }
      }
    }
    material.depthWrite = !(material.transparent && Number(material.opacity ?? 1) < 0.98);
    material.dithering = true;
    material.userData.realmVisualUpgrade = visualTier;
    material.needsUpdate = true;
    return material;
  }

  function prepareStaticModelObject(object) {
    if (!object || !object.traverse) return object;
    object.traverse(part => {
      if (!part || !part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
      if (part.geometry && !getGeometryAttributeCompat(part.geometry, 'normal') && typeof part.geometry.computeVertexNormals === 'function') part.geometry.computeVertexNormals();
      if (part.geometry && typeof part.geometry.computeBoundingSphere === 'function') part.geometry.computeBoundingSphere();
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      materials.forEach(material => enhanceStaticModelMaterial(material, part.geometry));
    });
    return object;
  }

  function refreshStaticModelVisualQuality() {
    Object.values(staticModelStates).forEach(state => {
      if (!state?.source?.traverse) return;
      state.source.traverse(part => {
        if (!part || !part.isMesh) return;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        materials.forEach(material => enhanceStaticModelMaterial(material, part.geometry));
      });
    });
  }

  function cloneStaticModel(key) {
    const state = staticModelState(key);
    if (!state.source) return null;
    const clone = state.source.clone(true);
    clone.traverse(part => {
      if (!part || !part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
    });
    return clone;
  }

  function cloneBarrelModel(bodyMat) {
    const state = staticModelState('barrel');
    if (!state.source) return null;
    const clone = state.source.clone(true);
    const useDarkBody = bodyMat === mats.darkMetal;
    clone.traverse(part => {
      if (!part || !part.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = true;
      if (useDarkBody && part.material && /rust|body|scratch|oil/i.test(part.material.name || '')) {
        part.material = mats.darkMetal;
      }
    });
    return clone;
  }

  const fastModuleBlockGeometries = {};

  function fastModuleBlockBaseSize(key) {
    if (isWallBuildingBlockKey(key)) return { x: 2.0, y: 1.0, z: 2.0 };
    if (isFloorBuildingBlockKey(key)) return { x: 2.0, y: 0.12, z: 2.0 };
    if (isRoofBuildingBlockKey(key)) return { x: 2.0, y: 0.20, z: 2.0 };
    return null;
  }

  function usesFastModuleBlockRenderer(key) {
    // Modular buildings must render the exact GLB assets placed by the
    // location editor. The old fast path replaced them with generated box
    // geometry, which made the game view differ from the editor view.
    return false;
  }

  function fastModuleBlockGeometry(key) {
    const size = fastModuleBlockBaseSize(key);
    if (!size) return null;
    const cacheKey = `${key}:${size.x}:${size.y}:${size.z}`;
    if (!fastModuleBlockGeometries[cacheKey]) {
      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      if (typeof geometry.computeBoundingSphere === 'function') geometry.computeBoundingSphere();
      fastModuleBlockGeometries[cacheKey] = markSharedGeometry(geometry);
    }
    return fastModuleBlockGeometries[cacheKey];
  }

  function fastModuleBlockMaterial(key, opts = {}) {
    let material = null;
    if (key === 'wallWoodBlock') material = mats.realScaleRoofWood || mats.realScaleWoodFloor || mats.traderBuildingCorrugatedWhite;
    else if (key === 'wallBrickBlock' || key === 'traderWallBlock') material = mats.realScaleOldBrickWall || mats.traderBuildingBrickWindow;
    else if (key === 'wallMetalBlock') material = mats.traderBuildingWallMetal || mats.traderBuildingCorrugatedRust;
    else if (key === 'traderWindowBlock') material = mats.traderBuildingWindowDark || mats.traderBuildingConcreteWindow;
    else if (key === 'floorWoodBlock') material = mats.realScaleWoodFloor || mats.realScaleMixedFloor;
    else if (key === 'floorTileBlock' || key === 'traderFloorSlab') material = mats.traderBuildingFloorConcrete || mats.realScaleMixedFloor;
    else if (key === 'roofWoodBlock') material = mats.traderRoofRenderFast || mats.realScaleRoofWood;
    else if (key === 'roofMetalBlock' || key === 'traderRoofBlock') material = mats.traderRoofCleanCorrugated || mats.traderBuildingRoofRedWhite;
    if (!material) material = mats.realScaleMixedFloor || mats.gray || new THREE.MeshStandardMaterial({ color: 0xd0b88a, roughness: 0.92 });

    const needsPrivateMaterial = isWallBuildingBlockKey(key) || isRoofBuildingBlockKey(key);
    if (needsPrivateMaterial && material.clone) {
      material = markDisposableMaterial(material.clone());
    }
    if (key === 'traderWindowBlock') {
      material.transparent = true;
      material.opacity = Math.min(Number(material.opacity || 0.42), 0.42);
      if ('depthWrite' in material) material.depthWrite = false;
    }
    if ('needsUpdate' in material) material.needsUpdate = true;
    return material;
  }

  function enableInstanceOpacityMaterial(material, key = 'module') {
    if (!material || material.userData?.instanceOpacityEnabled) return material;
    material = material.clone ? markDisposableMaterial(material.clone()) : material;
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.userData = material.userData || {};
    material.userData.instanceOpacityEnabled = true;
    material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
attribute float instanceOpacity;
varying float vInstanceOpacity;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vInstanceOpacity = instanceOpacity;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
varying float vInstanceOpacity;`
      );
      const before = shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        /vec4\s+diffuseColor\s*=\s*vec4\(\s*diffuse\s*,\s*opacity\s*\)\s*;/,
        'vec4 diffuseColor = vec4( diffuse, opacity * vInstanceOpacity );'
      );
      if (shader.fragmentShader === before) {
        shader.fragmentShader = shader.fragmentShader.replace(
          /gl_FragColor\s*=\s*vec4\(\s*outgoingLight\s*,\s*diffuseColor\.a\s*\)\s*;/,
          'gl_FragColor = vec4( outgoingLight, diffuseColor.a * vInstanceOpacity );'
        );
      }
    };
    material.customProgramCacheKey = () => `realm-instance-opacity-${key}`;
    material.needsUpdate = true;
    return material;
  }

  function fastModuleBatchMaterial(key, rows = []) {
    const material = fastModuleBlockMaterial(key, { cloneMaterials: false });
    return material;
  }

  function authoredModuleInitialOpacity(row = {}, key = '') {
    if (key === 'traderWindowBlock') return Math.min(0.42, Number(row.opacity || row.material?.opacity || 0.42));
    return 1.0;
  }

  function setInstancedModuleOpacity(proxy, opacity = 1.0) {
    const data = proxy?.userData?.instancedOccluderBatch;
    if (!data || !data.mesh) return false;
    const index = Number(data.index);
    const alpha = Math.max(0.04, Math.min(1.0, Number(opacity || 0)));
    const prev = Number.isFinite(Number(data.opacity)) ? Number(data.opacity) : 1.0;
    if (Math.abs(prev - alpha) < 0.001) return false;
    if (data.originalMatrix && data.hiddenMatrix && data.key) {
      const shouldFade = alpha < 0.999;
      if (shouldFade) {
        if (!data.hidden) {
          data.mesh.setMatrixAt(index, data.hiddenMatrix);
          if (data.mesh.instanceMatrix) data.mesh.instanceMatrix.needsUpdate = true;
          data.hidden = true;
        }
        if (!data.fadeMesh) {
          const geometry = fastModuleBlockGeometry(data.key);
          const material = fastModuleBlockMaterial(data.key, { cloneMaterials: true });
          if (!geometry || !material) return false;
          material.transparent = true;
          material.opacity = alpha;
          if ('depthWrite' in material) material.depthWrite = false;
          if ('depthTest' in material) material.depthTest = true;
          if ('needsUpdate' in material) material.needsUpdate = true;
          const fadeMesh = new THREE.Mesh(geometry, material);
          fadeMesh.name = `fast_module_fade_${data.key}_${index}`;
          fadeMesh.position.copy(data.position);
          fadeMesh.quaternion.copy(data.quaternion);
          fadeMesh.scale.copy(data.scale);
          fadeMesh.castShadow = false;
          fadeMesh.receiveShadow = false;
          fadeMesh.frustumCulled = false;
          fadeMesh.renderOrder = 18;
          fadeMesh.userData.kind = `fast-module-fade-${data.key}`;
          fadeMesh.userData.forceNoShadow = true;
          fadeMesh.userData.fastModuleFade = true;
          data.fadeMesh = fadeMesh;
          worldGroup.add(fadeMesh);
        } else {
          data.fadeMesh.visible = true;
        }
        const materials = Array.isArray(data.fadeMesh.material) ? data.fadeMesh.material : [data.fadeMesh.material];
        materials.forEach(mat => {
          if (!mat) return;
          mat.transparent = true;
          mat.opacity = alpha;
          if ('depthWrite' in mat) mat.depthWrite = false;
          if ('depthTest' in mat) mat.depthTest = true;
          if ('needsUpdate' in mat) mat.needsUpdate = true;
        });
      } else {
        if (data.hidden) {
          data.mesh.setMatrixAt(index, data.originalMatrix);
          if (data.mesh.instanceMatrix) data.mesh.instanceMatrix.needsUpdate = true;
          data.hidden = false;
        }
        if (data.fadeMesh) data.fadeMesh.visible = false;
      }
      data.opacity = alpha;
      proxy.userData.traderOccluderOpacity = alpha;
      return true;
    }
    if (!data.opacityAttribute) return false;
    const array = data.opacityAttribute.array;
    if (!Number.isInteger(index) || !array || index < 0 || index >= array.length) return false;
    if (Math.abs(Number(array[index] || 0) - alpha) < 0.001) return false;
    array[index] = alpha;
    data.opacityAttribute.needsUpdate = true;
    data.opacity = alpha;
    proxy.userData.traderOccluderOpacity = alpha;
    return true;
  }

  function createFastModuleBlockModel(key, opts = {}) {
    const geometry = fastModuleBlockGeometry(key);
    if (!geometry) return null;
    const material = fastModuleBlockMaterial(key, opts);
    const mesh = new THREE.Mesh(geometry, material);
    const size = fastModuleBlockBaseSize(key) || { y: 1 };
    mesh.name = `fast_module_${key}`;
    mesh.position.y = Math.max(0.001, Number(size.y || 1)) * 0.5;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.userData.kind = opts.kind || key;
    mesh.userData.fastModuleBlock = true;
    mesh.userData.forceNoShadow = true;
    return mesh;
  }

  function applyStaticModelInstanceOptions(model, opts = {}) {
    if (!model || !model.traverse) return model;
    const cloneMat = (mat) => (opts.cloneMaterials && mat && mat.clone)
      ? markDisposableMaterial(mat.clone())
      : mat;
    model.traverse(part => {
      if (!part || !part.isMesh) return;
      if (opts.cloneMaterials && part.material) {
        part.material = Array.isArray(part.material)
          ? part.material.map(cloneMat)
          : cloneMat(part.material);
      }
      if (opts.castShadow !== undefined) part.castShadow = opts.castShadow !== false;
      if (opts.receiveShadow !== undefined) part.receiveShadow = opts.receiveShadow !== false;
      if (opts.kind && part.userData) part.userData.kind = opts.kind;
      const materials = Array.isArray(part.material) ? part.material : [part.material];
      materials.forEach(mat => {
        if (!mat) return;
        if (mat.transparent && 'depthWrite' in mat) mat.depthWrite = false;
        if ('needsUpdate' in mat) mat.needsUpdate = true;
      });
    });
    return model;
  }

  function applyStaticModel(holder, key, opts = {}) {
    clearObjectChildren(holder);
    if (usesFastModuleBlockRenderer(key)) {
      const model = createFastModuleBlockModel(key, opts);
      if (model) {
        holder.add(model);
        if (typeof opts.afterApply === 'function') opts.afterApply(holder, model, key, opts);
      }
      return;
    }
    const model = key === 'barrel' ? cloneBarrelModel(opts.bodyMat) : cloneStaticModel(key);
    if (model) {
      applyStaticModelInstanceOptions(model, opts);
      holder.add(model);
      if (typeof opts.afterApply === 'function') opts.afterApply(holder, model, key, opts);
      return;
    }
    const state = staticModelState(key);
    if (!state.pending.some(entry => entry.holder === holder)) {
      state.pending.push({ holder, opts });
    }
    requestStaticModel(key);
  }

  function requestStaticModel(key) {
    if (usesFastModuleBlockRenderer(key)) return;
    const url = STATIC_MODEL_URLS[key];
    if (!url) return;
    const state = staticModelState(key);
    if (state.source || state.loading || state.failed) return;
    if (!THREE.GLTFLoader) {
      state.failed = true;
      console.warn('GLTFLoader is unavailable; static GLB models cannot be loaded.');
      return;
    }
    state.loading = true;
    const loader = new THREE.GLTFLoader();
    loader.load(url, gltf => {
      const source = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
      state.source = prepareStaticModelObject(source || null);
      state.loading = false;
      const pending = state.pending.splice(0);
      pending.forEach(entry => {
        if (entry && entry.holder && entry.holder.parent) applyStaticModel(entry.holder, key, entry.opts || {});
      });
    }, undefined, err => {
      state.loading = false;
      state.failed = true;
      state.pending.length = 0;
      console.warn('Failed to load static GLB model:', key, err);
    });
  }

  function makeStaticModelGroup(key, x, z, angle = 0, kind = key, opts = {}) {
    const group = new THREE.Group();
    group.name = `static_glb_${key}`;
    group.userData.kind = kind;
    group.userData.staticModelKey = key;
    group.position.set(x, opts.y || 0, z);
    group.rotation.y = angle;
    const sx = opts.scaleX !== undefined ? opts.scaleX : (opts.scale || 1);
    const sy = opts.scaleY !== undefined ? opts.scaleY : (opts.scale || 1);
    const sz = opts.scaleZ !== undefined ? opts.scaleZ : (opts.scale || 1);
    group.scale.set(sx, sy, sz);
    const modelSlot = new THREE.Group();
    modelSlot.name = `static_glb_slot_${key}`;
    group.userData.staticModelSlot = modelSlot;
    group.add(modelSlot);
    applyStaticModel(modelSlot, key, opts);
    return group;
  }

  function createStaticSetDressing(key, x, z, angle = 0, kind = key, opts = {}) {
    const group = makeStaticModelGroup(key, x, z, angle, kind, opts);
    return registerSetDressingGroup(group, x, z, kind);
  }

  function createStaticObstacleModel(key, x, z, angle = 0, kind = key, cullKind = 'static-obstacle', opts = {}) {
    const group = makeStaticModelGroup(key, x, z, angle, kind, opts);
    worldGroup.add(group);
    obstacleMeshes.push(group);
    const tt = worldToTile(x, z);
    staticCullObjects.push({ object: group, tx: tt.tx, tz: tt.tz, kind: cullKind });
    if (opts.registerCollision !== false) {
      group.userData.staticCollisionBox = addStaticModelCollision(key, x, z, angle, opts, kind || key);
    }
    return group;
  }

  function staticModelKeyFromLocationObject(row = {}) {
    const model = String(row.model || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (model && STATIC_MODEL_URLS[model]) return model;
    const url = String(row.url || row.file || '');
    if (!url) return '';
    const normalized = url.replace(/\\/g, '/').split('/').pop();
    const match = Object.entries(STATIC_MODEL_URLS).find(([, value]) => String(value || '').replace(/\\/g, '/').endsWith('/' + normalized));
    return match ? match[0] : '';
  }

  function locationObjectIsEntity(row = {}) {
    const tags = (Array.isArray(row.tags) ? row.tags : []).map(tag => String(tag || '').toLowerCase());
    const entityKind = String(row.entity?.kind || row.entity || '').toLowerCase();
    const interactiveKind = String(row.interactive?.kind || '').toLowerCase();
    const model = String(row.model || '').toLowerCase();
    if (entityKind === 'jobboard' || interactiveKind === 'jobboard' || tags.includes('jobboard') || tags.includes('questboard')) return false;
    if (entityKind === 'trademachine' || interactiveKind === 'trademachine' || tags.includes('trademachine') || tags.includes('vendingmachine')) return false;
    if (entityKind === 'craftingstation' || interactiveKind === 'craftingstation' || tags.includes('crafting-station')) return false;
    return !!entityKind
      || tags.some(tag => ['npc', 'enemy', 'monster', 'player', 'living'].includes(tag))
      || /^(enemy|npc|tradernpc|caravanmerchant|caravanguard|klimpatrolguard|wastelandsettler)/i.test(model);
  }

  function locationUsesAuthoredLayout(loc = currentLocation) {
    return !!(loc
      && loc.runtimeMode !== 'procedural'
      && loc.runtimeMode !== 'worldSiteInstance'
      && loc.worldSiteInstance !== true
      && loc.legacyProcedural !== true
      && (loc.authored === true || loc.schema === 'realm.location.v1' || Array.isArray(loc.objects)));
  }

  function authoredObjectUsesModuleGrid(row = {}) {
    const key = staticModelKeyFromLocationObject(row);
    return !!(key && (
      isWallBuildingBlockKey(key)
      || isFloorBuildingBlockKey(key)
      || isRoofBuildingBlockKey(key)
    ));
  }

  function authoredObjectScale(row = {}) {
    if (authoredObjectUsesModuleGrid(row)) return { x: 1, y: 1, z: 1 };
    const scale = row.scale && typeof row.scale === 'object' ? row.scale : {};
    const uniform = Number(row.scale || 1);
    return {
      x: Number.isFinite(Number(scale.x)) ? Number(scale.x) : (Number.isFinite(uniform) ? uniform : 1),
      y: Number.isFinite(Number(scale.y)) ? Number(scale.y) : (Number.isFinite(uniform) ? uniform : 1),
      z: Number.isFinite(Number(scale.z)) ? Number(scale.z) : (Number.isFinite(uniform) ? uniform : 1)
    };
  }

  function authoredObjectCollisionSize(row = {}) {
    const key = staticModelKeyFromLocationObject(row);
    const bounds = key ? staticModelColliderBounds(key) : null;
    if (bounds) {
      const scale = authoredObjectScale(row);
      return {
        width: Number(bounds.size.x) * Math.abs(scale.x),
        depth: Number(bounds.size.z) * Math.abs(scale.z)
      };
    }
    const exact = row.collisionSize && typeof row.collisionSize === 'object' ? row.collisionSize : {};
    const exactWidth = Number(exact.width || exact.x || 0);
    const exactDepth = Number(exact.depth || exact.z || 0);
    if (Number.isFinite(exactWidth) && exactWidth > 0 && Number.isFinite(exactDepth) && exactDepth > 0) {
      return {
        width: Math.max(0.4, exactWidth),
        depth: Math.max(0.4, exactDepth)
      };
    }
    const placement = row.placement && typeof row.placement === 'object' ? row.placement : {};
    const cells = placement.cells && typeof placement.cells === 'object' ? placement.cells : {};
    const footprint = row.footprint && typeof row.footprint === 'object' ? row.footprint : {};
    const scale = authoredObjectScale(row);
    const cellW = Number(cells.x || 0) > 0 ? Number(cells.x) * TILE : 0;
    const cellD = Number(cells.z || 0) > 0 ? Number(cells.z) * TILE : 0;
    return {
      width: Math.max(0.45, cellW || Number(footprint.x || 0) || Math.max(1, Math.abs(scale.x)) * TILE),
      depth: Math.max(0.45, cellD || Number(footprint.z || 0) || Math.max(1, Math.abs(scale.z)) * TILE)
    };
  }

  function authoredObjectTags(row = {}) {
    return (Array.isArray(row.tags) ? row.tags : [])
      .map(tag => String(tag || '').toLowerCase())
      .filter(Boolean);
  }

  function authoredObjectResourceType(row = {}) {
    const tags = authoredObjectTags(row);
    const collision = String(row.collision || '').toLowerCase();
    const model = String(row.model || row.url || '').toLowerCase();
    const explicitRaw = String(row.resourceType || row.resource || '').trim().toLowerCase();
    const explicit = explicitRaw === 'ammoparts' ? 'ammoParts' : explicitRaw === 'weaponparts' ? 'weaponParts' : explicitRaw;
    const supported = ['ore', 'wood', 'scrap', 'water', 'oil', 'chemicals', 'medicine', 'food', 'electronics', 'ammoParts', 'weaponParts'];
    if (supported.includes(explicit)) return explicit;
    const candidate = collision === 'resource' || tags.includes('resource') || tags.includes('harvestable') || tags.includes('resource-node');
    if (!candidate) return '';
    if (tags.includes('oil') || model.includes('oil_pump') || model.includes('oilpump')) return 'oil';
    if (tags.includes('scrap') || model.includes('scrap')) return 'scrap';
    if (tags.includes('water') || model.includes('water_tank') || model.includes('watertank')) return 'water';
    if (tags.includes('ore') || model.includes('ore')) return 'ore';
    if (tags.includes('wood') || model.includes('deadwood') || (collision === 'resource' && tags.includes('tree'))) return 'wood';
    return '';
  }

  function authoredResourceObjectIsVisible(row = {}) {
    const type = authoredObjectResourceType(row);
    if (!type) return true;
    const authoritativeLocation = typeof authoritativeResourceSnapshotLocationId === 'string'
      ? authoritativeResourceSnapshotLocationId
      : '';
    if (!currentLocation || authoritativeLocation !== String(currentLocation.id || '')) return true;
    const id = String(row.id || '');
    return Array.isArray(resourceNodes) && resourceNodes.some(resource => resource
      && String(resource.id || '') === id
      && Number(resource.hp || 0) > 0);
  }

  function authoredObjectIsJobBoard(row = {}) {
    const tags = authoredObjectTags(row);
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const entityKind = String(entity.kind || '').toLowerCase();
    const interactiveKind = String(interactive.kind || '').toLowerCase();
    const role = String(entity.role || interactive.role || row.role || '').toLowerCase();
    const model = String(row.model || row.url || '').toLowerCase();
    return entityKind === 'jobboard'
      || interactiveKind === 'jobboard'
      || role === 'jobboard'
      || role === 'worldtaskboard'
      || tags.includes('jobboard')
      || tags.includes('questboard')
      || model.includes('jobboard')
      || model.includes('job_board');
  }

  function authoredObjectIsTradeMachine(row = {}) {
    const tags = authoredObjectTags(row);
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const entityKind = String(entity.kind || '').toLowerCase();
    const interactiveKind = String(interactive.kind || '').toLowerCase();
    const role = String(entity.role || interactive.role || row.role || '').toLowerCase();
    const model = String(row.model || row.url || '').toLowerCase();
    return entityKind === 'trademachine'
      || interactiveKind === 'trademachine'
      || role === 'trademachine'
      || tags.includes('trademachine')
      || tags.includes('vendingmachine')
      || model.includes('trademachine')
      || model.includes('trade_machine');
  }

  function authoredCraftingStationIds(row = {}) {
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const values = [
      row.craftingStation,
      row.stationType,
      row.workstation,
      row.craftingStations,
      row.stationTypes,
      row.workstationTypes,
      entity.craftingStation,
      entity.stationType,
      entity.workstation,
      entity.craftingStations,
      entity.stationTypes,
      entity.workstationTypes,
      interactive.craftingStation,
      interactive.stationType,
      interactive.workstation,
      interactive.craftingStations,
      interactive.stationTypes,
      interactive.workstationTypes
    ];
    const ids = [];
    const append = value => {
      if (Array.isArray(value)) {
        value.forEach(append);
        return;
      }
      if (typeof value !== 'string') return;
      value.split(/[\s,;|]+/).forEach(part => {
        const id = String(part || '').trim().toLowerCase();
        if (id && !ids.includes(id)) ids.push(id);
      });
    };
    values.forEach(append);
    return ids;
  }

  function authoredObjectIsCraftingStation(row = {}) {
    const tags = authoredObjectTags(row);
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const entityKind = String(entity.kind || '').toLowerCase();
    const interactiveKind = String(interactive.kind || '').toLowerCase();
    const role = String(entity.role || interactive.role || row.role || '').toLowerCase();
    return entityKind === 'craftingstation'
      || interactiveKind === 'craftingstation'
      || role === 'craftingstation'
      || tags.includes('crafting-station')
      || authoredCraftingStationIds(row).length > 0;
  }

  const DEFAULT_TRADE_MACHINE_PROFILE = {
    caps: 350,
    buyInterests: ['materials', 'tools', 'aid', 'ammo'],
    stock: [
      { id: 'water', price: 6, qty: 12 },
      { id: 'stim', price: 13, qty: 6 },
      { id: 'medkit', price: 24, qty: 3 },
      { id: 'ammo9', price: 3, qty: 90 },
      { id: 'ammo556', price: 5, qty: 60 },
      { id: 'shotgunShell', price: 6, qty: 24 },
      { id: 'napalm', price: 7, qty: 18 },
      { id: 'repairKit', price: 22, qty: 3 },
      { id: 'oil', price: 10, qty: 5 }
    ]
  };

  function authoredTradeMachineStock(row = {}) {
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const traderProfile = String(interactive.traderProfile || entity.traderProfile || 'outpostMachine').trim();
    const stockSource = Array.isArray(interactive.stock)
      ? interactive.stock
      : (Array.isArray(entity.stock)
        ? entity.stock
        : (traderProfile === 'outpostMachine' ? DEFAULT_TRADE_MACHINE_PROFILE.stock : []));
    return stockSource
      .map(entry => ({
        id: String(entry?.id || '').trim(),
        price: Math.max(1, Math.round(Number(entry?.price || 1))),
        qty: Number.isFinite(Number(entry?.qty)) ? Math.max(0, Math.floor(Number(entry.qty))) : 1
      }))
      .filter(entry => entry.id && entry.price > 0 && entry.qty > 0)
      .slice(0, 48);
  }

  function authoredObjectOcclusionRole(row = {}) {
    return String(row.occlusion?.role || '').toLowerCase();
  }

  function authoredObjectAllowsPlayerOverlap(row = {}) {
    const explicit = String(row.playerCollision ?? row.movementCollision ?? '').trim().toLowerCase();
    if (row.playerCollision === false || ['none', 'off', 'disabled', 'pass', 'pass-through', 'passthrough'].includes(explicit)) return true;
    const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
    const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
    const kinds = [interactive.kind, entity.kind, row.kind]
      .map(value => String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase())
      .filter(Boolean);
    const tags = [
      ...authoredObjectTags(row),
      ...authoredObjectTags(entity),
      ...authoredObjectTags(interactive)
    ];
    return kinds.some(kind => ['craftingstation', 'jobboard', 'trademachine', 'vendingmachine', 'container', 'storage'].includes(kind))
      || tags.some(tag => [
        'interactive', 'crafting-station', 'jobboard', 'questboard', 'trademachine',
        'vendingmachine', 'container', 'storage', 'personal-storage', 'ground-item',
        'loot-item', 'pickup', 'pass-through', 'no-player-collision'
      ].includes(tag));
  }

  function authoredObjectModelVisionRule(row = {}) {
    const key = staticModelKeyFromLocationObject(row);
    if (key && STATIC_MODEL_VISION_RULES[key]) return STATIC_MODEL_VISION_RULES[key];
    const model = String(row.model || '').replace(/[^a-zA-Z0-9_-]/g, '');
    return model && STATIC_MODEL_VISION_RULES[model] ? STATIC_MODEL_VISION_RULES[model] : null;
  }

  function visionKindFromConfig(vision = null) {
    if (!vision || typeof vision !== 'object') return null;
    const mode = String(vision.mode || vision.kind || '').toLowerCase();
    if (vision.blocks === true || mode === 'block' || mode === 'blocking') return 'block';
    if (vision.cover === true || vision.lowCover === true || mode === 'cover' || mode === 'low-cover') return 'cover';
    if (vision.blocks === false || mode === 'none' || mode === 'clear') return '';
    return null;
  }

  function authoredObjectBlocksMovement(row = {}) {
    const collision = String(row.collision || '').toLowerCase();
    const role = authoredObjectOcclusionRole(row);
    const tags = authoredObjectTags(row);
    if (role === 'roof' || role === 'floor' || tags.includes('roof') || tags.includes('floor')) return false;
    if (authoredObjectAllowsPlayerOverlap(row)) return false;
    // `cover` affects sight and ballistics, but is deliberately passable for
    // movement. Treating it as a wall made every barrel/cargo prop shove the
    // character back through authoritative movement correction.
    return ['solid', 'block', 'blocked', 'wall', 'resource'].includes(collision);
  }

  function authoredObjectVisionKind(row = {}) {
    const modelVision = authoredObjectModelVisionRule(row);
    const modelVisionKind = visionKindFromConfig(modelVision);
    if (modelVisionKind === '') return '';

    const vision = row.vision && typeof row.vision === 'object' ? row.vision : null;
    const explicitVisionKind = visionKindFromConfig(vision);
    if (explicitVisionKind !== null) return explicitVisionKind;

    if (modelVisionKind !== null) return modelVisionKind;

    const occlusion = row.occlusion && typeof row.occlusion === 'object' ? row.occlusion : null;
    const role = authoredObjectOcclusionRole(row);
    if (occlusion?.losBlocking === false || role === 'window' || role === 'roof' || role === 'floor') return '';
    if (role === 'wall') return 'block';

    const tags = authoredObjectTags(row);
    const collision = String(row.collision || '').toLowerCase();
    const model = String(row.model || row.url || '').toLowerCase();
    if (tags.includes('window') || tags.includes('roof') || tags.includes('floor')) return '';
    if (tags.includes('wall') || collision === 'wall' || collision === 'block' || collision === 'blocked') return 'block';
    if (collision === 'cover') return 'cover';
    if (tags.includes('ore') || tags.includes('wood') || model.includes('ore') || model.includes('deadwood')) return 'cover';
    return '';
  }

  function addAuthoredObjectCollision(row = {}, x = 0, z = 0, angle = 0) {
    if (!authoredObjectBlocksMovement(row)) return null;
    const key = staticModelKeyFromLocationObject(row);
    const scale = authoredObjectScale(row);
    const modelRef = key || row.url || row.file || '';
    const modelEntry = staticModelCatalogEntry(modelRef);
    const colliders = addStaticModelCollision(modelRef, x, z, angle, {
      scaleX: scale.x,
      scaleZ: scale.z
    }, row.id || row.model || 'authored-object');
    if (modelEntry) return colliders;
    const size = authoredObjectCollisionSize(row);
    return addStaticCollisionBox(x, z, size.width, size.depth, row.id || row.model || 'authored-object', angle);
  }

  function registerAuthoredTraderCutawayBlock(group, row = {}, key = '', x = 0, y = 0, z = 0, angle = 0) {
    if (!group || !key) return;
    const tags = (Array.isArray(row.tags) ? row.tags : []).map(tag => String(tag || '').toLowerCase());
    const cutawayTagged = tags.includes('trader-cutaway') || tags.includes('wall') || tags.includes('window') || tags.includes('roof');
    if (!cutawayTagged) return;
    const size = authoredObjectCollisionSize(row);
    if (isRoofBuildingBlockKey(key)) {
      const roofHeight = Math.max(0.04, Number(row.building?.height || row.occlusion?.thickness || row.footprint?.y || 0.20));
      group.userData.traderAuthoredRoofBlock = true;
      group.userData.traderWorldTileSized = true;
      group.userData.traderRoofWorldX = Number(x || 0);
      group.userData.traderRoofWorldZ = Number(z || 0);
      group.userData.traderRoofSizeX = Math.max(0.1, Number(size.width || TILE || 2));
      group.userData.traderRoofSizeZ = Math.max(0.1, Number(size.depth || TILE || 2));
      group.userData.traderRoofSizeY = roofHeight;
      group.userData.traderRoofWorldY = Number(y || 0) + roofHeight * 0.5;
      group.userData.traderRoofOpacity = 1.0;
      group.userData.kind = row.id || key;
      group.castShadow = false;
      group.receiveShadow = false;
      group.userData.forceNoShadow = true;
      traderBuildingAuthoredRoofBlocks.push(group);
      invalidateTraderShellBoundsCache();
      requestTraderRoofCutawayRefresh('authored-roof-block-registered');
      return;
    }
    if (!isWallBuildingBlockKey(key)) return;
    const sin = Math.abs(Math.sin(angle));
    const orientation = sin > 0.55 ? 'side' : 'front';
    const label = orientation === 'side'
      ? (Number(x || 0) < 0 ? 'left' : 'right')
      : (Number(z || 0) < 0 ? 'back' : 'front');
    group.userData.traderWallBlock = true;
    group.userData.traderWorldTileSized = true;
    group.userData.traderWallLocalX = Number(x || 0);
    group.userData.traderWallLocalZ = Number(z || 0);
    group.userData.traderWallWorldX = Number(x || 0);
    group.userData.traderWallWorldZ = Number(z || 0);
    group.userData.traderWallSizeX = Math.max(0.1, Number(size.width || TILE || 2));
    group.userData.traderWallSizeZ = Math.max(0.1, Number(size.depth || TILE || 2));
    group.userData.traderWallSizeY = Math.max(0.1, Number(row.building?.height || row.occlusion?.topY || 1));
    group.userData.traderWallBlockSize = Math.max(0.5, Number(row.placement?.gridStep || TILE || 2));
    group.userData.traderWallRow = 0;
    group.userData.traderWallBottomY = Number(y || 0);
    group.userData.traderWallTopY = Number(y || 0) + group.userData.traderWallSizeY;
    group.userData.traderWallOpacity = 1.0;
    group.userData.kind = `${row.id || key}-${label}-wall`;
    if (key === 'traderWindowBlock') {
      group.userData.traderWindowWallBlock = true;
      group.userData.traderAlwaysTranslucent = true;
      group.userData.traderBaseOpacity = 0.42;
    }
    traderBuildingWallBlocks.push(group);
    invalidateTraderWallCutawayCache();
  }

  function authoredModuleObjectCanBeBatched(row = {}, key = '') {
    if (!key || !usesFastModuleBlockRenderer(key)) return false;
    // Module-grid blocks are the hottest authored-location case. Collision,
    // LOS and cutaway still use one logical proxy per block; visible geometry
    // is drawn through InstancedMesh. When one wall/roof must fade, that single
    // instance is temporarily replaced by a lightweight transparent copy.
    if (!(isFloorBuildingBlockKey(key) || isWallBuildingBlockKey(key) || isRoofBuildingBlockKey(key))) return false;
    if (locationObjectIsEntity(row)) return false;
    if (authoredObjectIsJobBoard(row) || authoredObjectIsTradeMachine(row)) return false;
    return true;
  }

  function queueAuthoredModuleBatch(batches, row = {}, key = '') {
    if (!batches || !key) return;
    if (!batches.has(key)) batches.set(key, []);
    batches.get(key).push(row);
  }

  function createAuthoredModuleBatchProxy(row = {}, key = '', batchData = {}) {
    const pos = row.position && typeof row.position === 'object' ? row.position : row;
    const rot = row.rotation && typeof row.rotation === 'object' ? row.rotation : {};
    const proxy = new THREE.Object3D();
    proxy.name = `fast_module_proxy_${row.id || key}`;
    proxy.position.set(Number(pos.x || 0), Number(pos.y || 0), Number(pos.z || 0));
    proxy.rotation.y = Number(rot.y ?? row.rotationY ?? 0);
    proxy.userData = {
      kind: row.id || key,
      locationObjectId: row.id || '',
      locationObject: row,
      collision: row.collision || '',
      vision: row.vision || authoredObjectModelVisionRule(row) || null,
      occlusion: row.occlusion || null,
      blocksVision: authoredObjectVisionKind(row) === 'block',
      lowVisionCover: authoredObjectVisionKind(row) === 'cover',
      fastModuleBatchProxy: true,
      instancedOccluderBatch: batchData
    };
    return proxy;
  }

  function flushAuthoredModuleBatches(batches) {
    if (!batches || !batches.size || !THREE.InstancedMesh) return;
    batches.forEach((batchRows, key) => {
      const rows = Array.isArray(batchRows) ? batchRows.filter(Boolean) : [];
      if (!rows.length) return;
      const geometry = fastModuleBlockGeometry(key);
      if (!geometry) return;
      const batchGeometry = geometry.clone ? markDisposableGeometry(geometry.clone()) : geometry;
      const material = fastModuleBatchMaterial(key, rows);
      const mesh = new THREE.InstancedMesh(batchGeometry, material, rows.length);
      mesh.name = `fast_module_batch_${key}_${currentLocation?.id || 'location'}`;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.kind = `fast-module-batch-${key}`;
      mesh.userData.fastModuleBatch = true;
      mesh.userData.fastModuleBatchKey = key;
      mesh.userData.forceNoShadow = true;

      const opacityArray = new Float32Array(rows.length);
      const InstancedAttribute = THREE.InstancedBufferAttribute || THREE.BufferAttribute;
      const opacityAttribute = new InstancedAttribute(opacityArray, 1);
      if (batchGeometry && typeof batchGeometry.setAttribute === 'function') {
        batchGeometry.setAttribute('instanceOpacity', opacityAttribute);
      } else if (typeof setGeometryAttributeCompat === 'function') {
        setGeometryAttributeCompat(batchGeometry, 'instanceOpacity', opacityAttribute);
      }

      const matrix = new THREE.Matrix4();
      const hiddenMatrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scaleVector = new THREE.Vector3();
      const hiddenScale = new THREE.Vector3(0.0001, 0.0001, 0.0001);
      const up = new THREE.Vector3(0, 1, 0);
      const baseSize = fastModuleBlockBaseSize(key) || { y: 0 };

      rows.forEach((row, index) => {
        const pos = row.position && typeof row.position === 'object' ? row.position : row;
        const rot = row.rotation && typeof row.rotation === 'object' ? row.rotation : {};
        const scale = authoredObjectScale(row);
        const x = Number(pos.x || 0);
        const y = Number(pos.y || 0) + Math.max(0, Number(baseSize.y || 0)) * 0.5 * Math.max(0.001, Number(scale.y || 1));
        const z = Number(pos.z || 0);
        const angle = Number(rot.y ?? row.rotationY ?? 0);
        position.set(x, y, z);
        quaternion.setFromAxisAngle(up, angle);
        scaleVector.set(
          Math.max(0.001, Number(scale.x || 1)),
          Math.max(0.001, Number(scale.y || 1)),
          Math.max(0.001, Number(scale.z || 1))
        );
        matrix.compose(position, quaternion, scaleVector);
        mesh.setMatrixAt(index, matrix);
        opacityArray[index] = authoredModuleInitialOpacity(row, key);

        if (isWallBuildingBlockKey(key) || isRoofBuildingBlockKey(key)) {
          hiddenMatrix.compose(position, quaternion, hiddenScale);
          const proxy = createAuthoredModuleBatchProxy(row, key, {
            mesh,
            opacityAttribute,
            index,
            key,
            originalMatrix: matrix.clone(),
            hiddenMatrix: hiddenMatrix.clone(),
            position: position.clone(),
            quaternion: quaternion.clone(),
            scale: scaleVector.clone(),
            opacity: opacityArray[index]
          });
          registerAuthoredTraderCutawayBlock(proxy, row, key, x, Number(pos.y || 0), z, angle);
        }
        addAuthoredObjectCollision(row, x, z, angle);
      });
      if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
      opacityAttribute.needsUpdate = true;
      worldGroup.add(mesh);
    });
  }

  function createAuthoredLocationObjects() {
    if (!locationUsesAuthoredLayout(currentLocation)) return false;
    const rows = Array.isArray(currentLocation.objects) ? currentLocation.objects : [];
    const moduleBatches = new Map();
    rows.forEach(row => {
      if (!row || typeof row !== 'object' || locationObjectIsEntity(row)) return;
      if (!authoredResourceObjectIsVisible(row)) return;
      if (currentLocation.storage && row.model === 'storageChest') return;
      const key = staticModelKeyFromLocationObject(row);
      if (!key) return;
      if (authoredModuleObjectCanBeBatched(row, key)) {
        queueAuthoredModuleBatch(moduleBatches, row, key);
        return;
      }
      const pos = row.position && typeof row.position === 'object' ? row.position : row;
      const rot = row.rotation && typeof row.rotation === 'object' ? row.rotation : {};
      const scale = authoredObjectScale(row);
      const x = Number(pos.x || 0);
      const y = Number(pos.y || 0);
      const z = Number(pos.z || 0);
      const angle = Number(rot.y ?? row.rotationY ?? 0);
      const opts = {
        y,
        scaleX: scale.x,
        scaleY: scale.y,
        scaleZ: scale.z,
        cloneMaterials: true,
        registerCollision: false
      };
      const visionKind = authoredObjectVisionKind(row);
      const modelVision = authoredObjectModelVisionRule(row);
      const group = authoredObjectBlocksMovement(row)
        ? createStaticObstacleModel(key, x, z, angle, row.id || key, 'authored-location-object', opts)
        : createStaticSetDressing(key, x, z, angle, row.id || key, opts);
      group.userData.locationObjectId = row.id || '';
      group.userData.locationObject = row;
      group.userData.collision = row.collision || '';
      group.userData.vision = row.vision || modelVision || null;
      group.userData.occlusion = row.occlusion || null;
      group.userData.blocksVision = visionKind === 'block';
      group.userData.lowVisionCover = visionKind === 'cover';
      const resourceType = authoredObjectResourceType(row);
      if (resourceType) {
        const resource = resourceNodes.find(node => String(node?.id || '') === String(row.id || ''));
        if (resource) {
          resource.mesh = group;
          group.userData.resource = resource;
        }
      }
      if (authoredObjectIsJobBoard(row)) {
        const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
        const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
        const board = {
          id: String(row.id || `job_board_${locationJobBoards.length + 1}`).slice(0, 96),
          name: String(row.name || interactive.name || entity.name || 'Доска заданий').slice(0, 80),
          siteId: String(interactive.boardSiteId || entity.boardSiteId || row.boardSiteId || currentLocation?.worldSiteId || currentLocation?.id || '').slice(0, 80),
          x,
          z,
          mesh: group,
          row
        };
        group.userData.jobBoard = board;
        locationJobBoards.push(board);
      }
      if (authoredObjectIsCraftingStation(row)) {
        const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
        const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
        const station = {
          id: String(row.id || `crafting_station_${locationCraftingStations.length + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96),
          name: String(row.name || interactive.name || entity.name || '\u0420\u0430\u0431\u043e\u0447\u0438\u0439 \u0441\u0442\u0430\u043d\u043e\u043a').slice(0, 80),
          x,
          z,
          mesh: group,
          locationId: currentLocation?.id || '',
          siteId: String(interactive.stationSiteId || entity.stationSiteId || row.stationSiteId || currentLocation?.worldSiteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
          craftingStations: authoredCraftingStationIds(row),
          row
        };
        group.userData.craftingStation = station;
        group.traverse(child => {
          child.userData = child.userData || {};
          child.userData.craftingStation = station;
        });
        locationCraftingStations.push(station);
      }
      if (authoredObjectIsTradeMachine(row)) {
        const entity = row.entity && typeof row.entity === 'object' ? row.entity : {};
        const interactive = row.interactive && typeof row.interactive === 'object' ? row.interactive : {};
        const traderProfile = String(interactive.traderProfile || entity.traderProfile || 'outpostMachine').slice(0, 64);
        const profileDefaults = traderProfile === 'outpostMachine' ? DEFAULT_TRADE_MACHINE_PROFILE : { caps: 0, buyInterests: [] };
        const caps = Number.isFinite(Number(interactive.caps ?? entity.caps))
          ? Math.max(0, Math.floor(Number(interactive.caps ?? entity.caps)))
          : profileDefaults.caps;
        const buyInterests = Array.isArray(interactive.buyInterests)
          ? interactive.buyInterests
          : (Array.isArray(entity.buyInterests) ? entity.buyInterests : profileDefaults.buyInterests);
        const machine = {
          id: String(row.id || `trade_machine_${locationTradeMachines.length + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96),
          name: String(row.name || interactive.name || entity.name || 'Торговый автомат').slice(0, 80),
          x,
          z,
          mesh: group,
          locationId: currentLocation?.id || '',
          isTradeMachine: true,
          hostileToPlayer: false,
          encounterRole: 'merchant',
          traderId: String(interactive.traderId || entity.traderId || traderProfile || row.id || 'outpost_machine').slice(0, 64),
          traderProfile,
          siteId: String(interactive.siteId || interactive.marketSiteId || entity.siteId || entity.marketSiteId || row.siteId || row.marketSiteId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
          dialogueProfile: 'tradeMachine',
          traderCaps: caps,
          traderBuyInterests: buyInterests.map(value => String(value || '')).filter(Boolean),
          traderStock: authoredTradeMachineStock(row),
          inventory: caps > 0 ? [{ id: 'silver', qty: caps }] : [],
          row
        };
        group.userData.tradeMachine = machine;
        group.traverse(child => {
          child.userData = child.userData || {};
          child.userData.tradeMachine = machine;
        });
        locationTradeMachines.push(machine);
      }
      registerAuthoredTraderCutawayBlock(group, row, key, x, y, z, angle);
      group.userData.staticCollisionBox = addAuthoredObjectCollision(row, x, z, angle);
    });
    flushAuthoredModuleBatches(moduleBatches);
    return true;
  }

  Object.keys(STATIC_MODEL_URLS).forEach(requestStaticModel);

  // v7.74.40: terrain-specific moonlit night response. The base relief ground, road/dust
  // decals and baked AO now get a mild warm moonlit tint at night. This is not
  // a heavy fullscreen darkener; only terrain layers are corrected, so the
  // lокация remains playable and brighter than the old black-night variant.
  registerDayNightTerrainMaterial(mats.settlementBack, { dayColor: 0xffffff, nightColor: 0xb99b70 });
  registerDayNightTerrainMaterial(mats.wastelandBack, { dayColor: 0xffffff, nightColor: 0xb79a70 });
  registerDayNightTerrainMaterial(mats.grassA, { nightColor: 0xb6986d });
  registerDayNightTerrainMaterial(mats.grassB, { nightColor: 0xb69970 });
  registerDayNightTerrainMaterial(mats.darkGrass, { nightColor: 0x8f7355 });
  registerDayNightTerrainMaterial(mats.path, { nightColor: 0xb99667 });
  registerDayNightTerrainMaterial(mats.traderLayerSand, { dayColor: 0xffffff, nightColor: 0xb69a72, nightOpacity: 0.78 });
  registerDayNightTerrainMaterial(mats.traderLayerCracks, { dayColor: 0xffffff, nightColor: 0xa78a67, nightOpacity: 0.68 });
  registerDayNightTerrainMaterial(mats.traderLayerGravel, { dayColor: 0xffffff, nightColor: 0xa98e6b, nightOpacity: 0.74 });
  registerDayNightTerrainMaterial(mats.traderLayerTire, { dayColor: 0xffffff, nightColor: 0x907861, nightOpacity: 0.66 });
  registerDayNightTerrainMaterial(mats.traderLayerOil, { dayColor: 0xffffff, nightColor: 0x766452, nightOpacity: 0.52 });
  registerDayNightTerrainMaterial(mats.traderLayerRoad, { dayColor: 0xffffff, nightColor: 0xb49a72, nightOpacity: 0.64 });
  registerDayNightTerrainMaterial(mats.traderLayerShadow, { dayColor: 0xffffff, nightColor: 0xc0a37a, nightOpacity: 0.46 });
  registerDayNightTerrainMaterial(mats.traderContactAO, { dayColor: 0xffffff, nightColor: 0xbda17a, nightOpacity: 0.64 });
  // The lantern glow becomes more visible at night, instead of being dimmed
  // together with the ground. It gives the trader yard a readable focal point.
  registerDayNightTerrainMaterial(mats.traderWarmGlow, { dayColor: 0xffb45d, nightColor: 0xffd18a, dayOpacity: 0.42, nightOpacity: 0.72 });

  const detailPlaneGeom = markSharedGeometry(new THREE.PlaneGeometry(1, 1));
  const pebbleGeom = markSharedGeometry(new THREE.DodecahedronGeometry(0.075, 0));
  const grassBladeGeom = markSharedGeometry(new THREE.ConeGeometry(0.027, 0.48, 5));

