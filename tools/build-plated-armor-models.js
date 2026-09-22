'use strict';
// Военная броня полным костюмом: форма Swat/Soldier даёт рукава, штаны и
// ботинки, пластины прежней утверждённой брони ложатся поверх. Собирает тот же
// слоёный конвейер, что и костюмы (tools/blender/build_layered_suit_models.py),
// но публикуется отдельным семейством: у костюмов ОЗК и энергозащиты своя
// утверждённая партия, которую эта сборка не трогает.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const bodies = ['male_medium', 'female_medium'];
const items = ['ballisticVest', 'combatArmor', 'heavyArmor', 'metalArmor'];
const candidateDir = path.join(root, 'unity-client/Logs/UpperSuitCandidate');
const publicDir = path.join(root, 'public/assets/models/equipment/armor-v3');
const catalogFile = path.join(root, 'unity-client/Assets/Scripts/Game/RoaOutfitModelCatalog.cs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Plated armor build failed (${result.status}): ${exe}`);
}

if (!process.argv.includes('--skip-blender')) {
  const blender = process.env.REALM_BLENDER_EXE
    || path.join(os.homedir(), '.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');
  for (const item of items) {
    for (const body of bodies) {
      run(blender, ['--background', '--factory-startup', '--python-exit-code', '1',
        '--python', 'tools/blender/build_layered_suit_models.py', '--',
        '--candidate', '--joint-liner', `--item=${item}`, `--body=${body}`]);
    }
  }
}

fs.mkdirSync(publicDir, { recursive: true });
const metaTemplate = fs.readFileSync(path.join(root, 'public/assets/models/equipment/suits-v2/equipment_hazmatSuit_male_medium.glb.meta'), 'utf8');
const rows = [];
for (const item of items) {
  for (const body of bodies) {
    const name = `equipment_${item}_${body}.glb`;
    const bytes = fs.readFileSync(path.join(candidateDir, name));
    fs.writeFileSync(path.join(publicDir, name), bytes);
    const meta = path.join(publicDir, `${name}.meta`);
    if (!fs.existsSync(meta)) {
      fs.writeFileSync(meta, metaTemplate.replace(/guid: [0-9a-f]+/, 'guid: ' + crypto.randomBytes(16).toString('hex')));
    }
    rows.push({
      itemId: item,
      bodyId: body,
      file: `/assets/models/equipment/armor-v3/${name}`,
      sha256: hash(bytes),
      bytes: bytes.length,
      bodyReference: {
        file: `public/assets/models/characters/base/character_${body}.glb`,
        sha256: hash(fs.readFileSync(path.join(root, `public/assets/models/characters/base/character_${body}.glb`)))
      }
    });
  }
}
const version = '1-' + hash(rows.map(row => row.sha256).join('')).slice(0, 8);
fs.writeFileSync(path.join(publicDir, 'manifest.json'),
  JSON.stringify({
    schema: 'realm.plated-armor.v1',
    version,
    generator: 'tools/blender/build_layered_suit_models.py',
    source: { creator: 'Quaternius / Manaos', license: 'CC0-1.0 / CC-BY', pack: 'Ultimate Modular Men / Ultimate Modular Women, Soldier' },
    files: rows
  }, null, 2) + '\n');

const catalog = fs.readFileSync(catalogFile, 'utf8');
if (!/PlatedVersion = "[^"]+"/.test(catalog)) throw new Error('Missing plated armor cache version');
fs.writeFileSync(catalogFile, catalog.replace(/PlatedVersion = "[^"]+"/, `PlatedVersion = "${version}"`));

run(process.execPath, ['tools/optimize-glb.js', publicDir]);
run(process.execPath, ['tools/check-outfit-models.js']);
console.log(`Plated armor ${version}: ${rows.length} models published and checked.`);
