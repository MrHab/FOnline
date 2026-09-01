'use strict';

const NPC_CAPS_INVENTORY_VERSION = 1;
const NPC_PERSONAL_INVENTORY_VERSION = 2;
const NPC_INVENTORY_VERSION = 3;

const FACTION_ALIASES = Object.freeze({
  caravan: 'caravans',
  caravans: 'caravans',
  klim_patrol: 'old_klim',
  old_klim: 'old_klim',
  scrap: 'scrap_union',
  scrap_town: 'scrap_union',
  scrap_union: 'scrap_union',
  relay: 'relay_order',
  relay_station: 'relay_order',
  relay_order: 'relay_order',
  raider: 'raiders',
  raiders: 'raiders',
  mutant: 'mutants',
  mutants: 'mutants',
  super_mutant: 'mutants',
  super_mutants: 'mutants'
});

const FACTION_DOCTRINES = Object.freeze({
  old_klim: {
    weapons: ['assaultRifle', 'rifle', 'shotgun', 'pistol', 'axe', 'knife'],
    backupWeapons: ['knife', 'axe', 'pickaxe'],
    armor: ['combatArmor', 'ballisticVest', 'leather'],
    helmets: ['assaultHelmet', 'tacticalHelmet', 'helmet'],
    boots: ['reinforcedBoots', 'boots'],
    backpacks: ['backpack']
  },
  caravans: {
    weapons: ['rifle', 'shotgun', 'pistol', 'knife', 'axe'],
    backupWeapons: ['knife', 'axe'],
    armor: ['ballisticVest', 'leather'],
    helmets: ['tacticalHelmet', 'helmet'],
    boots: ['boots', 'scoutBoots'],
    backpacks: ['backpack']
  },
  scrap_union: {
    weapons: ['shotgun', 'rifle', 'pistol', 'axe', 'pickaxe', 'knife'],
    backupWeapons: ['axe', 'pickaxe', 'knife'],
    armor: ['metalArmor', 'ballisticVest', 'leather'],
    helmets: ['helmet', 'tacticalHelmet'],
    boots: ['scoutBoots', 'boots'],
    backpacks: ['backpack']
  },
  relay_order: {
    weapons: ['plasmaRifle', 'laserPistol', 'flamethrower', 'pistol', 'knife'],
    backupWeapons: ['knife', 'handPump'],
    armor: ['energySuit', 'hazmatSuit', 'ballisticVest', 'leather'],
    helmets: ['assaultHelmet', 'tacticalHelmet', 'helmet'],
    boots: ['reinforcedBoots', 'boots'],
    backpacks: ['backpack']
  },
  raiders: {
    weapons: ['assaultRifle', 'shotgun', 'rifle', 'pistol', 'axe', 'knife'],
    backupWeapons: ['axe', 'knife'],
    armor: ['metalArmor', 'leather'],
    helmets: ['helmet'],
    boots: ['boots'],
    backpacks: ['backpack']
  },
  mutants: {
    weapons: ['machineGun', 'assaultRifle', 'rifle', 'axe'],
    backupWeapons: ['axe'],
    armor: ['heavyArmor', 'metalArmor', 'combatArmor'],
    helmets: ['assaultHelmet'],
    boots: ['reinforcedBoots', 'boots'],
    backpacks: []
  },
  neutral: {
    weapons: ['pistol', 'knife', 'axe', 'pickaxe'],
    backupWeapons: ['knife', 'axe', 'pickaxe'],
    armor: ['leather'],
    helmets: ['helmet'],
    boots: ['boots'],
    backpacks: ['backpack']
  }
});

function normalizeFaction(faction = '') {
  const key = String(faction || 'neutral').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'neutral';
  if (FACTION_ALIASES[key]) return FACTION_ALIASES[key];
  if (['ghouls', 'radscorpions', 'mutant_ants', 'geckos', 'ash_wolves', 'monsters', 'wild'].includes(key)) return 'wild';
  return key;
}

function stableUnit(seed = '', salt = '') {
  const text = `${seed}:${salt}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function profileRows(profile = {}) {
  return Array.isArray(profile?.stock) ? profile.stock : [];
}

function buildFactionSupplyCatalog(state = {}, faction = '', traderProfiles = {}) {
  const group = normalizeFaction(faction);
  const items = new Set();
  const amounts = {};
  const sources = new Set();
  let prosperity = 0;
  let security = 0;
  let siteCount = 0;

  const add = (id, amount = 1, source = '') => {
    const key = String(id || '').trim();
    const qty = Math.max(0, Number(amount || 0));
    if (!key || qty <= 0) return;
    items.add(key);
    amounts[key] = Math.max(0, Number(amounts[key] || 0)) + qty;
    if (source) sources.add(String(source));
  };
  const addObject = (rows, source, includeZeroCapability = false) => {
    if (!rows || typeof rows !== 'object') return;
    for (const [id, amount] of Object.entries(rows)) {
      const qty = Number(amount || 0);
      if (qty > 0) add(id, qty, source);
      else if (includeZeroCapability && id) {
        items.add(id);
        if (source) sources.add(String(source));
      }
    }
  };
  const addRows = (rows, source) => {
    for (const row of Array.isArray(rows) ? rows : []) add(row?.id || row?.itemId, row?.qty ?? row?.count ?? 1, source);
  };

  for (const site of Object.values(state?.sites || {})) {
    if (!site || normalizeFaction(site.owner || site.capitalFaction || '') !== group) continue;
    siteCount++;
    prosperity += Math.max(0, Number(site.prosperity || 0));
    security += Math.max(0, Number(site.security || 0));
    addObject(site.stockpile, `site:${site.id}:stock`);
    addObject(site.output, `site:${site.id}:output`, true);
    addObject(site.production, `site:${site.id}:production`, true);
    for (const profileId of Array.isArray(site.traderProfiles) ? site.traderProfiles : []) {
      addRows(profileRows(traderProfiles?.[profileId]), `trader:${profileId}`);
    }
  }

  for (const party of Object.values(state?.parties || {})) {
    if (!party || normalizeFaction(party.faction || '') !== group || party.destroyed) continue;
    addObject(party.cargo, `party:${party.id}:cargo`);
    addRows(party.inventory, `party:${party.id}:inventory`);
  }

  const has = id => items.has(id) || Number(amounts[id] || 0) > 0;
  const derive = (id, amount, source) => {
    if (amount > 0) add(id, amount, source);
  };
  if (has('ammoParts')) {
    derive('ammo9', Number(amounts.ammoParts || 1) * 2.8, 'craft:ammoParts');
    derive('ammo556', Number(amounts.ammoParts || 1) * 1.7, 'craft:ammoParts');
    derive('shotgunShell', Number(amounts.ammoParts || 1) * 1.1, 'craft:ammoParts');
  }
  if (has('electronics') && has('chemicals')) derive('energyCell', Math.min(Number(amounts.electronics || 1) * 2.2, Number(amounts.chemicals || 1) * 6), 'craft:energyCell');
  if (has('oil') && has('chemicals')) derive('napalm', Math.min(Number(amounts.oil || 1) * 1.8, Number(amounts.chemicals || 1) * 4), 'craft:napalm');
  if (has('medicine') && has('chemicals')) {
    derive('stim', Number(amounts.medicine || 1) * 0.7, 'craft:medicine');
    derive('medkit', Number(amounts.medicine || 1) * 0.3, 'craft:medicine');
    derive('antibiotics', Number(amounts.medicine || 1) * 0.35, 'craft:medicine');
  }
  if (has('scrap') && has('electronics')) derive('repairKit', Math.min(Number(amounts.scrap || 1) / 3, Number(amounts.electronics || 1)), 'craft:repairKit');
  if (has('scrap')) derive('knife', Math.max(1, Number(amounts.scrap || 1) * 0.08), 'craft:scrap');
  if (has('scrap') && has('wood')) derive('axe', Math.max(1, Math.min(Number(amounts.scrap || 1), Number(amounts.wood || 1)) * 0.08), 'craft:axe');
  if (has('scrap') && has('ore')) derive('pickaxe', Math.max(1, Math.min(Number(amounts.scrap || 1), Number(amounts.ore || 1)) * 0.06), 'craft:pickaxe');

  const doctrine = FACTION_DOCTRINES[group] || FACTION_DOCTRINES.neutral;
  const ammoIssuedWeapons = {
    ammo9: ['pistol'],
    ammo556: group === 'mutants' ? ['machineGun', 'assaultRifle', 'rifle'] : group === 'old_klim' || group === 'raiders' ? ['assaultRifle', 'rifle'] : ['rifle'],
    shotgunShell: ['shotgun'],
    energyCell: group === 'relay_order' ? ['plasmaRifle', 'laserPistol'] : ['laserPistol'],
    napalm: ['flamethrower'],
    rocketAmmo: ['rocketLauncher']
  };
  for (const [ammoId, weaponIds] of Object.entries(ammoIssuedWeapons)) {
    if (!has(ammoId)) continue;
    weaponIds.filter(id => doctrine.weapons.includes(id)).forEach(id => derive(id, 1, `arsenal:${ammoId}`));
  }
  if (group === 'raiders' && has('scrap')) {
    derive('leather', 1, 'raider:salvage');
    derive('helmet', 1, 'raider:salvage');
    derive('boots', 1, 'raider:salvage');
  }
  if (group === 'mutants' && (has('scrap') || has('ore'))) {
    derive('metalArmor', 1, 'mutant:forge');
    derive('reinforcedBoots', 1, 'mutant:forge');
  }

  return {
    group,
    items,
    amounts,
    sources: [...sources],
    siteCount,
    wealth: Math.max(0, Number(amounts.silver || 0)) + prosperity * 1.5 + security * 0.5
  };
}

function doctrineForFaction(faction = '') {
  return FACTION_DOCTRINES[normalizeFaction(faction)] || FACTION_DOCTRINES.neutral;
}

function itemAvailable(catalog = {}, id = '') {
  if (!id || id === 'fists') return id === 'fists';
  return catalog?.items instanceof Set ? catalog.items.has(id) : Array.isArray(catalog?.items) && catalog.items.includes(id);
}

function chooseStable(rows = [], seed = '', salt = '') {
  const choices = rows.filter(Boolean);
  if (!choices.length) return '';
  const poolSize = Math.min(3, choices.length);
  return choices[Math.floor(stableUnit(seed, salt) * poolSize) % poolSize];
}

function chooseFactionEquipment(context = {}) {
  const faction = normalizeFaction(context.faction || 'neutral');
  const role = String(context.role || '').toLowerCase();
  const seed = String(context.seed || `${faction}:${role}`);
  const catalog = context.catalog || { items: new Set() };
  const doctrine = doctrineForFaction(faction);
  const requested = context.requested && typeof context.requested === 'object' ? context.requested : {};
  const fallback = context.fallback && typeof context.fallback === 'object' ? context.fallback : {};
  const allowed = rows => rows.filter(id => itemAvailable(catalog, id));
  const keepOrChoose = (slot, rows) => {
    const current = String(requested[slot] || fallback[slot] || '');
    if (itemAvailable(catalog, current)) return current;
    return chooseStable(allowed(rows), seed, `equipment:${slot}`);
  };

  let weapons = doctrine.weapons.slice();
  if (['worker', 'scavenger', 'hauler', 'craftsman', 'mechanic'].includes(role)) {
    weapons = ['pickaxe', 'axe', 'handPump', 'knife', ...weapons];
  } else if (['civilian', 'medic', 'merchant', 'trader', 'quartermaster'].includes(role)) {
    weapons = ['pistol', 'knife', 'axe', ...weapons];
  }
  const combatRole = ['guard', 'patrol', 'raider', 'mutant', 'attacker', 'defender'].includes(role);
  const equipment = {
    weapon: keepOrChoose('weapon', weapons) || 'fists',
    armor: keepOrChoose('armor', combatRole ? doctrine.armor : doctrine.armor.slice().reverse()),
    helmet: keepOrChoose('helmet', combatRole ? doctrine.helmets : doctrine.helmets.slice().reverse()),
    boots: keepOrChoose('boots', doctrine.boots),
    backpack: keepOrChoose('backpack', doctrine.backpacks)
  };
  return equipment;
}

function mergeRows(rows = [], allowed = null) {
  const byId = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.id || row?.itemId || '').trim();
    const qty = Math.max(0, Math.floor(Number(row?.qty ?? row?.count ?? 0)));
    if (!id || qty <= 0 || (allowed && !allowed(id))) continue;
    byId.set(id, (byId.get(id) || 0) + qty);
  }
  return [...byId.entries()].map(([id, qty]) => ({ id, qty }));
}

function rowQty(rows = [], itemId = '') {
  return mergeRows(rows).filter(row => row.id === itemId).reduce((sum, row) => sum + row.qty, 0);
}

function setRowQty(rows = [], itemId = '', qty = 0) {
  const out = mergeRows(rows).filter(row => row.id !== itemId);
  const count = Math.max(0, Math.floor(Number(qty || 0)));
  if (itemId && count > 0) out.push({ id: itemId, qty: count });
  return out;
}

function buildNpcEquipmentInventory(equipment = {}, itemIds = null) {
  const allowed = id => !itemIds || itemIds.has(id);
  const rows = [];
  for (const rawId of Object.values(equipment && typeof equipment === 'object' ? equipment : {})) {
    const id = String(rawId || '').trim();
    if (id && id !== 'fists' && allowed(id)) rows.push({ id, qty: 1 });
  }
  return mergeRows(rows, allowed);
}

function startingNpcCaps(context = {}) {
  const role = String(context.role || '').toLowerCase();
  const seed = String(context.seed || `${context.faction || 'neutral'}:${role}:npc`);
  const wealth = Math.max(0, Number(context.wealth || 0));
  const roleMoney = ['merchant', 'trader', 'quartermaster'].includes(role) ? 48
    : ['guard', 'patrol', 'defender'].includes(role) ? 18
      : ['raider', 'attacker', 'mutant'].includes(role) ? 7 : 10;
  const wealthMultiplier = Math.max(0.55, Math.min(1.8, 0.55 + Math.log10(Math.max(1, wealth)) * 0.34));
  return Math.max(1, Math.floor(roleMoney * wealthMultiplier * (0.72 + stableUnit(seed, 'money') * 0.72)));
}

function materializeNpcCapsInventory(input = {}, context = {}) {
  const naturalCreature = context.naturalCreature === true;
  const previousVersion = Math.max(0, Math.floor(Number(input.inventoryVersion || 0)));
  let inventory = mergeRows(input.inventory || []);
  if (naturalCreature) {
    return {
      inventory: inventory.filter(row => row.id !== 'silver'),
      inventoryVersion: 0
    };
  }
  if (previousVersion < NPC_CAPS_INVENTORY_VERSION && rowQty(inventory, 'silver') <= 0) {
    const legacyCaps = Number(input.caps ?? input.traderCaps);
    const caps = Number.isFinite(legacyCaps) && legacyCaps > 0
      ? Math.floor(legacyCaps)
      : startingNpcCaps({
        seed: context.seed || input.id,
        role: context.role || input.role,
        faction: context.faction || input.faction,
        wealth: context.wealth
      });
    inventory = setRowQty(inventory, 'silver', caps);
  }
  return {
    inventory,
    inventoryVersion: Math.max(previousVersion, NPC_CAPS_INVENTORY_VERSION)
  };
}

function buildFactionPersonalInventory(context = {}) {
  const faction = normalizeFaction(context.faction || 'neutral');
  const role = String(context.role || '').toLowerCase();
  const seed = String(context.seed || `${faction}:${role}:npc`);
  const catalog = context.catalog || { items: new Set(), amounts: {}, wealth: 0 };
  const equipment = context.equipment && typeof context.equipment === 'object' ? context.equipment : {};
  const weaponDefs = context.weaponDefs || {};
  const doctrine = doctrineForFaction(faction);
  const rows = buildNpcEquipmentInventory(equipment, context.itemIds);
  const allowed = id => !context.itemIds || context.itemIds.has(id);
  const add = (id, qty) => {
    const count = Math.max(0, Math.floor(Number(qty || 0)));
    if (id && count > 0 && allowed(id)) rows.push({ id, qty: count });
  };
  const has = id => itemAvailable(catalog, id);

  add('silver', startingNpcCaps({ seed, role, faction, wealth: catalog.wealth }));
  if (has('water')) add('water', 1 + Math.floor(stableUnit(seed, 'water') * 2));
  if (has('food') && stableUnit(seed, 'food') > 0.22) add('food', 1);

  const weapon = weaponDefs[equipment.weapon] || null;
  if (weapon?.ammoType && has(weapon.ammoType)) {
    const combatRole = ['guard', 'patrol', 'raider', 'mutant', 'attacker', 'defender'].includes(role);
    const magazines = combatRole ? 3 + Math.floor(stableUnit(seed, 'ammo-magazines') * 3) : 2 + Math.floor(stableUnit(seed, 'ammo-magazines') * 2);
    add(weapon.ammoType, Math.max(1, Math.max(1, Number(weapon.magSize || 1)) * magazines));
  }

  if (weapon?.ammoType) {
    const backup = doctrine.backupWeapons.find(id => has(id));
    if (backup) add(backup, 1);
  }
  if (['worker', 'scavenger', 'hauler'].includes(role)) {
    const material = ['scrap', 'wood', 'ore'].filter(has);
    const id = chooseStable(material, seed, 'worker-material');
    if (id) add(id, 1 + Math.floor(stableUnit(seed, 'worker-material-qty') * 3));
  }
  if (['craftsman', 'mechanic'].includes(role)) {
    if (has('repairKit') && stableUnit(seed, 'repair-kit') > 0.38) add('repairKit', 1);
    if (has('scrap')) add('scrap', 1 + Math.floor(stableUnit(seed, 'craft-scrap') * 3));
  }
  if (role === 'medic' || (['guard', 'patrol'].includes(role) && stableUnit(seed, 'guard-aid') > 0.68)) {
    if (has('stim')) add('stim', 1 + (role === 'medic' ? Math.floor(stableUnit(seed, 'stim') * 2) : 0));
    if (role === 'medic' && has('medkit')) add('medkit', 1);
  }
  if (has('antibiotics') && stableUnit(seed, 'antibiotics') > 0.88) add('antibiotics', 1);
  return mergeRows(rows, allowed);
}

function weaponScore(weapon = {}, distance = 0) {
  const min = Number(weapon?.dmg?.[0] || 0);
  const max = Number(weapon?.dmg?.[1] || min);
  const average = (min + max) / 2;
  const ranged = !!weapon?.ammoType;
  let score = average + Number(weapon?.range || 0) * (ranged ? 0.45 : 0.12);
  if (ranged && Number(distance || 0) < 2.4) score *= 0.72;
  if (!ranged && Number(distance || 0) > 3.2) score *= 0.55;
  if (weapon?.id === 'fists') score = Math.max(0.5, score * 0.4);
  return score;
}

function chooseUsableWeapon(actor = {}, weaponDefs = {}, context = {}) {
  const currentId = String(actor?.equipment?.weapon || actor?.weapon || 'fists');
  const candidates = new Set([currentId, 'fists']);
  for (const row of mergeRows(actor.inventory || [])) if (weaponDefs[row.id]) candidates.add(row.id);
  const excluded = new Set(Array.isArray(context.exclude) ? context.exclude : []);
  const usable = [...candidates]
    .filter(id => weaponDefs[id] && !excluded.has(id))
    .filter(id => !weaponDefs[id].ammoType || rowQty(actor.inventory || [], weaponDefs[id].ammoType) > 0)
    .sort((a, b) => {
      const delta = weaponScore(weaponDefs[b], context.distance) - weaponScore(weaponDefs[a], context.distance);
      if (Math.abs(delta) > 0.0001) return delta;
      if (a === currentId) return -1;
      if (b === currentId) return 1;
      return a.localeCompare(b);
    });
  return usable[0] || 'fists';
}

function prepareNpcWeapon(actor = {}, weaponDefs = {}, context = {}) {
  if (!actor.equipment || typeof actor.equipment !== 'object') actor.equipment = {};
  const previousWeapon = String(actor.equipment.weapon || actor.weapon || 'fists');
  const weaponId = chooseUsableWeapon(actor, weaponDefs, context);
  actor.equipment.weapon = weaponId;
  actor.weapon = weaponId;
  return { weaponId, previousWeapon, switched: weaponId !== previousWeapon, weapon: weaponDefs[weaponId] || weaponDefs.fists };
}

function consumeNpcAmmo(actor = {}, weapon = {}, weaponDefs = {}, context = {}) {
  const ammoType = String(weapon?.ammoType || '');
  if (!ammoType) return { consumed: 0, remaining: 0, switched: false, weaponId: String(actor?.equipment?.weapon || actor?.weapon || 'fists') };
  const before = rowQty(actor.inventory || [], ammoType);
  if (before <= 0) return { consumed: 0, remaining: 0, ...prepareNpcWeapon(actor, weaponDefs, { ...context, exclude: [weapon.id] }) };
  actor.inventory = setRowQty(actor.inventory || [], ammoType, before - 1);
  const remaining = before - 1;
  if (remaining > 0) return { consumed: 1, remaining, switched: false, weaponId: String(actor?.equipment?.weapon || actor?.weapon || weapon.id) };
  return { consumed: 1, remaining: 0, ...prepareNpcWeapon(actor, weaponDefs, { ...context, exclude: [weapon.id] }) };
}

function buildPersonalTradeStock(actor = {}, context = {}) {
  const allowed = typeof context.allowed === 'function' ? context.allowed : () => true;
  const priceFor = typeof context.priceFor === 'function' ? context.priceFor : () => 1;
  const weaponDefs = context.weaponDefs || {};
  const inventory = mergeRows(actor.inventory || [], allowed);
  const reserve = new Map();
  const keep = (id, qty = 1) => {
    const key = String(id || '').trim();
    const count = Math.max(0, Math.floor(Number(qty || 0)));
    if (key && key !== 'fists' && count > 0) reserve.set(key, Math.max(reserve.get(key) || 0, count));
  };

  Object.values(actor.equipment || {}).forEach(id => keep(id, 1));
  const activeWeaponId = String(actor?.equipment?.weapon || actor?.weapon || 'fists');
  const activeWeapon = weaponDefs[activeWeaponId] || null;
  if (activeWeapon?.ammoType) {
    const reserveMagazines = Math.max(1, Math.floor(Number(context.reserveMagazines || 1)));
    keep(activeWeapon.ammoType, Math.max(1, Number(activeWeapon.magSize || 1)) * reserveMagazines);
    const backupId = chooseUsableWeapon(actor, weaponDefs, { distance: 1.5, exclude: [activeWeaponId] });
    if (backupId && backupId !== 'fists') {
      keep(backupId, 1);
      const backupWeapon = weaponDefs[backupId];
      if (backupWeapon?.ammoType) keep(backupWeapon.ammoType, Math.max(1, Number(backupWeapon.magSize || 1)));
    }
    const meleeBackup = inventory
      .map(row => row.id)
      .find(id => id !== activeWeaponId && weaponDefs[id] && !weaponDefs[id].ammoType);
    if (meleeBackup) keep(meleeBackup, 1);
  }

  const existingPrices = new Map((Array.isArray(context.existingStock) ? context.existingStock : [])
    .map(row => [String(row?.id || ''), Math.max(1, Math.floor(Number(row?.price || 1)))])
    .filter(([id]) => !!id));
  return inventory
    .filter(row => row.id !== 'silver' && row.id !== 'fists')
    .map(row => ({
      id: row.id,
      qty: Math.max(0, row.qty - Number(reserve.get(row.id) || 0)),
      price: existingPrices.get(row.id) || Math.max(1, Math.floor(Number(priceFor(row.id) || 1)))
    }))
    .filter(row => row.qty > 0)
    .slice(0, 80);
}

function transferCorpseLoot(looter = {}, corpse = {}, context = {}) {
  const allowed = typeof context.allowed === 'function' ? context.allowed : () => true;
  const stackLimit = typeof context.stackLimit === 'function' ? context.stackLimit : () => 9999;
  const itemWeight = typeof context.itemWeight === 'function' ? context.itemWeight : () => 0;
  const priority = typeof context.priority === 'function' ? context.priority : () => 0;
  const inventory = mergeRows(looter.inventory || [], allowed);
  const corpseRows = mergeRows(corpse.loot || [], allowed)
    .sort((a, b) => priority(b.id, b.qty) - priority(a.id, a.qty) || a.id.localeCompare(b.id));
  const equipmentWeight = Object.values(looter.equipment || {}).reduce((sum, id) => {
    if (!id || id === 'fists' || rowQty(inventory, id) > 0) return sum;
    return sum + Math.max(0, Number(itemWeight(id) || 0));
  }, 0);
  const inventoryWeight = inventory.reduce((sum, row) => sum + Math.max(0, Number(itemWeight(row.id) || 0)) * row.qty, 0);
  let freeWeight = Math.max(0, Number(context.capacity ?? Infinity) - inventoryWeight - equipmentWeight);
  const taken = [];

  for (const row of corpseRows) {
    const have = rowQty(inventory, row.id);
    const stackRoom = Math.max(0, Math.floor(Number(stackLimit(row.id) || 0)) - have);
    if (stackRoom <= 0) continue;
    const weight = Math.max(0, Number(itemWeight(row.id) || 0));
    const byWeight = weight > 0 && Number.isFinite(freeWeight) ? Math.max(0, Math.floor((freeWeight + 0.0001) / weight)) : row.qty;
    const qty = Math.min(row.qty, stackRoom, byWeight);
    if (qty <= 0) continue;
    const nextQty = have + qty;
    const nextRows = setRowQty(inventory, row.id, nextQty);
    inventory.length = 0;
    inventory.push(...nextRows);
    corpse.loot = setRowQty(corpse.loot || [], row.id, rowQty(corpse.loot || [], row.id) - qty);
    if (Number.isFinite(freeWeight)) freeWeight = Math.max(0, freeWeight - weight * qty);
    taken.push({ id: row.id, qty });
  }
  looter.inventory = mergeRows(inventory, allowed);
  corpse.loot = mergeRows(corpse.loot || [], allowed);
  corpse.looted = corpse.loot.length === 0;
  return { taken, remaining: corpse.loot.map(row => ({ ...row })), freeWeight };
}

module.exports = {
  NPC_CAPS_INVENTORY_VERSION,
  NPC_PERSONAL_INVENTORY_VERSION,
  NPC_INVENTORY_VERSION,
  FACTION_DOCTRINES,
  normalizeFaction,
  buildFactionSupplyCatalog,
  chooseFactionEquipment,
  buildNpcEquipmentInventory,
  buildFactionPersonalInventory,
  startingNpcCaps,
  materializeNpcCapsInventory,
  chooseUsableWeapon,
  prepareNpcWeapon,
  consumeNpcAmmo,
  buildPersonalTradeStock,
  transferCorpseLoot,
  mergeRows,
  rowQty,
  setRowQty
};
