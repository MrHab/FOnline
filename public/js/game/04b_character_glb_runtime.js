  // ===== APPROVED CHARACTER GLB RUNTIME / CREATOR PREVIEW =====
  const CHARACTER_APPEARANCE_SCHEMA = 'realm.character-appearance.v1';
  const CHARACTER_SEXES = ['female', 'male'];
  const CHARACTER_BODY_TYPES = ['slim', 'medium', 'large'];
  const CHARACTER_FACE_OPTIONS = {
    female: [
      { id: 'female_01', label: 'Классическое' },
      { id: 'female_02', label: 'Обветренное' },
      { id: 'female_03', label: 'Со шрамом' }
    ],
    male: [
      { id: 'male_01', label: 'Классическое' },
      { id: 'male_02', label: 'Обветренное' },
      { id: 'male_03', label: 'Со шрамом' }
    ]
  };
  const CHARACTER_HAIR_OPTIONS = [
    { id: 'short_crop', label: 'Короткая' },
    { id: 'tied_back', label: 'Собранная' },
    { id: 'mohawk', label: 'Ирокез' },
    { id: 'shaved', label: 'Без волос' }
  ];
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
    return {
      ...defaults,
      bodyType,
      faceId,
      hairId
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
    return [
      CHARACTER_SEX_LABELS[appearance.sex],
      CHARACTER_BODY_TYPE_LABELS[appearance.bodyType],
      face?.label || appearance.faceId,
      hair?.label || appearance.hairId
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
      obj.geometry?.dispose?.();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => {
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
    return new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.9,
      metalness: 0,
      flatShading: true,
      transparent: !!options.transparent,
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite !== false
    });
  }

  function attachCharacterVariantToHead(root, group) {
    if (!root || !group) return;
    root.add(group);
    root.updateMatrixWorld(true);
    const head = root.getObjectByName?.('head');
    if (head?.attach) head.attach(group);
  }

  function addCharacterShortHair(group, material, tiedBack = false) {
    const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.112, 0), material);
    cap.name = 'hair_variant_cap';
    cap.position.set(0, 1.81, -0.006);
    cap.scale.set(0.94, 0.56, 1.02);
    group.add(cap);
    [-1, 0, 1].forEach(index => {
      const lock = new THREE.Mesh(new THREE.TetrahedronGeometry(0.045, 0), material);
      lock.name = `hair_variant_lock_${index}`;
      lock.position.set(index * 0.052, 1.795 - Math.abs(index) * 0.008, 0.092);
      lock.rotation.set(-0.18, index * 0.14, index * -0.12);
      lock.scale.set(0.75, 1.05, 0.65);
      group.add(lock);
    });
    if (!tiedBack) return;
    const knot = new THREE.Mesh(new THREE.DodecahedronGeometry(0.064, 0), material);
    knot.name = 'hair_variant_knot';
    knot.position.set(0, 1.77, -0.125);
    knot.scale.set(0.9, 0.9, 0.78);
    group.add(knot);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.048, 0.17, 5), material);
    tail.name = 'hair_variant_tail';
    tail.position.set(0, 1.66, -0.135);
    tail.rotation.x = -0.12;
    group.add(tail);
  }

  function addCharacterMohawk(group, material) {
    const halfWidth = 0.034;
    const bottom = 1.838;
    const top = 1.912;
    const front = 0.112;
    const back = -0.112;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -halfWidth, bottom, front,
      halfWidth, bottom, front,
      0, top, front,
      -halfWidth, bottom, back,
      halfWidth, bottom, back,
      0, top, back
    ], 3));
    geometry.setIndex([
      0, 1, 2,
      3, 5, 4,
      0, 2, 5, 0, 5, 3,
      1, 4, 5, 1, 5, 2,
      0, 3, 4, 0, 4, 1
    ]);
    geometry.computeVertexNormals();
    const crest = new THREE.Mesh(geometry, material);
    crest.name = 'hair_variant_mohawk_crest';
    group.add(crest);
  }

  function addCharacterFaceVariant(group, appearance) {
    if (appearance.faceId.endsWith('_02')) {
      const weathering = characterVariantMaterial(0x6f4a36, {
        roughness: 1,
        transparent: true,
        opacity: 0.58,
        depthWrite: false
      });
      [-1, 1].forEach(side => {
        const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.027, 5), weathering);
        cheek.name = `face_variant_weathered_${side < 0 ? 'l' : 'r'}`;
        cheek.position.set(side * 0.062, 1.678, 0.132);
        cheek.scale.set(1.3, 0.52, 1);
        cheek.rotation.z = side * 0.18;
        group.add(cheek);
      });
      return;
    }
    if (!appearance.faceId.endsWith('_03')) return;
    const scarMaterial = characterVariantMaterial(0x8a4a3a, {
      roughness: 1,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });
    [
      { y: 1.712, h: 0.052, angle: -0.48 },
      { y: 1.674, h: 0.032, angle: -0.32 }
    ].forEach((mark, index) => {
      const scar = new THREE.Mesh(new THREE.BoxGeometry(0.008, mark.h, 0.004), scarMaterial);
      scar.name = `face_variant_scar_${index}`;
      scar.position.set(0.056 + index * 0.008, mark.y, 0.135);
      scar.rotation.z = mark.angle;
      group.add(scar);
    });
  }

  function applyCharacterFaceShape(root, appearance) {
    const head = root?.getObjectByName?.('head');
    if (!head?.scale) return;
    if (!Array.isArray(head.userData?.characterAppearanceBaseScale)) {
      head.userData.characterAppearanceBaseScale = [head.scale.x, head.scale.y, head.scale.z];
    }
    const factors = appearance.faceId.endsWith('_02')
      ? [1.06, 1, 0.98]
      : (appearance.faceId.endsWith('_03') ? [0.96, 1.025, 1.03] : [1, 1, 1]);
    head.userData.characterAppearanceScaleFactors = factors;
    const [baseX, baseY, baseZ] = head.userData.characterAppearanceBaseScale;
    head.scale.set(baseX * factors[0], baseY * factors[1], baseZ * factors[2]);
  }

  function applyCharacterFaceShapeFrame(root) {
    const head = root?.getObjectByName?.('head');
    const factors = head?.userData?.characterAppearanceScaleFactors;
    if (!head?.scale || !Array.isArray(factors)) return;
    head.scale.x *= factors[0];
    head.scale.y *= factors[1];
    head.scale.z *= factors[2];
  }

  function applyCharacterGlbVisualVariants(root, input = {}, options = {}) {
    if (!root?.traverse) return;
    const appearance = normalizeCharacterAppearance(input);
    const helmetOn = !!options.helmetOn;
    const appearanceKey = `${appearance.faceId}:${appearance.hairId}:${helmetOn ? 1 : 0}`;
    if (root.userData?.characterAppearanceKey === appearanceKey) return;
    applyCharacterFaceShape(root, appearance);
    const sourceHairId = appearance.sex === 'female' ? 'tied_back' : 'short_crop';
    root.traverse(obj => {
      if (!obj || obj.userData?.characterAppearanceVariant) return;
      const layer = String(obj.userData?.realm_character_layer || '').toLowerCase();
      const name = String(obj.name || '').toLowerCase();
      if (layer === 'hair' || name.startsWith('hair_')) {
        obj.visible = !helmetOn && appearance.hairId === sourceHairId;
      }
    });
    const previous = root.userData?.characterAppearanceVariantGroup;
    if (previous?.parent) previous.parent.remove(previous);
    if (previous) disposeCharacterGlbObject(previous);
    const group = new THREE.Group();
    group.name = 'character_appearance_variants';
    group.userData.characterAppearanceVariant = true;
    const hairMaterial = characterVariantMaterial(0x2d241e, { roughness: 0.94 });
    if (!helmetOn && appearance.hairId === 'short_crop' && sourceHairId !== 'short_crop') {
      addCharacterShortHair(group, hairMaterial, false);
    } else if (!helmetOn && appearance.hairId === 'tied_back' && sourceHairId !== 'tied_back') {
      addCharacterShortHair(group, hairMaterial, true);
    } else if (!helmetOn && appearance.hairId === 'mohawk') {
      addCharacterMohawk(group, hairMaterial);
    } else {
      hairMaterial.dispose();
    }
    addCharacterFaceVariant(group, appearance);
    if (group.children.length) {
      group.traverse(obj => {
        if (!obj?.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = false;
        obj.frustumCulled = false;
      });
      attachCharacterVariantToHead(root, group);
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
      action.setLoop(THREE.LoopRepeat, Infinity);
      actions[key] = action;
    });
    return actions;
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
  }

  function removeCharacterGlbRuntime(actor) {
    const runtime = actor?.userData?.characterGlbRuntime;
    if (!runtime) return;
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
        root.name = `character_glb_${key}`;
        const mixer = new THREE.AnimationMixer(root);
        const runtime = {
          key,
          appearance,
          root,
          mixer,
          actions: characterGlbActions(mixer, gltf.animations || []),
          currentAction: ''
        };
        const previous = actor.userData.characterGlbRuntime;
        actor.add(root);
        actor.userData.characterGlbRuntime = runtime;
        setCharacterGlbAction(runtime, 'idle', 0);
        refreshCharacterGlbEquipmentLayers(actor, options.equipment || {});
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
    const moving = !!state.moving;
    const speed = Math.max(0, Number(state.speed || 0));
    const action = moving ? (speed > 5.35 ? 'run' : 'walk') : 'idle';
    setCharacterGlbAction(runtime, action);
    runtime.root.position.y = state.crouching ? -0.13 : 0;
    runtime.mixer.update(Math.max(0, Math.min(0.08, Number(dt || 0.016))));
    applyCharacterFaceShapeFrame(runtime.root);
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
    const appearanceKey = `${key}:${appearance.faceId}:${appearance.hairId}`;
    if (characterPreviewState.loadedKey === key && characterPreviewState.model) {
      if (characterPreviewState.loadedAppearanceKey !== appearanceKey) {
        applyCharacterGlbVisualVariants(characterPreviewState.model, appearance);
        characterPreviewState.loadedAppearanceKey = appearanceKey;
      }
      setCharacterPreviewStatus(characterAppearanceLabel(appearance), 'ready');
      return;
    }
    if (characterPreviewState.requestedKey === key) return;
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
      applyCharacterGlbVisualVariants(model, appearance);
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
      characterPreviewState.loadedAppearanceKey = appearanceKey;
      setCharacterPreviewStatus(characterAppearanceLabel(appearance), 'ready');
      resizeCharacterPreview();
    }, undefined, error => {
      console.warn(`Character preview failed to load (${key}):`, error);
      if (characterPreviewState.requestId === requestId) {
        setCharacterPreviewStatus('Не удалось загрузить модель.', 'error');
      }
    });
  }
