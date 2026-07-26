const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function fail(message) {
  throw new Error(message);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertIncludes(relPath, expected, label) {
  const source = read(relPath);
  if (!source.includes(expected)) {
    fail(`${label} is not synced in ${relPath}: expected ${expected}`);
  }
}

function assertGameVersion(relPath, expected, packageRequirePath) {
  const source = read(relPath);
  const match = source.match(/const\s+GAME_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (match) {
    if (match[1] !== expected) {
      fail(`GAME_VERSION mismatch in ${relPath}: expected ${expected}, got ${match[1]}`);
    }
    return;
  }
  const requirePattern = new RegExp(`const\\s+\\{\\s*version\\s*:\\s*GAME_VERSION\\s*\\}\\s*=\\s*require\\(['"]${escapeRegex(packageRequirePath)}['"]\\)`);
  if (!requirePattern.test(source)) {
    fail(`GAME_VERSION in ${relPath} must equal ${expected} or be read from ${packageRequirePath}`);
  }
}

const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const expectedName = pkg.name;
const expectedVersion = pkg.version;
const removedServerReference = path.join(root, 'src', 'server', 'authoritative-server.js');

if (!expectedName) fail('package.json name is empty');
if (!/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  fail(`package.json version must be semver-like x.y.z, got ${expectedVersion}`);
}

if (lock.name !== expectedName) {
  fail(`package-lock.json name mismatch: expected ${expectedName}, got ${lock.name}`);
}
if (lock.version !== expectedVersion) {
  fail(`package-lock.json version mismatch: expected ${expectedVersion}, got ${lock.version}`);
}
if (!lock.packages || !lock.packages['']) {
  fail('package-lock.json root package entry is missing');
}
if (lock.packages[''].name !== expectedName) {
  fail(`package-lock root name mismatch: expected ${expectedName}, got ${lock.packages[''].name}`);
}
if (lock.packages[''].version !== expectedVersion) {
  fail(`package-lock root version mismatch: expected ${expectedVersion}, got ${lock.packages[''].version}`);
}
if (fs.existsSync(removedServerReference)) {
  fail('Historical src/server/authoritative-server.js must not duplicate the production entry point');
}

assertGameVersion('server.js', expectedVersion, './package.json');
assertIncludes(path.join('public', 'index.html'), `<title>Realm of Ashes v${expectedVersion}</title>`, 'HTML title version');
assertIncludes(path.join('public', 'js', 'game', '01_bootstrap_online_save.js'), `Realm of Ashes v${expectedVersion} client bootstrap`, 'client bootstrap version');
assertIncludes(path.join('public', 'js', 'game', '13_minimap_hud_loop.js'), `Realm of Ashes v${expectedVersion}.`, 'welcome log version');

const clientLoader = read(path.join('public', 'js', 'game.js'));
const clientVersionMatch = clientLoader.match(/const\s+GAME_CLIENT_VERSION\s*=\s*['"]([^'"]+)['"]/);
if (!clientVersionMatch) {
  fail('GAME_CLIENT_VERSION is missing in public/js/game.js');
}
const clientVersion = clientVersionMatch[1];
assertIncludes(path.join('public', 'index.html'), `/js/game.js?v=${clientVersion}`, 'HTML client cache version');
assertIncludes(path.join('docs', 'PERFORMANCE_DEPLOYMENT.md'), `?v=${clientVersion}`, 'deployment probe cache version');

const readme = read('README.md');
const readmeVersionPattern = new RegExp(`\\*\\*${escapeRegex(expectedVersion)}(?:[-\\w]+)?\\*\\*`);
if (!readmeVersionPattern.test(readme)) {
  fail(`README current version does not include ${expectedVersion}`);
}

console.log(`Project metadata OK: ${expectedName}@${expectedVersion}`);
