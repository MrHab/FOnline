  // ===== APPROVED CHARACTER GLB RUNTIME / CREATOR PREVIEW =====
  const CHARACTER_APPEARANCE_SCHEMA = 'realm.character-appearance.v1';
  const CHARACTER_SEXES = ['female', 'male'];
  const CHARACTER_BODY_TYPES = ['slim', 'medium', 'large'];
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
    requestId: 0,
    resizeObserver: null
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

  function normalizeCharacterAppearance(input = {}) {
    const sex = CHARACTER_SEXES.includes(String(input?.sex || ''))
      ? String(input.sex)
      : 'male';
    const bodyType = CHARACTER_BODY_TYPES.includes(String(input?.bodyType || ''))
      ? String(input.bodyType)
      : 'medium';
    const defaults = defaultCharacterAppearance(sex);
    return {
      ...defaults,
      bodyType
    };
  }

  function characterAppearanceKey(input = {}) {
    const appearance = normalizeCharacterAppearance(input);
    return `${appearance.sex}_${appearance.bodyType}`;
  }

  function characterAppearanceLabel(input = {}) {
    const appearance = normalizeCharacterAppearance(input);
    return `${CHARACTER_SEX_LABELS[appearance.sex]} · ${CHARACTER_BODY_TYPE_LABELS[appearance.bodyType]}`;
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
    runtime.root.traverse(obj => {
      if (!obj) return;
      const name = String(obj.name || '').toLowerCase();
      if (name.includes('hair')) obj.visible = !helmetOn;
    });
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
        characterPreviewState.model.rotation.y = Math.sin(now / 4200) * 0.2;
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
      setCharacterPreviewStatus(characterAppearanceLabel(appearance), 'ready');
      resizeCharacterPreview();
    }, undefined, error => {
      console.warn(`Character preview failed to load (${key}):`, error);
      if (characterPreviewState.requestId === requestId) {
        setCharacterPreviewStatus('Не удалось загрузить модель.', 'error');
      }
    });
  }
