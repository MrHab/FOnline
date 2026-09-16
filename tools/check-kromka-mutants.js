#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));
const catalog = readJson('data/mutants.json');
const encounters = readJson('data/encounters.json');
const server = read('server.js');

assert.strictEqual(catalog.schema, 'kromka.mutants.v1');
const required = ['burned', 'fold', 'gari', 'rykhlyak', 'listener', 'mourner', 'lantern', 'dustling'];
assert.deepStrictEqual(catalog.types.map(row => row.id).sort(), required.slice().sort(),
  'Kromka needs exactly its eight canonical creature types');
assert.deepStrictEqual(catalog.legacyAliases, {
  ghoul: 'burned',
  superMutant: 'fold',
  ashWolf: 'gari',
  radScorpion: 'rykhlyak',
  mutantAnt: 'dustling',
  gecko: 'listener',
  fireGecko: 'mourner'
}, 'Legacy creatures need stable migration aliases');

for (const creature of catalog.types) {
  assert(creature.displayName && creature.pluralName && creature.description.length >= 55,
    `${creature.id}: identity and ecology must be authored`);
  for (const key of ['hp', 'attack', 'speed', 'xp', 'scale'])
    assert(Number.isFinite(creature.stats?.[key]), `${creature.id}: missing stat ${key}`);
  assert(creature.senses?.hearingShotRange > 0 && creature.senses?.visionRange >= 0,
    `${creature.id}: senses must be concrete`);
  assert(Array.isArray(creature.attacks) && creature.attacks.length >= 1
    && creature.attacks.every(row => row.id && row.damageType && row.telegraphMs > 0),
  `${creature.id}: attacks need readable server timing`);
  for (const damageType of ['physical', 'ballistic', 'energy', 'toxic', 'radiation', 'anomaly'])
    assert(Number.isFinite(creature.resistances?.[damageType]), `${creature.id}: missing ${damageType} resistance`);
  assert(creature.injuryProfile && creature.loot?.table && Number.isFinite(creature.loot?.trophyQty),
    `${creature.id}: injury and trophy profiles are required`);
  assert(creature.modelKey === `kromka${creature.id === 'rykhlyak' ? 'Rykhlyak' : creature.id[0].toUpperCase() + creature.id.slice(1)}`,
    `${creature.id}: unexpected canonical model key`);
}

assert.strictEqual(catalog.types.find(row => row.id === 'burned').classification, 'human',
  'Выжженные remain human in gameplay classification');
assert.strictEqual(catalog.types.find(row => row.id === 'lantern').hostileByDefault, false,
  'Фонарники must remain peaceful by default');
assert(catalog.types.find(row => row.id === 'listener').senses.hearingShotRange >= 20
  && catalog.types.find(row => row.id === 'listener').senses.visionRange <= 3,
  'Слухачи must be blind and hearing-driven');

const used = new Set();
const obsoleteNames = /гул|супермутант|радскорпион|мутировавш(?:ий|ие) мурав|геккон|пепельн(?:ый|ые) волк/i;
for (const encounter of Object.values(encounters.encounters || {})) {
  assert(!obsoleteNames.test(encounter.name || ''), `Released encounter retains an obsolete creature name: ${encounter.name}`);
  for (const actor of encounter.actors || []) {
    assert(!obsoleteNames.test(actor.name || ''), `Released actor retains an obsolete creature name: ${actor.name}`);
    if (!actor.creatureTypeId) continue;
    assert(required.includes(actor.creatureTypeId), `${actor.name}: unknown creatureTypeId`);
    used.add(actor.creatureTypeId);
  }
}
assert.deepStrictEqual([...used].sort(), required.slice().sort(),
  'Every canonical creature needs a released encounter');
assert(server.includes('creatureTypeId: String(opts.creatureTypeId || type.creatureTypeId')
  && server.includes('creatureTypeId: String(e.creatureTypeId ||')
  && server.includes('KROMKA_MUTANT_BY_ID[String(enemy?.creatureTypeId ||'),
  'Server must spawn, replicate and mitigate damage by explicit creatureTypeId');
assert(server.includes('injuryProfile: attackProfile.injuryProfile')
  && server.includes('attackId: String(attackProfile.attackId ||'),
  'Canonical attack and injury profiles are not used by authoritative combat');

// --- авторские поля обязаны доходить до рантайма ------------------------------
// Каталог описывал вдвое больше, чем сервер исполнял: он всегда брал attacks[0],
// игнорировал telegraphMs и не читал bleedChance. Эти проверки стоят здесь,
// чтобы авторские поля больше не превращались в мёртвые данные.
const enemyAi = read('src/server/enemy-ai.js');

assert(server.includes('function serverCreatureAttackFor(')
  && !server.includes('Array.isArray(creature?.attacks) ? creature.attacks[0] : null'),
  'Атака существа обязана выбираться среди авторских, а не быть всегда attacks[0]');
assert(server.includes('function serverCommitCreatureAttack(')
  && server.includes('serverEnemyAttackProfile(enemy, { commit: true, now })'),
  'Выбранная атака обязана уходить на откат по своему cooldownMs');

const maxTelegraph = Math.max(...catalog.types.flatMap(row => (row.attacks || []).map(a => Number(a.telegraphMs || 0))));
const ceiling = Number((enemyAi.match(/options\.windowMs \?\? windowMs, 240, (\d+)\)/) || [])[1] || 0);
assert(ceiling >= maxTelegraph,
  'Потолок окна замаха ' + ceiling + ' мс срезает авторские ' + maxTelegraph + ' мс');
assert(server.includes('windowMs: Number(creatureAttack.telegraphMs)'),
  'Авторский telegraphMs обязан доезжать до клиентского телеграфа');

assert(server.includes('Number(attack.telegraphMs || meanTelegraph)') && server.includes('fallbackAtk * weight'),
  'Урон существа обязан зависеть от выбранной атаки, а не быть плоским enemy.atk');

assert(server.includes('Number(profile.bleedChance || 0)'),
  'bleedChance каталога не читается сервером');

// Каждый авторский эффект атаки обязан иметь исполнителя. lure и reposition —
// поведение ИИ, а не состояние жертвы, поэтому их здесь не ждём.
const AI_ONLY_EFFECTS = new Set(['lure', 'reposition']);
const effects = [...new Set(catalog.types.flatMap(row => (row.attacks || []).map(a => String(a.effect || '')).filter(Boolean)))];
for (const effect of effects) {
  if (AI_ONLY_EFFECTS.has(effect)) continue;
  assert(server.includes("case '" + effect + "':"),
    'Эффект атаки «' + effect + '» объявлен в каталоге, но сервер его не исполняет');
}

// Добыча обязана различать виды: один «Трофей» на всех делал девять тварей
// неразличимыми, а у Обожжённого trophyQty: 0 обнулял труп целиком.
const lootTables = readJson('data/loot-tables.json').enemies || {};
for (const row of catalog.types) {
  const table = lootTables[row.id];
  assert(Array.isArray(table) && table.length > 0, row.id + ': нет таблицы добычи в data/loot-tables.json');
  assert(table.some(entry => (entry.id || (entry.oneOf || [])[0]) !== 'trophy'),
    row.id + ': таблица добычи состоит из одного трофея — вид неразличим по луту');
}
assert(server.includes('SERVER_ENEMY_LOOT_TABLES[creatureId]'),
  'Таблица добычи вида не разыгрывается при смерти существа');
assert(!server.includes('if (trophyQty <= 0) return [];'),
  'Ранний выход по trophyQty обнулял добычу вида с нулевым трофеем');

console.log('Kromka mutants OK: eight explicit species, encounters, combat profiles and migration aliases; '
  + 'authored attacks rotate, telegraphs up to ' + maxTelegraph + ' ms survive, '
  + (effects.length - [...effects].filter(e => AI_ONLY_EFFECTS.has(e)).length) + ' attack effects are executed '
  + 'and every species has its own loot table');
