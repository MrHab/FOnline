  window.REALM_SERVICE_SCOUT_PART_LOADED = true;
  const SERVICE_SCOUT_RUNTIME_MANIFEST =
    '/assets/models/characters/service-scout-boots-manifest.json';
  const SERVICE_SCOUT_LODS = ['lod0', 'lod1', 'lod2'];
  const SERVICE_SCOUT_ALLOWED_VARIANTS = new Set([
    'female_slim',
    'female_medium',
    'female_large',
    'male_slim',
    'male_medium',
    'male_large'
  ]);
  const serviceScoutTemplatePromises = new Map();
  let serviceScoutManifestPromise = null;
  const serviceScoutRuntimeDiagnostics = {
    manifest: 'idle',
    requests: 0,
    attachedActors: 0,
    failedActors: 0,
    lastError: ''
  };

  function publishServiceScoutDiagnostics() {
    if (!document?.documentElement) return;
    document.documentElement.dataset.serviceScoutRuntime = JSON.stringify({
      ...serviceScoutRuntimeDiagnostics,
      cachedTemplates: serviceScoutTemplatePromises.size
    });
  }

  function loadServiceScoutRuntimeManifest() {
    if (serviceScoutManifestPromise) return serviceScoutManifestPromise;
    serviceScoutRuntimeDiagnostics.manifest = 'loading';
    publishServiceScoutDiagnostics();
    serviceScoutManifestPromise = fetch(SERVICE_SCOUT_RUNTIME_MANIFEST, {
      cache: 'default',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Service Scout manifest HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(manifest => {
        if (
          manifest?.schema !== 'realm.runtime-character-module.v1' ||
          manifest?.status !== 'approved' ||
          manifest?.assetId !== 'service_boots' ||
          !Array.isArray(manifest?.physicalItemIds) ||
          !manifest.physicalItemIds.includes('scoutBoots') ||
          manifest?.authority?.equipmentSource !==
            'server_snapshot.equipment.boots' ||
          manifest?.authority?.clientCosmeticOverrideAllowed !== false
        ) {
          throw new Error('Service Scout runtime manifest is not approved');
        }
        serviceScoutRuntimeDiagnostics.manifest = 'ready';
        publishServiceScoutDiagnostics();
        return manifest;
      })
      .catch(error => {
        serviceScoutRuntimeDiagnostics.manifest = 'failed';
        serviceScoutRuntimeDiagnostics.lastError = String(
          error?.message || error
        );
        publishServiceScoutDiagnostics();
        serviceScoutManifestPromise = null;
        throw error;
      });
    return serviceScoutManifestPromise;
  }

  function serviceScoutVariantForParts(parts = {}) {
    const sex = String(parts.runtimeAppearance?.sex || 'male').toLowerCase();
    const bodyType = String(
      parts.runtimeAppearance?.bodyType || 'medium'
    ).toLowerCase();
    const key = `${sex}_${bodyType}`;
    return SERVICE_SCOUT_ALLOWED_VARIANTS.has(key) ? key : 'male_medium';
  }

  function serviceScoutMaterialForGroup(mesh, materialIndex, cache) {
    const key = `${mesh.uuid}:${materialIndex}`;
    if (cache.has(key)) return cache.get(key);
    const source = Array.isArray(mesh.material)
      ? mesh.material[materialIndex] || mesh.material[0]
      : mesh.material;
    const material = source?.clone ? source.clone() : source;
    if (material) {
      material.skinning = false;
      material.needsUpdate = true;
    }
    cache.set(key, material);
    return material;
  }

  function serviceScoutBakedTriangles(gltf) {
    const triangles = [];
    const materials = new Map();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(mesh => {
      if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) return;
      const geometry = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      const position = geometry.attributes.position;
      const normal = geometry.attributes.normal;
      const uv = geometry.attributes.uv;
      const groups = geometry.groups?.length
        ? geometry.groups
        : [{ start: 0, count: position.count, materialIndex: 0 }];
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for (const group of groups) {
        const end = Math.min(position.count, group.start + group.count);
        for (let index = group.start; index + 2 < end; index += 3) {
          const vertices = [];
          for (let offset = 0; offset < 3; offset += 1) {
            const vertexIndex = index + offset;
            const point = new THREE.Vector3().fromBufferAttribute(
              position,
              vertexIndex
            );
            point.applyMatrix4(mesh.matrixWorld);
            const vertexNormal = normal
              ? new THREE.Vector3()
                  .fromBufferAttribute(normal, vertexIndex)
                  .applyMatrix3(normalMatrix)
                  .normalize()
              : null;
            vertices.push({
              point,
              normal: vertexNormal,
              uv: uv ? [uv.getX(vertexIndex), uv.getY(vertexIndex)] : null
            });
          }
          const side =
            vertices.reduce((sum, vertex) => sum + vertex.point.x, 0) < 0
              ? 'L'
              : 'R';
          triangles.push({
            side,
            material: serviceScoutMaterialForGroup(
              mesh,
              Number(group.materialIndex || 0),
              materials
            ),
            vertices
          });
        }
      }
      geometry.dispose();
    });
    return triangles;
  }

  function serviceScoutTemplateFromGltf(gltf) {
    const triangles = serviceScoutBakedTriangles(gltf);
    const anchors = {};
    for (const side of ['L', 'R']) {
      const xs = triangles
        .filter(triangle => triangle.side === side)
        .flatMap(triangle => triangle.vertices.map(vertex => vertex.point.x));
      if (!xs.length) throw new Error(`Service Scout ${side} boot is empty`);
      anchors[side] = (Math.min(...xs) + Math.max(...xs)) * 0.5;
    }

    const template = { L: [], R: [] };
    for (const side of ['L', 'R']) {
      const byMaterial = new Map();
      for (const triangle of triangles) {
        if (triangle.side !== side) continue;
        const material = triangle.material;
        const materialKey = material?.uuid || `material-${byMaterial.size}`;
        if (!byMaterial.has(materialKey)) {
          byMaterial.set(materialKey, {
            material,
            positions: [],
            normals: [],
            uvs: []
          });
        }
        const row = byMaterial.get(materialKey);
        for (const vertex of triangle.vertices) {
          row.positions.push(
            vertex.point.x - anchors[side],
            vertex.point.y,
            vertex.point.z
          );
          if (vertex.normal) {
            row.normals.push(
              vertex.normal.x,
              vertex.normal.y,
              vertex.normal.z
            );
          }
          if (vertex.uv) row.uvs.push(vertex.uv[0], vertex.uv[1]);
        }
      }
      for (const row of byMaterial.values()) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(row.positions, 3)
        );
        if (row.normals.length) {
          geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(row.normals, 3)
          );
        } else {
          geometry.computeVertexNormals();
        }
        if (row.uvs.length) {
          geometry.setAttribute(
            'uv',
            new THREE.Float32BufferAttribute(row.uvs, 2)
          );
        }
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        template[side].push({ geometry, material: row.material });
      }
    }
    return template;
  }

  function loadServiceScoutTemplate(url) {
    if (serviceScoutTemplatePromises.has(url)) {
      return serviceScoutTemplatePromises.get(url);
    }
    serviceScoutRuntimeDiagnostics.requests += 1;
    publishServiceScoutDiagnostics();
    const promise = new Promise((resolve, reject) => {
      if (!THREE.GLTFLoader) {
        reject(new Error('THREE.GLTFLoader is unavailable'));
        return;
      }
      new THREE.GLTFLoader().load(
        url,
        gltf => {
          try {
            resolve(serviceScoutTemplateFromGltf(gltf));
          } catch (error) {
            reject(error);
          }
        },
        undefined,
        reject
      );
    }).catch(error => {
      serviceScoutTemplatePromises.delete(url);
      throw error;
    });
    serviceScoutTemplatePromises.set(url, promise);
    return promise;
  }

  function makeServiceScoutLevel(template, side) {
    const group = new THREE.Group();
    for (const row of template[side] || []) {
      const mesh = new THREE.Mesh(row.geometry, row.material);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.serviceScoutBoot = true;
      group.add(mesh);
    }
    return group;
  }

  function disposeServiceScoutAttachment(parts = {}) {
    for (const side of ['L', 'R']) {
      const attachment = parts[`serviceScoutBoot${side}`];
      if (attachment?.parent) attachment.parent.remove(attachment);
      parts[`serviceScoutBoot${side}`] = null;
    }
  }

  function attachServiceScoutTemplates(parts, variant, manifest, templates) {
    disposeServiceScoutAttachment(parts);
    const distances = manifest.lodDistancesMeters || {};
    for (const side of ['L', 'R']) {
      const ankle = parts[`ankle${side}`];
      if (!ankle) continue;
      const lod = new THREE.LOD();
      lod.name = `service_scout_${variant}_${side.toLowerCase()}`;
      SERVICE_SCOUT_LODS.forEach((lodId, index) => {
        lod.addLevel(
          makeServiceScoutLevel(templates[index], side),
          Number(distances[lodId] || 0)
        );
      });
      lod.visible = parts.serviceScoutDesiredItem === 'scoutBoots';
      lod.userData.assetId = 'service_boots';
      lod.userData.physicalItemId = 'scoutBoots';
      lod.userData.variant = variant;
      ankle.add(lod);
      parts[`serviceScoutBoot${side}`] = lod;
    }
    parts.serviceScoutLoadedVariant = variant;
    parts.serviceScoutLoadState = 'ready';
    serviceScoutRuntimeDiagnostics.attachedActors += 1;
    publishServiceScoutDiagnostics();
  }

  function syncServiceScoutBootVisual(parts = {}, bootsId = '') {
    const desired = String(bootsId || '');
    parts.serviceScoutDesiredItem = desired;
    const visible = desired === 'scoutBoots';
    for (const side of ['L', 'R']) {
      const attachment = parts[`serviceScoutBoot${side}`];
      if (attachment) attachment.visible = visible;
    }
    if (!visible || !parts.ankleL || !parts.ankleR) return;

    const variant = serviceScoutVariantForParts(parts);
    if (
      parts.serviceScoutLoadState === 'ready' &&
      parts.serviceScoutLoadedVariant === variant
    ) {
      return;
    }
    if (
      parts.serviceScoutLoadState === 'loading' &&
      parts.serviceScoutRequestedVariant === variant
    ) {
      return;
    }
    const requestId = Number(parts.serviceScoutRequestId || 0) + 1;
    parts.serviceScoutRequestId = requestId;
    parts.serviceScoutRequestedVariant = variant;
    parts.serviceScoutLoadState = 'loading';

    loadServiceScoutRuntimeManifest()
      .then(manifest => {
        const row = (manifest.variants || []).find(
          candidate => candidate.key === variant
        );
        if (!row) throw new Error(`Service Scout variant is missing: ${variant}`);
        return Promise.all(
          SERVICE_SCOUT_LODS.map(lod => loadServiceScoutTemplate(row.lods[lod]))
        ).then(templates => ({ manifest, templates }));
      })
      .then(({ manifest, templates }) => {
        if (parts.serviceScoutRequestId !== requestId) return;
        attachServiceScoutTemplates(parts, variant, manifest, templates);
      })
      .catch(error => {
        if (parts.serviceScoutRequestId !== requestId) return;
        parts.serviceScoutLoadState = 'failed';
        parts.serviceScoutError = String(error?.message || error);
        serviceScoutRuntimeDiagnostics.failedActors += 1;
        serviceScoutRuntimeDiagnostics.lastError = parts.serviceScoutError;
        publishServiceScoutDiagnostics();
        console.error('Service Scout runtime load failed:', error);
      });
  }

  if (typeof window !== 'undefined') {
    publishServiceScoutDiagnostics();
    window.REALM_SERVICE_SCOUT_RUNTIME = Object.freeze({
      diagnostics: () => ({
        ...serviceScoutRuntimeDiagnostics,
        cachedTemplates: serviceScoutTemplatePromises.size
      }),
      manifestUrl: SERVICE_SCOUT_RUNTIME_MANIFEST
    });
  }
