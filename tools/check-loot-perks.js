#!/usr/bin/env node
'use strict';

// Перки поиска в экономике v3 (библия 14.5, 15.3): прогрессия не создаёт добычу,
// она усиливает открытый кран. Модуль проверяется напрямую, привязка — настоящими
// функциями server.js в песочнице: труп налётчика, труп существа и тайник.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadWorldEconomy, zoneLootMultiplier, rollQuantity, npcRemnantRows } = require('../src/server/world-economy');
const { normalizeBlackMarketState, fundBlackMarket, takeBlackMarketLoot, blackMarketFatigueFactor } = require('../src/server/black-market');
const perks = require('../src/server/loot-perks');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const economy = loadWorldEconomy(path.join(root, 'data', 'kromka', 'economy.json'));
const progression = JSON.parse(fs.readFileSync(path.join(root, 'data', 'kromka', 'character-progression.json'), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const byId = rows => Object.fromEntries(plain(rows).map(row => [row.id, row.qty]));
const config = economy.lootPerks;

// --- числа ------------------------------------------------------------------------
assert.deepEqual(plain(config), {
  remnantSharePerRank: 0.15, cacheMaterialsPerRank: 0.25, scavengerTrophyChance: 0.25, trophyItemId: 'trophy'
}, 'the perk numbers live in data/kromka/economy.json');
assert.deepEqual(plain(perks.normalizeLootPerkConfig({ remnantSharePerRank: 9, cacheMaterialsPerRank: -1, scavengerTrophyChance: 'x' })),
  { remnantSharePerRank: 1, cacheMaterialsPerRank: 0, scavengerTrophyChance: 0.25, trophyItemId: 'trophy' },
  'a broken config is clamped instead of multiplying loot without a limit');

// --- «Редкая находка»: доля останков -------------------------------------------------
const maxScrounger = progression.perks.items.find(row => row.id === 'scrounger').maxRank;
assert.equal(perks.remnantShareMultiplier(config, 0), 1, 'no rank leaves the share alone');
assert.equal(perks.remnantShareMultiplier(config, maxScrounger), 1 + 0.15 * maxScrounger);
assert(perks.remnantShareMultiplier(config, maxScrounger) < 1.5,
  'a character perk stays below the premium multiplier on the same kind of faucet');
{
  const pistol = [{ id: 'pistol', qty: 1, kind: 'firearm' }];
  // Деталь: 1 × 0,5 = 0,5 без перка и 0,725 с третьим рангом; бросок 0,6 отделяет одно от другого.
  assert.deepEqual(byId(npcRemnantRows(economy, pistol, () => 0.6)), { scrap: 1 });
  assert.deepEqual(byId(npcRemnantRows(economy, pistol, () => 0.6, perks.remnantShareMultiplier(config, 3))),
    { weaponParts: 1, scrap: 1 });
  // Больше целого предмета с единицы снаряжения не достаётся ни при каком множителе.
  assert.deepEqual(byId(npcRemnantRows(economy, pistol, () => 0, 50)), { weaponParts: 1, scrap: 2 });
  assert.deepEqual(byId(npcRemnantRows(economy, pistol, () => 0.6, 0)), { scrap: 1 }, 'a multiplier never lowers the share');
}

// --- «Нюх на тайники»: только материалы, только то, что уже лежит ---------------------
{
  const isMaterial = id => id === 'scrap' || id === 'ore';
  const cache = [{ id: 'scrap', qty: 4 }, { id: 'ore', qty: 3 }, { id: 'medkit', qty: 1 }, { id: 'silver', qty: 10 }];
  const frozen = plain(cache);
  const sensed = perks.cacheSenseLoot(config, cache, 2, isMaterial, () => 0.4);
  // 4 × 1,5 = 6; 3 × 1,5 = 4,5 → 4 и ещё один при броске ниже 0,5.
  assert.deepEqual(byId(sensed.loot), { scrap: 6, ore: 5, medkit: 1, silver: 10 });
  assert.equal(sensed.changed, true);
  assert.deepEqual(plain(cache), frozen, 'the container rows are copied, not edited in place');
  assert.deepEqual(byId(perks.cacheSenseLoot(config, cache, 2, isMaterial, () => 0.9).loot).ore, 4);
  const none = perks.cacheSenseLoot(config, cache, 0, isMaterial, () => 0);
  assert.deepEqual(byId(none.loot), byId(cache));
  assert.equal(none.changed, false);
  assert.deepEqual(plain(perks.cacheSenseLoot(config, [], 2, isMaterial, () => 0)), { loot: [], changed: false },
    'an empty cache stays empty: the perk finds more, it does not create');
  assert.deepEqual(plain(perks.cacheSenseLoot(config, null, 2, isMaterial, () => 0).loot), []);
}

// --- «Падальщик»: ещё один трофей там, где трофей уже есть ---------------------------
{
  const gari = [{ id: 'trophy', qty: 1 }];
  assert.deepEqual(byId(perks.scavengerLoot(config, gari, true, () => 0.1).loot), { trophy: 2 });
  assert.deepEqual(byId(perks.scavengerLoot(config, gari, true, () => 0.25).loot), { trophy: 1 }, 'the chance is 25%, not more');
  assert.deepEqual(byId(perks.scavengerLoot(config, gari, false, () => 0).loot), { trophy: 1 });
  const human = [{ id: 'silver', qty: 8 }, { id: 'water', qty: 1 }];
  assert.deepEqual(plain(perks.scavengerLoot(config, human, true, () => 0)), { loot: human, changed: false },
    'a corpse without trophies gains none');
  assert.deepEqual(plain(gari), [{ id: 'trophy', qty: 1 }]);
}

// --- настоящие функции server.js ------------------------------------------------------
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `server.js has no function ${name}`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

const CATALOG = {
  pistol: { category: 'weapons', slot: 'weapon' }, leather: { category: 'armor', slot: 'armor' },
  boots: { category: 'armor', slot: 'boots' }, medkit: { category: 'aid', slot: 'weapon' },
  ammo9: { category: 'ammo' }, silver: { category: 'currency' }, water: { category: 'misc' },
  trophy: { category: 'misc' }, scrap: { category: 'materials' }, weaponParts: { category: 'materials' },
  electronics: { category: 'materials' }
};

function sandbox(mode, roll) {
  const market = normalizeBlackMarketState({ treasury: 0, stock: {} }, economy.blackMarket, 0);
  const context = vm.createContext({
    Map, Set, Number, String, JSON, Object, Array, Math, console, Date,
    WORLD_ECONOMY: economy,
    zoneLootMultiplier, rollQuantity, npcRemnantRows, fundBlackMarket, takeBlackMarketLoot, blackMarketFatigueFactor,
    remnantShareMultiplier: perks.remnantShareMultiplier,
    cacheSenseLoot: perks.cacheSenseLoot,
    scavengerLoot: perks.scavengerLoot,
    serverBlackMarketStore: () => market,
    serverBlackMarketItemPrice: () => 0,
    serverMarkBlackMarketDirty: () => {},
    serverBaseItemId: id => String(id || ''),
    SERVER_WEAPONS: { pistol: { id: 'pistol', ammoType: 'ammo9' }, fists: { id: 'fists', ammoType: null } },
    KROMKA_ITEM_INDEXES: { byId: CATALOG },
    SERVER_ITEM_IDS: new Set(Object.keys(CATALOG)),
    roomLocation: room => room.loc,
    locationPvpMode: loc => loc.pvpMode,
    serverNpcIsNaturalCreature: enemy => enemy.natural === true,
    normalizeServerNaturalCreatureState: enemy => enemy,
    stripServerCreatureInventoryRows: rows => rows.filter(row => row.id !== 'silver').map(row => ({ ...row })),
    serverTalentLevel: (player, id) => Number(player.talentRanks?.[id] || 0),
    serverHasTrait: (player, id) => (player.traits || []).includes(id),
    sanitizeServerInventorySnapshot: rows => {
      const merged = new Map();
      for (const row of rows || []) {
        const qty = Math.floor(Number(row?.qty || 0));
        if (row?.id && qty > 0) merged.set(row.id, (merged.get(row.id) || 0) + qty);
      }
      return [...merged.entries()].map(([id, qty]) => ({ id, qty }));
    }
  });
  for (const name of [
    'serverNpcGearKind', 'serverApplyNpcCorpseEconomy', 'serverPrepareNpcCorpseLoot',
    'serverItemIsMaterial', 'applyEnemyProgressionLoot', 'applyContainerProgressionLoot'
  ]) vm.runInContext(functionSource(name), context);
  return { context, room: { loc: { pvpMode: mode }, rng: () => roll } };
}

const raider = () => ({
  id: 'raider', dead: true,
  inventory: [
    { id: 'pistol', qty: 1 }, { id: 'leather', qty: 1 }, { id: 'boots', qty: 1 },
    { id: 'medkit', qty: 2 }, { id: 'ammo9', qty: 6 }, { id: 'silver', qty: 20 }
  ]
});
const gari = () => ({ id: 'gari', dead: true, natural: true, inventory: [{ id: 'trophy', qty: 1 }], loot: [{ id: 'trophy', qty: 1 }] });
const novice = { talentRanks: {}, traits: [] };
const finder = { talentRanks: { scrounger: 3, cacheSense: 2 }, traits: ['scavengerStart'] };

// Труп человека: «Редкая находка» прибавляет останки и не трогает ни марки, ни расходники.
// Бросок 0,65 лежит между базовой долей детали (0,5) и долей третьего ранга (0,725)
// и в стороне от дробной части марок (26,6), поэтому оба трупа детерминированы.
{
  const base = sandbox('pvp', 0.65);
  const plainCorpse = raider();
  base.context.applyEnemyProgressionLoot(base.room, plainCorpse, novice);
  assert.deepEqual(byId(plainCorpse.loot), { medkit: 2, ammo9: 6, silver: 21, scrap: 3 },
    'without the perk the corpse is the plain v3 corpse: ' + JSON.stringify(plain(plainCorpse.loot)));

  const perked = sandbox('pvp', 0.65);
  const richCorpse = raider();
  perked.context.applyEnemyProgressionLoot(perked.room, richCorpse, finder);
  assert.deepEqual(byId(richCorpse.loot), { medkit: 2, ammo9: 6, silver: 21, scrap: 5, weaponParts: 1 },
    'rank 3 turns more of the same gear into parts and scrap: ' + JSON.stringify(plain(richCorpse.loot)));
  assert.equal(byId(richCorpse.loot).silver, byId(plainCorpse.loot).silver, 'marks are left to the premium multiplier');
  for (const id of Object.keys(byId(richCorpse.loot))) {
    assert(byId(raider().inventory)[id] || ['scrap', 'weaponParts'].includes(id),
      `the perk conjured ${id}: a finder gets more of the remains, never a new kind of item`);
  }
  assert(!byId(richCorpse.loot).pistol && !byId(richCorpse.loot).leather, 'gear still never drops');

  // Один раз на смерть: повторный вызов и повторная подготовка трупа ничего не добавляют.
  const before = byId(richCorpse.loot);
  assert.equal(perked.context.applyEnemyProgressionLoot(perked.room, richCorpse, finder), false);
  perked.context.serverPrepareNpcCorpseLoot(richCorpse, perked.room);
  assert.deepEqual(byId(richCorpse.loot), before, 'a corpse is converted and boosted once');
}

// NPC, убитый не игроком, перка не получает: доля остаётся базовой.
{
  const { context, room } = sandbox('pvp', 0.65);
  const corpse = raider();
  context.serverPrepareNpcCorpseLoot(corpse, room);
  assert.deepEqual(byId(corpse.loot), { medkit: 2, ammo9: 6, silver: 21, scrap: 3 });
}

// Существо: «Падальщик» даёт ещё один трофей, «Редкая находка» существу безразлична.
{
  const lucky = sandbox('pve', 0.1);
  const corpse = gari();
  assert.equal(lucky.context.applyEnemyProgressionLoot(lucky.room, corpse, finder), true);
  assert.deepEqual(byId(corpse.loot), { trophy: 2 });
  assert.deepEqual(byId(corpse.inventory), { trophy: 2 }, 'the corpse inventory and loot agree');
  assert.equal(lucky.context.applyEnemyProgressionLoot(lucky.room, corpse, finder), false, 'one extra trophy per creature at most');
  assert.deepEqual(byId(corpse.loot), { trophy: 2 });

  const unlucky = sandbox('pve', 0.9);
  const usual = gari();
  unlucky.context.applyEnemyProgressionLoot(unlucky.room, usual, finder);
  assert.deepEqual(byId(usual.loot), { trophy: 1 });

  const noTrait = sandbox('pve', 0.1);
  const other = gari();
  noTrait.context.applyEnemyProgressionLoot(noTrait.room, other, { talentRanks: { scrounger: 3 }, traits: [] });
  assert.deepEqual(byId(other.loot), { trophy: 1 }, 'scrounger is about gear remains, a creature carries none');
}

// Тайник: перк срабатывает у первого открывшего С перком, один раз, и не на наградах.
{
  const { context, room } = sandbox('pvp', 0.4);
  const cache = { id: 'ctr', loot: [{ id: 'scrap', qty: 4 }, { id: 'electronics', qty: 2 }, { id: 'medkit', qty: 1 }, { id: 'silver', qty: 10 }] };
  assert.equal(context.applyContainerProgressionLoot(room, cache, novice), false);
  assert.deepEqual(byId(cache.loot), { scrap: 4, electronics: 2, medkit: 1, silver: 10 });
  assert.equal(context.applyContainerProgressionLoot(room, cache, finder), true,
    'a player without the perk who opened first does not spend the bonus of the one who has it');
  assert.deepEqual(byId(cache.loot), { scrap: 6, electronics: 3, medkit: 1, silver: 10 },
    'materials grow by 25% per rank, consumables and marks do not: ' + JSON.stringify(plain(cache.loot)));
  assert.equal(context.applyContainerProgressionLoot(room, cache, finder), false, 'the bonus is not applied twice');
  assert.deepEqual(byId(cache.loot), { scrap: 6, electronics: 3, medkit: 1, silver: 10 });

  const empty = { id: 'empty', loot: [] };
  context.applyContainerProgressionLoot(room, empty, finder);
  assert.deepEqual(plain(empty.loot), [], 'an empty cache stays empty');

  for (const reward of [{ bossLoot: 'zero_custodian' }, { publicEventId: 'event_1' }]) {
    const vault = { id: 'vault', ...reward, loot: [{ id: 'scrap', qty: 4 }] };
    assert.equal(context.applyContainerProgressionLoot(room, vault, finder), false);
    assert.deepEqual(byId(vault.loot), { scrap: 4 }, 'a boss or event reward is tuned for the victory and is not multiplied');
  }
}

// --- описания говорят то же, что делает код -------------------------------------------
const percent = value => `${Math.round(value * 100)}%`;
const text = id => [...progression.perks.items, ...progression.startTraits.items].find(row => row.id === id).description;
assert(text('scrounger').includes(percent(config.remnantSharePerRank)), 'scrounger names its real number: ' + text('scrounger'));
assert(text('cacheSense').includes(percent(config.cacheMaterialsPerRank)), 'cacheSense names its real number: ' + text('cacheSense'));
assert(text('scavengerStart').includes(percent(config.scavengerTrophyChance)), 'scavengerStart names its real number: ' + text('scavengerStart'));
{
  // Стартовой половины у «Падальщика» нет. Новый персонаж получает вещи только из
  // набора снабжения (buildTutorialSupplies — ящик Сборного двора или пропуск
  // обучения), и с чертой набор тот же: лом в него не входит вовсе.
  const { buildTutorialSupplies } = require('../src/server/starting-loadout');
  const supplies = traits => byId(buildTutorialSupplies({ traits }));
  assert.deepEqual(supplies(['scavengerStart']), supplies([]),
    'the trait changes the starting supplies, so its description must name what it adds');
  assert(!/на старте|металлолом|патрон/i.test(text('scavengerStart')),
    'the trait adds nothing to the starting supplies, so the text must not promise any: ' + text('scavengerStart'));
}

console.log('Loot perks OK: scrounger raises NPC gear remains by 15% per rank, cacheSense raises cache materials by 25% per rank for the first finder, '
  + 'scavengerStart adds a trophy with a 25% chance; none of them touches marks or adds a new kind of item, and each applies once.');
