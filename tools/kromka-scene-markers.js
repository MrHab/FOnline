'use strict';

// Reads the KromkaPlacedObjectAuthoring markers of a Kromka location scene.
// KromkaWorldSceneExporter turns these flags into the server's `collision` and
// `vision`, so the scene is authored data that checks pair with data/locations.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLACED_OBJECT_SCRIPT_GUID = 'da467f951bfa613fd5b8f17562a30404';
// The collision modes locationObjectBlocksMovement() in server.js stops a player on.
const SERVER_BLOCKING_COLLISIONS = new Set(['solid', 'block', 'blocked', 'wall', 'resource']);

const CLASS_GAME_OBJECT = 1;
const CLASS_TRANSFORM = 4;
const CLASS_BOX_COLLIDER = 65;
const CLASS_SPHERE_COLLIDER = 135;
const CLASS_CAPSULE_COLLIDER = 136;
const CLASS_MONO_BEHAVIOUR = 114;
const CLASS_PREFAB_INSTANCE = 1001;
// Every Unity collider class. The scenes use the three analytic ones; any other
// (mesh, terrain, wheel) has no exact 2D shape here and must fail loudly.
const COLLIDER_CLASSES = new Map([
  [CLASS_BOX_COLLIDER, 'box'], [CLASS_SPHERE_COLLIDER, 'sphere'], [CLASS_CAPSULE_COLLIDER, 'capsule'],
  [64, 'mesh'], [154, 'terrain'], [146, 'wheel']
]);

function collisionBlocksMovement(collision) {
  return SERVER_BLOCKING_COLLISIONS.has(String(collision || '').trim().toLowerCase());
}

function locationScenePath(definition, root = ROOT) {
  const scene = String(definition?.unityScene || '').trim();
  return scene ? path.join(root, 'unity-client', scene) : '';
}

function sceneDocuments(scenePath) {
  return fs.readFileSync(scenePath, 'utf8').split(/^--- !u!/m).slice(1).map(text => {
    const header = /^(\d+) &(-?\d+)( stripped)?/.exec(text);
    if (!header) throw new Error(`${scenePath}: unreadable YAML document header`);
    return { classId: Number(header[1]), fileId: header[2], stripped: Boolean(header[3]), text };
  });
}

function fieldReader(text) {
  return name => (text.match(new RegExp(`^  ${name}:[ \\t]*(.*?)\\r?$`, 'm')) || [])[1];
}

function markerFromDocument(document, scenePath) {
  const field = fieldReader(document.text);
  const id = field('_stableObjectId') || '';
  if (!id) throw new Error(`${scenePath}: placed-object marker without _stableObjectId`);
  const tagBlock = document.text.match(/^  _gameplayTags:[ \t]*\r?\n((?:  - .*\r?\n)*)/m);
  return {
    id,
    gameObject: reference(field('m_GameObject')),
    archetype: field('_serverArchetypeId') || '',
    role: field('_role') || '',
    tags: tagBlock ? tagBlock[1].split(/\r?\n/).filter(Boolean).map(line => unquote(line.slice(4).trim())) : [],
    blocksMovement: field('_blocksMovement') === '1',
    blocksVision: field('_blocksVision') === '1',
    lowCover: field('_lowCover') === '1'
  };
}

function isMarkerDocument(document) {
  return document.classId === CLASS_MONO_BEHAVIOUR && document.text.includes(`guid: ${PLACED_OBJECT_SCRIPT_GUID}`);
}

function readPlacedObjectMarkers(scenePath) {
  const markers = new Map();
  for (const document of sceneDocuments(scenePath)) {
    if (!isMarkerDocument(document)) continue;
    const marker = markerFromDocument(document, scenePath);
    if (markers.has(marker.id)) throw new Error(`${scenePath}: duplicate placed-object marker ${marker.id}`);
    markers.set(marker.id, marker);
  }
  return markers;
}

function unquote(value) {
  const quoted = /^'(.*)'$/.exec(value) || /^"(.*)"$/.exec(value);
  return quoted ? quoted[1] : value;
}

function reference(value) {
  return (/fileID: (-?\d+)/.exec(String(value || '')) || [])[1] || '0';
}

function inlineVector(value, keys) {
  const result = {};
  for (const key of keys) {
    const match = new RegExp(`\\b${key}: (-?[0-9.eE+-]+)`).exec(String(value || ''));
    if (!match) return null;
    result[key] = Number(match[1]);
  }
  return result;
}

// Row-major 3x4 affine matrices: [linear 3x3 | translation].
function trsMatrix(position, rotation, scale) {
  const { x, y, z, w } = rotation;
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
  ];
  return [
    r[0] * scale.x, r[1] * scale.y, r[2] * scale.z, position.x,
    r[3] * scale.x, r[4] * scale.y, r[5] * scale.z, position.y,
    r[6] * scale.x, r[7] * scale.y, r[8] * scale.z, position.z
  ];
}

function multiply(a, b) {
  const out = new Array(12);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      out[row * 4 + column] = a[row * 4] * b[column] + a[row * 4 + 1] * b[4 + column] + a[row * 4 + 2] * b[8 + column]
        + (column === 3 ? a[row * 4 + 3] : 0);
    }
  }
  return out;
}

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]
  ];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

// Every enabled, non-trigger collider of the scene, grouped by the placed-object
// marker above it, with the world-space geometry the physics engine uses. Colliders
// under no marker are returned under the key '' (the ground is a marker of its own).
function readMarkerColliders(scenePath) {
  const documents = sceneDocuments(scenePath);
  const gameObjects = new Map();
  const transforms = new Map();
  const transformOfGameObject = new Map();
  const prefabParents = new Map();
  const markerOfGameObject = new Map();
  const colliders = [];

  for (const document of documents) {
    const field = fieldReader(document.text);
    if (document.classId === CLASS_GAME_OBJECT) {
      gameObjects.set(document.fileId, {
        name: unquote(field('m_Name') || ''),
        active: document.stripped ? true : field('m_IsActive') !== '0',
        stripped: document.stripped
      });
    } else if (document.classId === CLASS_TRANSFORM) {
      const transform = { fileId: document.fileId, stripped: document.stripped, gameObject: reference(field('m_GameObject')) };
      if (document.stripped) transform.prefabInstance = reference(field('m_PrefabInstance'));
      else {
        transform.position = inlineVector(field('m_LocalPosition'), ['x', 'y', 'z']);
        transform.rotation = inlineVector(field('m_LocalRotation'), ['x', 'y', 'z', 'w']);
        transform.scale = inlineVector(field('m_LocalScale'), ['x', 'y', 'z']);
        transform.father = reference(field('m_Father'));
        if (!transform.position || !transform.rotation || !transform.scale)
          throw new Error(`${scenePath}: transform ${document.fileId} has no readable TRS`);
      }
      transforms.set(document.fileId, transform);
      if (transform.gameObject !== '0') transformOfGameObject.set(transform.gameObject, transform);
    } else if (document.classId === CLASS_PREFAB_INSTANCE) {
      prefabParents.set(document.fileId, reference((document.text.match(/^    m_TransformParent:[ \t]*(.*?)\r?$/m) || [])[1]));
    } else if (isMarkerDocument(document)) {
      const marker = markerFromDocument(document, scenePath);
      markerOfGameObject.set(marker.gameObject, marker);
    } else if (COLLIDER_CLASSES.has(document.classId)) {
      const kind = COLLIDER_CLASSES.get(document.classId);
      const collider = {
        kind,
        gameObject: reference(field('m_GameObject')),
        enabled: field('m_Enabled') !== '0',
        trigger: field('m_IsTrigger') === '1',
        center: inlineVector(field('m_Center'), ['x', 'y', 'z']) || { x: 0, y: 0, z: 0 }
      };
      if (kind === 'box') collider.size = inlineVector(field('m_Size'), ['x', 'y', 'z']);
      if (kind === 'sphere' || kind === 'capsule') collider.radius = Number(field('m_Radius'));
      if (kind === 'capsule') {
        collider.height = Number(field('m_Height'));
        collider.direction = Number(field('m_Direction'));
      }
      colliders.push(collider);
    }
  }

  const worldCache = new Map();
  function world(transform) {
    if (!transform) return { matrix: IDENTITY, active: true, marker: null };
    if (worldCache.has(transform.fileId)) return worldCache.get(transform.fileId);
    const gameObject = gameObjects.get(transform.gameObject);
    const ownMarker = markerOfGameObject.get(transform.gameObject) || null;
    let result;
    if (transform.stripped) {
      // A prefab instance root keeps its TRS in the PrefabInstance overrides. No blocking
      // marker is built that way, so only the chain above it matters here.
      const parent = world(transforms.get(prefabParents.get(transform.prefabInstance)));
      result = { matrix: null, active: parent.active, marker: ownMarker || parent.marker };
    } else {
      const parent = world(transforms.get(transform.father));
      result = {
        matrix: parent.matrix ? multiply(parent.matrix, trsMatrix(transform.position, transform.rotation, transform.scale)) : null,
        active: parent.active && (!gameObject || gameObject.active),
        marker: ownMarker || parent.marker
      };
    }
    worldCache.set(transform.fileId, result);
    return result;
  }

  const byMarker = new Map();
  for (const collider of colliders) {
    const transform = transformOfGameObject.get(collider.gameObject);
    const placed = world(transform);
    if (!collider.enabled || collider.trigger || !placed.active) continue;
    const name = gameObjects.get(collider.gameObject)?.name || '';
    const owner = placed.marker ? placed.marker.id : '';
    if (!['box', 'sphere', 'capsule'].includes(collider.kind))
      throw new Error(`${scenePath}: ${owner || name} carries a ${collider.kind} collider; only box, sphere and capsule have an exported server shape`);
    if (!placed.matrix)
      throw new Error(`${scenePath}: collider ${name} of ${owner || 'no marker'} sits inside a prefab instance; its transform is not readable here`);
    const m = placed.matrix;
    const axes = [0, 1, 2].map(column => [m[column], m[4 + column], m[8 + column]]);
    const lengths = axes.map(axis => Math.hypot(axis[0], axis[1], axis[2]));
    const shape = {
      kind: collider.kind,
      name,
      // Unit world directions of the collider's local X, Y, Z and the scale along each.
      axes: axes.map((axis, index) => axis.map(value => value / (lengths[index] || 1))),
      scale: lengths,
      center: transformPoint(m, [collider.center.x, collider.center.y, collider.center.z])
    };
    if (collider.kind === 'box') {
      const half = [collider.size.x / 2, collider.size.y / 2, collider.size.z / 2];
      shape.corners = [];
      for (let i = 0; i < 8; i++) {
        shape.corners.push(transformPoint(m, [
          collider.center.x + ((i & 1) ? half[0] : -half[0]),
          collider.center.y + ((i & 2) ? half[1] : -half[1]),
          collider.center.z + ((i & 4) ? half[2] : -half[2])
        ]));
      }
    } else {
      shape.radius = collider.radius;
      if (collider.kind === 'capsule') {
        shape.height = collider.height;
        shape.direction = collider.direction;
      }
    }
    if (!byMarker.has(owner)) byMarker.set(owner, []);
    byMarker.get(owner).push(shape);
  }
  return byMarker;
}

// Дружелюбные НПС сцены — экземпляры префаба KromkaNpc. Всё, что у них своё,
// лежит в переопределениях экземпляра: id якоря (_spawnId), место и поворот
// корня, облик. Мир — через родителя экземпляра (Npcs_EDITABLE и выше).
function readNpcPlacements(scenePath, prefabGuid) {
  const documents = sceneDocuments(scenePath);
  const transforms = new Map();
  for (const document of documents) {
    if (document.classId !== CLASS_TRANSFORM || document.stripped) continue;
    const field = fieldReader(document.text);
    transforms.set(document.fileId, {
      position: inlineVector(field('m_LocalPosition'), ['x', 'y', 'z']),
      rotation: inlineVector(field('m_LocalRotation'), ['x', 'y', 'z', 'w']),
      scale: inlineVector(field('m_LocalScale'), ['x', 'y', 'z']),
      father: reference(field('m_Father'))
    });
  }
  const worldCache = new Map();
  function world(fileId) {
    if (!fileId || fileId === '0') return IDENTITY;
    if (worldCache.has(fileId)) return worldCache.get(fileId);
    const transform = transforms.get(fileId);
    if (!transform) throw new Error(`${scenePath}: an NPC hangs under transform ${fileId} this reader cannot place`);
    const matrix = multiply(world(transform.father), trsMatrix(transform.position, transform.rotation, transform.scale));
    worldCache.set(fileId, matrix);
    return matrix;
  }

  const source = `guid: ${prefabGuid}`;
  const placements = [];
  for (const document of documents) {
    if (document.classId !== CLASS_PREFAB_INSTANCE) continue;
    const sourceLine = (document.text.match(/^  m_SourcePrefab:[ \t]*(.*?)\r?$/m) || [])[1] || '';
    if (!sourceLine.includes(source)) continue;
    const parent = reference((document.text.match(/^    m_TransformParent:[ \t]*(.*?)\r?$/m) || [])[1]);
    const values = {};
    const pattern = /- target: \{fileID: -?\d+, guid: [0-9a-f]+, type: \d+\}\r?\n\s+propertyPath: (\S+)\r?\n\s+value: ?(.*?)\r?$/gm;
    for (const match of document.text.matchAll(pattern)) values[match[1]] = unquote(match[2].trim());
    const number = (key, fallback) => (values[key] !== undefined && values[key] !== '' ? Number(values[key]) : fallback);
    const local = trsMatrix(
      { x: number('m_LocalPosition.x', 0), y: number('m_LocalPosition.y', 0), z: number('m_LocalPosition.z', 0) },
      { x: number('m_LocalRotation.x', 0), y: number('m_LocalRotation.y', 0), z: number('m_LocalRotation.z', 0),
        w: number('m_LocalRotation.w', 1) },
      { x: number('m_LocalScale.x', 1), y: number('m_LocalScale.y', 1), z: number('m_LocalScale.z', 1) });
    const matrix = multiply(world(parent), local);
    const position = transformPoint(matrix, [0, 0, 0]);
    placements.push({
      id: values._spawnId || '',
      x: position[0],
      z: position[2],
      // Поворот вокруг вертикали — как его пишет экспорт: eulerAngles.y в радианах.
      yaw: Math.atan2(matrix[2], matrix[10]),
      appearance: {
        sex: Number(values._sex || 0) === 1 ? 'female' : 'male',
        hairId: values._hairId || 'short_crop',
        hairColorId: `hair_0${number('_hairColor', 3)}`
      },
      equipment: {
        weapon: values._weapon || 'fists',
        armor: values._armor || '',
        helmet: values._helmet || '',
        boots: values._boots || '',
        backpack: values._backpack || ''
      }
    });
  }
  return placements;
}

module.exports = {
  PLACED_OBJECT_SCRIPT_GUID,
  collisionBlocksMovement,
  locationScenePath,
  readMarkerColliders,
  readNpcPlacements,
  readPlacedObjectMarkers
};
