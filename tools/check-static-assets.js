const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
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
const knownDynamicRoutes = new Set([
  '/sdk.js',
  '/socket.io/socket.io.js',
  '/vendor/three.min.js',
  '/vendor/GLTFLoader.js'
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
  return url.startsWith('/') || url.startsWith('./') || url.startsWith('../');
}

function publicPathFor(url, sourceFile) {
  if (url.startsWith('/')) return path.join(publicDir, url.slice(1).replace(/[\\/]+/g, path.sep));
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
  }

  if (ext === '.js') {
    addMatches(/['"`](\/(?:assets|css|js)\/[^'"`]+)['"`]/g);
    addMatches(/['"`](\/(?:sdk\.js|vendor\/three\.min\.js|vendor\/GLTFLoader\.js|socket\.io\/socket\.io\.js))['"`]/g);
  }

  return refs.filter(shouldCheck);
}

function shouldCheckManifestRef(url) {
  if (!url || knownDynamicRoutes.has(url)) return false;
  if (/^(?:data:|https?:|blob:)/i.test(url)) return false;
  return /\.(?:png|webp|jpe?g|gif|fbx|glb|gltf|json|txt)$/i.test(url);
}

function collectManifestRefs(node, key = '') {
  const refs = [];
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === 'string' && manifestListKeys.has(key)) refs.push(cleanUrl(item));
      else refs.push(...collectManifestRefs(item, key));
    }
    return refs;
  }
  if (!node || typeof node !== 'object') return refs;
  for (const [childKey, value] of Object.entries(node)) {
    if (typeof value === 'string' && manifestAssetKeys.has(childKey)) {
      refs.push(cleanUrl(value));
    } else {
      refs.push(...collectManifestRefs(value, childKey));
    }
  }
  return refs.filter(shouldCheckManifestRef);
}

function manifestFiles() {
  return walkFiles(path.join(publicDir, 'assets'), [], new Set(['.json']))
    .filter(file => path.basename(file).toLowerCase().includes('manifest') && path.extname(file) === '.json');
}

const missing = [];
let refCount = 0;
let manifestRefCount = 0;

for (const file of walkFiles(publicDir)) {
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
    }
  }
}

if (missing.length) {
  throw new Error(`Missing static asset reference(s):\n${missing.map(row => `- ${row}`).join('\n')}`);
}

console.log(`Static asset references OK: ${refCount} local URL(s), ${manifestRefCount} manifest file reference(s) checked`);
