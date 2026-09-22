const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const authoredDataDir = path.join(root, 'data');
const serverSourceDir = path.join(root, 'src', 'server');
const unityScriptsDir = path.join(root, 'unity-client', 'Assets', 'Scripts');
// public/unity — генерируемая сборка WebGL (меню «Кромка → Build WebGL»), в git не
// входит и локально может отставать от исходников. Её страница проверяется по
// исходному шаблону в unity-client/Assets/WebGLTemplates.
const generatedUnityBuildDir = path.join(publicDir, 'unity');
const unityWebGlTemplatesDir = path.join(root, 'unity-client', 'Assets', 'WebGLTemplates');
const checkedExtensions = new Set(['.html', '.css', '.js']);
const manifestListKeys = new Set(['files', 'bundled_files']);
const manifestAssetKeys = new Set([
  'base',
  'normal',
  'roughness',
  'ao',
  'height',
  'metallic',
  'emissive',
  'opacity',
  'alpha',
  'map',
  'file',
  'url'
]);
const runtimeAssetExtensions = new Set([
  '.avif',
  '.fbx',
  '.gif',
  '.glb',
  '.gltf',
  '.ico',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.ogg',
  '.png',
  '.svg',
  '.webp',
  '.woff',
  '.woff2'
]);
const knownDynamicRoutes = new Set([
  '/socket.io/socket.io.js'
]);

function walkFiles(dir, out = [], extensionFilter = checkedExtensions) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out, extensionFilter);
    else if (entry.isFile() && (!extensionFilter || extensionFilter.has(path.extname(entry.name)))) out.push(full);
  }
  return out;
}

function cleanUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) return '';
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  url = url.split('#')[0].split('?')[0].trim();
  return url;
}

function shouldCheck(url) {
  if (!url || knownDynamicRoutes.has(url)) return false;
  if (/^(?:data:|https?:|blob:|mailto:|javascript:)/i.test(url)) return false;
  if (url.includes('${') || url.includes('`')) return false;
  return url.startsWith('/')
    || url.startsWith('./')
    || url.startsWith('../')
    || /^(?:assets|css|js)\//.test(url);
}

function publicPathFor(url, sourceFile) {
  // Generator provenance uses repository paths; runtime entries use URLs.
  if (/^public\/(?:assets|css|js)\//.test(url)) {
    return path.resolve(root, url);
  }
  if (url.startsWith('/')) return path.join(publicDir, url.slice(1).replace(/[\\/]+/g, path.sep));
  if (/^(?:assets|css|js)\//.test(url)) {
    return path.join(publicDir, url.replace(/[\\/]+/g, path.sep));
  }
  return path.resolve(path.dirname(sourceFile), url);
}

function collectRefs(file, source) {
  const refs = [];
  const ext = path.extname(file);
  const addMatches = regex => {
    for (const match of source.matchAll(regex)) refs.push(cleanUrl(match[1]));
  };

  if (ext === '.css') {
    addMatches(/url\(\s*(['"]?[^'")]+['"]?)\s*\)/g);
    addMatches(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g);
  }

  if (ext === '.html') {
    addMatches(/\b(?:src|href)=["']([^"']+)["']/g);
    // Встроенные <script> dev-редакторов ссылаются на текстуры строковыми литералами.
    for (const script of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      for (const match of script[1].matchAll(/['"`](\/?(?:assets|css|js)\/[^'"`]+)['"`]/g)) {
        refs.push(cleanUrl(match[1]));
      }
    }
  }

  if (ext === '.js') {
    addMatches(/['"`](\/?(?:assets|css|js)\/[^'"`]+)['"`]/g);
    addMatches(/['"`](\/(?:vendor\/three\.min\.js|vendor\/GLTFLoader\.js|socket\.io\/socket\.io\.js))['"`]/g);
  }

  return refs.filter(shouldCheck);
}

// Unity C#: полные пути "/assets/…" — литералом или склейкой с константой файла
// (`private const string Wasteland = "/assets/models/wasteland/";` +
// `Wasteland + "npc_ghoul.glb"`). Префиксы без расширения
// ("/assets/models/weapons/weapon_" + id + ".glb") собираются во время игры и
// здесь не проверяются; их файлы должны быть учтены другими источниками.
function collectUnityRefs(source) {
  const constants = new Map();
  for (const match of source.matchAll(/\bconst\s+string\s+([A-Za-z_]\w*)\s*=\s*"([^"\\]*)"\s*;/g)) {
    constants.set(match[1], match[2]);
  }
  const refs = [...source.matchAll(/"(\/assets\/[^"\\]*)"/g)].map(match => match[1]);
  for (const match of source.matchAll(/\b([A-Za-z_]\w*)\s*\+\s*"([^"\\]*)"/g)) {
    if (constants.has(match[1])) refs.push(constants.get(match[1]) + match[2]);
  }
  return refs
    .map(cleanUrl)
    .filter(url => url.startsWith('/assets/') && /\.[A-Za-z0-9]+$/.test(url));
}

function shouldCheckManifestRef(url) {
  if (!url || knownDynamicRoutes.has(url)) return false;
  if (/^(?:data:|https?:|blob:)/i.test(url)) return false;
  return /\.(?:png|webp|jpe?g|gif|fbx|glb|gltf|json|txt)$/i.test(url);
}

function collectManifestRefs(node, key = '', sourceProvenance = '') {
  const refs = [];
  if (['realm.free-equipment-catalog.v2', 'realm.layered-suits.v2', 'realm.vehicle-model-manifest.v1'].includes(node?.schema)) {
    sourceProvenance = node.schema;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === 'string' && manifestListKeys.has(key)) refs.push(cleanUrl(item));
      else refs.push(...collectManifestRefs(item, key, sourceProvenance));
    }
    return refs;
  }
  if (!node || typeof node !== 'object') return refs;
  for (const [childKey, value] of Object.entries(node)) {
    // Donor filenames are relative to source-assets, not served URLs. Their
    // existence/hash/license is checked by the corresponding model check.
    if (sourceProvenance && (childKey === 'source' || childKey === 'sources')) continue;
    if (sourceProvenance === 'realm.layered-suits.v2' && childKey === 'retainedReference') continue;
    if (typeof value === 'string' && manifestAssetKeys.has(childKey)) {
      refs.push(cleanUrl(value));
    } else {
      refs.push(...collectManifestRefs(value, childKey, sourceProvenance));
    }
  }
  return refs.filter(shouldCheckManifestRef);
}

function manifestFiles() {
  return walkFiles(path.join(publicDir, 'assets'), [], new Set(['.json']))
    .filter(file => {
      const basename = path.basename(file).toLowerCase();
      return path.extname(file) === '.json'
        && (basename.includes('manifest') || basename === 'approved-humanoid-assets.json');
    });
}

// Resolution regressions: never confuse generator inputs with runtime files,
// and retain traversal checks and ordinary manifest source validation.
const fixtureManifest = path.join(publicDir, 'assets/models/fixture/manifest.json');
assert.equal(publicPathFor('public/assets/models/test.glb', fixtureManifest),
  path.join(publicDir, 'assets/models/test.glb'));
assert.equal(publicPathFor('test.glb', fixtureManifest),
  path.join(publicDir, 'assets/models/fixture/test.glb'));
assert(!publicPathFor('public/assets/../../../outside.glb', fixtureManifest)
  .startsWith(publicDir + path.sep));
assert.deepEqual(collectManifestRefs({ schema: 'realm.free-equipment-catalog.v2',
  files: [{ file: '/assets/result.glb', source: { file: 'donor.glb' },
    retainedReference: { file: 'public/assets/original.glb' } }] }),
['/assets/result.glb', 'public/assets/original.glb']);
assert.deepEqual(collectManifestRefs({ source: { file: 'ordinary.glb' } }), ['ordinary.glb']);
assert.deepEqual(collectManifestRefs({ schema: 'realm.layered-suits.v2', files: [
  { file: '/assets/suit.glb', source: { file: 'Build/donor.gltf' },
    retainedReference: { file: 'docs/review.glb' },
    bodyReference: { file: 'public/assets/body.glb' } }
] }), ['/assets/suit.glb', 'public/assets/body.glb']);

const missing = [];
const referencedAssets = new Set();
let refCount = 0;
let manifestRefCount = 0;
let authoredRefCount = 0;
let serverRefCount = 0;
let unityRefCount = 0;

function rememberAssetReference(target) {
  const resolved = path.resolve(target);
  const assetsDir = path.join(publicDir, 'assets');
  if (resolved === assetsDir || resolved.startsWith(assetsDir + path.sep)) {
    referencedAssets.add(resolved.toLowerCase());
  }
}

for (const file of walkFiles(publicDir)) {
  if (file.startsWith(generatedUnityBuildDir + path.sep)) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const ref of collectRefs(file, source)) {
    refCount += 1;
    const target = publicPathFor(ref, file);
    if (!target.startsWith(publicDir + path.sep) && target !== publicDir) {
      missing.push(`${path.relative(root, file)} -> ${ref} escapes public/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      missing.push(`${path.relative(root, file)} -> ${ref}`);
    } else {
      rememberAssetReference(target);
    }
  }
}

for (const file of [
  path.join(root, 'server.js'),
  ...walkFiles(serverSourceDir, [], new Set(['.js']))
]) {
  const source = fs.readFileSync(file, 'utf8');
  for (const ref of collectRefs(file, source)) {
    // /assets/models-lite — виртуальный маршрут (генерируемые копии GLB с фолбэком на оригинал).
    if (/^\/assets\/models-lite(\/|$)/.test(ref)) continue;
    serverRefCount += 1;
    const target = publicPathFor(ref, file);
    if (!target.startsWith(publicDir + path.sep) && target !== publicDir) {
      missing.push(`${path.relative(root, file)} -> ${ref} escapes public/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      missing.push(`${path.relative(root, file)} -> ${ref}`);
    } else {
      rememberAssetReference(target);
    }
  }
}

// Unity-клиент грузит модели по HTTP с того же сервера: его пути тоже ссылки на
// public/, и GLB, нужные только Unity (NPC пустоши), считаются используемыми.
// Шаблон WebGL отдаётся как /unity/index.html; относительные пути и {{{ … }}}
// заполняет сборка Unity, поэтому из него проверяются только абсолютные ссылки.
const unitySources = [
  ...walkFiles(unityScriptsDir, [], new Set(['.cs']))
    .map(file => [file, collectUnityRefs(fs.readFileSync(file, 'utf8'))]),
  ...walkFiles(unityWebGlTemplatesDir, [], new Set(['.html']))
    .map(file => [file, collectRefs(file, fs.readFileSync(file, 'utf8'))
      .filter(url => url.startsWith('/') && !url.includes('{{{'))])
];
for (const [file, refs] of unitySources) {
  for (const ref of refs) {
    // /assets/models-lite — виртуальный маршрут (генерируемые копии GLB с фолбэком на оригинал).
    if (/^\/assets\/models-lite(\/|$)/.test(ref)) continue;
    unityRefCount += 1;
    const target = publicPathFor(ref, file);
    if (!target.startsWith(publicDir + path.sep) && target !== publicDir) {
      missing.push(`${path.relative(root, file)} -> ${ref} escapes public/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      missing.push(`${path.relative(root, file)} -> ${ref}`);
    } else {
      rememberAssetReference(target);
    }
  }
}

for (const file of walkFiles(authoredDataDir, [], new Set(['.json']))) {
  let authoredData;
  try {
    authoredData = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    missing.push(`${path.relative(root, file)} is not valid JSON: ${err.message}`);
    continue;
  }
  for (const ref of collectManifestRefs(authoredData)) {
    authoredRefCount += 1;
    const target = publicPathFor(ref, file);
    if (!target.startsWith(publicDir + path.sep) && target !== publicDir) {
      missing.push(`${path.relative(root, file)} -> ${ref} escapes public/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      missing.push(`${path.relative(root, file)} -> ${ref}`);
    } else {
      rememberAssetReference(target);
    }
  }
}

for (const file of manifestFiles()) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    missing.push(`${path.relative(root, file)} is not valid JSON: ${err.message}`);
    continue;
  }
  for (const ref of collectManifestRefs(manifest)) {
    manifestRefCount += 1;
    const target = publicPathFor(ref, file);
    if (!target.startsWith(publicDir + path.sep) && target !== publicDir) {
      missing.push(`${path.relative(root, file)} -> ${ref} escapes public/`);
      continue;
    }
    if (!fs.existsSync(target)) {
      missing.push(`${path.relative(root, file)} -> ${ref}`);
    } else {
      rememberAssetReference(target);
    }
  }
}

if (missing.length) {
  throw new Error(`Missing static asset reference(s):\n${missing.map(row => `- ${row}`).join('\n')}`);
}

// public/assets/models-lite — генерируемые копии GLB (npm run build:models-lite), в git не входят
// и на них ссылаются по маршруту /assets/models-lite/* с фолбэком на оригинал.
const assetFiles = walkFiles(path.join(publicDir, 'assets'), [], null)
  .filter(file => !path.relative(publicDir, file).split(path.sep).includes('models-lite'));
const emptyAssets = assetFiles
  .filter(file => fs.statSync(file).size === 0)
  .map(file => path.relative(root, file));
const orphanedRuntimeAssets = assetFiles
  .filter(file => runtimeAssetExtensions.has(path.extname(file).toLowerCase()))
  .filter(file => !referencedAssets.has(path.resolve(file).toLowerCase()))
  .map(file => path.relative(root, file));

if (emptyAssets.length || orphanedRuntimeAssets.length) {
  const rows = [];
  if (emptyAssets.length) {
    rows.push('Empty asset file(s):', ...emptyAssets.map(file => `- ${file}`));
  }
  if (orphanedRuntimeAssets.length) {
    rows.push('Unreferenced runtime asset file(s):', ...orphanedRuntimeAssets.map(file => `- ${file}`));
  }
  throw new Error(rows.join('\n'));
}

console.log(
  `Static asset references OK: ${refCount} public URL(s), ${serverRefCount} server URL(s), `
  + `${unityRefCount} Unity URL(s), `
  + `${authoredRefCount} authored-data reference(s), ${manifestRefCount} manifest reference(s), `
  + `${referencedAssets.size} runtime asset file(s) checked`
);
