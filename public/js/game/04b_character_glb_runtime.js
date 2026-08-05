  // ===== APPROVED CHARACTER GLB RUNTIME / CREATOR PREVIEW =====
  const CHARACTER_APPEARANCE_SCHEMA = 'realm.character-appearance.v1';
  const CHARACTER_SEXES = ['female', 'male'];
  const CHARACTER_BODY_TYPES = ['slim', 'medium', 'large'];
  const CHARACTER_FACE_OPTIONS = {
    female: [
      { id: 'female_01', label: 'Угловатое' },
      { id: 'female_02', label: 'Узкое' },
      { id: 'female_03', label: 'Широкое' },
      { id: 'female_04', label: 'Округлое' }
    ],
    male: [
      { id: 'male_01', label: 'Угловатое' },
      { id: 'male_02', label: 'Узкое' },
      { id: 'male_03', label: 'Широкое' },
      { id: 'male_04', label: 'Округлое' }
    ]
  };
  const CHARACTER_HAIR_OPTIONS = [
    { id: 'shaved', label: 'Без волос' },
    { id: 'short_crop', label: 'Короткая' },
    { id: 'side_swept', label: 'Набок' },
    { id: 'mohawk', label: 'Ирокез' },
    { id: 'braids', label: 'Косы' },
    { id: 'tied_back', label: 'Собранная' },
    { id: 'long', label: 'Длинная' },
    { id: 'buns', label: 'Два пучка' }
  ];
  const CHARACTER_HAIR_COLOR_OPTIONS = [
    { id: 'hair_01', label: 'Чёрный', hex: '#1A1512' },
    { id: 'hair_02', label: 'Тёмно-коричневый', hex: '#2A1B16' },
    { id: 'hair_03', label: 'Каштановый', hex: '#4B3023' },
    { id: 'hair_04', label: 'Коричневый', hex: '#6B452A' },
    { id: 'hair_05', label: 'Светло-коричневый', hex: '#8A6040' },
    { id: 'hair_06', label: 'Русый', hex: '#A27A4B' },
    { id: 'hair_07', label: 'Седой', hex: '#7B7D76' },
    { id: 'hair_08', label: 'Рыжий', hex: '#5B2922' }
  ];
  const CHARACTER_FACE_FIT_PROFILES = {
    '01': {
      headScale: [1, 1, 1],
      scalpScale: [1, 1],
      topOffset: 0
    },
    '02': {
      headScale: [0.88, 1.018, 1.05],
      scalpScale: [0.94, 1.035],
      topOffset: 0.0065
    },
    '03': {
      headScale: [1.13, 0.985, 0.96],
      scalpScale: [1.105, 0.975],
      topOffset: -0.0055
    },
    '04': {
      headScale: [0.98, 0.982, 1.09],
      scalpScale: [1.07, 1.055],
      topOffset: -0.0065
    }
  };
  const CHARACTER_HEAD_FIT = {
    female: { top: 1.8285, centerZ: -0.006 },
    male: { top: 1.8282, centerZ: -0.006 }
  };
  const CHARACTER_SEX_LABELS = { female: 'Женский', male: 'Мужской' };
  const CHARACTER_BODY_TYPE_LABELS = {
    slim: 'Стройное',
    medium: 'Среднее',
    large: 'Крепкое'
  };
  const characterPreviewState = {
    renderer: null,
    scene: null,
    camera: null,
    model: null,
    mixer: null,
    animationFrame: 0,
    lastFrameAt: 0,
    requestedKey: '',
    loadedKey: '',
    loadedAppearanceKey: '',
    requestedAppearance: null,
    requestId: 0,
    resizeObserver: null,
    pointerX: 0,
    pointerActive: false
  };

  function defaultCharacterAppearance(sex = 'male') {
    const normalizedSex = CHARACTER_SEXES.includes(String(sex || '')) ? String(sex) : 'male';
    return {
      schema: CHARACTER_APPEARANCE_SCHEMA,
      sex: normalizedSex,
      bodyType: 'medium',
      faceId: normalizedSex === 'female' ? 'female_01' : 'male_01',
      hairId: normalizedSex === 'female' ? 'tied_back' : 'short_crop',
      skinToneId: 'skin_03',
      hairColorId: 'hair_03'
    };
  }

  function characterAppearanceOption(options = [], id = '') {
    return options.find(option => option.id === id) || options[0] || null;
  }

  function normalizeCharacterAppearance(input = {}) {
    const sex = CHARACTER_SEXES.includes(String(input?.sex || ''))
      ? String(input.sex)
      : 'male';
    const bodyType = CHARACTER_BODY_TYPES.includes(String(input?.bodyType || ''))
      ? String(input.bodyType)
      : 'medium';
    const defaults = defaultCharacterAppearance(sex);
    const faceOptions = CHARACTER_FACE_OPTIONS[sex] || CHARACTER_FACE_OPTIONS.male;
    const faceId = faceOptions.some(option => option.id === String(input?.faceId || ''))
      ? String(input.faceId)
      : defaults.faceId;
    const hairId = CHARACTER_HAIR_OPTIONS.some(option => option.id === String(input?.hairId || ''))
      ? String(input.hairId)
      : defaults.hairId;
    const hairColorId = CHARACTER_HAIR_COLOR_OPTIONS.some(option => option.id === String(input?.hairColorId || ''))
      ? String(input.hairColorId)
      : defaults.hairColorId;
    return {
      ...defaults,
      bodyType,
      faceId,
      hairId,
      hairColorId
    };
  }

  function characterAppearanceKey(input = {}) {
    const appearance = normalizeCharacterAppearance(input);
    return `${appearance.sex}_${appearance.bodyType}`;
  }

  function characterAppearanceLabel(input = {}) {
    const appearance = normalizeCharacterAppearance(input);
    const face = characterAppearanceOption(CHARACTER_FACE_OPTIONS[appearance.sex], appearance.faceId);
    const hair = characterAppearanceOption(CHARACTER_HAIR_OPTIONS, appearance.hairId);
    const hairColor = characterAppearanceOption(CHARACTER_HAIR_COLOR_OPTIONS, appearance.hairColorId);
    return [
      CHARACTER_SEX_LABELS[appearance.sex],
      CHARACTER_BODY_TYPE_LABELS[appearance.bodyType],
      face?.label || appearance.faceId,
      hair?.label || appearance.hairId,
      hairColor?.label || appearance.hairColorId
    ].join(' · ');
  }

  function characterModelUrl(input = {}) {
    return `/assets/models/characters/base/character_${characterAppearanceKey(input)}.glb`;
  }

  function characterGlbLoader() {
    return THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
  }

  function characterModelMaterials(root, callback) {
    if (!root?.traverse || typeof callback !== 'function') return;
    root.traverse(obj => {
      if (!obj?.isMesh) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => callback(material, obj));
    });
  }

  function disposeCharacterGlbObject(root) {
    if (!root?.traverse) return;
    const disposedTextures = new Set();
    root.traverse(obj => {
      if (!obj?.isMesh) return;
      const sharedApprovedAsset = !!obj.userData?.approvedEquipmentSharedAsset;
      if (!sharedApprovedAsset) obj.geometry?.dispose?.();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => {
        if (sharedApprovedAsset) return;
        Object.values(material).forEach(value => {
          if (value?.isTexture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose?.();
          }
        });
        material.dispose?.();
      });
    });
  }

  function configureCharacterGlbScene(root, options = {}) {
    const castShadow = options.castShadow !== false;
    root.traverse(obj => {
      if (!obj?.isMesh) return;
      obj.castShadow = castShadow;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => {
        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      });
    });
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    return root;
  }

  function characterVariantMaterial(color, options = {}) {
    const materialColor = new THREE.Color(color);
    materialColor.convertSRGBToLinear?.();
    return new THREE.MeshStandardMaterial({
      color: materialColor,
      roughness: options.roughness ?? 0.9,
      metalness: 0,
      flatShading: true,
      transparent: !!options.transparent,
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite !== false
    });
  }

  function characterHeadRestMatrix(root) {
    const head = root?.getObjectByName?.('head');
    if (!head) return null;
    const saved = head.userData?.characterAppearanceRestMatrix;
    if (Array.isArray(saved) && saved.length === 16) {
      return new THREE.Matrix4().fromArray(saved);
    }
    root.updateMatrixWorld(true);
    const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const restMatrix = rootInverse.multiply(head.matrixWorld);
    head.userData.characterAppearanceRestMatrix = restMatrix.toArray();
    return restMatrix;
  }

  function attachCharacterVariantToHead(root, group, appearance = {}) {
    if (!root || !group) return;
    const head = root.getObjectByName?.('head');
    const restMatrix = characterHeadRestMatrix(root);
    if (!head || !restMatrix) {
      root.add(group);
      root.updateMatrixWorld(true);
      return;
    }
    const factors = characterFaceFitProfile(appearance).headScale;
    const fittedRestMatrix = restMatrix.clone().multiply(
      new THREE.Matrix4().makeScale(factors[0], factors[1], factors[2])
    );
    const attachmentMatrix = fittedRestMatrix.invert();
    head.add(group);
    attachmentMatrix.decompose(group.position, group.quaternion, group.scale);
    group.updateMatrixWorld(true);
  }

  function characterFaceFitProfile(input = {}) {
    const appearance = normalizeCharacterAppearance(input);
    const profileId = String(appearance.faceId || '').slice(-2);
    const profile = CHARACTER_FACE_FIT_PROFILES[profileId] || CHARACTER_FACE_FIT_PROFILES['01'];
    const head = CHARACTER_HEAD_FIT[appearance.sex] || CHARACTER_HEAD_FIT.male;
    return {
      ...profile,
      top: head.top + profile.topOffset,
      centerZ: head.centerZ
    };
  }

  function characterHairPoint(fit, x, y, z) {
    const baseTop = CHARACTER_HEAD_FIT.female.top;
    const baseCenterZ = CHARACTER_HEAD_FIT.female.centerZ;
    return [
      x * fit.scalpScale[0],
      y + (fit.top - baseTop),
      fit.centerZ + (z - baseCenterZ) * fit.scalpScale[1]
    ];
  }

  function addCharacterScalpCap(group, material, style, fit) {
    const centerY = fit.top - 0.084;
    const radiusX = 0.0947 * fit.scalpScale[0];
    const radiusY = 0.11;
    const radiusZ = 0.118 * fit.scalpScale[1];
    const segments = 14;
    const rings = 6;
    const positions = [0, centerY + radiusY, fit.centerZ];
    const indices = [];
    for (let ring = 1; ring <= rings; ring += 1) {
      const fraction = ring / rings;
      for (let segment = 0; segment < segments; segment += 1) {
        const phi = Math.PI * 2 * segment / segments;
        const directionZ = Math.sin(phi);
        let thetaMax = directionZ < -0.45 ? 1.04 : (directionZ > 0.45 ? 1.58 : 1.18);
        if (style === 'short_crop') thetaMax -= 0.1;
        const theta = thetaMax * fraction;
        positions.push(
          Math.cos(phi) * Math.sin(theta) * radiusX,
          centerY + Math.cos(theta) * radiusY,
          fit.centerZ - Math.sin(phi) * Math.sin(theta) * radiusZ
        );
      }
    }
    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(0, 1 + segment, 1 + ((segment + 1) % segments));
    }
    for (let ring = 0; ring < rings - 1; ring += 1) {
      const current = 1 + ring * segments;
      const following = current + segments;
      for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(
          current + segment,
          following + segment,
          following + next,
          current + segment,
          following + next,
          current + next
        );
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const cap = new THREE.Mesh(geometry, material);
    cap.name = 'hair_variant_scalp';
    group.add(cap);
  }

  function addCharacterHairPiece(group, material, name, fit, position, scale, rotation = [0, 0, 0], detail = 0) {
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), material);
    const fitted = characterHairPoint(fit, position[0], position[1], position[2]);
    mesh.name = `hair_variant_${name}`;
    mesh.position.set(fitted[0], fitted[1], fitted[2]);
    mesh.scale.set(
      scale[0] * fit.scalpScale[0],
      scale[1],
      scale[2] * fit.scalpScale[1]
    );
    mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    group.add(mesh);
  }

  function addCharacterSideSweptHair(group, material, fit) {
    [-0.065, -0.043, -0.02, 0.004, 0.028, 0.051].forEach((offsetX, index) => {
      addCharacterHairPiece(group, material, `sweep_${index}`, fit, [
        offsetX + 0.02,
        1.8485 - Math.abs(offsetX) * 0.22,
        0.006 - index * 0.009
      ], [0.019, 0.024, 0.09], [0.11, -0.2, -0.32]);
    });
    for (let index = 0; index < 3; index += 1) {
      addCharacterHairPiece(group, material, `fringe_${index}`, fit, [
        0.064 + index * 0.007,
        1.7685 - index * 0.034,
        0.044
      ], [0.014, 0.058, 0.019], [0, 0.12, -0.18]);
    }
  }

  function addCharacterMohawk(group, material, fit) {
    [-0.085, -0.06, -0.035, -0.01, 0.018, 0.047, 0.076, 0.103].forEach((offsetZ, index) => {
      const height = 0.08 + 0.028 * Math.sin((index + 1) * Math.PI / 9);
      addCharacterHairPiece(group, material, `mohawk_blade_${index}`, fit, [
        0,
        1.8285 + height * 0.36,
        -0.006 - offsetZ
      ], [0.02, height, 0.027], [0, -0.07 + index * 0.018, 0]);
    });
    [-1, 1].forEach(side => {
      [-0.045, 0.015, 0.072].forEach((offsetZ, index) => {
        addCharacterHairPiece(group, material, `mohawk_root_${side}_${index}`, fit, [
          side * 0.017,
          1.8035,
          -0.006 - offsetZ
        ], [0.014, 0.015, 0.044]);
      });
    });
  }

  function addCharacterBraids(group, material, fit) {
    [-1, 1].forEach(side => {
      for (let index = 0; index < 8; index += 1) {
        const sway = Math.sin(index * 1.25 + (side > 0 ? 0.8 : 0)) * 0.008;
        addCharacterHairPiece(group, material, `braid_${side}_${index}`, fit, [
          side * (0.066 + sway),
          1.7235 - index * 0.04,
          -0.088 - index * 0.003
        ], [0.018, 0.027, 0.02], [0, side * 0.15, side * 0.2]);
      }
      for (let index = 0; index < 4; index += 1) {
        addCharacterHairPiece(group, material, `braid_crown_${side}_${index}`, fit, [
          side * (0.018 + index * 0.015),
          1.8385 - index * 0.012,
          -0.026 - index * 0.016
        ], [0.014, 0.016, 0.034], [0, side * 0.12, side * -0.2]);
      }
    });
  }

  function addCharacterTiedBackHair(group, material, fit) {
    addCharacterHairPiece(group, material, 'tied_knot', fit, [
      0, 1.7785, -0.148
    ], [0.043, 0.043, 0.039]);
    for (let index = 0; index < 5; index += 1) {
      addCharacterHairPiece(group, material, `tied_tail_${index}`, fit, [
        Math.sin(index * 0.8) * 0.012,
        1.7335 - index * 0.05,
        -0.16
      ], [0.026, 0.04, 0.025], [0, 0.12, Math.sin(index) * 0.15]);
    }
  }

  function addCharacterLongHair(group, material, fit) {
    [-1, 1].forEach(side => {
      for (let index = 0; index < 7; index += 1) {
        const offset = index * 0.012;
        addCharacterHairPiece(group, material, `long_side_${side}_${index}`, fit, [
          side * (0.058 + offset * 0.55),
          1.6935 - index * 0.036,
          -0.021 - offset
        ], [0.018, 0.09, 0.028], [0.04, side * 0.08, side * (0.1 + index * 0.018)]);
      }
    });
    [-0.045, -0.022, 0, 0.022, 0.045].forEach((offsetX, index) => {
      addCharacterHairPiece(group, material, `long_back_${index}`, fit, [
        offsetX, 1.5835, -0.118
      ], [0.02, 0.19, 0.026], [0.03, -offsetX * 0.8, offsetX * 0.8]);
    });
  }

  function addCharacterBuns(group, material, fit) {
    [-1, 1].forEach(side => {
      addCharacterHairPiece(group, material, `bun_${side}`, fit, [
        side * 0.08, 1.8465, -0.038
      ], [0.04, 0.041, 0.038]);
      for (let index = 0; index < 4; index += 1) {
        const angle = Math.PI * 2 * index / 4;
        addCharacterHairPiece(group, material, `bun_lock_${side}_${index}`, fit, [
          side * 0.08 + Math.cos(angle) * 0.028,
          1.8465 + Math.sin(angle * 0.5) * 0.02,
          -0.038 - Math.sin(angle) * 0.023
        ], [0.018, 0.016, 0.032], [angle * 0.2, side * 0.18, angle]);
      }
    });
    [-0.05, -0.025, 0, 0.025, 0.05].forEach((offsetX, index) => {
      addCharacterHairPiece(group, material, `bun_crown_${index}`, fit, [
        offsetX, 1.8335, -0.016
      ], [0.018, 0.021, 0.075], [0, -offsetX * 1.2, -offsetX * 1.8]);
    });
  }

  function addCharacterHairVariant(group, material, appearance) {
    const hairId = appearance.hairId;
    if (hairId === 'shaved') return false;
    const fit = characterFaceFitProfile(appearance);
    if (hairId !== 'mohawk') addCharacterScalpCap(group, material, hairId, fit);
    const builders = {
      side_swept: addCharacterSideSweptHair,
      mohawk: addCharacterMohawk,
      braids: addCharacterBraids,
      tied_back: addCharacterTiedBackHair,
      long: addCharacterLongHair,
      buns: addCharacterBuns
    };
    builders[hairId]?.(group, material, fit);
    return true;
  }

  function applyCharacterFaceShape(root, appearance) {
    const head = root?.getObjectByName?.('head');
    if (!head?.scale) return;
    if (!Array.isArray(head.userData?.characterAppearanceBaseScale)) {
      head.userData.characterAppearanceBaseScale = [head.scale.x, head.scale.y, head.scale.z];
    }
    const factors = characterFaceFitProfile(appearance).headScale;
    head.userData.characterAppearanceScaleFactors = factors;
    const [baseX, baseY, baseZ] = head.userData.characterAppearanceBaseScale;
    head.scale.set(baseX * factors[0], baseY * factors[1], baseZ * factors[2]);
  }

  function applyCharacterFaceShapeFrame(root) {
    const head = root?.getObjectByName?.('head');
    const factors = head?.userData?.characterAppearanceScaleFactors;
    if (!head?.scale || !Array.isArray(factors)) return;
    const base = head.userData?.characterAppearanceBaseScale;
    if (!Array.isArray(base)) return;
    head.scale.set(
      base[0] * factors[0],
      base[1] * factors[1],
      base[2] * factors[2]
    );
  }

  function applyCharacterGlbVisualVariants(root, input = {}, options = {}) {
    if (!root?.traverse) return;
    const appearance = normalizeCharacterAppearance(input);
    const helmetOn = !!options.helmetOn;
    const appearanceKey = `${appearance.faceId}:${appearance.hairId}:${appearance.hairColorId}:${helmetOn ? 1 : 0}`;
    if (root.userData?.characterAppearanceKey === appearanceKey) return;
    characterHeadRestMatrix(root);
    applyCharacterFaceShape(root, appearance);
    root.updateMatrixWorld(true);
    root.traverse(obj => {
      if (!obj || obj.userData?.characterAppearanceVariant) return;
      const layer = String(obj.userData?.realm_character_layer || '').toLowerCase();
      const name = String(obj.name || '').toLowerCase();
      if (layer === 'hair' || name.startsWith('hair_')) {
        obj.visible = false;
      }
    });
    const previous = root.userData?.characterAppearanceVariantGroup;
    if (previous?.parent) previous.parent.remove(previous);
    if (previous) disposeCharacterGlbObject(previous);
    const group = new THREE.Group();
    group.name = 'character_appearance_variants';
    group.userData.characterAppearanceVariant = true;
    if (!helmetOn && appearance.hairId !== 'shaved') {
      const hairColor = characterAppearanceOption(CHARACTER_HAIR_COLOR_OPTIONS, appearance.hairColorId);
      const hairMaterial = characterVariantMaterial(hairColor?.hex || '#4B3023', { roughness: 0.94 });
      if (!addCharacterHairVariant(group, hairMaterial, appearance)) hairMaterial.dispose();
    }
    if (group.children.length) {
      group.traverse(obj => {
        if (!obj?.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = false;
        obj.frustumCulled = false;
      });
      attachCharacterVariantToHead(root, group, appearance);
      root.userData.characterAppearanceVariantGroup = group;
    } else {
      delete root.userData.characterAppearanceVariantGroup;
    }
    root.userData.characterAppearanceKey = appearanceKey;
  }

  function characterGlbActions(mixer, animations = []) {
    const actions = {};
    animations.forEach(clip => {
      const key = String(clip?.name || '').toLowerCase();
      if (!key || actions[key]) return;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      if (['attack', 'hurt', 'death'].includes(key)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      actions[key] = action;
    });
    return actions;
  }

  function characterDirectionalLocomotionState(state = {}) {
    const moving = !!state.moving;
    const speed = Math.max(0, Number(state.speed || 0));
    const facingAngle = Number.isFinite(Number(state.facingAngle))
      ? Number(state.facingAngle)
      : 0;
    let moveX = Number(state.moveX || 0);
    let moveZ = Number(state.moveZ || 0);
    let moveLength = Math.hypot(moveX, moveZ);
    if (!moving || !Number.isFinite(moveLength) || moveLength < 0.0001) {
      moveX = Math.sin(facingAngle);
      moveZ = Math.cos(facingAngle);
      moveLength = 1;
    }
    moveX /= moveLength;
    moveZ /= moveLength;
    const facingX = Math.sin(facingAngle);
    const facingZ = Math.cos(facingAngle);
    const rightX = Math.cos(facingAngle);
    const rightZ = -Math.sin(facingAngle);
    const forwardAmount = Math.max(-1, Math.min(1, moveX * facingX + moveZ * facingZ));
    const sideAmount = Math.max(-1, Math.min(1, moveX * rightX + moveZ * rightZ));
    const relativeAngle = Math.atan2(sideAmount, forwardAmount);
    const backward = moving && forwardAmount < -0.42;
    const sideStrength = Math.abs(sideAmount);
    let lowerBodyYaw = 0;
    if (moving && !backward) {
      lowerBodyYaw = Math.max(-1.05, Math.min(1.05, relativeAngle * 0.82));
    } else if (backward) {
      lowerBodyYaw = sideAmount * 0.38;
    }
    let direction = 'idle';
    if (moving) {
      const vertical = forwardAmount > 0.42 ? 'forward' : (forwardAmount < -0.42 ? 'backward' : '');
      const horizontal = sideAmount > 0.42 ? 'right' : (sideAmount < -0.42 ? 'left' : '');
      direction = [vertical, horizontal].filter(Boolean).join('_') || 'forward';
    }
    const action = moving
      ? (backward ? 'walk' : (speed > 5.35 ? 'run' : 'walk'))
      : 'idle';
    const playbackRate = !moving
      ? 1
      : (backward ? -0.82 : (sideStrength > 0.62 ? 0.92 : 1));
    const strideScale = !moving
      ? 0
      : (backward ? 0.68 : (sideStrength > 0.62 ? 0.84 : 1));
    return {
      moving,
      speed,
      direction,
      action,
      forwardAmount,
      sideAmount,
      relativeAngle,
      lowerBodyYaw,
      upperBodyYaw: -lowerBodyYaw,
      playbackRate,
      strideScale
    };
  }

  function characterLocomotionBlend(current, target, rate, dt) {
    const step = Math.min(1, Math.max(0.001, Number(dt || 0.016)) * Math.max(0, Number(rate || 0)));
    return Number(current || 0) + (Number(target || 0) - Number(current || 0)) * step;
  }

  function clearCharacterGlbDirectionalPose(runtime) {
    const offsets = Array.isArray(runtime?.directionalPoseOffsets)
      ? runtime.directionalPoseOffsets
      : [];
    offsets.forEach(row => {
      if (!row?.bone?.quaternion || !row.quaternion) return;
      row.bone.quaternion.multiply(row.quaternion.clone().invert());
    });
    if (runtime) runtime.directionalPoseOffsets = [];
  }

  function addCharacterGlbDirectionalBoneOffset(runtime, bone, x = 0, y = 0, z = 0) {
    if (!runtime || !bone?.quaternion) return;
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
    bone.quaternion.multiply(quaternion);
    runtime.directionalPoseOffsets.push({ bone, quaternion });
  }

  function applyCharacterGlbDirectionalPose(runtime, locomotion, dt = 0.016) {
    if (!runtime?.root || !locomotion) return;
    runtime.directionalMoveBlend = characterLocomotionBlend(
      runtime.directionalMoveBlend,
      locomotion.moving ? 1 : 0,
      locomotion.moving ? 9 : 6,
      dt
    );
    runtime.directionalLowerBodyYaw = characterLocomotionBlend(
      runtime.directionalLowerBodyYaw,
      locomotion.lowerBodyYaw,
      locomotion.moving ? 8.5 : 6.5,
      dt
    );
    runtime.directionalSideAmount = characterLocomotionBlend(
      runtime.directionalSideAmount,
      locomotion.sideAmount,
      9,
      dt
    );
    runtime.directionalForwardAmount = characterLocomotionBlend(
      runtime.directionalForwardAmount,
      locomotion.forwardAmount,
      9,
      dt
    );
    const moveBlend = runtime.directionalMoveBlend;
    const lowerBodyYaw = runtime.directionalLowerBodyYaw * moveBlend;
    const counterYaw = -lowerBodyYaw;
    const side = runtime.directionalSideAmount * moveBlend;
    const forward = runtime.directionalForwardAmount;
    const backwardLean = Math.max(0, -forward) * moveBlend;
    const forwardLean = Math.max(0, forward) * moveBlend;
    runtime.root.rotation.y = Number(runtime.baseRotationY ?? Math.PI) + lowerBodyYaw;
    const bones = runtime.locomotionBones || {};
    addCharacterGlbDirectionalBoneOffset(runtime, bones.pelvis, backwardLean * -0.025, 0, side * -0.035);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine01, forwardLean * 0.025 - backwardLean * 0.045, counterYaw * 0.25, side * -0.018);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine02, 0, counterYaw * 0.29, side * -0.012);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine03, 0, counterYaw * 0.27, side * 0.012);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.neck, 0, counterYaw * 0.11, side * 0.008);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.head, 0, counterYaw * 0.08, 0);
  }

  function setCharacterGlbAction(runtime, name = 'idle', fadeSeconds = 0.16) {
    if (!runtime?.actions) return;
    const nextName = runtime.actions[name] ? name : (runtime.actions.idle ? 'idle' : Object.keys(runtime.actions)[0]);
    if (!nextName || runtime.currentAction === nextName) return;
    const next = runtime.actions[nextName];
    const previous = runtime.actions[runtime.currentAction];
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(name === 'walk' ? 1.05 : 1);
    next.play();
    if (previous && previous !== next) previous.crossFadeTo(next, fadeSeconds, false);
    runtime.currentAction = nextName;
  }

  function captureCharacterProceduralBaseMeshes(actor, parts = {}) {
    if (!actor?.traverse || !parts) return;
    const keep = new Set([
      parts.shadow,
      parts.helmet,
      parts.backpack,
      parts.backpackTop,
      parts.bedroll,
      ...(Array.isArray(parts.packAccessories) ? parts.packAccessories : [])
    ].filter(Boolean));
    parts.proceduralCharacterBaseMeshes = [];
    actor.traverse(obj => {
      if (obj?.isMesh && !keep.has(obj)) parts.proceduralCharacterBaseMeshes.push(obj);
    });
    parts.characterRoot = actor;
  }

  function setCharacterProceduralBaseVisible(actor, visible) {
    const parts = actor?.userData?.parts || {};
    (parts.proceduralCharacterBaseMeshes || []).forEach(mesh => {
      if (mesh) mesh.visible = !!visible;
    });
  }

  function refreshCharacterGlbEquipmentLayers(actor, eq = {}) {
    const runtime = actor?.userData?.characterGlbRuntime;
    if (!runtime?.root) return;
    setCharacterProceduralBaseVisible(actor, false);
    const helmetOn = !!eq?.helmet;
    applyCharacterGlbVisualVariants(runtime.root, runtime.appearance, { helmetOn });
    if (typeof applyApprovedBootsVisual === 'function') applyApprovedBootsVisual(actor, eq);
  }

  function removeCharacterGlbRuntime(actor) {
    const runtime = actor?.userData?.characterGlbRuntime;
    if (!runtime) return;
    if (typeof restoreApprovedAssaultRifleGrip === 'function') restoreApprovedAssaultRifleGrip(actor);
    if (typeof removeApprovedBootRuntime === 'function') removeApprovedBootRuntime(actor);
    runtime.mixer?.stopAllAction?.();
    if (runtime.root?.parent) runtime.root.parent.remove(runtime.root);
    disposeCharacterGlbObject(runtime.root);
    delete actor.userData.characterGlbRuntime;
    setCharacterProceduralBaseVisible(actor, true);
  }

  function applyCharacterGlbAppearance(actor, input = {}, options = {}) {
    if (!actor?.userData) return Promise.resolve(false);
    const appearance = normalizeCharacterAppearance(input);
    const key = characterAppearanceKey(appearance);
    const current = actor.userData.characterGlbRuntime;
    if (current?.key === key && current.root) {
      current.appearance = appearance;
      actor.userData.characterAppearance = appearance;
      refreshCharacterGlbEquipmentLayers(actor, options.equipment || {});
      if (options.npcAnimations && typeof attachApprovedNpcAnimations === 'function') {
        void attachApprovedNpcAnimations(current);
      }
      return Promise.resolve(true);
    }
    const loader = characterGlbLoader();
    if (!loader) {
      setCharacterProceduralBaseVisible(actor, true);
      return Promise.resolve(false);
    }
    const requestId = Number(actor.userData.characterGlbRequestId || 0) + 1;
    actor.userData.characterGlbRequestId = requestId;
    actor.userData.characterAppearance = appearance;
    return new Promise(resolve => {
      loader.load(characterModelUrl(appearance), gltf => {
        if (actor.userData.characterGlbRequestId !== requestId) {
          disposeCharacterGlbObject(gltf?.scene);
          resolve(false);
          return;
        }
        const root = configureCharacterGlbScene(gltf.scene, {
          castShadow: options.castShadow !== false
        });
        // Исходная GLB смотрит вдоль +Z, а actor-контейнер исторически ориентирован вдоль -Z.
        // Разворачиваем только базовую GLB, чтобы лицо, оружие и курсор совпадали по направлению.
        root.rotation.y = Math.PI;
        root.scale.setScalar(Math.max(0.1, Number(options.modelScale || 1) || 1));
        root.name = `character_glb_${key}`;
        root.traverse(node => {
          if (actor.userData.enemy) node.userData.enemy = actor.userData.enemy;
          if (actor.userData.traderNpc) node.userData.traderNpc = actor.userData.traderNpc;
          if (actor.userData.remotePlayerRow) node.userData.remotePlayerRow = actor.userData.remotePlayerRow;
        });
        const mixer = new THREE.AnimationMixer(root);
        const runtime = {
          key,
          appearance,
          root,
          mixer,
          actions: characterGlbActions(mixer, gltf.animations || []),
          approvedAssaultRifleRestPose: typeof captureApprovedAssaultRifleRestPose === 'function'
            ? captureApprovedAssaultRifleRestPose(root)
            : null,
          currentAction: '',
          baseRotationY: Math.PI,
          modelScale: Math.max(0.1, Number(options.modelScale || 1) || 1),
          directionalMoveBlend: 0,
          directionalLowerBodyYaw: 0,
          directionalSideAmount: 0,
          directionalForwardAmount: 1,
          directionalPlaybackRate: 1,
          directionalWasMoving: false,
          directionalPoseOffsets: [],
          locomotionBones: {
            pelvis: root.getObjectByName('pelvis'),
            spine01: root.getObjectByName('spine_01'),
            spine02: root.getObjectByName('spine_02'),
            spine03: root.getObjectByName('spine_03'),
            neck: root.getObjectByName('neck_01'),
            head: root.getObjectByName('head')
          }
        };
        const previous = actor.userData.characterGlbRuntime;
        actor.add(root);
        actor.userData.characterGlbRuntime = runtime;
        setCharacterGlbAction(runtime, 'idle', 0);
        refreshCharacterGlbEquipmentLayers(actor, options.equipment || {});
        if (options.npcAnimations && typeof attachApprovedNpcAnimations === 'function') {
          void attachApprovedNpcAnimations(runtime);
        }
        if (previous?.root && previous.root !== root) {
          previous.mixer?.stopAllAction?.();
          previous.root.parent?.remove(previous.root);
          disposeCharacterGlbObject(previous.root);
        }
        resolve(true);
      }, undefined, error => {
        console.warn(`Character model failed to load (${key}):`, error);
        if (actor.userData.characterGlbRequestId === requestId) {
          setCharacterProceduralBaseVisible(actor, true);
        }
        resolve(false);
      });
    });
  }

  function updateCharacterGlbAnimation(actor, dt = 0.016, state = {}) {
    const runtime = actor?.userData?.characterGlbRuntime;
    if (!runtime?.mixer) return false;
    const frameDt = Math.max(0, Math.min(0.08, Number(dt || 0.016)));
    const locomotion = characterDirectionalLocomotionState(state);
    const requestedAction = state.dead && runtime.actions?.death
      ? 'death'
      : (state.hurt && runtime.actions?.hurt
        ? 'hurt'
        : (state.attacking && runtime.actions?.attack ? 'attack' : locomotion.action));
    setCharacterGlbAction(runtime, requestedAction, requestedAction === locomotion.action ? 0.16 : 0.08);
    if (locomotion.moving && !runtime.directionalWasMoving) {
      runtime.directionalPlaybackRate = locomotion.playbackRate;
    }
    runtime.directionalPlaybackRate = characterLocomotionBlend(
      runtime.directionalPlaybackRate,
      locomotion.playbackRate,
      locomotion.playbackRate < 0 ? 7 : 9,
      frameDt
    );
    const action = runtime.actions?.[runtime.currentAction];
    if (action) {
      const baseRate = runtime.currentAction === 'walk' ? 1.05 : 1;
      action.setEffectiveTimeScale(baseRate * runtime.directionalPlaybackRate);
    }
    clearCharacterGlbDirectionalPose(runtime);
    runtime.root.position.y = state.crouching ? -0.13 : 0;
    runtime.mixer.update(frameDt);
    applyCharacterFaceShapeFrame(runtime.root);
    applyCharacterGlbDirectionalPose(runtime, locomotion, frameDt);
    actor.userData.characterLocomotionDirection = locomotion.direction;
    actor.userData.characterLocomotionForwardAmount = locomotion.forwardAmount;
    actor.userData.characterLocomotionSideAmount = locomotion.sideAmount;
    runtime.directionalWasMoving = locomotion.moving;
    return true;
  }

  function setCharacterPreviewStatus(message = '', tone = '') {
    const status = document.getElementById('character-model-preview-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function resizeCharacterPreview() {
    const canvas = document.getElementById('character-model-preview');
    const renderer = characterPreviewState.renderer;
    const camera = characterPreviewState.camera;
    if (!canvas || !renderer || !camera) return;
    const width = Math.max(220, Math.round(canvas.clientWidth || 360));
    const height = Math.max(220, Math.round(canvas.clientHeight || 300));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function releaseCharacterCreationPreview() {
    characterPreviewState.requestId += 1;
    characterPreviewState.requestedKey = '';
    characterPreviewState.loadedKey = '';
    characterPreviewState.loadedAppearanceKey = '';
    characterPreviewState.requestedAppearance = null;
    characterPreviewState.mixer?.stopAllAction?.();
    characterPreviewState.mixer = null;
    if (characterPreviewState.model) {
      characterPreviewState.scene?.remove(characterPreviewState.model);
      disposeCharacterGlbObject(characterPreviewState.model);
      characterPreviewState.model = null;
    }
    setCharacterPreviewStatus('', '');
  }

  function ensureCharacterPreview() {
    if (characterPreviewState.renderer) return true;
    const canvas = document.getElementById('character-model-preview');
    if (!canvas || !THREE.WebGLRenderer) return false;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: !IS_MOBILE_DEVICE,
      powerPreference: IS_MOBILE_DEVICE ? 'low-power' : 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_MOBILE_DEVICE ? 1.15 : 1.5));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const previewScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
    camera.position.set(2.45, 1.45, 3.15);
    camera.lookAt(0, 0.92, 0);
    const key = new THREE.DirectionalLight(0xffd69b, 2.1);
    key.position.set(-2.6, 4.2, 2.8);
    const fill = new THREE.DirectionalLight(0x8ba9bd, 1.05);
    fill.position.set(2.4, 2.2, -2.1);
    const rim = new THREE.DirectionalLight(0xd77b4e, 0.75);
    rim.position.set(0, 2.4, -3);
    previewScene.add(new THREE.HemisphereLight(0xc6d2c0, 0x1c1712, 1.35), key, fill, rim);
    characterPreviewState.renderer = renderer;
    characterPreviewState.scene = previewScene;
    characterPreviewState.camera = camera;
    resizeCharacterPreview();
    if (window.ResizeObserver) {
      characterPreviewState.resizeObserver = new ResizeObserver(resizeCharacterPreview);
      characterPreviewState.resizeObserver.observe(canvas);
    }
    canvas.addEventListener('pointermove', event => {
      const rect = canvas.getBoundingClientRect();
      characterPreviewState.pointerX = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1));
      characterPreviewState.pointerActive = true;
    }, { passive: true });
    canvas.addEventListener('pointerleave', () => {
      characterPreviewState.pointerX = 0;
      characterPreviewState.pointerActive = false;
    }, { passive: true });
    const frame = now => {
      characterPreviewState.animationFrame = requestAnimationFrame(frame);
      const panel = document.getElementById('character-creator-panel');
      if (!panel?.classList.contains('active') || document.hidden) {
        characterPreviewState.lastFrameAt = now;
        return;
      }
      const previous = characterPreviewState.lastFrameAt || now;
      const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      characterPreviewState.lastFrameAt = now;
      characterPreviewState.mixer?.update(dt);
      if (characterPreviewState.model) {
        applyCharacterFaceShapeFrame(characterPreviewState.model);
        characterPreviewState.model.updateMatrixWorld(true);
        const faceCameraYaw = Math.atan2(camera.position.x, camera.position.z);
        const pointerOffset = characterPreviewState.pointerActive
          ? characterPreviewState.pointerX * 0.34
          : Math.sin(now / 4200) * 0.08;
        const targetYaw = faceCameraYaw + pointerOffset;
        characterPreviewState.model.rotation.y += (targetYaw - characterPreviewState.model.rotation.y)
          * Math.min(1, dt * 8);
      }
      renderer.render(previewScene, camera);
    };
    characterPreviewState.animationFrame = requestAnimationFrame(frame);
    return true;
  }

  function setCharacterCreationPreviewAppearance(input = {}) {
    if (!ensureCharacterPreview()) return;
    const appearance = normalizeCharacterAppearance(input);
    const key = characterAppearanceKey(appearance);
    const appearanceKey = `${key}:${appearance.faceId}:${appearance.hairId}:${appearance.hairColorId}`;
    characterPreviewState.requestedAppearance = appearance;
    if (characterPreviewState.loadedKey === key && characterPreviewState.model) {
      if (characterPreviewState.requestedKey !== key) {
        characterPreviewState.requestId += 1;
        characterPreviewState.requestedKey = key;
      }
      if (characterPreviewState.loadedAppearanceKey !== appearanceKey) {
        applyCharacterGlbVisualVariants(characterPreviewState.model, appearance);
        characterPreviewState.loadedAppearanceKey = appearanceKey;
      }
      setCharacterPreviewStatus(characterAppearanceLabel(appearance), 'ready');
      return;
    }
    if (characterPreviewState.requestedKey === key) {
      setCharacterPreviewStatus(`Загрузка: ${characterAppearanceLabel(appearance)}…`, 'loading');
      return;
    }
    characterPreviewState.requestedKey = key;
    const requestId = characterPreviewState.requestId + 1;
    characterPreviewState.requestId = requestId;
    setCharacterPreviewStatus(`Загрузка: ${characterAppearanceLabel(appearance)}…`, 'loading');
    const loader = characterGlbLoader();
    if (!loader) {
      setCharacterPreviewStatus('Предпросмотр GLB недоступен.', 'error');
      return;
    }
    loader.load(characterModelUrl(appearance), gltf => {
      if (characterPreviewState.requestId !== requestId) {
        disposeCharacterGlbObject(gltf?.scene);
        return;
      }
      const model = configureCharacterGlbScene(gltf.scene, { castShadow: false });
      const requestedAppearance = normalizeCharacterAppearance(
        characterPreviewState.requestedAppearance || appearance
      );
      const requestedAppearanceKey = `${key}:${requestedAppearance.faceId}:${requestedAppearance.hairId}:${requestedAppearance.hairColorId}`;
      applyCharacterGlbVisualVariants(model, requestedAppearance);
      const previous = characterPreviewState.model;
      if (previous) {
        characterPreviewState.scene.remove(previous);
        characterPreviewState.mixer?.stopAllAction?.();
        disposeCharacterGlbObject(previous);
      }
      characterPreviewState.model = model;
      characterPreviewState.mixer = new THREE.AnimationMixer(model);
      const actions = characterGlbActions(characterPreviewState.mixer, gltf.animations || []);
      if (actions.idle) actions.idle.play();
      characterPreviewState.scene.add(model);
      characterPreviewState.loadedKey = key;
      characterPreviewState.loadedAppearanceKey = requestedAppearanceKey;
      setCharacterPreviewStatus(characterAppearanceLabel(requestedAppearance), 'ready');
      resizeCharacterPreview();
    }, undefined, error => {
      console.warn(`Character preview failed to load (${key}):`, error);
      if (characterPreviewState.requestId === requestId) {
        setCharacterPreviewStatus('Не удалось загрузить модель.', 'error');
      }
    });
  }
