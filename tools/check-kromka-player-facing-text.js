const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const runtimeRoots = [
  'server.js',
  path.join('src', 'server'),
  path.join('unity-client', 'Assets', 'Scripts', 'Game'),
  path.join('unity-client', 'Assets', 'Scripts', 'Kromka'),
  path.join('data', 'locations')
];
const rawFiles = [
  path.join('data', 'global-map.json'),
  path.join('data', 'quests.json'),
  path.join('data', 'encounters.json'),
  path.join('data', 'mutants.json'),
  path.join('data', 'anomalies.json'),
  path.join('data', 'artifacts.json'),
  path.join('data', 'traders.json'),
  path.join('data', 'base-residents.json'),
  path.join('public', 'unity-unavailable.html'),
  path.join('unity-client', 'Assets', 'WebGLTemplates', 'RealmOfAshes', 'index.html'),
  path.join('unity-client', 'ProjectSettings', 'ProjectSettings.asset')
];
const builtIndex = path.join(root, 'public', 'unity', 'index.html');
if (fs.existsSync(builtIndex)) rawFiles.push(path.relative(root, builtIndex));

const forbidden = [
  { label: 'старый бренд', pattern: /Realm of Ashes/iu },
  { label: 'чужое имя терминала', pattern: /PIP-(?:ASH|BOY)/iu },
  { label: 'старое имя характеристик', pattern: /SPECIAL/u },
  { label: 'старая валюта', pattern: /(?<![А-Яа-яЁё])крышк/iu },
  { label: 'прямая отсылка к Fallout', pattern: /Fallout/iu },
  { label: 'старое имя фракции', pattern: /Стар(?:ый|ого) Клим/iu },
  { label: 'старое имя фракции', pattern: /Свалочн(?:ый|ого) союз/iu },
  { label: 'старое имя фракции', pattern: /Вольные караваны/iu }
];

function filesUnder(relPath) {
  const absolute = path.join(root, relPath);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [relPath];
  const result = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relPath, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(child));
    else if (/\.(?:cs|js|json)$/iu.test(entry.name)) result.push(child);
  }
  return result;
}

function stringLiterals(source) {
  return source.match(/@?"(?:\\.|""|[^"\\])*"|'(?:\\.|[^'\\])*'/gsu) || [];
}

function inspect(relPath, source, literalsOnly) {
  const haystacks = literalsOnly ? stringLiterals(source) : [source];
  const failures = [];
  for (const value of haystacks) {
    for (const rule of forbidden) {
      const match = value.match(rule.pattern);
      if (!match) continue;
      const offset = source.indexOf(value) + Math.max(0, value.indexOf(match[0]));
      const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
      const lineEnd = source.indexOf('\n', offset);
      const sourceLine = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
      if (rule.label === 'старое имя фракции' && sourceLine.includes('.Replace(')) continue;
      const line = source.slice(0, Math.max(0, offset)).split(/\r?\n/u).length;
      failures.push(`${relPath}:${line}: ${rule.label}: ${match[0]}`);
    }
  }
  return failures;
}

function inspectPublicBoundaryContracts() {
  const failures = [];
  const serverPath = path.join(root, 'server.js');
  const serverSource = fs.readFileSync(serverPath, 'utf8');
  const publicEnemyStart = serverSource.indexOf('function publicEnemy(');
  const publicEnemyEnd = serverSource.indexOf('\nfunction publicEnemySnapshotForViewer', publicEnemyStart);
  const publicEnemySource = publicEnemyStart >= 0 && publicEnemyEnd > publicEnemyStart
    ? serverSource.slice(publicEnemyStart, publicEnemyEnd)
    : '';
  if (!publicEnemySource.includes('return transformKromkaPublicValue({')) {
    failures.push('server.js: publicEnemy must pass the complete NPC snapshot through transformKromkaPublicValue');
  }
  if (!serverSource.includes("'wastelandOwnerFaction'")) {
    failures.push('server.js: transformKromkaPublicValue must canonicalize wastelandOwnerFaction');
  }
  return failures;
}

const failures = [];
for (const relPath of runtimeRoots.flatMap(filesUnder)) {
  failures.push(...inspect(relPath, fs.readFileSync(path.join(root, relPath), 'utf8'), true));
}
for (const relPath of rawFiles) {
  failures.push(...inspect(relPath, fs.readFileSync(path.join(root, relPath), 'utf8'), false));
}
failures.push(...inspectPublicBoundaryContracts());

if (failures.length) {
  console.error('В видимых игроку поверхностях осталась старая терминология:\n' + failures.join('\n'));
  process.exit(1);
}

console.log(`Kromka player-facing terminology OK: ${runtimeRoots.length} runtime roots, ${rawFiles.length} metadata surfaces`);
