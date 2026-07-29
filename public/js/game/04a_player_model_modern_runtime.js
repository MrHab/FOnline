  // ===== MODERN PLAYER CHARACTER RUNTIME =====
  // Выразительный стилизованный персонаж с бюджетом современного low-poly:
  // общие геометрии/материалы, крупные читаемые формы и шарнирный риг без GLB.
  const modernCharacterGeometryCache = new Map();

  function modernCharacterGeometry(type, values = []) {
    const rounded = values.map(value => Number(Number(value || 0).toFixed(4)));
    const key = `${type}:${rounded.join(':')}`;
    if (modernCharacterGeometryCache.has(key)) return modernCharacterGeometryCache.get(key);
    let geometry = null;
    if (type === 'box') geometry = new THREE.BoxGeometry(rounded[0], rounded[1], rounded[2]);
    else if (type === 'cylinder') geometry = new THREE.CylinderGeometry(rounded[0], rounded[1], rounded[2], rounded[3] || 6);
    else if (type === 'sphere') geometry = new THREE.SphereGeometry(rounded[0], rounded[1] || 10, rounded[2] || 7);
    else if (type === 'dodeca') geometry = new THREE.DodecahedronGeometry(rounded[0], rounded[1] || 0);
    if (!geometry) geometry = new THREE.BoxGeometry(1, 1, 1);
    modernCharacterGeometryCache.set(key, geometry);
    return geometry;
  }

  function modernCharacterTexture(name, baseHex, highHex, lowHex, options = {}) {
    const base = splitHexColor(baseHex);
    const high = splitHexColor(highHex);
    const low = splitHexColor(lowHex);
    const kind = String(options.kind || 'fabric');
    return canvasTextureFrom(`modern-actor-${name}-${kind}`, (ctx, size) => {
      ctx.fillStyle = `rgb(${base.r},${base.g},${base.b})`;
      ctx.fillRect(0, 0, size, size);
      if (kind === 'fabric') {
        ctx.globalAlpha = 0.12;
        ctx.lineWidth = 1;
        for (let y = 2; y < size; y += 5) {
          ctx.strokeStyle = y % 10 ? `rgb(${high.r},${high.g},${high.b})` : `rgb(${low.r},${low.g},${low.b})`;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(size, y + 3);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.08;
        for (let x = 3; x < size; x += 7) {
          ctx.strokeStyle = `rgb(${low.r},${low.g},${low.b})`;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x - 2, size);
          ctx.stroke();
        }
      } else if (kind === 'leather') {
        ctx.globalAlpha = 0.15;
        for (let i = 0; i < 24; i++) {
          const x = hash01(i, 41, 7) * size;
          const y = hash01(i, 17, 19) * size;
          const length = 3 + hash01(i, 5, 31) * 10;
          ctx.strokeStyle = i % 3 ? `rgb(${low.r},${low.g},${low.b})` : `rgb(${high.r},${high.g},${high.b})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + length, y + length * 0.18);
          ctx.stroke();
        }
      } else if (kind === 'metal') {
        ctx.globalAlpha = 0.2;
        for (let i = 0; i < 18; i++) {
          const x = hash01(i, 73, 11) * size;
          const y = hash01(i, 29, 23) * size;
          const w = 2 + hash01(i, 13, 37) * 8;
          const h = 1 + hash01(i, 47, 3) * 3;
          ctx.fillStyle = i % 4 ? `rgb(${low.r},${low.g},${low.b})` : `rgb(${high.r},${high.g},${high.b})`;
          ctx.fillRect(x, y, w, h);
        }
        ctx.globalAlpha = 0.14;
        ctx.strokeStyle = `rgb(${high.r},${high.g},${high.b})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(size * 0.08, size * 0.82);
        ctx.lineTo(size * 0.84, size * 0.12);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }, options.size || 96, options.repeat || 1);
  }

  const modernCharacterMats = {
    coat: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('burnt-sienna-coat', 0x8a4d32, 0xb56f48, 0x3d241c, { kind: 'fabric' }),
      roughness: 0.91,
      metalness: 0.01,
      flatShading: true
    }),
    coatDark: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('coat-shadow-panels', 0x593324, 0x7f4c34, 0x281812, { kind: 'fabric' }),
      roughness: 0.93,
      metalness: 0.01,
      flatShading: true
    }),
    cloth: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('blue-charcoal-cloth', 0x263039, 0x3f4a51, 0x11171c, { kind: 'fabric' }),
      roughness: 0.9,
      metalness: 0.02,
      flatShading: true
    }),
    armor: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('muted-teal-armor', 0x496765, 0x73918a, 0x1d302f, { kind: 'metal' }),
      roughness: 0.58,
      metalness: 0.36,
      flatShading: true
    }),
    armorDark: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('dark-painted-armor', 0x303a3b, 0x596364, 0x111718, { kind: 'metal' }),
      roughness: 0.62,
      metalness: 0.4,
      flatShading: true
    }),
    leather: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('dark-worn-leather', 0x3d281d, 0x714932, 0x160e0a, { kind: 'leather' }),
      roughness: 0.86,
      metalness: 0.02,
      flatShading: true
    }),
    scarf: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('dusty-tan-scarf', 0xa48055, 0xc6a675, 0x55402b, { kind: 'fabric' }),
      roughness: 0.95,
      metalness: 0,
      flatShading: true
    }),
    pack: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('muted-olive-canvas', 0x4b543d, 0x72785a, 0x242a1f, { kind: 'fabric' }),
      roughness: 0.94,
      metalness: 0,
      flatShading: true
    }),
    brass: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('aged-brass', 0x9c743b, 0xc99b57, 0x49341c, { kind: 'metal' }),
      roughness: 0.54,
      metalness: 0.54,
      flatShading: true
    }),
    boot: matStandard({
      color: 0xffffff,
      map: modernCharacterTexture('reinforced-boots', 0x242321, 0x4b443a, 0x0c0d0d, { kind: 'leather' }),
      roughness: 0.76,
      metalness: 0.1,
      flatShading: true
    }),
    skin: matStandard({ color: 0xc68c67, roughness: 0.88, metalness: 0, flatShading: true }),
    hair: matStandard({ color: 0x211b18, roughness: 0.92, metalness: 0, flatShading: true }),
    glass: matStandard({
      color: 0x79a45d,
      emissive: 0x183218,
      emissiveIntensity: 0.24,
      roughness: 0.18,
      metalness: 0.12,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
      flatShading: true
    })
  };

  const modernCharacterArmorMats = {
    vest: matStandard({ color: 0x2c343b, roughness: 0.82, metalness: 0.12, flatShading: true }),
    combat: matStandard({ color: 0x536c60, roughness: 0.64, metalness: 0.22, flatShading: true }),
    hazmat: matStandard({ color: 0xa3aa48, roughness: 0.86, metalness: 0.02, flatShading: true }),
    hazmatDark: matStandard({ color: 0x505d2c, roughness: 0.82, metalness: 0.08, flatShading: true }),
    energy: matStandard({ color: 0x315b68, roughness: 0.46, metalness: 0.42, flatShading: true }),
    energyGlow: matStandard({ color: 0x78d6ff, emissive: 0x2ea7ff, emissiveIntensity: 0.92, roughness: 0.22, metalness: 0.24 }),
    visor: matStandard({ color: 0x79d7b2, emissive: 0x1d6255, emissiveIntensity: 0.46, transparent: true, opacity: 0.84, depthWrite: false, roughness: 0.16, metalness: 0.12 }),
    heavy: matStandard({ color: 0x626d6d, roughness: 0.4, metalness: 0.58, flatShading: true }),
    plateDark: modernCharacterMats.armorDark,
    leatherJacket: modernCharacterMats.coat,
    leatherTrim: modernCharacterMats.leather
  };

  const SERVICE_SCOUT_BOOT_MODEL_URL = '/assets/models/equipment/service_scout_boots.glb';
  const serviceScoutBootModelState = {
    promise: null,
    templates: null,
    failed: false
  };

  function buildServiceScoutBootTemplate(source, side) {
    const sourceNode = source?.getObjectByName?.(`SERVICE_SCOUT_BOOT_${side}`);
    if (!sourceNode) return null;
    source.updateMatrixWorld(true);
    const mesh = sourceNode.clone(true);
    sourceNode.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    const template = new THREE.Group();
    template.name = `service_scout_boot_template_${side}`;
    template.add(mesh);
    template.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(template);
    const center = new THREE.Vector3();
    box.getCenter(center);
    template.position.set(-center.x, -box.min.y, -center.z);
    template.traverse(part => {
      if (!part?.isMesh) return;
      part.castShadow = true;
      part.receiveShadow = false;
      part.frustumCulled = false;
    });
    return template;
  }

  function preloadServiceScoutBootModel() {
    if (serviceScoutBootModelState.templates) {
      return Promise.resolve(serviceScoutBootModelState.templates);
    }
    if (serviceScoutBootModelState.promise) return serviceScoutBootModelState.promise;
    if (serviceScoutBootModelState.failed || !THREE.GLTFLoader) return Promise.resolve(null);
    const loader = new THREE.GLTFLoader();
    serviceScoutBootModelState.promise = new Promise(resolve => {
      loader.load(SERVICE_SCOUT_BOOT_MODEL_URL, gltf => {
        const source = gltf?.scene || gltf?.scenes?.[0] || null;
        const templates = source ? {
          L: buildServiceScoutBootTemplate(source, 'L'),
          R: buildServiceScoutBootTemplate(source, 'R')
        } : null;
        if (!templates?.L || !templates?.R) {
          serviceScoutBootModelState.failed = true;
          serviceScoutBootModelState.promise = null;
          console.warn('GLB разведботинок не содержит оба runtime-меша.');
          resolve(null);
          return;
        }
        serviceScoutBootModelState.templates = templates;
        serviceScoutBootModelState.promise = null;
        resolve(templates);
      }, undefined, error => {
        serviceScoutBootModelState.failed = true;
        serviceScoutBootModelState.promise = null;
        console.warn('Не удалось загрузить GLB разведботинок:', error);
        resolve(null);
      });
    });
    return serviceScoutBootModelState.promise;
  }

  function setServiceScoutBootFallbackVisible(parts, visible) {
    ['L', 'R'].forEach(side => {
      if (parts?.[`baseBoot${side}`]) parts[`baseBoot${side}`].visible = !!visible;
      if (parts?.[`baseGaiter${side}`]) parts[`baseGaiter${side}`].visible = !!visible;
      if (parts?.[`boot${side}`]) parts[`boot${side}`].visible = !!visible;
    });
  }

  function installServiceScoutBootInstances(parts) {
    if (!parts?.ankleL || !parts?.ankleR || !serviceScoutBootModelState.templates) return false;
    if (parts.serviceScoutBootL && parts.serviceScoutBootR) return true;
    ['L', 'R'].forEach(side => {
      // После разворота носком вперёд стороны меняются местами.
      const templateSide = side === 'L' ? 'R' : 'L';
      const holder = new THREE.Group();
      holder.name = `service_scout_boot_${side}`;
      holder.add(serviceScoutBootModelState.templates[templateSide].clone(true));
      holder.position.set(0, -0.01, -0.045);
      holder.rotation.y = Math.PI;
      holder.scale.setScalar(1.08);
      holder.visible = false;
      holder.userData.cosmeticLod = false;
      parts[`ankle${side}`].add(holder);
      parts[`serviceScoutBoot${side}`] = holder;
    });
    return true;
  }

  function applyServiceScoutBootVisual(parts, bootsId = '') {
    if (!parts) return false;
    const wanted = bootsId === 'scoutBoots';
    parts.serviceScoutBootWanted = wanted;
    if (!wanted) {
      if (parts.serviceScoutBootL) parts.serviceScoutBootL.visible = false;
      if (parts.serviceScoutBootR) parts.serviceScoutBootR.visible = false;
      return false;
    }
    if (installServiceScoutBootInstances(parts)) {
      parts.serviceScoutBootL.visible = true;
      parts.serviceScoutBootR.visible = true;
      setServiceScoutBootFallbackVisible(parts, false);
      return true;
    }
    const requestId = Number(parts.serviceScoutBootRequestId || 0) + 1;
    parts.serviceScoutBootRequestId = requestId;
    preloadServiceScoutBootModel().then(templates => {
      if (!templates || parts.serviceScoutBootRequestId !== requestId || !parts.serviceScoutBootWanted) return;
      if (!installServiceScoutBootInstances(parts)) return;
      parts.serviceScoutBootL.visible = true;
      parts.serviceScoutBootR.visible = true;
      setServiceScoutBootFallbackVisible(parts, false);
    });
    return false;
  }

  function modernCharacterMesh(type, values, material, position = [0, 0, 0], rotation = [0, 0, 0], castShadow = true, cosmetic = false) {
    const mesh = new THREE.Mesh(modernCharacterGeometry(type, values), material);
    mesh.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
    mesh.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
    mesh.castShadow = !!castShadow;
    mesh.receiveShadow = false;
    mesh.userData.cosmeticLod = !!cosmetic;
    return mesh;
  }

  function modernCharacterBox(size, material, position, rotation, castShadow, cosmetic) {
    return modernCharacterMesh('box', size, material, position, rotation, castShadow, cosmetic);
  }

  function modernCharacterTaper(topRadius, bottomRadius, height, segments, material, position, rotation, castShadow, cosmetic) {
    return modernCharacterMesh('cylinder', [topRadius, bottomRadius, height, segments], material, position, rotation, castShadow, cosmetic);
  }

  function modernCharacterJoint(parent, position = [0, 0, 0]) {
    const joint = new THREE.Group();
    joint.position.set(position[0] || 0, position[1] || 0, position[2] || 0);
    parent.add(joint);
    return joint;
  }

  function buildModernCharacterLeg(motionRoot, parts, side, castShadow) {
    const sign = side === 'L' ? -1 : 1;
    const hip = modernCharacterJoint(motionRoot, [sign * 0.18, 0.72, 0.02]);
    const thigh = modernCharacterTaper(0.135, 0.105, 0.4, 6, modernCharacterMats.cloth, [0, -0.2, 0], [0.02 * sign, 0, 0], castShadow);
    const kneeGuard = modernCharacterBox([0.22, 0.11, 0.22], side === 'L' ? modernCharacterMats.armor : modernCharacterMats.armorDark, [0, -0.39, -0.04], [0.04, 0, 0.04 * sign], castShadow, true);
    hip.add(thigh, kneeGuard);

    const knee = modernCharacterJoint(hip, [0, -0.39, 0]);
    const shin = modernCharacterTaper(0.1, 0.115, 0.34, 6, modernCharacterMats.cloth, [0, -0.17, 0.015], [-0.02, 0, 0], castShadow);
    const gaiter = modernCharacterBox([0.22, 0.23, 0.22], modernCharacterMats.leather, [0, -0.2, -0.005], [0.01, 0, 0.025 * sign], castShadow, true);
    knee.add(shin, gaiter);

    const ankle = modernCharacterJoint(knee, [0, -0.32, 0]);
    const boot = modernCharacterBox([0.27, 0.15, 0.38], modernCharacterMats.boot, [0, 0.075, -0.08], [0, 0, 0.02 * sign], castShadow);
    const toeCap = modernCharacterBox([0.29, 0.065, 0.2], modernCharacterMats.armorDark, [0, 0.09, -0.19], [0.02, 0, 0], castShadow, true);
    ankle.add(boot, toeCap);

    parts[`leg${side}`] = hip;
    parts[`knee${side}`] = knee;
    parts[`ankle${side}`] = ankle;
    parts[`baseBoot${side}`] = boot;
    parts[`baseGaiter${side}`] = gaiter;
    return [thigh, kneeGuard, shin, gaiter, boot, toeCap];
  }

  function buildModernCharacterArm(torsoRig, parts, side, castShadow) {
    const sign = side === 'L' ? -1 : 1;
    const shoulder = modernCharacterJoint(torsoRig, [sign * 0.49, 0.61, 0]);
    shoulder.rotation.z = -sign * 0.16;
    const upper = modernCharacterTaper(0.11, 0.09, 0.39, 6, modernCharacterMats.coat, [0, -0.19, 0], [0, 0, 0], castShadow);
    const shoulderPad = modernCharacterBox([0.26, 0.14, 0.29], side === 'L' ? modernCharacterMats.armor : modernCharacterMats.coatDark, [0, -0.035, -0.015], [0.02, 0, 0.03 * sign], castShadow, true);
    shoulder.add(upper, shoulderPad);

    const elbow = modernCharacterJoint(shoulder, [0, -0.37, 0]);
    const forearm = modernCharacterTaper(0.09, 0.075, 0.3, 6, modernCharacterMats.coatDark, [0, -0.15, -0.015], [0.02, 0, 0], castShadow);
    const bracer = modernCharacterBox([0.19, 0.2, 0.19], modernCharacterMats.leather, [0, -0.13, -0.03], [0.02, 0, 0.025 * sign], castShadow, true);
    elbow.add(forearm, bracer);

    const wrist = modernCharacterJoint(elbow, [0, -0.29, -0.01]);
    const hand = modernCharacterBox([0.15, 0.16, 0.17], modernCharacterMats.skin, [0, -0.075, -0.015], [0.02, 0, 0], castShadow);
    const glove = modernCharacterBox([0.17, 0.09, 0.19], modernCharacterMats.leather, [0, -0.025, -0.01], [0.02, 0, 0], castShadow, true);
    wrist.add(hand, glove);

    parts[`arm${side}`] = shoulder;
    parts[`forearm${side}`] = elbow;
    parts[`wrist${side}`] = wrist;
    parts[`hand${side}`] = hand;
    parts[`armMaterialMeshes${side}`] = [
      { mesh: upper, material: modernCharacterMats.coat },
      { mesh: forearm, material: modernCharacterMats.coatDark }
    ];
    return [upper, shoulderPad, forearm, bracer, hand, glove];
  }

  function buildModernWastelandHumanoid(root, parts = {}, options = {}) {
    const castShadow = options.castShadow !== false;
    const isPlayer = !!options.isPlayer;
    const cosmeticMeshes = [];

    const shadow = new THREE.Mesh(
      modernCharacterGeometry('cylinder', [isPlayer ? 0.67 : 0.62, isPlayer ? 0.67 : 0.62, 0.012, 24]),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: isPlayer ? 0.28 : 0.22, depthWrite: false })
    );
    shadow.position.y = 0.018;
    shadow.castShadow = false;
    root.add(shadow);
    parts.shadow = shadow;

    const motionRoot = modernCharacterJoint(root);
    const torsoRig = modernCharacterJoint(motionRoot, [0, 0.72, 0]);
    parts.motionRoot = motionRoot;
    parts.torsoRig = torsoRig;
    parts.modernRig = true;

    cosmeticMeshes.push(...buildModernCharacterLeg(motionRoot, parts, 'L', castShadow));
    cosmeticMeshes.push(...buildModernCharacterLeg(motionRoot, parts, 'R', castShadow));

    const pelvis = modernCharacterTaper(0.33, 0.39, 0.28, 6, modernCharacterMats.cloth, [0, 0.72, 0.015], [0, 0, 0], castShadow);
    const belt = modernCharacterBox([0.78, 0.13, 0.43], modernCharacterMats.leather, [0, 0.76, 0], [0, 0, 0], castShadow);
    const buckle = modernCharacterBox([0.16, 0.095, 0.04], modernCharacterMats.brass, [0, 0.76, -0.235], [0, 0, 0], castShadow, true);
    motionRoot.add(pelvis, belt, buckle);
    parts.pelvis = pelvis;
    parts.belt = belt;

    const coatBack = modernCharacterBox([0.62, 0.58, 0.11], modernCharacterMats.coatDark, [0, 0.54, 0.24], [-0.06, 0, 0], castShadow, true);
    const coatTailL = modernCharacterBox([0.29, 0.62, 0.12], modernCharacterMats.coat, [-0.2, 0.49, 0.08], [-0.035, 0.04, -0.055], castShadow, true);
    const coatTailR = modernCharacterBox([0.29, 0.62, 0.12], modernCharacterMats.coat, [0.2, 0.49, 0.08], [-0.035, -0.04, 0.055], castShadow, true);
    motionRoot.add(coatBack, coatTailL, coatTailR);
    parts.coatBack = coatBack;
    parts.coatTailL = coatTailL;
    parts.coatTailR = coatTailR;
    cosmeticMeshes.push(coatBack, coatTailL, coatTailR, buckle);

    const body = modernCharacterTaper(0.31, 0.39, 0.62, 7, modernCharacterMats.coat, [0, 0.13, 0.025], [0, 0, 0], castShadow);
    const chest = modernCharacterBox([0.74, 0.5, 0.35], modernCharacterMats.coat, [0, 0.38, -0.005], [0.015, 0, 0], castShadow);
    torsoRig.add(body, chest);
    parts.body = body;
    parts.chest = chest;

    const baseChestPlate = modernCharacterBox([0.55, 0.34, 0.09], modernCharacterMats.armor, [0, 0.39, -0.215], [-0.055, 0, 0], castShadow, true);
    const bellyPlate = modernCharacterBox([0.39, 0.14, 0.07], modernCharacterMats.armorDark, [0.035, 0.15, -0.205], [0.06, 0, -0.025], castShadow, true);
    torsoRig.add(baseChestPlate, bellyPlate);
    parts.baseChestPlate = baseChestPlate;
    parts.baseBellyPlate = bellyPlate;
    cosmeticMeshes.push(baseChestPlate, bellyPlate);

    cosmeticMeshes.push(...buildModernCharacterArm(torsoRig, parts, 'L', castShadow));
    cosmeticMeshes.push(...buildModernCharacterArm(torsoRig, parts, 'R', castShadow));
    parts.baseShoulderL = parts.armL.children[1] || null;
    parts.baseShoulderR = parts.armR.children[1] || null;

    const neckWrap = modernCharacterTaper(0.255, 0.285, 0.16, 8, modernCharacterMats.scarf, [0, 0.69, -0.005], [0, 0, 0], castShadow);
    torsoRig.add(neckWrap);
    parts.neckWrap = neckWrap;

    const headRig = modernCharacterJoint(torsoRig, [0, 0.9, -0.02]);
    const head = modernCharacterMesh('dodeca', [0.245, 0], modernCharacterMats.skin, [0, 0, 0], [0, 0, 0], castShadow);
    head.scale.set(0.9, 1.08, 0.92);
    headRig.add(head);
    parts.head = headRig;
    parts.headMesh = head;

    const hairCap = modernCharacterMesh('dodeca', [0.258, 0], modernCharacterMats.hair, [0, 0.1, 0.015], [0, 0, 0], castShadow, true);
    hairCap.scale.set(0.92, 0.55, 0.94);
    headRig.add(hairCap);
    for (let i = -2; i <= 2; i++) {
      const tuft = modernCharacterBox([0.085, 0.15 + (2 - Math.abs(i)) * 0.018, 0.085], modernCharacterMats.hair, [i * 0.075, 0.23 - Math.abs(i) * 0.012, -0.015 + Math.abs(i) * 0.008], [-0.18, 0, i * -0.08], castShadow, true);
      headRig.add(tuft);
      cosmeticMeshes.push(tuft);
    }
    parts.hairMeshes = [hairCap, ...headRig.children.filter(child => child !== head && child !== hairCap && child.material === modernCharacterMats.hair)];

    const goggles = modernCharacterBox([0.35, 0.11, 0.075], modernCharacterMats.glass, [0, 0.015, -0.225], [0, 0, 0], castShadow, true);
    const goggleBridge = modernCharacterBox([0.06, 0.06, 0.09], modernCharacterMats.armorDark, [0, 0.005, -0.235], [0, 0, 0], castShadow, true);
    const mask = modernCharacterBox([0.21, 0.15, 0.12], modernCharacterMats.armorDark, [0, -0.12, -0.215], [0.02, 0, 0], castShadow, true);
    const filterL = modernCharacterTaper(0.055, 0.055, 0.1, 8, modernCharacterMats.brass, [-0.125, -0.12, -0.245], [Math.PI / 2, 0, 0], castShadow, true);
    const filterR = filterL.clone();
    filterR.position.x = 0.125;
    headRig.add(goggles, goggleBridge, mask, filterL, filterR);
    parts.goggles = goggles;
    parts.mask = mask;
    cosmeticMeshes.push(hairCap, goggles, goggleBridge, mask, filterL, filterR);

    const helmet = modernCharacterMesh('sphere', [0.285, 10, 7], modernCharacterMats.armorDark, [0, 0.09, 0], [0, 0, 0], castShadow, true);
    helmet.scale.set(1, 0.72, 1);
    helmet.visible = false;
    headRig.add(helmet);
    parts.helmet = helmet;

    const backpack = modernCharacterBox([0.52, 0.59, 0.25], modernCharacterMats.pack, [0, 0.35, 0.37], [0.015, 0, 0], castShadow);
    const packTop = modernCharacterBox([0.43, 0.12, 0.27], modernCharacterMats.pack, [0, 0.68, 0.37], [-0.04, 0, 0], castShadow, true);
    const bedroll = modernCharacterTaper(0.105, 0.105, 0.55, 8, modernCharacterMats.scarf, [0, 0.7, 0.41], [0, 0, Math.PI / 2], castShadow, true);
    const packStrapL = modernCharacterBox([0.07, 0.68, 0.055], modernCharacterMats.leather, [-0.2, 0.38, 0.22], [0.04, 0, 0.045], castShadow, true);
    const packStrapR = modernCharacterBox([0.07, 0.68, 0.055], modernCharacterMats.leather, [0.2, 0.38, 0.22], [0.04, 0, -0.045], castShadow, true);
    torsoRig.add(backpack, packTop, bedroll, packStrapL, packStrapR);
    parts.backpack = backpack;
    parts.backpackTop = packTop;
    parts.bedroll = bedroll;
    parts.packAccessories = [packTop, bedroll, packStrapL, packStrapR];
    cosmeticMeshes.push(packTop, bedroll, packStrapL, packStrapR);

    const bandolier = modernCharacterBox([0.075, 0.74, 0.07], modernCharacterMats.leather, [-0.14, 0.39, -0.225], [0.08, 0, -0.58], castShadow, true);
    torsoRig.add(bandolier);
    parts.bandolierA = bandolier;
    for (let i = 0; i < 5; i++) {
      const cartridge = modernCharacterBox([0.045, 0.11, 0.042], modernCharacterMats.brass, [-0.25 + i * 0.075, 0.47 - i * 0.058, -0.274], [0.08, 0, -0.58], castShadow, true);
      torsoRig.add(cartridge);
      cosmeticMeshes.push(cartridge);
    }

    if (isPlayer) {
      const rankPlate = modernCharacterBox([0.17, 0.052, 0.03], modernCharacterMats.brass, [0.17, 0.48, -0.278], [-0.03, 0, 0.02], castShadow, true);
      torsoRig.add(rankPlate);
      parts.playerRankPlate = rankPlate;
      cosmeticMeshes.push(rankPlate);
    }

    const weaponGroup = modernCharacterJoint(torsoRig, [0.5, 0.34, -0.27]);
    weaponGroup.rotation.set(0.04, 0, -0.08);
    parts.weaponGroup = weaponGroup;

    parts.cosmeticLodMeshes = cosmeticMeshes;
    parts.baseMaterials = {
      body: modernCharacterMats.coat,
      chest: modernCharacterMats.coat,
      arm: modernCharacterMats.coat,
      helmet: modernCharacterMats.armorDark,
      backpack: modernCharacterMats.pack
    };
    root.userData.parts = parts;
    return parts;
  }

  function buildModernCharacterArmorExtras(root, parts, castShadow = true) {
    const torsoRig = parts.torsoRig || parts.motionRoot || root;
    const headRig = parts.head || torsoRig;
    parts.styleMats = modernCharacterArmorMats;

    const chestPlate = modernCharacterBox([0.68, 0.49, 0.16], modernCharacterArmorMats.plateDark, [0, 0.36, -0.14], [-0.035, 0, 0], castShadow);
    chestPlate.visible = false;
    torsoRig.add(chestPlate);

    const shoulderL = modernCharacterBox([0.31, 0.2, 0.31], modernCharacterArmorMats.heavy, [0, -0.04, -0.005], [0.02, 0, 0], castShadow);
    const shoulderR = shoulderL.clone();
    shoulderL.visible = false;
    shoulderR.visible = false;
    parts.armL.add(shoulderL);
    parts.armR.add(shoulderR);

    const energyCore = modernCharacterBox([0.16, 0.2, 0.045], modernCharacterArmorMats.energyGlow, [0, 0.34, -0.245], [0, 0, 0], false);
    energyCore.visible = false;
    torsoRig.add(energyCore);

    const visor = modernCharacterBox([0.3, 0.12, 0.065], modernCharacterArmorMats.visor, [0, 0.01, -0.245], [0, 0, 0], castShadow);
    visor.visible = false;
    headRig.add(visor);

    const canister = modernCharacterTaper(0.08, 0.08, 0.38, 8, modernCharacterArmorMats.hazmatDark, [0.21, 0.34, 0.36], [0, 0, Math.PI / 2], castShadow);
    canister.visible = false;
    torsoRig.add(canister);

    const helmetVisor = modernCharacterBox([0.34, 0.12, 0.09], modernCharacterArmorMats.visor, [0, 0.01, -0.26], [0, 0, 0], castShadow);
    const helmetFront = modernCharacterBox([0.25, 0.18, 0.09], modernCharacterArmorMats.heavy, [0, -0.1, -0.22], [0.03, 0, 0], castShadow);
    const helmetPodL = modernCharacterBox([0.09, 0.13, 0.1], modernCharacterArmorMats.heavy, [-0.24, -0.005, -0.015], [0, 0, 0], castShadow);
    const helmetPodR = helmetPodL.clone();
    helmetPodR.position.x = 0.24;
    [helmetVisor, helmetFront, helmetPodL, helmetPodR].forEach(mesh => { mesh.visible = false; headRig.add(mesh); });

    const bootL = modernCharacterBox([0.3, 0.19, 0.4], modernCharacterArmorMats.plateDark, [0, 0.08, -0.08], [0, 0, 0], castShadow);
    const bootR = bootL.clone();
    bootL.visible = false;
    bootR.visible = false;
    parts.ankleL.add(bootL);
    parts.ankleR.add(bootR);

    const injuryGroup = new THREE.Group();
    injuryGroup.position.set(0, 2.45, 0);
    injuryGroup.visible = false;
    root.add(injuryGroup);

    const leatherTorso = modernCharacterBox([0.73, 0.51, 0.18], modernCharacterArmorMats.leatherJacket, [0, 0.37, -0.1], [0.015, 0, 0], castShadow);
    leatherTorso.visible = false;
    torsoRig.add(leatherTorso);

    const leatherSleeveL = modernCharacterTaper(0.12, 0.1, 0.4, 6, modernCharacterArmorMats.leatherJacket, [0, -0.19, 0], [0, 0, 0], castShadow);
    const leatherSleeveR = leatherSleeveL.clone();
    leatherSleeveL.visible = false;
    leatherSleeveR.visible = false;
    parts.armL.add(leatherSleeveL);
    parts.armR.add(leatherSleeveR);

    const leatherCollarL = modernCharacterBox([0.16, 0.11, 0.09], modernCharacterArmorMats.leatherTrim, [-0.13, 0.65, -0.19], [0.5, 0, 0.38], castShadow);
    const leatherCollarR = leatherCollarL.clone();
    leatherCollarR.position.x = 0.13;
    leatherCollarR.rotation.z = -0.38;
    leatherCollarL.visible = false;
    leatherCollarR.visible = false;
    torsoRig.add(leatherCollarL, leatherCollarR);

    Object.assign(parts, {
      chestPlate,
      shoulderL,
      shoulderR,
      energyCore,
      visor,
      canister,
      helmetVisor,
      helmetFront,
      helmetPodL,
      helmetPodR,
      bootL,
      bootR,
      injuryGroup,
      leatherTorso,
      leatherSleeveL,
      leatherSleeveR,
      leatherCollarL,
      leatherCollarR
    });
  }

  function modernAnimationBlend(current, target, rate, dt) {
    return current + (target - current) * Math.min(1, Math.max(0.001, Number(dt || 0.016)) * rate);
  }

  function modernAnimationWeaponId(actor) {
    const parts = actorAnimationParts(actor);
    const weaponGroup = parts.weaponGroup;
    if (!weaponGroup || !weaponGroup.children || !weaponGroup.children.length) return 'fists';
    return String(actor.userData?.weaponId || weaponGroup.userData?.weaponId || 'ranged');
  }

  function triggerCharacterReloadVisual(actor, weaponId = 'pistol', duration = 0.82) {
    if (!actor?.userData) return;
    actor.userData.reloadAnim = {
      startedAt: performance.now(),
      duration: Math.max(0.5, Number(duration || 0.82)),
      weaponId: String(weaponId || 'pistol')
    };
  }

  function triggerCharacterHitReaction(actor, direction = 1, duration = 0.34) {
    if (!actor?.userData) return;
    actor.userData.hitReactionAnim = {
      startedAt: performance.now(),
      duration: Math.max(0.22, Number(duration || 0.34)),
      direction: Number(direction || 1) < 0 ? -1 : 1
    };
  }

  function updateCharacterLocomotionAnimation(actor, dt = 0.016, state = {}) {
    if (typeof updateCharacterGlbAnimation === 'function') {
      updateCharacterGlbAnimation(actor, dt, state);
    }
    const parts = actorAnimationParts(actor);
    if (!actor || !parts.modernRig || !parts.motionRoot || !parts.torsoRig) return;
    const moving = !!state.moving;
    const crouching = state.crouching !== undefined ? !!state.crouching : !!actor.userData.crouching;
    const speed = Math.max(0, Number(state.speed || 0));
    const weaponId = modernAnimationWeaponId(actor);
    const usesRangedStance = !['fists', 'knife', 'pickaxe', 'axe', 'handPump'].includes(weaponId);
    const now = performance.now();
    const directional = typeof characterDirectionalLocomotionState === 'function'
      ? characterDirectionalLocomotionState(state)
      : {
          lowerBodyYaw: 0,
          upperBodyYaw: 0,
          sideAmount: 0,
          playbackRate: moving ? 1 : 0,
          strideScale: moving ? 1 : 0
        };

    const moveTarget = moving ? 1 : 0;
    const aimTarget = usesRangedStance ? 1 : 0;
    actor.userData.modernMoveBlend = modernAnimationBlend(Number(actor.userData.modernMoveBlend || 0), moveTarget, moving ? 10 : 7, dt);
    actor.userData.modernAimBlend = modernAnimationBlend(Number(actor.userData.modernAimBlend || 0), aimTarget, 9, dt);
    actor.userData.modernCrouchBlend = modernAnimationBlend(Number(actor.userData.modernCrouchBlend || 0), crouching ? 1 : 0, 11, dt);
    const moveBlend = actor.userData.modernMoveBlend;
    const aimBlend = actor.userData.modernAimBlend;
    const crouchBlend = actor.userData.modernCrouchBlend;
    actor.userData.modernLowerBodyYaw = modernAnimationBlend(
      Number(actor.userData.modernLowerBodyYaw || 0),
      directional.lowerBodyYaw,
      moving ? 8.5 : 6.5,
      dt
    );
    actor.userData.modernSideAmount = modernAnimationBlend(
      Number(actor.userData.modernSideAmount || 0),
      Number(directional.sideAmount || 0),
      9,
      dt
    );
    if (moving && !actor.userData.modernWasMoving) {
      actor.userData.modernPlaybackRate = directional.playbackRate;
    }
    actor.userData.modernPlaybackRate = modernAnimationBlend(
      Number.isFinite(Number(actor.userData.modernPlaybackRate))
        ? Number(actor.userData.modernPlaybackRate)
        : 1,
      moving ? directional.playbackRate : 1,
      directional.playbackRate < 0 ? 7 : 9,
      dt
    );
    actor.userData.modernWasMoving = moving;
    const lowerBodyYaw = actor.userData.modernLowerBodyYaw * moveBlend;
    const upperBodyYaw = -lowerBodyYaw;
    const sideAmount = actor.userData.modernSideAmount * moveBlend;

    const phaseSpeed = moving ? Math.max(4.6, Math.min(9.2, 4.2 + speed * 0.7)) : 2.2;
    actor.userData.modernWalkPhase = Number(actor.userData.modernWalkPhase || 0)
      + dt * phaseSpeed * actor.userData.modernPlaybackRate;
    const phase = actor.userData.modernWalkPhase;
    const stride = Math.sin(phase) * moveBlend * directional.strideScale * (0.58 - crouchBlend * 0.22);
    const footLiftL = Math.max(0, Math.sin(phase)) * moveBlend;
    const footLiftR = Math.max(0, -Math.sin(phase)) * moveBlend;
    const breath = Math.sin(now / 720) * 0.012;
    const bob = Math.abs(Math.sin(phase)) * moveBlend * (0.035 - crouchBlend * 0.012);

    parts.motionRoot.position.y = -crouchBlend * 0.16 + bob;
    parts.motionRoot.rotation.x = crouchBlend * 0.055;
    parts.motionRoot.rotation.y = lowerBodyYaw;
    parts.motionRoot.rotation.z = Math.sin(phase * 0.5) * moveBlend * 0.012 - sideAmount * 0.035;
    parts.torsoRig.position.y = 0.72 + breath;
    parts.torsoRig.rotation.x = crouchBlend * 0.14 + moveBlend * 0.025;
    parts.torsoRig.rotation.y = Math.sin(phase) * moveBlend * 0.035 + upperBodyYaw * 0.82;
    parts.torsoRig.rotation.z = -Math.sin(phase) * moveBlend * 0.018 + sideAmount * 0.025;

    parts.legL.rotation.set(stride - crouchBlend * 0.34, 0, 0.035);
    parts.legR.rotation.set(-stride - crouchBlend * 0.34, 0, -0.035);
    parts.kneeL.rotation.x = footLiftL * 0.46 + crouchBlend * 0.62;
    parts.kneeR.rotation.x = footLiftR * 0.46 + crouchBlend * 0.62;
    parts.ankleL.rotation.x = -footLiftL * 0.3 - crouchBlend * 0.2;
    parts.ankleR.rotation.x = -footLiftR * 0.3 - crouchBlend * 0.2;
    if (parts.coatTailL) parts.coatTailL.rotation.x = -0.035 + Math.max(0, -stride) * 0.12 + moveBlend * 0.035;
    if (parts.coatTailR) parts.coatTailR.rotation.x = -0.035 + Math.max(0, stride) * 0.12 + moveBlend * 0.035;
    if (parts.coatBack) parts.coatBack.rotation.x = -0.06 + moveBlend * 0.05;

    const armSwing = stride * (1 - aimBlend) * 0.72;
    const readyX = 1.03 - crouchBlend * 0.12;
    parts.armL.rotation.set(armSwing + readyX * aimBlend, 0.08 * aimBlend, 0.16 + 0.28 * aimBlend);
    parts.armR.rotation.set(-armSwing + readyX * aimBlend, -0.04 * aimBlend, -0.16 - 0.31 * aimBlend);
    parts.forearmL.rotation.set(0.12 + 0.74 * aimBlend, -0.08 * aimBlend, -0.12 * aimBlend);
    parts.forearmR.rotation.set(0.08 + 0.5 * aimBlend, 0.05 * aimBlend, 0.1 * aimBlend);
    parts.wristL.rotation.set(-0.12 * aimBlend, 0, 0);
    parts.wristR.rotation.set(-0.06 * aimBlend, 0, 0);
    if (parts.head) {
      parts.head.rotation.x = -crouchBlend * 0.08 + moveBlend * 0.015;
      parts.head.rotation.y = -Math.sin(phase) * moveBlend * 0.025 + upperBodyYaw * 0.18;
      parts.head.rotation.z = 0;
    }

    let reloadLift = 0;
    const reloadAnim = actor.userData.reloadAnim;
    if (reloadAnim) {
      const reloadPhase = (now - Number(reloadAnim.startedAt || 0)) / (Math.max(0.5, Number(reloadAnim.duration || 0.82)) * 1000);
      if (reloadPhase >= 1) {
        delete actor.userData.reloadAnim;
      } else {
        reloadLift = Math.sin(Math.max(0, Math.min(1, reloadPhase)) * Math.PI);
        parts.armL.rotation.x += reloadLift * 0.38;
        parts.armL.rotation.z += reloadLift * 0.32;
        parts.forearmL.rotation.x += reloadLift * 0.72;
        parts.armR.rotation.x -= reloadLift * 0.16;
        parts.forearmR.rotation.x += reloadLift * 0.18;
        parts.torsoRig.rotation.y -= reloadLift * 0.08;
      }
    }

    const hitAnim = actor.userData.hitReactionAnim;
    if (hitAnim) {
      const hitPhase = (now - Number(hitAnim.startedAt || 0)) / (Math.max(0.22, Number(hitAnim.duration || 0.34)) * 1000);
      if (hitPhase >= 1) {
        delete actor.userData.hitReactionAnim;
      } else {
        const hit = Math.sin(Math.max(0, Math.min(1, hitPhase)) * Math.PI);
        const direction = Number(hitAnim.direction || 1);
        parts.motionRoot.rotation.z += hit * 0.1 * direction;
        parts.torsoRig.rotation.x -= hit * 0.12;
        parts.torsoRig.rotation.y += hit * 0.16 * direction;
        parts.armL.rotation.z += hit * 0.14;
        parts.armR.rotation.z -= hit * 0.14;
      }
    }

    if (parts.weaponGroup) {
      parts.weaponGroup.userData.characterPose = {
        x: -aimBlend * 0.025 + reloadLift * 0.04,
        y: aimBlend * 0.04 + reloadLift * 0.11 + bob * 0.35,
        z: -aimBlend * 0.12 + reloadLift * 0.09,
        rx: -aimBlend * 0.08 + reloadLift * 0.22,
        ry: reloadLift * -0.16,
        rz: aimBlend * -0.035 + reloadLift * 0.28
      };
    }
  }
