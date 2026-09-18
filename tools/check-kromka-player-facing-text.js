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

// Кириллица, пережившая перекодировку в однобайтовую кодировку, становится «?»:
// так отказ торговца в performServerNpcTradeExchange дошёл до игрока как
// '? ???????? ??????????? ??????.'. Литерал, где «?» идут подряд и их больше,
// чем букв и цифр, — потерянный текст; U+FFFD — тот же сбой другой утилиты.
function lostEncodingLiterals(relPath, source) {
  const failures = [];
  for (const match of source.matchAll(/@?"(?:\\.|""|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gsu)) {
    const text = match[0].replace(/\{[^{}]*\}/gu, ' ');
    const questionMarks = (text.match(/\?/gu) || []).length;
    const lettersAndDigits = (text.match(/[\p{L}\p{N}]/gu) || []).length;
    const mostlyQuestionMarks = /\?{3}/u.test(text) && questionMarks > lettersAndDigits;
    if (!mostlyQuestionMarks && !match[0].includes('\uFFFD')) continue;
    const line = source.slice(0, match.index).split(/\r?\n/u).length;
    failures.push(`${relPath}:${line}: текст потерял кодировку: ${match[0].slice(0, 60)}`);
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
const encodingProbe = lostEncodingLiterals('probe',
  "const error = lost ? '? ???????? ??????????? ??????.' : 'Кто оставил эту запись?' ?? '';");
if (encodingProbe.length !== 1 || !encodingProbe[0].startsWith('probe:1:')) {
  failures.push('tools/check-kromka-player-facing-text.js: контракт проверки кодировки нарушен');
}
for (const relPath of runtimeRoots.flatMap(filesUnder)) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8');
  failures.push(...inspect(relPath, source, true), ...lostEncodingLiterals(relPath, source));
}
for (const relPath of rawFiles) {
  const source = fs.readFileSync(path.join(root, relPath), 'utf8');
  failures.push(...inspect(relPath, source, false), ...lostEncodingLiterals(relPath, source));
}
failures.push(...inspectPublicBoundaryContracts());

if (failures.length) {
  console.error('В видимых игроку поверхностях осталась старая терминология или битая кодировка:\n' + failures.join('\n'));
  process.exit(1);
}

console.log(`Kromka player-facing terminology and encoding OK: ${runtimeRoots.length} runtime roots, ${rawFiles.length} metadata surfaces`);
