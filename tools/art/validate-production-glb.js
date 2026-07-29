const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CONTRACT = path.join(
  REPO_ROOT,
  'source-assets',
  'library',
  'asset-production-contract.json'
);
const COMPONENT_INFO = {
  5121: { bytes: 1, read: 'getUint8', normalizedMax: 255 },
  5122: { bytes: 2, read: 'getInt16', normalizedMax: 32767 },
  5123: { bytes: 2, read: 'getUint16', normalizedMax: 65535 },
  5125: { bytes: 4, read: 'getUint32', normalizedMax: 4294967295 },
  5126: { bytes: 4, read: 'getFloat32', normalizedMax: null }
};
const TYPE_COMPONENTS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16
};

function parseArgs(argv) {
  const args = {
    contract: DEFAULT_CONTRACT,
    requiredAnimations: [],
    requiredSockets: [],
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--input') {
      if (!value) throw new Error('--input requires a path');
      args.input = path.resolve(value);
      index += 1;
    } else if (arg === '--contract') {
      if (!value) throw new Error('--contract requires a path');
      args.contract = path.resolve(value);
      index += 1;
    } else if (arg === '--class') {
      if (!value) throw new Error('--class requires an asset class');
      args.assetClass = value;
      index += 1;
    } else if (arg === '--asset-id') {
      if (!value) throw new Error('--asset-id requires a runtime asset id');
      args.assetId = value;
      index += 1;
    } else if (arg === '--model-id') {
      if (!value) throw new Error('--model-id requires a model id');
      args.modelId = value;
      index += 1;
    } else if (arg === '--lod') {
      if (!value) throw new Error('--lod requires lod0, lod1 or lod2');
      args.lod = value;
      index += 1;
    } else if (arg === '--rig-id') {
      if (!value) throw new Error('--rig-id requires a rig id');
      args.rigId = value;
      index += 1;
    } else if (arg === '--required-animation') {
      if (!value) throw new Error('--required-animation requires one or more comma-separated names');
      args.requiredAnimations.push(...value.split(',').filter(Boolean));
      index += 1;
    } else if (arg === '--required-socket') {
      if (!value) throw new Error('--required-socket requires one or more comma-separated names');
      args.requiredSockets.push(...value.split(',').filter(Boolean));
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.input || !args.assetClass) {
    throw new Error(
      'Usage: node tools/art/validate-production-glb.js ' +
      '--input FILE --class ASSET_CLASS [--asset-id ID] [--model-id ID] [--lod lod0]'
    );
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/u, ''));
}

function addIssue(issues, condition, message) {
  if (!condition) issues.push(message);
}

function addWarning(warnings, condition, message) {
  if (!condition) warnings.push(message);
}

function unique(values) {
  return [...new Set(values)];
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function toModelId(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function parseGlb(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Invalid GLB magic');
  }
  if (buffer.readUInt32LE(4) !== 2) {
    throw new Error(`Expected GLB container version 2, got ${buffer.readUInt32LE(4)}`);
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error('GLB header length does not match file length');
  }

  let offset = 12;
  let json = null;
  let binary = null;
  let jsonChunks = 0;
  let binaryChunks = 0;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) throw new Error('Truncated GLB chunk header');
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + chunkLength;
    if (end > buffer.length) throw new Error('GLB chunk exceeds file bounds');
    if (chunkLength % 4 !== 0) throw new Error('GLB chunk is not aligned to four bytes');
    if (chunkType === 0x4e4f534a) {
      jsonChunks += 1;
      json = JSON.parse(
        buffer.subarray(start, end).toString('utf8').replace(/[\u0000 ]+$/u, '')
      );
    } else if (chunkType === 0x004e4942) {
      binaryChunks += 1;
      binary = buffer.subarray(start, end);
    }
    offset = end;
  }
  if (jsonChunks !== 1 || !json) throw new Error(`Expected one JSON chunk, got ${jsonChunks}`);
  if (binaryChunks !== 1 || !binary) throw new Error(`Expected one BIN chunk, got ${binaryChunks}`);
  return { buffer, json, binary };
}

function vectorEquals(actual, expected, epsilon = 0.000001) {
  const value = actual || expected;
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((component, index) => Math.abs(Number(component) - expected[index]) <= epsilon)
  );
}

function validateBufferLayout(gltf, binary, issues) {
  addIssue(issues, (gltf.buffers || []).length === 1, 'Production GLB must contain one buffer');
  const declaredBytes = gltf.buffers?.[0]?.byteLength;
  addIssue(
    issues,
    Number.isInteger(declaredBytes) && declaredBytes > 0 && declaredBytes <= binary.length,
    'Declared buffer byteLength is invalid'
  );
  for (const [index, view] of (gltf.bufferViews || []).entries()) {
    const start = Number(view.byteOffset || 0);
    const length = Number(view.byteLength || 0);
    addIssue(issues, view.buffer === 0 || view.buffer === undefined, `bufferView ${index} uses a non-GLB buffer`);
    addIssue(
      issues,
      Number.isInteger(start) &&
        Number.isInteger(length) &&
        start >= 0 &&
        length > 0 &&
        start + length <= binary.length,
      `bufferView ${index} exceeds the BIN chunk`
    );
  }
}

function accessorLayout(gltf, accessorIndex, issues, label) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) {
    issues.push(`${label}: missing accessor ${accessorIndex}`);
    return null;
  }
  const view = gltf.bufferViews?.[accessor.bufferView];
  if (!view) {
    issues.push(`${label}: accessor ${accessorIndex} has no valid bufferView`);
    return null;
  }
  const component = COMPONENT_INFO[accessor.componentType];
  const components = TYPE_COMPONENTS[accessor.type];
  if (!component || !components) {
    issues.push(`${label}: accessor ${accessorIndex} uses an unsupported component layout`);
    return null;
  }
  const packedStride = component.bytes * components;
  const stride = view.byteStride || packedStride;
  const start = Number(view.byteOffset || 0) + Number(accessor.byteOffset || 0);
  const count = Number(accessor.count || 0);
  addIssue(
    issues,
    Number.isInteger(count) && count > 0,
    `${label}: accessor ${accessorIndex} has an invalid count`
  );
  addIssue(
    issues,
    stride >= packedStride && stride % component.bytes === 0,
    `${label}: accessor ${accessorIndex} has an invalid byte stride`
  );
  return { accessor, view, component, components, packedStride, stride, start, count };
}

function readAccessor(gltf, binary, accessorIndex, issues, label) {
  const layout = accessorLayout(gltf, accessorIndex, issues, label);
  if (!layout || layout.count <= 0) return [];
  const values = [];
  const data = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const signedNormalized = layout.accessor.componentType === 5122;
  for (let rowIndex = 0; rowIndex < layout.count; rowIndex += 1) {
    const row = [];
    const rowStart = layout.start + rowIndex * layout.stride;
    for (let componentIndex = 0; componentIndex < layout.components; componentIndex += 1) {
      const byteOffset = rowStart + componentIndex * layout.component.bytes;
      if (byteOffset + layout.component.bytes > binary.length) {
        issues.push(`${label}: accessor ${accessorIndex} reads beyond the BIN chunk`);
        return values;
      }
      let value = data[layout.component.read](
        byteOffset,
        layout.component.bytes === 1 ? undefined : true
      );
      if (layout.accessor.normalized && layout.component.normalizedMax) {
        value = signedNormalized
          ? Math.max(-1, value / layout.component.normalizedMax)
          : value / layout.component.normalizedMax;
      }
      row.push(value);
    }
    values.push(row);
  }
  return values;
}

function primitiveTriangleCount(gltf, primitive, issues, label) {
  addIssue(
    issues,
    (primitive.mode ?? 4) === 4,
    `${label}: production meshes must use TRIANGLES mode`
  );
  const positionIndex = primitive.attributes?.POSITION;
  const countAccessor = Number.isInteger(primitive.indices)
    ? gltf.accessors?.[primitive.indices]
    : gltf.accessors?.[positionIndex];
  const count = countAccessor?.count || 0;
  addIssue(issues, count % 3 === 0, `${label}: triangle element count is not divisible by three`);
  return Math.floor(count / 3);
}

function readPngDimensions(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), mime: 'image/png' };
  }
  return null;
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const sofMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ]);
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
        mime: 'image/jpeg'
      };
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes) {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null;
  }
  const chunk = bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
      mime: 'image/webp'
    };
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
      mime: 'image/webp'
    };
  }
  if (
    chunk === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
      mime: 'image/webp'
    };
  }
  return null;
}

function imageBytes(gltf, binary, image, issues, label) {
  addIssue(issues, !image.uri, `${label}: production GLB image must use a bufferView`);
  const view = gltf.bufferViews?.[image.bufferView];
  if (!view) {
    issues.push(`${label}: image has no valid bufferView`);
    return null;
  }
  const start = Number(view.byteOffset || 0);
  const end = start + Number(view.byteLength || 0);
  if (start < 0 || end > binary.length || end <= start) {
    issues.push(`${label}: image bufferView exceeds the BIN chunk`);
    return null;
  }
  return binary.subarray(start, end);
}

function imageDimensions(bytes) {
  return readPngDimensions(bytes) || readJpegDimensions(bytes) || readWebpDimensions(bytes);
}

function textureImage(gltf, textureIndex) {
  const texture = gltf.textures?.[textureIndex];
  return Number.isInteger(texture?.source) ? gltf.images?.[texture.source] : null;
}

function validateTextureRole(gltf, textureIndex, role, texturePattern, issues, label) {
  const texture = gltf.textures?.[textureIndex];
  addIssue(issues, !!texture, `${label}: missing ${role} texture`);
  if (!texture) return;
  addIssue(
    issues,
    Number.isInteger(texture.source) && !!gltf.images?.[texture.source],
    `${label}: ${role} texture has no valid image source`
  );
  const image = textureImage(gltf, textureIndex);
  if (!image) return;
  addIssue(issues, texturePattern.test(image.name || ''), `${label}: invalid embedded image name ${image.name || '<unnamed>'}`);
  addIssue(
    issues,
    new RegExp(`_${role}\\.(png|jpg|webp)$`, 'u').test(image.name || ''),
    `${label}: ${image.name || '<unnamed>'} does not identify the ${role} channel`
  );
}

function validateMaterials(gltf, binary, assetClass, contract, issues) {
  const materials = gltf.materials || [];
  addIssue(issues, materials.length > 0, 'Production GLB has no materials');
  addIssue(
    issues,
    materials.length <= assetClass.maxMaterials,
    `Material budget exceeded: ${materials.length}/${assetClass.maxMaterials}`
  );
  const materialPattern = new RegExp(contract.naming.materialPattern);
  const texturePattern = new RegExp(contract.naming.texturePattern);
  const allowedAlphaModes = new Set(contract.textureContract.alphaModes);
  const materialNames = materials.map(material => material.name);
  const duplicateMaterials = duplicateValues(materialNames);
  addIssue(
    issues,
    duplicateMaterials.length === 0,
    `Duplicate material names: ${duplicateMaterials.join(', ')}`
  );

  for (const [index, material] of materials.entries()) {
    const label = `material ${material.name || index}`;
    addIssue(issues, materialPattern.test(material.name || ''), `${label}: invalid material name`);
    addIssue(issues, !material.extensions, `${label}: material extensions are not allowed`);
    const pbr = material.pbrMetallicRoughness;
    addIssue(issues, !!pbr, `${label}: missing metallic/roughness PBR block`);
    if (!pbr) continue;
    const baseColorIndex = pbr.baseColorTexture?.index;
    const normalIndex = material.normalTexture?.index;
    const ormIndex = pbr.metallicRoughnessTexture?.index;
    const occlusionIndex = material.occlusionTexture?.index;
    validateTextureRole(gltf, baseColorIndex, 'basecolor', texturePattern, issues, label);
    validateTextureRole(gltf, normalIndex, 'normal', texturePattern, issues, label);
    validateTextureRole(gltf, ormIndex, 'orm', texturePattern, issues, label);
    addIssue(
      issues,
      Number.isInteger(ormIndex) && ormIndex === occlusionIndex,
      `${label}: occlusion and metallic/roughness must use the same ORM texture`
    );
    if (material.emissiveTexture) {
      validateTextureRole(
        gltf,
        material.emissiveTexture.index,
        'emissive',
        texturePattern,
        issues,
        label
      );
    }
    addIssue(
      issues,
      allowedAlphaModes.has(material.alphaMode || 'OPAQUE'),
      `${label}: alpha mode ${material.alphaMode || 'OPAQUE'} is not allowed`
    );
  }

  const imageNames = (gltf.images || []).map(image => image.name);
  const duplicateImages = duplicateValues(imageNames);
  addIssue(issues, duplicateImages.length === 0, `Duplicate embedded image names: ${duplicateImages.join(', ')}`);
  for (const [index, image] of (gltf.images || []).entries()) {
    const label = `image ${image.name || index}`;
    addIssue(issues, texturePattern.test(image.name || ''), `${label}: invalid embedded image name`);
    const bytes = imageBytes(gltf, binary, image, issues, label);
    if (!bytes) continue;
    const dimensions = imageDimensions(bytes);
    addIssue(issues, !!dimensions, `${label}: unsupported or invalid image payload`);
    if (!dimensions) continue;
    addIssue(
      issues,
      !image.mimeType || image.mimeType === dimensions.mime,
      `${label}: declared MIME type does not match image payload`
    );
    addIssue(
      issues,
      dimensions.width === dimensions.height,
      `${label}: runtime texture must be square`
    );
    addIssue(
      issues,
      contract.textureContract.allowedDimensions.includes(dimensions.width) &&
        contract.textureContract.allowedDimensions.includes(dimensions.height),
      `${label}: texture dimensions ${dimensions.width}x${dimensions.height} are not allowed`
    );
    addIssue(
      issues,
      dimensions.width <= assetClass.maxTextureDimension &&
        dimensions.height <= assetClass.maxTextureDimension,
      `${label}: texture exceeds ${assetClass.maxTextureDimension}px class budget`
    );
  }
}

function validateSkinWeights(gltf, binary, primitive, skin, issues, label) {
  const jointsIndex = primitive.attributes?.JOINTS_0;
  const weightsIndex = primitive.attributes?.WEIGHTS_0;
  addIssue(issues, Number.isInteger(jointsIndex), `${label}: missing JOINTS_0`);
  addIssue(issues, Number.isInteger(weightsIndex), `${label}: missing WEIGHTS_0`);
  addIssue(
    issues,
    !Number.isInteger(primitive.attributes?.JOINTS_1) &&
      !Number.isInteger(primitive.attributes?.WEIGHTS_1),
    `${label}: more than four joint influences are not allowed`
  );
  if (!Number.isInteger(jointsIndex) || !Number.isInteger(weightsIndex)) return;
  const jointAccessor = gltf.accessors?.[jointsIndex];
  const weightAccessor = gltf.accessors?.[weightsIndex];
  addIssue(issues, jointAccessor?.type === 'VEC4', `${label}: JOINTS_0 must be VEC4`);
  addIssue(issues, weightAccessor?.type === 'VEC4', `${label}: WEIGHTS_0 must be VEC4`);
  addIssue(
    issues,
    [5121, 5123].includes(jointAccessor?.componentType),
    `${label}: JOINTS_0 must use unsigned byte or unsigned short`
  );
  addIssue(
    issues,
    weightAccessor?.componentType === 5126 ||
      ([5121, 5123].includes(weightAccessor?.componentType) && weightAccessor.normalized === true),
    `${label}: WEIGHTS_0 must use float or normalized unsigned integers`
  );
  const joints = readAccessor(gltf, binary, jointsIndex, issues, `${label}/JOINTS_0`);
  const weights = readAccessor(gltf, binary, weightsIndex, issues, `${label}/WEIGHTS_0`);
  addIssue(issues, joints.length === weights.length, `${label}: joint and weight vertex counts differ`);
  let invalidWeightRows = 0;
  let invalidJointRows = 0;
  for (let rowIndex = 0; rowIndex < Math.min(joints.length, weights.length); rowIndex += 1) {
    const rowWeights = weights[rowIndex];
    const sum = rowWeights.reduce((total, value) => total + Number(value), 0);
    if (
      rowWeights.some(value => !Number.isFinite(value) || value < -0.0001 || value > 1.0001) ||
      Math.abs(sum - 1) > 0.01
    ) {
      invalidWeightRows += 1;
    }
    if (
      joints[rowIndex].some(
        value => !Number.isInteger(value) || value < 0 || value >= (skin?.joints?.length || 0)
      )
    ) {
      invalidJointRows += 1;
    }
  }
  addIssue(
    issues,
    invalidWeightRows === 0,
    `${label}: ${invalidWeightRows} vertices have non-normalized or invalid weights`
  );
  addIssue(
    issues,
    invalidJointRows === 0,
    `${label}: ${invalidJointRows} vertices reference invalid joints`
  );
}

function validateGeometry(gltf, binary, assetClass, contract, expectedRig, issues) {
  const meshes = gltf.meshes || [];
  addIssue(issues, meshes.length > 0, 'Production GLB has no meshes');
  const meshPattern = new RegExp(contract.naming.meshPattern);
  const meshNames = meshes.map(mesh => mesh.name);
  const duplicates = duplicateValues(meshNames);
  addIssue(issues, duplicates.length === 0, `Duplicate mesh names: ${duplicates.join(', ')}`);

  let triangles = 0;
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity]
  };
  const meshNodes = (gltf.nodes || []).filter(node => Number.isInteger(node.mesh));
  for (const [nodeIndex, node] of meshNodes.entries()) {
    addIssue(
      issues,
      !node.matrix &&
        vectorEquals(node.translation, [0, 0, 0]) &&
        vectorEquals(node.rotation, [0, 0, 0, 1]) &&
        vectorEquals(node.scale, [1, 1, 1]),
      `mesh node ${node.name || nodeIndex}: transforms must be applied`
    );
    if (assetClass.requiresSkin) {
      addIssue(issues, Number.isInteger(node.skin), `mesh node ${node.name || nodeIndex}: missing skin`);
    }
  }

  for (const [meshIndex, mesh] of meshes.entries()) {
    addIssue(issues, meshPattern.test(mesh.name || ''), `mesh ${meshIndex}: invalid name ${mesh.name || '<unnamed>'}`);
    for (const [primitiveIndex, primitive] of (mesh.primitives || []).entries()) {
      const label = `${mesh.name || `mesh ${meshIndex}`}/primitive ${primitiveIndex}`;
      addIssue(issues, Number.isInteger(primitive.attributes?.POSITION), `${label}: missing POSITION`);
      addIssue(issues, Number.isInteger(primitive.attributes?.NORMAL), `${label}: missing NORMAL`);
      if (assetClass.requiresUv) {
        addIssue(issues, Number.isInteger(primitive.attributes?.TEXCOORD_0), `${label}: missing TEXCOORD_0`);
      }
      addIssue(
        issues,
        Number.isInteger(primitive.material) && !!gltf.materials?.[primitive.material],
        `${label}: missing valid material`
      );
      triangles += primitiveTriangleCount(gltf, primitive, issues, label);
      const position = gltf.accessors?.[primitive.attributes?.POSITION];
      addIssue(
        issues,
        position?.type === 'VEC3' && position?.componentType === 5126,
        `${label}: POSITION must use float VEC3`
      );
      addIssue(
        issues,
        Array.isArray(position?.min) &&
          Array.isArray(position?.max) &&
          position.min.length === 3 &&
          position.max.length === 3 &&
          [...position.min, ...position.max].every(Number.isFinite),
        `${label}: POSITION accessor requires finite min/max bounds`
      );
      if (Array.isArray(position?.min) && Array.isArray(position?.max)) {
        for (let axis = 0; axis < 3; axis += 1) {
          bounds.min[axis] = Math.min(bounds.min[axis], position.min[axis]);
          bounds.max[axis] = Math.max(bounds.max[axis], position.max[axis]);
        }
      }
      if (assetClass.requiresSkin) {
        const owningNode = meshNodes.find(node => node.mesh === meshIndex);
        const skin = gltf.skins?.[owningNode?.skin];
        validateSkinWeights(gltf, binary, primitive, skin, issues, label);
      }
    }
  }
  addIssue(
    issues,
    triangles <= assetClass.maxTriangles[expectedRig.lod],
    `Triangle budget exceeded: ${triangles}/${assetClass.maxTriangles[expectedRig.lod]}`
  );
  return { triangles, bounds };
}

function validateSkins(gltf, assetClass, expectedRig, issues) {
  const skins = gltf.skins || [];
  if (!assetClass.requiresSkin) {
    addIssue(issues, skins.length === 0, 'Rigid production asset must not contain a skin');
    return;
  }
  addIssue(issues, skins.length === 1, `Expected one skin, got ${skins.length}`);
  const skin = skins[0];
  if (!skin) return;
  addIssue(
    issues,
    Array.isArray(skin.joints) && skin.joints.length > 0,
    'Skin has no joints'
  );
  addIssue(
    issues,
    Number.isInteger(skin.inverseBindMatrices) &&
      gltf.accessors?.[skin.inverseBindMatrices]?.count === skin.joints?.length,
    'Skin inverse-bind matrix count must match joint count'
  );
  if (expectedRig.jointCount) {
    addIssue(
      issues,
      skin.joints?.length === expectedRig.jointCount,
      `Rig ${expectedRig.rigId} must contain ${expectedRig.jointCount} joints`
    );
  }
  const jointNames = (skin.joints || []).map(index => gltf.nodes?.[index]?.name);
  addIssue(
    issues,
    jointNames.every(Boolean),
    'Every skin joint must reference a named node'
  );
  const duplicates = duplicateValues(jointNames);
  addIssue(issues, duplicates.length === 0, `Duplicate joint names: ${duplicates.join(', ')}`);
}

function validateOrigin(bounds, originProfile, gltf, issues) {
  if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return;
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const root = gltf.nodes?.[scene?.nodes?.[0]];
  const assetClass = root?.extras?.realm_asset_class;
  const floatingSkinnedEquipment =
    originProfile === 'rig_root_ground' &&
    assetClass === 'humanoid_skinned_equipment';
  if (
    ['rig_root_ground', 'object_base_center', 'creature_ground_contact'].includes(originProfile) &&
    !floatingSkinnedEquipment
  ) {
    addIssue(
      issues,
      bounds.min[1] >= -0.03 && bounds.min[1] <= 0.1,
      `Ground-contact origin is invalid: minimum Y is ${bounds.min[1]}`
    );
  }
  if (floatingSkinnedEquipment) {
    const jointNodes = (gltf.skins?.[0]?.joints || [])
      .map(index => gltf.nodes?.[index])
      .filter(Boolean);
    const rigRoot = jointNodes.find(node => node.name === 'root');
    addIssue(
      issues,
      !!rigRoot &&
        !rigRoot.matrix &&
        vectorEquals(rigRoot.translation, [0, 0, 0]) &&
        vectorEquals(rigRoot.scale, [1, 1, 1]),
      'Skinned-equipment rig root translation/scale must stay at the ground origin'
    );
  }
  if (originProfile === 'object_base_center') {
    const width = Math.max(0.001, bounds.max[0] - bounds.min[0]);
    const depth = Math.max(0.001, bounds.max[2] - bounds.min[2]);
    const centerX = (bounds.min[0] + bounds.max[0]) / 2;
    const centerZ = (bounds.min[2] + bounds.max[2]) / 2;
    addIssue(
      issues,
      Math.abs(centerX) <= Math.max(0.02, width * 0.05) &&
        Math.abs(centerZ) <= Math.max(0.02, depth * 0.05),
      `Object-base origin is not centered: X=${centerX}, Z=${centerZ}`
    );
  }
  if (originProfile === 'grip_anchor') {
    const gripNode = (gltf.nodes || []).find(node => node.name === 'socket_grip_r');
    if (gripNode) {
      addIssue(
        issues,
        !gripNode.matrix && vectorEquals(gripNode.translation, [0, 0, 0]),
        'socket_grip_r must coincide with the item origin'
      );
    }
  }
}

function validateNodesAndMetadata(gltf, expected, contract, registry, issues) {
  addIssue(issues, Array.isArray(gltf.scenes) && gltf.scenes.length === 1, 'Expected exactly one scene');
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  addIssue(issues, Array.isArray(scene?.nodes) && scene.nodes.length === 1, 'Scene must contain one production root');
  const root = gltf.nodes?.[scene?.nodes?.[0]];
  addIssue(issues, !!root, 'Production root node does not exist');
  if (!root) return;

  addIssue(issues, root.name === `${expected.modelId}_root`, `Root node must be ${expected.modelId}_root`);
  addIssue(
    issues,
    new RegExp(contract.naming.rootPattern).test(root.name || ''),
    `Root node name violates naming contract: ${root.name || '<unnamed>'}`
  );
  addIssue(
    issues,
    !root.matrix &&
      vectorEquals(root.translation, [0, 0, 0]) &&
      vectorEquals(root.rotation, [0, 0, 0, 1]) &&
      vectorEquals(root.scale, [1, 1, 1]),
    'Production root must have identity transforms'
  );

  const extras = root.extras || {};
  for (const field of contract.metadataContract.requiredRootExtras) {
    addIssue(issues, Object.prototype.hasOwnProperty.call(extras, field), `Root metadata is missing ${field}`);
  }
  addIssue(
    issues,
    extras.realm_asset_schema === contract.metadataContract.assetSchema,
    'Root asset metadata schema is invalid'
  );
  addIssue(issues, extras.realm_asset_id === expected.assetId, 'Root runtime asset id does not match');
  addIssue(issues, extras.realm_asset_class === expected.assetClass, 'Root asset class does not match');
  addIssue(issues, extras.realm_lod === expected.lod, 'Root LOD metadata does not match');
  addIssue(
    issues,
    extras.realm_origin_profile === expected.originProfile,
    'Root origin profile does not match the asset class'
  );
  addIssue(
    issues,
    contract.metadataContract.approvalStatuses.includes(extras.realm_approval_status),
    `Invalid root approval status: ${extras.realm_approval_status}`
  );
  if (contract.artDirection.status !== 'approved') {
    addIssue(
      issues,
      extras.realm_approval_status === 'review',
      'An asset cannot be marked approved or integrated before art-direction approval'
    );
  }
  addIssue(
    issues,
    contract.metadataContract.provenanceTypes.includes(extras.realm_provenance_type),
    `Invalid provenance type: ${extras.realm_provenance_type}`
  );
  addIssue(
    issues,
    typeof extras.realm_provenance_id === 'string' && extras.realm_provenance_id.length > 0,
    'Root provenance id is empty'
  );
  if (extras.realm_provenance_type === 'original') {
    addIssue(
      issues,
      extras.realm_provenance_id === contract.metadataContract.originalProvenanceId,
      'Original asset provenance id is invalid'
    );
  } else if (extras.realm_provenance_type === 'derived') {
    const source = (registry.sources || []).find(row => row.name === extras.realm_provenance_id);
    addIssue(issues, !!source, `Unknown derived source: ${extras.realm_provenance_id}`);
    addIssue(
      issues,
      !!source && !String(source.review_status || '').startsWith('blocked_'),
      `Derived source is blocked: ${extras.realm_provenance_id}`
    );
  }
  if (expected.rigId) {
    addIssue(
      issues,
      extras[contract.metadataContract.rigExtra] === expected.rigId,
      `Root rig metadata must be ${expected.rigId}`
    );
  }
  addIssue(
    issues,
    extras.realm_preview_only !== true,
    'Technical preview metadata is not allowed on a production GLB'
  );

  const nodeNames = (gltf.nodes || []).map(node => node.name);
  addIssue(issues, nodeNames.every(Boolean), 'Every production node must have a name');
  const duplicateNodes = duplicateValues(nodeNames);
  addIssue(issues, duplicateNodes.length === 0, `Duplicate node names: ${duplicateNodes.join(', ')}`);
  const leakedHelpers = nodeNames.filter(name => ['Cube', 'Camera', 'Light', 'Icosphere'].includes(name));
  addIssue(issues, leakedHelpers.length === 0, `Helper nodes leaked into GLB: ${leakedHelpers.join(', ')}`);
  addIssue(issues, (gltf.cameras || []).length === 0, 'Cameras are not allowed in a production GLB');

  const sockets = new Set(nodeNames.filter(name => String(name).startsWith('socket_')));
  for (const socket of expected.requiredSockets) {
    addIssue(issues, sockets.has(socket), `Missing required socket: ${socket}`);
  }
  const socketPattern = new RegExp(contract.naming.socketPattern);
  for (const socket of sockets) {
    addIssue(issues, socketPattern.test(socket), `Invalid socket name: ${socket}`);
  }
}

function validateAnimations(gltf, expected, contract, issues) {
  const names = (gltf.animations || []).map(animation => animation.name);
  const duplicates = duplicateValues(names);
  addIssue(issues, duplicates.length === 0, `Duplicate animation names: ${duplicates.join(', ')}`);
  const animationPattern = new RegExp(contract.naming.animationPattern);
  for (const name of names) {
    addIssue(issues, animationPattern.test(name || ''), `Invalid animation name: ${name || '<unnamed>'}`);
  }
  const available = new Set(names);
  for (const required of expected.requiredAnimations) {
    addIssue(issues, available.has(required), `Missing required animation: ${required}`);
  }
  if (contract.lodPolicy.animationClips === 'lod0_only' && expected.lod !== 'lod0') {
    addIssue(
      issues,
      names.length === 0,
      `${expected.lod}: animation clips must remain in LOD0 only`
    );
  }
}

function resolveExpected(options, contract, assetLibrary, characterLibrary, issues) {
  const classDefinition = (contract.assetClasses || []).find(row => row.id === options.assetClass);
  addIssue(issues, !!classDefinition, `Unknown asset class: ${options.assetClass}`);
  addIssue(issues, options.assetClass !== 'surface_material', 'surface_material is not a GLB asset class');

  const fileName = path.basename(options.input);
  const fileMatch = /^([a-z][a-z0-9_]*)_(lod[0-2])\.glb$/u.exec(fileName);
  const inferredModelId = fileMatch?.[1];
  const inferredLod = fileMatch?.[2];
  const assetId = options.assetId || inferredModelId || '';
  const modelId = options.modelId || toModelId(assetId) || inferredModelId || '';
  const lod = options.lod || inferredLod || '';
  addIssue(
    issues,
    new RegExp(contract.naming.runtimeIdPattern).test(assetId),
    `Invalid runtime asset id: ${assetId || '<missing>'}`
  );
  addIssue(
    issues,
    new RegExp(contract.naming.identifierPattern).test(modelId),
    `Invalid model id: ${modelId || '<missing>'}`
  );
  addIssue(issues, ['lod0', 'lod1', 'lod2'].includes(lod), `Invalid LOD: ${lod || '<missing>'}`);
  addIssue(
    issues,
    fileName === `${modelId}_${lod}.glb`,
    `File name must be ${modelId}_${lod}.glb`
  );

  const item = (assetLibrary.inventoryItems || []).find(row => row.id === assetId);
  const creature = (assetLibrary.creatures || []).find(row => row.id === assetId);
  const catalogItemOnlyClasses = new Set([
    'inventory_prop',
    'handheld_weapon',
    'handheld_tool',
    'rigid_equipment'
  ]);
  if (catalogItemOnlyClasses.has(options.assetClass)) {
    addIssue(
      issues,
      !!item,
      `${assetId}: class ${options.assetClass} requires an exact runtime item id from the asset library`
    );
  }
  if (options.assetClass === 'humanoid_skinned_equipment') {
    const firstOutfitIds = new Set(contract.humanoidContract.firstOutfitItems || []);
    addIssue(
      issues,
      !!item || firstOutfitIds.has(assetId),
      `${assetId}: skinned equipment is absent from the item catalog and first outfit`
    );
  }
  if (String(options.assetClass).startsWith('creature_')) {
    addIssue(
      issues,
      !!creature,
      `${assetId}: creature class requires an exact creature id from the asset library`
    );
  }
  let rigId = options.rigId || null;
  let jointCount = null;
  let requiredAnimations = [...options.requiredAnimations];
  let requiredSockets = [...options.requiredSockets];
  if (item) {
    const mappedClass = contract.inventoryFamilyClassMap[item.family];
    addIssue(
      issues,
      mappedClass === options.assetClass,
      `${assetId}: catalog family ${item.family} requires class ${mappedClass}`
    );
    requiredSockets.push(
      ...(contract.inventoryAttachmentRules.itemSocketOverrides[assetId] || [])
    );
  }
  if (creature) {
    const creatureContract = contract.creatureContracts.find(row => row.id === assetId);
    addIssue(issues, !!creatureContract, `${assetId}: missing creature production contract`);
    if (creatureContract) {
      addIssue(
        issues,
        creatureContract.assetClass === options.assetClass,
        `${assetId}: creature requires class ${creatureContract.assetClass}`
      );
      rigId = rigId || creatureContract.rigId;
      if (lod === 'lod0') {
        requiredAnimations.push(...creatureContract.requiredAnimations);
      }
    }
  }
  if (options.assetClass.startsWith('humanoid_')) {
    rigId = rigId || contract.humanoidContract.rigId;
    jointCount = contract.humanoidContract.jointCount;
    if (options.assetClass === 'humanoid_body') {
      requiredSockets.push(...contract.humanoidContract.characterSockets);
      if (lod === 'lod0') {
        requiredAnimations.push(...(characterLibrary.animationRequirements?.release || []));
      }
    }
  }
  if (classDefinition?.requiresSkin) {
    addIssue(issues, !!rigId, `${assetId}: skinned asset requires a rig id`);
  }

  return {
    assetId,
    modelId,
    lod,
    assetClass: options.assetClass,
    classDefinition,
    originProfile: contract.assetClassOriginMap[options.assetClass],
    rigId,
    jointCount,
    requiredAnimations: unique(requiredAnimations),
    requiredSockets: unique(requiredSockets),
    item,
    creature
  };
}

function validateProductionGlb(options) {
  options = {
    requiredAnimations: [],
    requiredSockets: [],
    contract: DEFAULT_CONTRACT,
    ...options
  };
  const issues = [];
  const warnings = [];
  addIssue(issues, fs.existsSync(options.input), `Input GLB does not exist: ${options.input}`);
  addIssue(issues, fs.existsSync(options.contract), `Production contract does not exist: ${options.contract}`);
  if (issues.length) {
    return { valid: false, issues, warnings, stats: {} };
  }

  const contract = readJson(options.contract);
  const assetLibraryFile = path.resolve(REPO_ROOT, contract.linkedManifests.assetLibrary);
  const characterLibraryFile = path.resolve(
    REPO_ROOT,
    contract.linkedManifests.characterLibrary
  );
  const registryFile = path.resolve(REPO_ROOT, contract.linkedManifests.sourceRegistry);
  const assetLibrary = readJson(assetLibraryFile);
  const characterLibrary = readJson(characterLibraryFile);
  const registry = readJson(registryFile);
  const expected = resolveExpected(
    options,
    contract,
    assetLibrary,
    characterLibrary,
    issues
  );
  let parsed;
  try {
    parsed = parseGlb(options.input);
  } catch (error) {
    issues.push(error.message || String(error));
    return { valid: false, issues, warnings, expected, stats: {} };
  }
  const { buffer, json: gltf, binary } = parsed;
  addIssue(issues, gltf.asset?.version === contract.runtimeTarget.gltfVersion, 'asset.version must be 2.0');
  const externalUris = [
    ...(gltf.buffers || []).map(row => row.uri),
    ...(gltf.images || []).map(row => row.uri)
  ].filter(Boolean);
  addIssue(issues, externalUris.length === 0, `GLB has external resources: ${externalUris.join(', ')}`);
  const requiredExtensions = gltf.extensionsRequired || [];
  addIssue(
    issues,
    requiredExtensions.every(extension =>
      contract.runtimeTarget.allowedRequiredExtensions.includes(extension)
    ),
    `GLB requires unsupported extensions: ${requiredExtensions.join(', ')}`
  );
  addWarning(
    warnings,
    (gltf.extensionsUsed || []).length === 0,
    `GLB declares optional extensions that require runtime review: ${(gltf.extensionsUsed || []).join(', ')}`
  );
  addIssue(
    issues,
    buffer.length <= (contract.maxGlbBytesByClass[options.assetClass] || 0),
    `GLB byte budget exceeded: ${buffer.length}/${contract.maxGlbBytesByClass[options.assetClass] || 0}`
  );
  validateBufferLayout(gltf, binary, issues);
  validateNodesAndMetadata(gltf, expected, contract, registry, issues);
  if (expected.classDefinition) {
    validateMaterials(gltf, binary, expected.classDefinition, contract, issues);
    validateSkins(gltf, expected.classDefinition, expected, issues);
    const geometry = validateGeometry(
      gltf,
      binary,
      expected.classDefinition,
      contract,
      expected,
      issues
    );
    validateOrigin(geometry.bounds, expected.originProfile, gltf, issues);
    validateAnimations(gltf, expected, contract, issues);
    return {
      valid: issues.length === 0,
      issues,
      warnings,
      expected,
      stats: {
        bytes: buffer.length,
        triangles: geometry.triangles,
        meshes: (gltf.meshes || []).length,
        materials: (gltf.materials || []).length,
        images: (gltf.images || []).length,
        skins: (gltf.skins || []).length,
        joints: gltf.skins?.[0]?.joints?.length || 0,
        animations: (gltf.animations || []).length,
        sockets: (gltf.nodes || []).filter(node =>
          String(node.name || '').startsWith('socket_')
        ).length
      }
    };
  }
  return { valid: false, issues, warnings, expected, stats: {} };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = validateProductionGlb(args);
  const output = {
    input: path.relative(REPO_ROOT, args.input).replace(/\\/g, '/'),
    valid: report.valid,
    assetId: report.expected?.assetId,
    modelId: report.expected?.modelId,
    assetClass: report.expected?.assetClass,
    lod: report.expected?.lod,
    originProfile: report.expected?.originProfile,
    rigId: report.expected?.rigId,
    requiredSockets: report.expected?.requiredSockets,
    requiredAnimations: report.expected?.requiredAnimations,
    stats: report.stats,
    issues: report.issues,
    warnings: report.warnings
  };
  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (report.valid) {
    console.log(
      `Производственный GLB корректен: ${output.modelId}/${output.lod}, ` +
      `${report.stats.triangles} треугольников, ${report.stats.materials} материалов, ` +
      `${report.stats.images} PBR-карт, ${report.stats.bytes} байт.`
    );
  } else {
    console.error(
      `Ошибки производственного GLB:\n${report.issues.map(issue => `- ${issue}`).join('\n')}`
    );
  }
  for (const warning of report.warnings) console.warn(`Предупреждение: ${warning}`);
  if (!report.valid) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message || error);
    process.exit(1);
  }
}

module.exports = {
  imageDimensions,
  parseGlb,
  readAccessor,
  toModelId,
  validateProductionGlb
};
