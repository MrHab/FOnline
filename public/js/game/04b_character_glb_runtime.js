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
    { id: 'shaved', label: 'Без волос', sexes: ['female', 'male'] },
    { id: 'short_crop', label: 'Короткая', sexes: ['male'] },
    { id: 'tied_back', label: 'Собранная', sexes: ['female'] }
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

  function characterHairOptionsForSex(sex = 'male') {
    const normalizedSex = CHARACTER_SEXES.includes(String(sex || '')) ? String(sex) : 'male';
    return CHARACTER_HAIR_OPTIONS.filter(option => option.sexes.includes(normalizedSex));
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
    const hairOptions = characterHairOptionsForSex(sex);
    const hairId = hairOptions.some(option => option.id === String(input?.hairId || ''))
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
    const hair = characterAppearanceOption(characterHairOptionsForSex(appearance.sex), appearance.hairId);
    const hairColor = characterAppearanceOption(CHARACTER_HAIR_COLOR_OPTIONS, appearance.hairColorId);
    return [
      CHARACTER_SEX_LABELS[appearance.sex],
      CHARACTER_BODY_TYPE_LABELS[appearance.bodyType],
      face?.label || appearance.faceId,
      hair?.label || appearance.hairId,
      hairColor?.label || appearance.hairColorId
    ].join(' · ');
  }

  // Content fingerprints come from the deterministic character manifest. They
  // keep the long-lived production cache safe when a body GLB is regenerated
  // under the same canonical filename.
  const CHARACTER_GLB_ASSET_VERSIONS = Object.freeze({
    female_slim: '7b93c9b064f41116',
    female_medium: 'f8cf08e4c8cdc20d',
    female_large: '8da5199fbfea9683',
    male_slim: 'dbdbf0e4cdbc1f4b',
    male_medium: '55b8394edc670092',
    male_large: '7b9b70759f25bfed'
  });

  function characterModelUrl(input = {}) {
    const key = characterAppearanceKey(input);
    const baseUrl = `/assets/models/characters/base/character_${key}.glb`;
    const version = CHARACTER_GLB_ASSET_VERSIONS[key] || 'character-glb-v1';
    return `${baseUrl}?v=${encodeURIComponent(version)}`;
  }

  function characterGlbLoader() {
    return THREE.GLTFLoader ? new THREE.GLTFLoader() : null;
  }

  // Parsed character bases are immutable templates. Loading the same 4-5 MiB
  // body once per NPC/player made crowded joins spend most of their time
  // repeatedly parsing identical GLB data. Instances keep their own scene and
  // skeleton, while geometry, textures and animation clips are shared. Material
  // wrappers stay per-instance because hit flashes and reveal fading mutate them.
  const characterGlbTemplateCache = new Map();
  const CHARACTER_GLB_FLIGHT_RETRY_DELAYS_MS = Object.freeze([450, 1_200, 2_800]);
  const CHARACTER_GLB_RETRY_COOLDOWN_MS = 8_000;
  const CHARACTER_GLB_ACTOR_RETRY_MAX_DELAY_MS = 30_000;
  let characterGlbLoadRevision = 0;

  function markCharacterGlbMaterialTexturesShared(material) {
    if (!material || typeof material !== 'object') return;
    Object.values(material).forEach(value => {
      if (!value?.isTexture) return;
      value.userData = value.userData || {};
      value.userData.characterGlbSharedTexture = true;
    });
  }

  function markCharacterGlbTemplateMaterial(material) {
    if (!material) return material;
    material.userData = material.userData || {};
    material.userData.characterGlbTemplateMaterial = true;
    material.userData.characterGlbInstanceMaterial = false;
    material.userData.characterGlbSharedTextures = true;
    markCharacterGlbMaterialTexturesShared(material);
    return material;
  }

  function markCharacterGlbTemplateShared(root) {
    root?.traverse?.(node => {
      if (!node?.isMesh) return;
      node.userData.characterGlbSharedGeometry = true;
      node.userData.characterGlbSharedMaterial = true;
      node.userData.characterGlbSharedAsset = true;
      node.userData.characterGlbTemplateSource = true;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.filter(Boolean).forEach(markCharacterGlbTemplateMaterial);
    });
    return root;
  }

  function cloneCharacterGlbInstanceMaterial(material) {
    if (!material?.clone) return null;
    const instance = material.clone();
    instance.userData = instance.userData || {};
    instance.userData.characterGlbTemplateMaterial = false;
    instance.userData.characterGlbInstanceMaterial = true;
    instance.userData.characterGlbSharedTextures = true;
    return instance;
  }

  function cloneCharacterGlbTemplateScene(source) {
    if (!source?.clone) return null;
    const clone = source.clone(true);
    const sourceNodes = [];
    const cloneNodes = [];
    source.traverse(node => sourceNodes.push(node));
    clone.traverse(node => cloneNodes.push(node));
    const clonedNodeBySource = new Map(
      sourceNodes.map((node, index) => [node, cloneNodes[index]])
    );
    const instanceMaterials = new Set();
    let cloneFailed = false;
    sourceNodes.forEach((sourceNode, index) => {
      if (sourceNode?.isMesh) {
        const cloneNode = cloneNodes[index];
        const sourceMaterials = Array.isArray(sourceNode.material)
          ? sourceNode.material
          : [sourceNode.material];
        const clonedMaterials = sourceMaterials.map(material => cloneCharacterGlbInstanceMaterial(material));
        clonedMaterials.filter(Boolean).forEach(material => instanceMaterials.add(material));
        if (clonedMaterials.some(material => !material)) {
          cloneFailed = true;
        } else if (cloneNode?.isMesh) {
          cloneNode.material = Array.isArray(sourceNode.material) ? clonedMaterials : clonedMaterials[0];
          cloneNode.userData = cloneNode.userData || {};
          cloneNode.userData.characterGlbSharedGeometry = true;
          cloneNode.userData.characterGlbSharedMaterial = false;
          cloneNode.userData.characterGlbSharedAsset = false;
          cloneNode.userData.characterGlbTemplateSource = false;
          cloneNode.userData.characterGlbInstanceMaterial = true;
        } else {
          cloneFailed = true;
        }
      }
      if (!sourceNode?.isSkinnedMesh || !sourceNode.skeleton) return;
      const cloneNode = cloneNodes[index];
      if (!cloneNode?.isSkinnedMesh) {
        cloneFailed = true;
        return;
      }
      const bones = sourceNode.skeleton.bones.map(bone => clonedNodeBySource.get(bone));
      if (bones.some(bone => !bone)) {
        cloneFailed = true;
        return;
      }
      cloneNode.bind(
        new THREE.Skeleton(
          bones,
          sourceNode.skeleton.boneInverses.map(matrix => matrix.clone())
        ),
        sourceNode.bindMatrix.clone()
      );
    });
    if (cloneFailed) instanceMaterials.forEach(material => material.dispose?.());
    return cloneFailed ? null : clone;
  }

  function loadCharacterGlbTemplate(input = {}) {
    const appearance = normalizeCharacterAppearance(input);
    const key = characterAppearanceKey(appearance);
    let state = characterGlbTemplateCache.get(key);
    if (!state) {
      state = {
        key,
        source: null,
        animations: [],
        promise: null,
        failureCount: 0,
        nextRetryAt: 0
      };
      characterGlbTemplateCache.set(key, state);
    }
    if (state.source) return Promise.resolve(state);
    if (state.promise) return state.promise;
    const loader = characterGlbLoader();
    if (!loader) return Promise.resolve(null);
    state.promise = new Promise(resolve => {
      let flightAttempt = 0;
      const finishFailure = error => {
        characterGlbLoadRevision += 1;
        state.failureCount = Math.max(0, Number(state.failureCount || 0)) + 1;
        const retryIndex = Math.min(
          flightAttempt,
          CHARACTER_GLB_FLIGHT_RETRY_DELAYS_MS.length - 1
        );
        const retryDelay = CHARACTER_GLB_FLIGHT_RETRY_DELAYS_MS[retryIndex];
        state.nextRetryAt = Date.now() + retryDelay;
        if (flightAttempt < CHARACTER_GLB_FLIGHT_RETRY_DELAYS_MS.length - 1) {
          flightAttempt += 1;
          setTimeout(runAttempt, retryDelay);
          return;
        }
        state.nextRetryAt = Date.now() + CHARACTER_GLB_RETRY_COOLDOWN_MS;
        console.warn(`Character model failed to load (${key}); GLB-only actor stays hidden until retry.`, error);
        resolve(null);
      };
      const runAttempt = () => {
        const activeLoader = characterGlbLoader();
        if (!activeLoader) {
          finishFailure(new Error('THREE.GLTFLoader is unavailable'));
          return;
        }
        characterGlbLoadRevision += 1;
        activeLoader.load(characterModelUrl(appearance), gltf => {
          const source = gltf?.scene || gltf?.scenes?.[0] || null;
          if (!source) {
            finishFailure(new Error('GLB has no runtime scene'));
            return;
          }
          state.source = markCharacterGlbTemplateShared(source);
          state.animations = Array.isArray(gltf?.animations) ? gltf.animations : [];
          state.failureCount = 0;
          state.nextRetryAt = 0;
          characterGlbLoadRevision += 1;
          resolve(state);
        }, undefined, finishFailure);
      };
      const initialDelay = Math.max(0, Number(state.nextRetryAt || 0) - Date.now());
      if (initialDelay > 0) setTimeout(runAttempt, initialDelay);
      else runAttempt();
    }).finally(() => {
      state.promise = null;
    });
    return state.promise;
  }

  function preloadCharacterAppearanceAsset(input = {}) {
    return loadCharacterGlbTemplate(input).then(template => !!template?.source);
  }

  function pendingCharacterGlbAssetSnapshot() {
    const states = Array.from(characterGlbTemplateCache.values());
    const activeStates = states.filter(state => !!state?.promise);
    const promises = Array.from(new Set(activeStates.map(state => state.promise)));
    const failedStates = states.filter(state => (
      !state?.source
      && !state?.promise
      && Number(state?.failureCount || 0) > 0
    ));
    return {
      revision: characterGlbLoadRevision,
      promises,
      activeCount: activeStates.length,
      unresolvedCount: activeStates.length + failedStates.length,
      retryScheduledCount: failedStates.length
    };
  }

  function waitForPendingCharacterGlbAssets(options = {}) {
    if (typeof waitForGlbAssetQuiescence === 'function') {
      return waitForGlbAssetQuiescence(pendingCharacterGlbAssetSnapshot, options);
    }
    const snapshot = pendingCharacterGlbAssetSnapshot();
    if (!snapshot.promises.length) return Promise.resolve(snapshot.unresolvedCount === 0);
    return Promise.allSettled(snapshot.promises)
      .then(() => pendingCharacterGlbAssetSnapshot().unresolvedCount === 0);
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
    const disposedMaterials = new Set();
    root.traverse(obj => {
      if (!obj?.isMesh) return;
      const sharedGeometry = !!(
        (typeof isSharedWorldGeometry === 'function' && isSharedWorldGeometry(obj.geometry))
        || obj.userData?.approvedEquipmentSharedAsset
        || obj.userData?.weaponSharedAsset
        || obj.userData?.characterGlbSharedGeometry
        || obj.userData?.characterGlbSharedAsset
      );
      if (!sharedGeometry) obj.geometry?.dispose?.();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => {
        if (disposedMaterials.has(material)) return;
        disposedMaterials.add(material);
        const instanceMaterial = !!(
          material.userData?.characterGlbInstanceMaterial
          || material.userData?.networkRevealManaged
          || obj.userData?.characterGlbInstanceMaterial
        );
        if (instanceMaterial) {
          // Material.clone() retains the immutable template textures. Release
          // only the mutable wrapper; maps remain owned by the template cache.
          material.dispose?.();
          return;
        }
        const sharedMaterial = !!(
          (typeof isSharedWorldMaterial === 'function' && isSharedWorldMaterial(material))
          || material.userData?.characterGlbTemplateMaterial
          || obj.userData?.approvedEquipmentSharedAsset
          || obj.userData?.weaponSharedAsset
          || (obj.userData?.characterGlbTemplateSource && obj.userData?.characterGlbSharedMaterial)
        );
        if (sharedMaterial) return;
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

  function enableConservativeCharacterFrustumCulling(obj, minimumRadius = 2.4) {
    if (!obj?.isMesh) return;
    const geometry = obj.geometry;
    if (geometry && !geometry.boundingSphere && typeof geometry.computeBoundingSphere === 'function') {
      geometry.computeBoundingSphere();
    }
    if (geometry?.boundingSphere && Number.isFinite(Number(geometry.boundingSphere.radius))) {
      // Skinned meshes keep bind-pose bounds in this Three.js version. Expand
      // them enough for locomotion, recoil and equipment so culling cannot clip
      // a visible limb while still skipping whole actors outside the camera.
      geometry.userData = geometry.userData || {};
      const baseRadius = Number.isFinite(Number(geometry.userData.realmCharacterCullBaseRadius))
        ? Number(geometry.userData.realmCharacterCullBaseRadius)
        : Number(geometry.boundingSphere.radius || 0);
      geometry.userData.realmCharacterCullBaseRadius = baseRadius;
      geometry.boundingSphere.radius = Math.max(
        Number(minimumRadius || 2.4),
        baseRadius * 1.35
      );
    }
    obj.frustumCulled = true;
  }

  function characterSkinMatrixEquals(a, b) {
    if (a === b) return true;
    return !!(a && b && typeof a.equals === 'function' && a.equals(b));
  }

  function compatibleCharacterSkeletonMeshes(canonicalMesh, candidateMesh) {
    const canonicalSkeleton = canonicalMesh?.skeleton;
    const candidateSkeleton = candidateMesh?.skeleton;
    if (!canonicalMesh?.isSkinnedMesh || !candidateMesh?.isSkinnedMesh) return false;
    if (!canonicalSkeleton || !candidateSkeleton) return false;
    if (canonicalMesh.bindMode !== candidateMesh.bindMode) return false;
    if (!characterSkinMatrixEquals(canonicalMesh.bindMatrix, candidateMesh.bindMatrix)) return false;
    if (!characterSkinMatrixEquals(canonicalMesh.bindMatrixInverse, candidateMesh.bindMatrixInverse)) return false;
    if (canonicalSkeleton.bones.length !== candidateSkeleton.bones.length) return false;
    if (canonicalSkeleton.boneInverses.length !== candidateSkeleton.boneInverses.length) return false;
    for (let index = 0; index < canonicalSkeleton.bones.length; index += 1) {
      if (canonicalSkeleton.bones[index] !== candidateSkeleton.bones[index]) return false;
    }
    for (let index = 0; index < canonicalSkeleton.boneInverses.length; index += 1) {
      if (!characterSkinMatrixEquals(
        canonicalSkeleton.boneInverses[index],
        candidateSkeleton.boneInverses[index]
      )) return false;
    }
    return true;
  }

  function shareCompatibleCharacterSkeletons(root) {
    if (!root?.traverse) return 0;
    const canonicalMeshes = [];
    let sharedCount = 0;
    root.traverse(obj => {
      if (!obj?.isSkinnedMesh || !obj.skeleton) return;
      let compatibleMesh = null;
      for (const canonicalMesh of canonicalMeshes) {
        if (compatibleCharacterSkeletonMeshes(canonicalMesh, obj)) {
          compatibleMesh = canonicalMesh;
          break;
        }
      }
      if (!compatibleMesh) {
        canonicalMeshes.push(obj);
        return;
      }
      if (obj.skeleton !== compatibleMesh.skeleton) {
        obj.skeleton = compatibleMesh.skeleton;
        sharedCount += 1;
      }
    });
    return sharedCount;
  }

  function configureCharacterGlbScene(root, options = {}) {
    const castShadow = options.castShadow !== false;
    root.traverse(obj => {
      if (!obj?.isMesh) return;
      obj.castShadow = castShadow;
      obj.receiveShadow = false;
      enableConservativeCharacterFrustumCulling(obj);
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.filter(Boolean).forEach(material => {
        material.side = THREE.FrontSide;
        material.needsUpdate = true;
      });
    });
    shareCompatibleCharacterSkeletons(root);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    return root;
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

  function applyCharacterFaceShape(root, appearance) {
    const head = root?.getObjectByName?.('head');
    if (!head?.scale) return;
    // The animated frame path runs for every visible humanoid. Keep the bone
    // reference on the GLB root instead of walking the full hierarchy again on
    // every mixer tick.
    if (root?.userData) root.userData.characterFaceShapeHead = head;
    if (!Array.isArray(head.userData?.characterAppearanceBaseScale)) {
      head.userData.characterAppearanceBaseScale = [head.scale.x, head.scale.y, head.scale.z];
    }
    const factors = characterFaceFitProfile(appearance).headScale;
    head.userData.characterAppearanceScaleFactors = factors;
    const [baseX, baseY, baseZ] = head.userData.characterAppearanceBaseScale;
    head.scale.set(baseX * factors[0], baseY * factors[1], baseZ * factors[2]);
  }

  function applyCharacterFaceShapeFrame(root) {
    const head = root?.userData?.characterFaceShapeHead || root?.getObjectByName?.('head');
    if (head && root?.userData && !root.userData.characterFaceShapeHead) {
      root.userData.characterFaceShapeHead = head;
    }
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
    applyCharacterFaceShape(root, appearance);
    root.updateMatrixWorld(true);
    const hairColor = characterAppearanceOption(CHARACTER_HAIR_COLOR_OPTIONS, appearance.hairColorId);
    const hairTint = new THREE.Color(hairColor?.hex || '#4B3023');
    hairTint.convertSRGBToLinear?.();
    root.traverse(obj => {
      if (!obj || obj.userData?.characterAppearanceVariant) return;
      const layer = String(obj.userData?.realm_character_layer || '').toLowerCase();
      const name = String(obj.name || '').toLowerCase();
      if (layer === 'hair' || name.startsWith('hair_')) {
        obj.visible = !helmetOn && appearance.hairId !== 'shaved';
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.filter(Boolean).forEach(material => {
          // Every live character owns cloned material wrappers. Geometry and
          // textures remain shared with the immutable GLB template, while the
          // base-color tint is safe to customize per actor.
          if (
            !material.color
            || material.userData?.characterGlbTemplateMaterial
            || material.userData?.characterGlbInstanceMaterial !== true
          ) return;
          material.color.copy(hairTint);
          material.userData.characterGlbHairTintId = hairColor?.id || 'hair_03';
          material.needsUpdate = true;
        });
      }
    });
    const previous = root.userData?.characterAppearanceVariantGroup;
    if (previous?.parent) previous.parent.remove(previous);
    if (previous) disposeCharacterGlbObject(previous);
    delete root.userData.characterAppearanceVariantGroup;
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

  function triggerActorAttackAnimationPulse(actor, token = 0, durationSeconds = 1.45) {
    if (!actor?.userData) return 0;
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const requestedToken = Number(token || 0);
    const previousToken = Number(actor.userData.attackAnimationToken || 0);
    actor.userData.attackAnimationToken = Number.isFinite(requestedToken) && requestedToken > 0
      ? (requestedToken === previousToken ? previousToken + 0.001 : requestedToken)
      : Math.max(now, previousToken + 0.001);
    actor.userData.attackAnimationUntil = Math.max(
      Number(actor.userData.attackAnimationUntil || 0),
      now + Math.max(1.45, Number(durationSeconds || 0)) * 1000
    );
    return actor.userData.attackAnimationToken;
  }

  function actorAttackAnimationPulseState(actor, persistentAttack = false) {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const token = Math.max(0, Number(actor?.userData?.attackAnimationToken || 0));
    return {
      token,
      active: (token > 0 && Number(actor?.userData?.attackAnimationUntil || 0) > now)
        || (token <= 0 && persistentAttack === true)
    };
  }

  function characterOneShotRestart(runtime, actionName = '', token = 0) {
    const normalizedToken = Math.max(0, Number(token || 0));
    if (!runtime || actionName !== 'attack' || normalizedToken <= 0) return false;
    if (Number(runtime.attackAnimationToken || 0) === normalizedToken) return false;
    runtime.attackAnimationToken = normalizedToken;
    return true;
  }

  function characterAngleDelta(from = 0, to = 0) {
    const delta = Number(to || 0) - Number(from || 0);
    return Math.atan2(Math.sin(delta), Math.cos(delta));
  }

  function characterTurnInPlaceState(actor, facingAngle = 0, moving = false, dt = 0.016) {
    const data = actor?.userData;
    if (!data) return { turning: false, amount: 0, delta: 0, angularSpeed: 0 };
    const frameDt = Math.max(0.001, Math.min(0.08, Number(dt || 0.016)));
    const angle = Number.isFinite(Number(facingAngle)) ? Number(facingAngle) : 0;
    const previous = Number(data.characterTurnFacingAngle);
    const delta = Number.isFinite(previous) ? characterAngleDelta(previous, angle) : 0;
    const angularSpeed = Math.abs(delta) / frameDt;
    data.characterTurnFacingAngle = angle;

    let hold = Math.max(0, Number(data.characterTurnHold || 0) - frameDt);
    let amount = Math.max(-1, Math.min(1, Number(data.characterTurnAmount || 0)));
    if (moving) {
      hold = 0;
      amount = characterLocomotionBlend(amount, 0, 12, frameDt);
    } else if (Math.abs(delta) >= 0.003 && angularSpeed >= 0.18) {
      const strength = Math.max(0.28, Math.min(1, angularSpeed / 2.8));
      amount = Math.sign(delta || amount || 1) * strength;
      hold = Math.max(hold, Math.max(0.14, Math.min(0.38, 0.13 + Math.abs(delta) * 0.18)));
    } else if (hold <= 0) {
      amount = characterLocomotionBlend(amount, 0, 10, frameDt);
    }

    data.characterTurnHold = hold;
    data.characterTurnAmount = amount;
    const turning = !moving && hold > 0 && Math.abs(amount) > 0.04;
    return {
      turning,
      amount: turning ? amount : 0,
      delta,
      angularSpeed
    };
  }

  function characterWrapAngle(angle) {
    let value = Number(angle || 0);
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function characterDirectionalLocomotionState(state = {}) {
    const moving = !!state.moving;
    const turnAmount = Math.max(-1, Math.min(1, Number(state.turnAmount || 0)));
    const turning = !moving && !!state.turning && Math.abs(turnAmount) > 0.02;
    const locomoting = moving || turning;
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
    // Режим заднего хода переключается около 90 градусов к прицелу с
    // гистерезисом (вход 100, выход 80): на самой границе оба варианта
    // равноправны, и без гистерезиса поза дребезжала бы между ними.
    const backwardEnter = -0.17;
    const backwardExit = 0.17;
    const backward = moving && (state.previousBackward
      ? forwardAmount < backwardExit
      : forwardAmount < backwardEnter);
    const sideStrength = Math.abs(sideAmount);
    let lowerBodyYaw = 0;
    if (turning) {
      lowerBodyYaw = turnAmount * 0.28;
    } else if (moving) {
      // Ноги смотрят строго по пути: клип «вперёд» разворачивается на угол
      // движения, клип «назад» — на противоположный. Обе ветки дают один и тот
      // же непрерывный угол на границе режимов, поэтому переключение клипа не
      // перекидывает таз рывком. Клэмп — страховка от сверхчеловеческого
      // излома корпуса относительно ног.
      const pathYaw = backward
        ? characterWrapAngle(relativeAngle + Math.PI)
        : relativeAngle;
      lowerBodyYaw = Math.max(-1.65, Math.min(1.65, pathYaw));
    }
    let direction = turning ? (turnAmount > 0 ? 'turn_right' : 'turn_left') : 'idle';
    if (moving) {
      const vertical = forwardAmount > 0.42 ? 'forward' : (forwardAmount < -0.42 ? 'backward' : '');
      const horizontal = sideAmount > 0.42 ? 'right' : (sideAmount < -0.42 ? 'left' : '');
      direction = [vertical, horizontal].filter(Boolean).join('_') || 'forward';
    }
    // Задний ход на скорости бега играет реверс клипа run, а не разогнанный
    // втрое walk: strideSync подгоняет темп к фактической скорости, и walk
    // назад при 4.6 м/с выглядел как судорожное семенение.
    const action = locomoting
      ? (turning ? 'turn' : (speed > 3.4 ? 'run' : 'walk'))
      : 'idle';
    const playbackRate = turning
      ? (1.0 + Math.abs(turnAmount) * 0.5)
      : (!moving ? 1 : (backward ? -0.88 : (sideStrength > 0.62 ? 0.92 : 1)));
    const strideScale = turning
      ? (0.28 + Math.abs(turnAmount) * 0.18)
      : (!moving ? 0 : (backward ? 0.8 : (sideStrength > 0.62 ? 0.84 : 1)));
    return {
      moving,
      turning,
      locomoting,
      turnAmount,
      speed,
      direction,
      action,
      forwardAmount,
      sideAmount,
      relativeAngle,
      backward,
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

  // Клипы локомоции авторизованы с размашистым верхом (в run шея и голова
  // качаются на ±40 градусов) — в игре это читается как «мотание головой» и у
  // игрока, и у гуманоидных НПС. Сразу после микшера верх прижимается к
  // рест-позе: keep — доля клипового движения, которая остаётся.
  const CHARACTER_UPPER_SWAY_KEEP = Object.freeze({
    spine02: 0.65,
    spine03: 0.45,
    neck: 0.3,
    head: 0.22
  });

  function captureCharacterUpperBodyRest(runtime) {
    const bones = runtime?.locomotionBones || {};
    const rest = {};
    for (const key of Object.keys(CHARACTER_UPPER_SWAY_KEEP)) {
      if (bones[key]?.quaternion) rest[key] = bones[key].quaternion.clone();
    }
    runtime.upperBodyRestQuats = rest;
  }

  function captureCharacterUpperSwayCleanPose(runtime) {
    const bones = runtime?.locomotionBones;
    if (!bones) return;
    const store = runtime.upperSwayCleanPose || (runtime.upperSwayCleanPose = {});
    for (const key of Object.keys(CHARACTER_UPPER_SWAY_KEEP)) {
      const bone = bones[key];
      if (!bone?.quaternion) continue;
      (store[key] || (store[key] = new THREE.Quaternion())).copy(bone.quaternion);
    }
    runtime.hasUpperSwayCleanPose = true;
  }

  function clearCharacterUpperSwayPose(runtime) {
    if (!runtime?.hasUpperSwayCleanPose) return;
    const bones = runtime.locomotionBones || {};
    for (const key of Object.keys(CHARACTER_UPPER_SWAY_KEEP)) {
      const bone = bones[key];
      const saved = runtime.upperSwayCleanPose?.[key];
      if (bone?.quaternion && saved) bone.quaternion.copy(saved);
    }
  }

  function applyCharacterUpperBodySwayDamping(runtime, dt = 0.016) {
    const rest = runtime?.upperBodyRestQuats;
    if (!rest) return;
    const damped = runtime.currentAction === 'walk'
      || runtime.currentAction === 'run'
      || runtime.currentAction === 'turn'
      || runtime.currentAction === 'walk_back'
      || runtime.currentAction === 'run_back'
      || runtime.currentAction === 'crouch_walk'
      || runtime.currentAction === 'crouch_walk_back';
    runtime.upperSwayDampBlend = characterLocomotionBlend(
      runtime.upperSwayDampBlend ?? 0,
      damped ? 1 : 0,
      8,
      dt
    );
    const blend = runtime.upperSwayDampBlend;
    if (blend < 0.01) return;
    captureCharacterUpperSwayCleanPose(runtime);
    const bones = runtime.locomotionBones || {};
    for (const key of Object.keys(CHARACTER_UPPER_SWAY_KEEP)) {
      const bone = bones[key];
      const restQ = rest[key];
      if (!bone?.quaternion || !restQ) continue;
      bone.quaternion.slerp(restQ, (1 - CHARACTER_UPPER_SWAY_KEEP[key]) * blend);
    }
  }

  // Предел угловой скорости разворота нижней части корпуса, рад/с.
  const CHARACTER_LOWER_BODY_YAW_RATE = 5.2;

  const characterDirectionalPoseEuler = new THREE.Euler();

  function clearCharacterGlbDirectionalPose(runtime) {
    const offsets = Array.isArray(runtime?.directionalPoseOffsets)
      ? runtime.directionalPoseOffsets
      : [];
    const count = Math.min(offsets.length, Math.max(0, Number(runtime?.directionalPoseOffsetCount || 0)));
    for (let index = 0; index < count; index += 1) {
      const row = offsets[index];
      if (!row?.bone?.quaternion || !row.quaternion) continue;
      row.inverse = row.inverse || new THREE.Quaternion();
      row.bone.quaternion.multiply(row.inverse.copy(row.quaternion).invert());
    }
    if (runtime) runtime.directionalPoseOffsetCount = 0;
  }

  function addCharacterGlbDirectionalBoneOffset(runtime, bone, x = 0, y = 0, z = 0) {
    if (!runtime || !bone?.quaternion) return;
    const offsets = Array.isArray(runtime.directionalPoseOffsets)
      ? runtime.directionalPoseOffsets
      : (runtime.directionalPoseOffsets = []);
    const index = Math.max(0, Number(runtime.directionalPoseOffsetCount || 0));
    const row = offsets[index] || (offsets[index] = {
      bone: null,
      quaternion: new THREE.Quaternion(),
      inverse: new THREE.Quaternion()
    });
    row.bone = bone;
    row.quaternion.setFromEuler(characterDirectionalPoseEuler.set(x, y, z, 'XYZ'));
    bone.quaternion.multiply(row.quaternion);
    runtime.directionalPoseOffsetCount = index + 1;
  }

  function applyCharacterGlbDirectionalPose(runtime, locomotion, dt = 0.016) {
    if (!runtime?.root || !locomotion) return;
    runtime.directionalMoveBlend = characterLocomotionBlend(
      runtime.directionalMoveBlend,
      locomotion.locomoting ? 1 : 0,
      locomotion.locomoting ? 9 : 6,
      dt
    );
    // Разворот таза ограничен по угловой скорости: без предела смена режима
    // (вперёд <-> назад) или быстрый разворот прицела перекидывали ноги на
    // 1200-1600 градусов в секунду — именно это читалось как «ноги глючат».
    // CHARACTER_LOWER_BODY_YAW_RATE — быстрый, но человеческий разворот.
    const previousLowerBodyYaw = runtime.directionalLowerBodyYaw;
    const blendedLowerBodyYaw = characterLocomotionBlend(
      previousLowerBodyYaw,
      locomotion.lowerBodyYaw,
      locomotion.locomoting ? 8.5 : 6.5,
      dt
    );
    const maxYawStep = CHARACTER_LOWER_BODY_YAW_RATE * Math.max(0.001, dt);
    runtime.directionalLowerBodyYaw = previousLowerBodyYaw
      + Math.max(-maxYawStep, Math.min(maxYawStep, blendedLowerBodyYaw - previousLowerBodyYaw));
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
    runtime.directionalTurnAmount = characterLocomotionBlend(
      runtime.directionalTurnAmount,
      locomotion.turnAmount,
      locomotion.turning ? 11 : 7,
      dt
    );
    const moveBlend = runtime.directionalMoveBlend;
    // Бег читается по силуэту: корпус подаётся вперёд заметно сильнее шага.
    const runLean = locomotion.action === 'run' ? 0.11 : 0;
    runtime.directionalRunLean = characterLocomotionBlend(
      runtime.directionalRunLean ?? 0,
      runLean,
      6,
      dt
    );
    const lowerBodyYaw = runtime.directionalLowerBodyYaw * moveBlend;
    const counterYaw = -lowerBodyYaw;
    const side = runtime.directionalSideAmount * moveBlend;
    const forward = runtime.directionalForwardAmount;
    const backwardLean = Math.max(0, -forward) * moveBlend;
    const forwardLean = Math.max(0, forward) * moveBlend;
    const turn = runtime.directionalTurnAmount * moveBlend;
    runtime.root.rotation.y = Number(runtime.baseRotationY ?? Math.PI) + lowerBodyYaw;
    const bones = runtime.locomotionBones || {};
    addCharacterGlbDirectionalBoneOffset(runtime, bones.pelvis, backwardLean * -0.025, turn * 0.06, side * -0.035);
    const runLeanNow = runtime.directionalRunLean * moveBlend;
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine01, forwardLean * 0.025 - backwardLean * 0.045 + runLeanNow * 0.5, counterYaw * 0.16 - turn * 0.035, side * -0.018);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine02, runLeanNow * 0.5, counterYaw * 0.18, side * -0.012);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine03, 0, counterYaw * 0.18, side * 0.012);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.neck, 0, counterYaw * 0.22, side * 0.008);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.head, 0, counterYaw * 0.26, 0);
  }

  // ===== IK стоп: фиксация опорной ноги =====
  // Запечённые клипы ходьбы проигрываются с масштабом темпа, а актёр движется
  // со скоростью сервера, поэтому стопы скользили по земле. Опорная стопа
  // ловится в момент контакта (низко и почти неподвижна в мире) и пришивается
  // к точке касания коротким FABRIK-решением бедро→голень→стопа, пока
  // анимация не поднимет её снова.
  const CHARACTER_FOOT_IK_BONES = Object.freeze({
    l: Object.freeze(['thigh_l', 'calf_l', 'foot_l']),
    r: Object.freeze(['thigh_r', 'calf_r', 'foot_r'])
  });
  // Естественная скорость шага клипов (замерена по опорной стопе при
  // единичном темпе): клип, проигранный быстрее или медленнее этой скорости,
  // скользит по земле. Темп клипа подтягивается к фактической скорости актёра.
  // Скорость, с которой клип «покрывает землю» при единичном темпе. Значения
  // не на глаз: их меряет tools/check-locomotion-clip-sync.js прямо по GLB
  // (перемещение опорной стопы за цикл) и не даёт им разойтись с клипами —
  // рассинхрон здесь напрямую превращается в скольжение стоп.
  const CHARACTER_CLIP_NATURAL_SPEEDS = Object.freeze({
    walk: 1.26,
    run: 3.72,
    walk_back: 1.20,
    run_back: 3.41,
    crouch_walk: 2.11,
    crouch_walk_back: 2.23
  });
  const CHARACTER_STRIDE_SYNC_MIN = 0.6;
  const CHARACTER_STRIDE_SYNC_MAX = 2.9;

  function characterStrideSyncTarget(runtime, locomotion) {
    if (!locomotion?.moving || locomotion.turning) return 1;
    const natural = CHARACTER_CLIP_NATURAL_SPEEDS[runtime?.currentAction || ''];
    if (!natural) return 1;
    const speed = Math.max(0, Number(locomotion.speed || 0));
    if (speed < 0.1) return 1;
    return Math.max(CHARACTER_STRIDE_SYNC_MIN, Math.min(CHARACTER_STRIDE_SYNC_MAX, speed / natural));
  }
  const CHARACTER_FOOT_IK_LIFT = 0.05;
  const CHARACTER_FOOT_IK_MAX_DRIFT = 0.44;
  const CHARACTER_FOOT_IK_TWIST_LIMIT = 0.55;
  const CHARACTER_FOOT_IK_TURN_TWIST_LIMIT = 0.6;
  const CHARACTER_FOOT_IK_BLEND_RATE = 24;
  const CHARACTER_FOOT_IK_TELEPORT_RESET = 1.6;
  // Сгиб коленей: таз опускается, IK дожимает стопы до земли — колени
  // сгибаются физически, без правки клипов. Стоя — слегка (боевая стойка),
  // в движении чуть больше, в приседе — глубоко.
  const CHARACTER_KNEE_FLEX_IDLE = 0.04;
  const CHARACTER_KNEE_FLEX_MOVE = 0.055;
  const CHARACTER_KNEE_FLEX_CROUCH = 0.26;

  function characterFootIkSideState() {
    return {
      locked: false,
      blend: 0,
      lockPos: new THREE.Vector3(),
      lockYaw: 0,
      relockCooldown: 0,
      prevAnim: new THREE.Vector3(),
      animated: new THREE.Vector3(),
      target: new THREE.Vector3(),
      hasPrev: false
    };
  }

  function characterLegIkSolveScratch(count = 3) {
    return {
      positions: Array.from({ length: count }, () => new THREE.Vector3()),
      lengths: Array.from({ length: Math.max(0, count - 1) }, () => 0),
      base: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      currentStart: new THREE.Vector3(),
      currentEnd: new THREE.Vector3(),
      currentDirection: new THREE.Vector3(),
      wantedDirection: new THREE.Vector3(),
      delta: new THREE.Quaternion(),
      currentWorld: new THREE.Quaternion(),
      parentWorld: new THREE.Quaternion()
    };
  }

  function captureCharacterFootIkRest(actor, runtime) {
    if (!actor || !runtime?.root) return;
    runtime.root.updateMatrixWorld(true);
    const actorWorld = actor.getWorldPosition(new THREE.Vector3());
    const restHeights = {};
    const chains = {};
    const solveScratch = {};
    for (const [side, names] of Object.entries(CHARACTER_FOOT_IK_BONES)) {
      const chain = names.map(name => runtime.root.getObjectByName(name));
      const foot = chain[2];
      if (!foot?.isBone) continue;
      if (chain.every(bone => bone?.isBone)) {
        chains[side] = chain;
        solveScratch[side] = characterLegIkSolveScratch(chain.length);
      }
      const height = foot.getWorldPosition(new THREE.Vector3()).y - actorWorld.y;
      if (Number.isFinite(height)) restHeights[side] = Math.max(0.015, height);
    }
    if (!Object.keys(restHeights).length) return;
    runtime.footIk = {
      restHeights,
      chains,
      solveScratch,
      actorWorld: new THREE.Vector3(),
      rootForward: new THREE.Vector3(),
      rootQuaternion: new THREE.Quaternion(),
      lastActorPos: null,
      feet: { l: characterFootIkSideState(), r: characterFootIkSideState() }
    };
  }

  function setCharacterBoneWorldQuaternion(bone, worldQuaternion, parentQuaternionScratch = null) {
    if (!bone?.isBone || !bone.parent) return false;
    const parentQuaternion = bone.parent.getWorldQuaternion(parentQuaternionScratch || new THREE.Quaternion());
    bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion)).normalize();
    bone.updateWorldMatrix(false, true);
    return true;
  }

  function solveCharacterLegChain(characterRoot, names, targetPosition, cachedChain = null, cachedScratch = null) {
    const chain = Array.isArray(cachedChain)
      ? cachedChain
      : names.map(name => characterRoot?.getObjectByName?.(name) || null);
    if (chain.some(bone => !bone?.isBone) || !targetPosition) return false;
    const scratch = cachedScratch || characterLegIkSolveScratch(chain.length);
    const positions = scratch.positions;
    const lengths = scratch.lengths;
    chain[0].updateWorldMatrix(true, true);
    for (let index = 0; index < chain.length; index += 1) {
      chain[index].getWorldPosition(positions[index]);
    }
    const base = scratch.base.copy(positions[0]);
    for (let index = 0; index < chain.length - 1; index += 1) {
      lengths[index] = positions[index].distanceTo(positions[index + 1]);
    }
    if (lengths.some(length => !Number.isFinite(length) || length <= 0.0001)) return false;
    const totalLength = lengths.reduce((sum, length) => sum + length, 0);
    if (base.distanceTo(targetPosition) >= totalLength) {
      const direction = scratch.direction.subVectors(targetPosition, base).normalize();
      for (let index = 1; index < positions.length; index += 1) {
        positions[index].copy(positions[index - 1]).addScaledVector(direction, lengths[index - 1]);
      }
    } else {
      for (let iteration = 0; iteration < 8; iteration += 1) {
        positions[positions.length - 1].copy(targetPosition);
        for (let index = positions.length - 2; index >= 0; index -= 1) {
          const direction = scratch.direction.subVectors(positions[index], positions[index + 1]).normalize();
          positions[index].copy(positions[index + 1]).addScaledVector(direction, lengths[index]);
        }
        positions[0].copy(base);
        for (let index = 1; index < positions.length; index += 1) {
          const direction = scratch.direction.subVectors(positions[index], positions[index - 1]).normalize();
          positions[index].copy(positions[index - 1]).addScaledVector(direction, lengths[index - 1]);
        }
        if (positions[positions.length - 1].distanceTo(targetPosition) < 0.0008) break;
      }
    }
    // Стопу не трогаем: её ориентацию задаёт анимация, IK двигает только
    // бедро и голень, чтобы сустав стопы пришёл в целевую точку.
    for (let index = 0; index < chain.length - 1; index += 1) {
      chain[index].updateWorldMatrix(true, true);
      chain[index].getWorldPosition(scratch.currentStart);
      chain[index + 1].getWorldPosition(scratch.currentEnd);
      scratch.currentDirection.subVectors(scratch.currentEnd, scratch.currentStart).normalize();
      scratch.wantedDirection.subVectors(positions[index + 1], positions[index]).normalize();
      scratch.delta.setFromUnitVectors(scratch.currentDirection, scratch.wantedDirection);
      chain[index].getWorldQuaternion(scratch.currentWorld);
      if (!setCharacterBoneWorldQuaternion(
        chain[index],
        scratch.delta.multiply(scratch.currentWorld),
        scratch.parentWorld
      )) return false;
    }
    chain[0].updateWorldMatrix(true, true);
    return true;
  }

  // Поза приседа: наклон корпуса вперёд, взгляд остаётся на цели. Сгиб ног
  // делает IK стоп (таз опущен на kneeFlex), здесь — только верх тела.
  function applyCharacterGlbCrouchPose(runtime, blend = 0) {
    const bones = runtime.locomotionBones || {};
    const b = Math.max(0, Math.min(1, blend));
    addCharacterGlbDirectionalBoneOffset(runtime, bones.pelvis, 0.06 * b, 0, 0);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine01, 0.14 * b, 0, 0);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine02, 0.12 * b, 0, 0);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.spine03, 0.08 * b, 0, 0);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.neck, -0.1 * b, 0, 0);
    addCharacterGlbDirectionalBoneOffset(runtime, bones.head, -0.14 * b, 0, 0);
  }

  // Three.js не записывает кость, если значение клипа не изменилось с прошлого
  // кадра (PropertyMixer сравнивает с тем, что записал сам). В клипах со
  // статичными ногами — например, в боевом attack — микшер перестаёт их
  // трогать, и правка IK остаётся в кости: на следующем кадре IK добавляет
  // ещё столько же, и нога неограниченно уезжает вверх.
  //
  // Поэтому поза ног снимается тем же приёмом, что и направленная поза:
  // до микшера кости возвращаются к чистым значениям клипа, после микшера
  // снимок обновляется, и только потом решается IK.
  function captureCharacterFootIkCleanPose(runtime) {
    const ik = runtime?.footIk;
    if (!ik?.chains) return;
    const store = ik.cleanPose || (ik.cleanPose = {});
    for (const side of Object.keys(ik.chains)) {
      const chain = ik.chains[side];
      if (!Array.isArray(chain)) continue;
      const slot = store[side] || (store[side] = chain.map(() => new THREE.Quaternion()));
      for (let index = 0; index < chain.length; index += 1) {
        const bone = chain[index];
        if (bone?.quaternion && slot[index]) slot[index].copy(bone.quaternion);
      }
    }
    ik.hasCleanPose = true;
  }

  function clearCharacterFootIkPose(runtime) {
    const ik = runtime?.footIk;
    if (!ik?.chains || !ik.hasCleanPose) return;
    for (const side of Object.keys(ik.chains)) {
      const chain = ik.chains[side];
      const slot = ik.cleanPose?.[side];
      if (!Array.isArray(chain) || !slot) continue;
      for (let index = 0; index < chain.length; index += 1) {
        const bone = chain[index];
        if (bone?.quaternion && slot[index]) bone.quaternion.copy(slot[index]);
      }
    }
  }

  function applyCharacterFootIk(actor, runtime, dt = 0.016, state = {}, locomotion = null) {
    const ik = runtime?.footIk;
    if (!ik?.feet || !runtime.root) return false;
    const frameDt = Math.max(0.001, Math.min(0.08, Number(dt || 0.016)));
    const disabled = !!state.dead;
    runtime.root.updateMatrixWorld(true);
    const actorWorld = actor.getWorldPosition(ik.actorWorld || (ik.actorWorld = new THREE.Vector3()));
    if (ik.lastActorPos && actorWorld.distanceTo(ik.lastActorPos) > CHARACTER_FOOT_IK_TELEPORT_RESET) {
      for (const side of Object.keys(ik.feet)) {
        ik.feet[side].locked = false;
        ik.feet[side].blend = 0;
        ik.feet[side].hasPrev = false;
      }
    }
    const hadActorPosition = !!ik.lastActorPos;
    const previousActorX = Number(ik.lastActorPos?.x || 0);
    const previousActorZ = Number(ik.lastActorPos?.z || 0);
    ik.lastActorPos = (ik.lastActorPos || new THREE.Vector3()).copy(actorWorld);
    const actorVelX = hadActorPosition ? (actorWorld.x - previousActorX) / frameDt : 0;
    const actorVelZ = hadActorPosition ? (actorWorld.z - previousActorZ) / frameDt : 0;
    const actorSpeed = Math.hypot(actorVelX, actorVelZ);
    const groundY = actorWorld.y;
    const rootForward = (ik.rootForward || (ik.rootForward = new THREE.Vector3()))
      .set(0, 0, 1)
      .applyQuaternion(runtime.root.getWorldQuaternion(
        ik.rootQuaternion || (ik.rootQuaternion = new THREE.Quaternion())
      ));
    const rootYaw = Math.atan2(rootForward.x, rootForward.z);
    const turning = !!locomotion?.turning;
    const idle = !locomotion?.locomoting;
    // Смена клипа (шёл -> встал, развернулся -> замер) перепришивает стопы:
    // иначе замки держат ноги там, где их застал прошлый клип, и в стойке
    // ноги остаются раскиданными и скрученными.
    const actionNow = String(runtime.currentAction || '');
    if (ik.lastAction !== actionNow) {
      ik.lastAction = actionNow;
      for (const side of Object.keys(ik.feet)) {
        ik.feet[side].locked = false;
        ik.feet[side].relockCooldown = 0.12;
      }
    }
    // Снимок чистой позы: сюда кости вернутся перед следующим микшером.
    captureCharacterFootIkCleanPose(runtime);
    let applied = false;
    for (const [side, names] of Object.entries(CHARACTER_FOOT_IK_BONES)) {
      const rest = Number(ik.restHeights[side] || 0);
      const sideState = ik.feet[side];
      const chain = ik.chains?.[side];
      const foot = chain?.[2] || runtime.root.getObjectByName(names[2]);
      if (!foot?.isBone || !sideState || rest <= 0) continue;
      const animated = foot.getWorldPosition(sideState.animated || (sideState.animated = new THREE.Vector3()));
      // Таз опущен на kneeFlex, поэтому «земля клипа» ниже настоящей. Высоту
      // считаем от настоящей земли: иначе в приседе (flex 0.26) стопа всегда
      // числится «у земли», замок хватает её в воздухе, а свободная стопа
      // уходит под пол.
      const flex = Math.max(0, Number(runtime.kneeFlex || 0));
      const height = animated.y - groundY - rest + flex;
      const footVelX = sideState.hasPrev ? (animated.x - sideState.prevAnim.x) / frameDt : 0;
      const footVelZ = sideState.hasPrev ? (animated.z - sideState.prevAnim.z) / frameDt : 0;
      const hadPrev = sideState.hasPrev;
      sideState.prevAnim.copy(animated);
      sideState.hasPrev = true;
      // Опора против переноса — по знаку скорости стопы относительно актёра:
      // опорная нога «уезжает назад» под корпусом, переносимая летит вперёд.
      // Высота у этих клипов почти не меняется, поэтому она лишь страховка.
      let stance = false;
      let swing = false;
      if (hadPrev && actorSpeed > 0.3) {
        // Переносимая нога летит вперёд быстрее корпуса (~2x его скорости),
        // опорная — нет. Порог замка мягкий, порог отпуска — явный перенос.
        const along = ((footVelX - actorVelX) * actorVelX + (footVelZ - actorVelZ) * actorVelZ) / actorSpeed;
        stance = along < actorSpeed * 0.15;
        swing = along > actorSpeed * 0.7;
      } else if (hadPrev) {
        const footSpeed = Math.hypot(footVelX, footVelZ);
        // В развороте клип ходьбы всё равно свипует стопы (~0.9 м/с) —
        // замок должен пересиливать свип, иначе ноги «шагают вперёд» на месте.
        stance = footSpeed < (turning ? 1.1 : 0.25);
        swing = footSpeed > (turning ? 1.5 : 0.8);
      }
      sideState.relockCooldown = Math.max(0, Number(sideState.relockCooldown || 0) - frameDt);
      if (disabled || !hadPrev) {
        sideState.locked = false;
      } else if (!sideState.locked) {
        if (stance && height < CHARACTER_FOOT_IK_LIFT * 1.2 && sideState.relockCooldown <= 0) {
          sideState.locked = true;
          sideState.lockPos.set(animated.x, groundY + rest, animated.z);
          sideState.lockYaw = rootYaw;
        }
      } else {
        const drift = Math.hypot(animated.x - sideState.lockPos.x, animated.z - sideState.lockPos.z);
        const twist = Math.abs(characterAngleDelta(sideState.lockYaw, rootYaw));
        const twistLimit = turning
          ? CHARACTER_FOOT_IK_TURN_TWIST_LIMIT
          : (idle ? 0.28 : CHARACTER_FOOT_IK_TWIST_LIMIT);
        const driftLimit = idle ? 0.2 : CHARACTER_FOOT_IK_MAX_DRIFT;
        // В развороте шаги диктует клип: нога отпускается, как только клип
        // её поднял; скручивание — только страховка на медленных поворотах.
        const liftRelease = CHARACTER_FOOT_IK_LIFT * (turning ? 1.5 : 2.4);
        if (swing || height > liftRelease || drift > driftLimit || twist > twistLimit) {
          sideState.locked = false;
          // Пауза перед повторным замком: без неё нога, опускаясь, ловится и
          // рвётся по нескольку раз за шаг, и фиксация размазывается.
          sideState.relockCooldown = turning ? 0.18 : 0.08;
        }
      }
      // Замок хватает быстро, отпускает мягко: резкий возврат к анимации
      // на полном дрейфе выглядел бы рывком стопы.
      sideState.blend = characterLocomotionBlend(
        sideState.blend,
        sideState.locked ? 1 : 0,
        sideState.locked ? CHARACTER_FOOT_IK_BLEND_RATE : 6,
        frameDt
      );
      // Стопа на настоящей земле — база для обоих случаев. Замок накладывается
      // поверх неё. Раньше грунт-коррекция работала только при полностью
      // снятом замке, а blend спадает со скоростью 6 (~0.6 с): всё это время
      // отпущенная стопа тянулась к устаревшему замку и проваливалась.
      const grounded = (sideState.grounded || (sideState.grounded = new THREE.Vector3()))
        .copy(animated)
        .setY(groundY + rest + Math.max(0, height));
      let target = null;
      if (sideState.blend >= 0.02) {
        target = (sideState.target || (sideState.target = new THREE.Vector3()))
          .copy(grounded)
          .lerp(sideState.lockPos, sideState.blend);
      } else if (!disabled && Math.abs(grounded.y - animated.y) > 0.004) {
        target = (sideState.target || (sideState.target = new THREE.Vector3())).copy(grounded);
      }
      if (target && solveCharacterLegChain(
        runtime.root,
        names,
        target,
        chain,
        ik.solveScratch?.[side]
      )) applied = true;
    }
    return applied;
  }

  function setCharacterFootIkEnabled(runtime, enabled = true) {
    const next = enabled !== false;
    if (!runtime || runtime.footIkEnabled === next) return;
    runtime.footIkEnabled = next;
    const ik = runtime.footIk;
    if (!ik?.feet) return;
    // A distant actor can travel while IK is suspended. Drop old world-space
    // foot locks so returning to the near tier cannot pull a leg backwards.
    ik.lastActorPos = null;
    ik.lastAction = '';
    ik.hasCleanPose = false;
    Object.values(ik.feet).forEach(side => {
      if (!side) return;
      side.locked = false;
      side.blend = 0;
      side.relockCooldown = 0;
      side.hasPrev = false;
    });
  }

  function setCharacterGlbAction(runtime, name = 'idle', fadeSeconds = 0.16, options = {}) {
    if (!runtime?.actions) return;
    const nextName = runtime.actions[name] ? name : (runtime.actions.idle ? 'idle' : Object.keys(runtime.actions)[0]);
    const restart = options.restart === true;
    if (!nextName || (runtime.currentAction === nextName && !restart)) return;
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

  function setCharacterProceduralBaseVisible(actor, _visible) {
    const parts = actor?.userData?.parts || {};
    let changed = false;
    (parts.proceduralCharacterBaseMeshes || []).forEach(mesh => {
      if (!mesh) return;
      const nextVisible = false;
      if (mesh.visible !== nextVisible) changed = true;
      mesh.visible = nextVisible;
    });
    if (changed && typeof invalidateModernProceduralRigAnimationCache === 'function') {
      invalidateModernProceduralRigAnimationCache(actor, parts);
    }
  }

  function refreshCharacterGlbEquipmentLayers(actor, eq = {}) {
    const runtime = actor?.userData?.characterGlbRuntime;
    if (!runtime?.root) return;
    setCharacterProceduralBaseVisible(actor, false);
    // Экипировка НПС нередко приходит раньше, чем догрузится GLB-персонаж —
    // одеваем модель по живому снимку, а не по снапшоту на момент запроса.
    const activeEq = actor.userData.enemyEquipment || eq;
    const helmetOn = !!activeEq?.helmet;
    applyCharacterGlbVisualVariants(runtime.root, runtime.appearance, { helmetOn });
    if (typeof applyApprovedEquipmentVisuals === 'function') applyApprovedEquipmentVisuals(actor, activeEq);
    else if (typeof applyApprovedBootsVisual === 'function') applyApprovedBootsVisual(actor, activeEq);
    const parts = actor.userData.parts || actor.userData.actorParts || {};
    [parts.weaponGroup, parts.offhandWeaponGroup, actor.userData.enemyWeaponGroup]
      .filter(Boolean)
      .forEach(group => {
        if (typeof setWeaponGlbGroupVisibility === 'function') {
          setWeaponGlbGroupVisibility(group, group.children?.length > 0);
        } else group.visible = group.children?.length > 0;
      });
  }

  function cancelPendingCharacterGlbAppearance(actor) {
    if (!actor?.userData) return;
    actor.userData.characterGlbRequestId = Number(actor.userData.characterGlbRequestId || 0) + 1;
    clearTimeout(actor.userData.characterGlbRetryTimer || 0);
    delete actor.userData.characterGlbRetryTimer;
  }

  function removeCharacterGlbRuntime(actor) {
    if (!actor?.userData) return;
    cancelPendingCharacterGlbAppearance(actor);
    const runtime = actor.userData.characterGlbRuntime;
    if (!runtime) {
      setCharacterProceduralBaseVisible(actor, false);
      return;
    }
    if (typeof restoreApprovedWeaponGrip === 'function') restoreApprovedWeaponGrip(actor);
    else if (typeof restoreApprovedAssaultRifleGrip === 'function') restoreApprovedAssaultRifleGrip(actor);
    if (typeof removeApprovedEquipmentRuntimes === 'function') removeApprovedEquipmentRuntimes(actor);
    else if (typeof removeApprovedBootRuntime === 'function') removeApprovedBootRuntime(actor);
    runtime.mixer?.stopAllAction?.();
    if (runtime.root?.parent) runtime.root.parent.remove(runtime.root);
    disposeCharacterGlbObject(runtime.root);
    delete actor.userData.characterGlbRuntime;
    setCharacterProceduralBaseVisible(actor, false);
  }

  function characterGlbActorAttached(actor) {
    if (!actor) return false;
    let root = actor;
    while (root.parent) root = root.parent;
    if (typeof scene !== 'undefined' && scene) return root === scene;
    return !!actor.parent || (typeof playerGroup !== 'undefined' && actor === playerGroup);
  }

  function scheduleCharacterGlbActorRetry(actor, appearance, options, requestId) {
    if (!actor?.userData || actor.userData.characterGlbRequestId !== requestId) return;
    const retryRound = Math.max(0, Number(options?.characterGlbRetryRound || 0));
    const state = characterGlbTemplateCache.get(characterAppearanceKey(appearance));
    const delay = Math.min(
      CHARACTER_GLB_ACTOR_RETRY_MAX_DELAY_MS,
      Math.max(
        250,
        Number(state?.nextRetryAt || 0) - Date.now(),
        Math.min(
          CHARACTER_GLB_ACTOR_RETRY_MAX_DELAY_MS,
          1_000 * (2 ** Math.min(5, retryRound))
        )
      )
    );
    clearTimeout(actor.userData.characterGlbRetryTimer || 0);
    actor.userData.characterGlbRetryTimer = setTimeout(() => {
      if (!actor?.userData || actor.userData.characterGlbRequestId !== requestId) return;
      if (!characterGlbActorAttached(actor)) return;
      delete actor.userData.characterGlbRetryTimer;
      void applyCharacterGlbAppearance(actor, appearance, {
        ...options,
        characterGlbRetryRound: retryRound + 1
      });
    }, delay);
  }

  function applyCharacterGlbAppearance(actor, input = {}, options = {}) {
    if (!actor?.userData) return Promise.resolve(false);
    const appearance = normalizeCharacterAppearance(input);
    const key = characterAppearanceKey(appearance);
    setCharacterProceduralBaseVisible(actor, false);
    const current = actor.userData.characterGlbRuntime;
    if (current?.key === key && current.root) {
      clearTimeout(actor.userData.characterGlbRetryTimer || 0);
      delete actor.userData.characterGlbRetryTimer;
      current.appearance = appearance;
      actor.userData.characterAppearance = appearance;
      refreshCharacterGlbEquipmentLayers(actor, options.equipment || {});
      if (options.npcAnimations && typeof attachApprovedNpcAnimations === 'function') {
        void attachApprovedNpcAnimations(current);
      } else if (!options.npcAnimations && typeof attachApprovedTurnAnimation === 'function') {
        void attachApprovedTurnAnimation(current);
      }
      return Promise.resolve(true);
    }
    if (!characterGlbLoader()) {
      setCharacterProceduralBaseVisible(actor, false);
      return Promise.resolve(false);
    }
    clearTimeout(actor.userData.characterGlbRetryTimer || 0);
    delete actor.userData.characterGlbRetryTimer;
    const requestId = Number(actor.userData.characterGlbRequestId || 0) + 1;
    actor.userData.characterGlbRequestId = requestId;
    actor.userData.characterAppearance = appearance;
    const requestParent = actor.parent || null;
    const requestWasAttached = characterGlbActorAttached(actor);
    if (typeof hideApprovedEquipmentFallbacksEarly === 'function') {
      hideApprovedEquipmentFallbacksEarly(actor, options.equipment || {});
    }
    return loadCharacterGlbTemplate(appearance).then(template => {
        if (actor.userData.characterGlbRequestId !== requestId) return false;
        if ((requestParent && !actor.parent) || (requestWasAttached && !characterGlbActorAttached(actor))) return false;
        const templateRoot = template?.source || null;
        const instanceRoot = cloneCharacterGlbTemplateScene(templateRoot);
        if (
          actor.userData.characterGlbRequestId !== requestId
          || (requestParent && !actor.parent)
          || (requestWasAttached && !characterGlbActorAttached(actor))
        ) {
          if (instanceRoot) disposeCharacterGlbObject(instanceRoot);
          return false;
        }
        if (!instanceRoot) {
          setCharacterProceduralBaseVisible(actor, false);
          scheduleCharacterGlbActorRetry(actor, appearance, options, requestId);
          return false;
        }
        const root = configureCharacterGlbScene(instanceRoot, {
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
          actions: characterGlbActions(mixer, template.animations || []),
          approvedAssaultRifleRestPose: typeof captureApprovedAssaultRifleRestPose === 'function'
            ? captureApprovedAssaultRifleRestPose(root)
            : null,
          currentAction: '',
          attackAnimationToken: 0,
          baseRotationY: Math.PI,
          modelScale: Math.max(0.1, Number(options.modelScale || 1) || 1),
          directionalMoveBlend: 0,
          directionalLowerBodyYaw: 0,
          directionalSideAmount: 0,
          directionalForwardAmount: 1,
          directionalTurnAmount: 0,
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
        clearTimeout(actor.userData.characterGlbRetryTimer || 0);
        delete actor.userData.characterGlbRetryTimer;
        captureCharacterFootIkRest(actor, runtime);
        captureCharacterUpperBodyRest(runtime);
        setCharacterGlbAction(runtime, 'idle', 0);
        refreshCharacterGlbEquipmentLayers(actor, options.equipment || {});
        if (options.npcAnimations && typeof attachApprovedNpcAnimations === 'function') {
          void attachApprovedNpcAnimations(runtime);
        } else if (!options.npcAnimations && typeof attachApprovedTurnAnimation === 'function') {
          void attachApprovedTurnAnimation(runtime);
        }
        if (previous?.root && previous.root !== root) {
          previous.mixer?.stopAllAction?.();
          previous.root.parent?.remove(previous.root);
          disposeCharacterGlbObject(previous.root);
        }
        return true;
      });
  }

  function updateCharacterGlbAnimation(actor, dt = 0.016, state = {}) {
    const runtime = actor?.userData?.characterGlbRuntime;
    if (!runtime?.mixer) return false;
    const frameDt = Math.max(0, Math.min(0.08, Number(dt || 0.016)));
    const locomotion = characterDirectionalLocomotionState({
      ...state,
      previousBackward: runtime.directionalBackward === true
    });
    runtime.directionalBackward = locomotion.backward;
    // Запечённое переступание есть не у всех сразу (клип грузится отдельно) —
    // до его прихода разворот отыгрывает старый walk.
    let locomotionAction = locomotion.action === 'turn' && !runtime.actions?.turn
      ? 'walk'
      : locomotion.action;
    // Авторские клипы: ходьба в приседе и шаг назад. Пока клип не догрузился,
    // работает прежний фолбэк (реверс walk/run, поза приседа поверх walk).
    if (locomotion.moving) {
      if (state.crouching) {
        // У приседа своя пара клипов. Раньше присед перехватывал выбор до
        // проверки направления, и отход в приседе играл crouch_walk задом
        // наперёд — шаги шли не в ту сторону.
        const crouchBack = locomotion.backward && runtime.actions?.crouch_walk_back;
        if (crouchBack) locomotionAction = 'crouch_walk_back';
        else if (runtime.actions?.crouch_walk) locomotionAction = 'crouch_walk';
      } else if (locomotion.backward) {
        // Задний ход своей парой клипов, как и вперёд: медленный отход шагом,
        // быстрый — бегом. Один walk_back на все скорости заставлял stride-sync
        // разгонять его втрое, и стопы скользили.
        const fastBack = locomotion.action === 'run' && runtime.actions?.run_back;
        if (fastBack) locomotionAction = 'run_back';
        else if (runtime.actions?.walk_back) locomotionAction = 'walk_back';
      }
    }
    const requestedAction = state.dead && runtime.actions?.death
      ? 'death'
      : (state.hurt && runtime.actions?.hurt
        ? 'hurt'
        : (state.attacking && runtime.actions?.attack ? 'attack' : locomotionAction));
    const restartAttack = characterOneShotRestart(runtime, requestedAction, state.attackToken);
    setCharacterGlbAction(
      runtime,
      requestedAction,
      requestedAction === locomotionAction ? 0.16 : 0.08,
      { restart: restartAttack }
    );
    // Авторский клип заднего хода сам шагает назад — реверс не нужен.
    // Клипы заднего хода шагают назад сами — реверс им не нужен.
    const authoredBackClip = locomotionAction === 'walk_back'
      || locomotionAction === 'run_back'
      || locomotionAction === 'crouch_walk_back';
    const playbackTarget = authoredBackClip ? 1 : locomotion.playbackRate;
    if (locomotion.locomoting && !runtime.directionalWasMoving) {
      runtime.directionalPlaybackRate = playbackTarget;
    }
    runtime.directionalPlaybackRate = characterLocomotionBlend(
      runtime.directionalPlaybackRate,
      playbackTarget,
      playbackTarget < 0 ? 7 : 9,
      frameDt
    );
    runtime.strideSyncRate = characterLocomotionBlend(
      runtime.strideSyncRate ?? 1,
      characterStrideSyncTarget(runtime, locomotion),
      8,
      frameDt
    );
    const action = runtime.actions?.[runtime.currentAction];
    if (action) {
      const baseRate = runtime.currentAction === 'walk' ? 1.05 : 1;
      action.setEffectiveTimeScale(baseRate * runtime.directionalPlaybackRate * runtime.strideSyncRate);
    }
    clearCharacterGlbDirectionalPose(runtime);
    clearCharacterFootIkPose(runtime);
    clearCharacterUpperSwayPose(runtime);
    const kneeFlexTarget = state.dead
      ? 0
      : (state.crouching
        ? CHARACTER_KNEE_FLEX_CROUCH
        : (locomotion.locomoting ? CHARACTER_KNEE_FLEX_MOVE : CHARACTER_KNEE_FLEX_IDLE));
    runtime.kneeFlex = characterLocomotionBlend(runtime.kneeFlex ?? 0, kneeFlexTarget, 7, frameDt);
    runtime.root.position.y = -runtime.kneeFlex;
    runtime.mixer.update(frameDt);
    applyCharacterFaceShapeFrame(runtime.root);
    applyCharacterUpperBodySwayDamping(runtime, frameDt);
    applyCharacterGlbDirectionalPose(runtime, locomotion, frameDt);
    runtime.crouchBlend = characterLocomotionBlend(
      runtime.crouchBlend ?? 0,
      state.crouching && !state.dead ? 1 : 0,
      8,
      frameDt
    );
    if (runtime.crouchBlend > 0.01) applyCharacterGlbCrouchPose(runtime, runtime.crouchBlend);
    const footIkEnabled = state.footIk !== false;
    setCharacterFootIkEnabled(runtime, footIkEnabled);
    if (footIkEnabled) applyCharacterFootIk(actor, runtime, frameDt, state, locomotion);
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    actor.userData.characterLocomotionDirection = locomotion.direction;
    actor.userData.characterLocomotionForwardAmount = locomotion.forwardAmount;
    actor.userData.characterLocomotionSideAmount = locomotion.sideAmount;
    actor.userData.characterLocomotionTurning = locomotion.turning;
    actor.userData.characterLocomotionTurnAmount = locomotion.turnAmount;
    runtime.directionalWasMoving = locomotion.locomoting;
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
    if (!THREE.GLTFLoader) {
      setCharacterPreviewStatus('Предпросмотр GLB недоступен.', 'error');
      return;
    }
    loadCharacterGlbTemplate(appearance).then(template => {
      if (characterPreviewState.requestId !== requestId) return;
      const instanceRoot = cloneCharacterGlbTemplateScene(template?.source);
      if (!instanceRoot) {
        setCharacterPreviewStatus('Не удалось загрузить модель.', 'error');
        return;
      }
      const model = configureCharacterGlbScene(instanceRoot, { castShadow: false });
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
      const actions = characterGlbActions(characterPreviewState.mixer, template.animations || []);
      if (actions.idle) actions.idle.play();
      characterPreviewState.scene.add(model);
      characterPreviewState.loadedKey = key;
      characterPreviewState.loadedAppearanceKey = requestedAppearanceKey;
      setCharacterPreviewStatus(characterAppearanceLabel(requestedAppearance), 'ready');
      resizeCharacterPreview();
    }).catch(error => {
      console.warn(`Character preview failed to prepare (${key}):`, error);
      if (characterPreviewState.requestId === requestId) {
        setCharacterPreviewStatus('Не удалось загрузить модель.', 'error');
      }
    });
  }
