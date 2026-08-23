const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const server = read('server.js');
const data = read('unity-client/Assets/Scripts/Game/RoaProgressionData.cs');
const pipboy = read('unity-client/Assets/Scripts/Game/RoaPipboy.cs');
const socket = read('unity-client/Assets/Scripts/Net/RoaSocketClient.cs');
const player = read('unity-client/Assets/Scripts/Game/RoaPlayerController.cs');
const inventory = read('unity-client/Assets/Scripts/Game/RoaInventory.cs');
const preview = read('unity-client/Assets/Scripts/Game/RoaCombatPreview.cs');
const combat = read('unity-client/Assets/Scripts/Game/RoaCombat.cs');
const nameplates = read('unity-client/Assets/Scripts/Game/RoaActorNameplates.cs');

function constObject(source, name) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert(start >= 0, `missing server constant ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      return vm.runInNewContext(`(${source.slice(brace, i + 1)})`);
    }
  }
  throw new Error(`unclosed server constant ${name}`);
}

function serverSet(name) {
  const match = server.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  assert(match, `missing server set ${name}`);
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(row => row[1]);
}

function splitArgs(source) {
  const parts = [];
  let start = 0;
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote && source[i - 1] !== '\\') quote = '';
    } else if (char === '"') quote = char;
    else if (char === ',') {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function scalar(value) {
  const clean = String(value || '').trim();
  if (/^".*"$/.test(clean)) return clean.slice(1, -1);
  if (/^-?\d+$/.test(clean)) return Number(clean);
  return clean;
}

function unityTalents() {
  const rows = [];
  const positional = ['id', 'name', 'group', 'maxRank', 'level', 'stat', 'statValue',
    'skill', 'skillValue', 'stat2', 'statValue2', 'description'];
  for (const match of data.matchAll(/new TalentDef\(([^\r\n]+)\),?/g)) {
    const row = {};
    let position = 0;
    for (const token of splitArgs(match[1])) {
      const named = token.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (named) row[named[1]] = scalar(named[2]);
      else row[positional[position++]] = scalar(token);
    }
    rows.push(row);
  }
  return rows;
}

const talents = unityTalents();
const unityIds = talents.map(row => row.id);
const serverIds = serverSet('SERVER_TALENT_IDS');
assert.equal(talents.length, 41, 'Unity must expose all 41 canonical talents');
assert.deepEqual(unityIds, serverIds, 'Unity talent ids/order drifted from the authoritative server');

const maxRanks = constObject(server, 'SERVER_TALENT_MAX_RANKS');
const requirements = constObject(server, 'SERVER_TALENT_REQUIREMENTS');
for (const talent of talents) {
  assert.equal(talent.maxRank, maxRanks[talent.id], `${talent.id}: max rank drifted`);
  const expected = { level: talent.level };
  if (talent.stat) expected[talent.stat] = talent.statValue;
  if (talent.stat2) expected[talent.stat2] = talent.statValue2;
  if (talent.skill) expected.skill = { [talent.skill]: talent.skillValue };
  assert.deepEqual(expected, requirements[talent.id], `${talent.id}: requirements drifted`);
  const description = data.match(new RegExp(`case "${talent.id}": return "([^"]+)";`));
  assert(description, `${talent.id}: Unity description is missing`);
  assert(/[0-9%×]/.test(description[1]) || /max|min|п\.п\./.test(description[1]),
    `${talent.id}: Unity description lacks an exact mechanical value`);
}

const unitySkills = [...data.matchAll(/new SkillDef\("([^"]+)"/g)].map(row => row[1]);
assert.equal(unitySkills.length, 16, 'Unity must expose all 16 canonical skills');
assert.deepEqual(unitySkills, serverSet('SERVER_SKILL_IDS'), 'Unity skill ids/order drifted');

[
  'ranks[id] = current + 1;',
  'Socket.SendProgressionProfile(null, ranks);',
  '_status = "Ожидаю подтверждение сервера…";'
].forEach(marker => assert(pipboy.includes(marker), `Unity progression request contract is missing: ${marker}`));
[
  '["profileOnly"] = true',
  'payload["talentRanks"] = talentRanks.DeepClone();',
  '_connection.EmitAsync("state", payload);'
].forEach(marker => assert(socket.includes(marker), `Unity progression authority contract is missing: ${marker}`));
assert(!pipboy.includes('_self["talentRanks"][id] ='),
  'Unity must not spend perk points or mutate accepted talent ranks locally');

for (const marker of ['TalentRank(ranks, "specialPer")', 'TalentRank(ranks, "vigilance")',
  'TalentRank(ranks, "specialAgi")']) {
  assert(player.includes(marker), `Unity player-derived state is missing ${marker}`);
}
assert(inventory.includes('_self?["talentRanks"]?["specialStr"]'),
  'Unity carry capacity ignores talent-adjusted Strength');
assert(combat.includes('bool awareness = Socket.Session.Self["talentRanks"]?["awareness"]'),
  'Unity target forecast ignores Awareness');
assert(nameplates.includes('bool awareness = Socket?.Session?.Self?["talentRanks"]?["awareness"]'),
  'Unity nameplates ignore Awareness');

const previewTalents = [
  'gunslinger', 'automaticMan', 'heavyShooter', 'machineGunner', 'pyromaniac',
  'energyTech', 'grenadier', 'meleeBreaker', 'unarmedFighter', 'sharpshooter', 'ambush'
];
for (const id of previewTalents)
  assert(preview.includes(`Talent(self, "${id}")`), `Unity combat forecast ignores ${id}`);
assert(preview.includes('return Mathf.Clamp(value + Talent(self, talent), 1, 15);'),
  'Unity combat forecast ignores SPECIAL talent ranks');

const missingServerMechanics = serverIds.filter(id => {
  if (id === 'vigilance' || id === 'awareness') return false;
  if (new RegExp(`serverTalentLevel\\([^)]*['"]${id}['"]`).test(server)) return false;
  return !(id.startsWith('special') && server.includes(`${id}:`) && server.includes('function serverStatValue'));
});
assert.deepEqual(missingServerMechanics, [], 'talent without authoritative server mechanic');

console.log('Unity progression OK: 16 skills, 41 talents, exact ranks/requirements, authority and client previews');
