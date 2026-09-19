'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  ZONE_MODES,
  ZONE_MODE_LABELS,
  normalizeZoneMode,
  zoneModeAllowsPvp,
  zoneModeIsSafe,
  zoneModeLossPolicy,
  zoneRules
} = require('../src/server/zone-rules');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.deepStrictEqual([...ZONE_MODES], ['peaceful', 'pve', 'pvp', 'pvpEvent', 'pvpFullDrop', 'pvpBlack']);

// Нормализация: канонические id, алиасы и безопасный fallback.
assert.strictEqual(normalizeZoneMode('peaceful'), 'peaceful');
assert.strictEqual(normalizeZoneMode('pve'), 'pve');
assert.strictEqual(normalizeZoneMode('pve_area'), 'pve');
assert.strictEqual(normalizeZoneMode('pvp'), 'pvp');
assert.strictEqual(normalizeZoneMode('pvpEvent'), 'pvpEvent');
assert.strictEqual(normalizeZoneMode('public_event'), 'pvpEvent');
assert.strictEqual(normalizeZoneMode('pvpFullDrop'), 'pvpFullDrop');
assert.strictEqual(normalizeZoneMode('fulldrop'), 'pvpFullDrop');
assert.strictEqual(normalizeZoneMode('territory'), 'pvpBlack');
assert.strictEqual(normalizeZoneMode('pvpBlack'), 'pvpBlack');
assert.strictEqual(normalizeZoneMode('black'), 'pvpBlack');
assert.strictEqual(normalizeZoneMode('red'), 'pvpFullDrop');
assert.strictEqual(normalizeZoneMode(true), 'pvp');
assert.strictEqual(normalizeZoneMode(false), 'peaceful');
assert.strictEqual(normalizeZoneMode(false, false), 'pvp');
assert.strictEqual(normalizeZoneMode('garbage'), 'peaceful');
assert.strictEqual(normalizeZoneMode('garbage', false), 'pvp');

// Лестница экономики v3: PvP разрешён в жёлтой, красной, чёрной зонах и на
// событиях; жёлтая ничего не роняет, красная — рюкзак, чёрная — всё.
assert.deepStrictEqual(ZONE_MODES.map(zoneModeAllowsPvp), [false, false, true, true, true, true]);
assert.deepStrictEqual(ZONE_MODES.map(zoneModeIsSafe), [true, false, false, false, false, false]);
assert.deepStrictEqual(ZONE_MODES.map(zoneModeLossPolicy), ['none', 'none', 'none', 'none', 'inventory', 'all']);

// Правила зоны: полный объект для интерфейса до входа и при смене режима.
for (const mode of ZONE_MODES) {
  const rules = zoneRules(mode);
  assert.strictEqual(rules.mode, mode);
  assert.strictEqual(rules.label, ZONE_MODE_LABELS[mode]);
  assert.strictEqual(rules.pvp, zoneModeAllowsPvp(mode));
  assert.strictEqual(rules.loss, zoneModeLossPolicy(mode));
  assert(typeof rules.lossLabel === 'string' && rules.lossLabel.length > 0);
  assert.strictEqual(rules.access, 'open');
  assert(!/полн(ый|ого|ым) (лут|дроп)/i.test(`${rules.label} ${rules.lossLabel}`), `${mode} must not be called full loot`);
}
assert.strictEqual(zoneRules('pvpFullDrop').confirmBeforeEntry, true);
assert.strictEqual(zoneRules('pvpBlack').confirmBeforeEntry, true);
assert(zoneRules('pvpBlack').lossLabel.includes('может стать ломом'));
assert(zoneRules('pvpBlack').lossLabel.includes('Марки и сюжетные предметы сохраняются'));
assert.strictEqual(zoneRules('pvp').confirmBeforeEntry, false);
assert.strictEqual(zoneRules('pvpEvent').confirmBeforeEntry, true);
assert.strictEqual(zoneRules('pve').confirmBeforeEntry, false);
assert(zoneRules('pvpFullDrop').lossLabel.includes('экипированный контейнер'));
assert(zoneRules('pvpFullDrop').lossLabel.includes('любые артефакты в инвентаре'));
assert.strictEqual(zoneRules('pvpFullDrop', { factionPvp: true }).pvpLabel, 'PvP разрешено между разными фракциями.');
assert.strictEqual(zoneRules('pve').pvpLabel, 'PvP запрещено.');
assert.deepStrictEqual(
  zoneRules('pvpFullDrop', { access: 'faction', territoryId: 'core', factionId: 'uprava', title: 'Сердцевина' }),
  {
    ...zoneRules('pvpFullDrop', { access: 'faction' }),
    territoryId: 'core',
    factionId: 'uprava',
    title: 'Сердцевина'
  }
);
assert.strictEqual(zoneRules('pvpFullDrop', { access: 'faction' }).accessLabel, 'Вход только для членов фракции.');
assert.strictEqual(zoneRules('unknown-mode').mode, 'peaceful');

// Серверная привязка: производные флаги локации и правила в снимке игрока.
const server = read('server.js');
assert(server.includes('const LOCATION_PVP_MODES = ZONE_MODE_SET;'));
assert(server.includes('const LOCATION_PVP_LABELS = ZONE_MODE_LABELS;'));
assert(server.includes('return normalizeZoneMode(input, safeFallback);'));
assert(server.includes('loc.pvp = zoneModeAllowsPvp(loc.pvpMode);'));
assert(server.includes('loc.lossPolicy = deathLootPolicy(loc.pvpMode).loss;'));
assert(server.includes("function locationAllowsPvp(loc = {}) { return zoneModeAllowsPvp(locationPvpMode(loc)); }"));
assert(server.includes('lossPolicy: deathLootPolicy(override).loss'));
assert(server.includes('zoneRules: zoneRules(currentPvpMode'));

console.log(`Zone modes OK: ${ZONE_MODES.length} modes, PvP/loss policies and pre-entry rules are server-derived.`);
