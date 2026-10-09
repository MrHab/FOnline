'use strict';

const CAPTURE_MS = 3 * 60 * 1000;
const MAX_TICK_MS = 10000;

function id(value) { return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64); }
function number(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }

function normalizeCatalog(input = {}) {
  const seen = new Set();
  const lairAnchors = Object.freeze((Array.isArray(input.lairAnchors) ? input.lairAnchors : []).map(row => {
    const anchor = { id: id(row.id), locationId: id(row.locationId),
      tx: Math.round(number(row.tx, NaN)), tz: Math.round(number(row.tz, NaN)),
      x: number(row.x, NaN), z: number(row.z, NaN) };
    if (!anchor.id || !anchor.locationId || seen.has(anchor.id)
      || ![anchor.tx, anchor.tz, anchor.x, anchor.z].every(Number.isFinite)
      || anchor.tx < 0 || anchor.tx >= 160 || anchor.tz < 0 || anchor.tz >= 160)
      throw new Error(`open-world A-Life: invalid or duplicate lair anchor ${anchor.id}`);
    seen.add(anchor.id);
    return Object.freeze(anchor);
  }));
  const lairAnchorsById = Object.freeze(Object.fromEntries(lairAnchors.map(row => [row.id, row])));
  const read = (rows, kind) => (Array.isArray(rows) ? rows : []).map(row => {
    const site = {
      id: id(row.id), kind, locationId: id(row.locationId),
      x: number(row.x), z: number(row.z), radius: Math.max(3, number(row.radius, 12)),
      ...(kind === 'huntingGround' ? {
        tx: Math.round(number(row.tx)), tz: Math.round(number(row.tz)), speciesId: id(row.speciesId)
      } : {
        siteLocationId: id(row.siteLocationId || row.locationId),
        bounds: row.bounds && ['minX', 'maxX', 'minZ', 'maxZ'].every(key => Number.isFinite(Number(row.bounds[key])))
          ? Object.freeze({ minX: number(row.bounds.minX), maxX: number(row.bounds.maxX),
            minZ: number(row.bounds.minZ), maxZ: number(row.bounds.maxZ) }) : null,
        ownerFaction: id(row.ownerFaction), garrisonSize: Math.max(1, Math.min(12, Math.round(number(row.garrisonSize, 4)))),
        bossType: id(row.bossType) || 'patrol_guard', captureXp: Math.max(0, Math.round(number(row.captureXp, 300)))
      })
    };
    if (!site.id || !site.locationId || seen.has(site.id)) throw new Error(`open-world A-Life: invalid or duplicate site ${site.id}`);
    if (kind === 'huntingGround' && !site.speciesId) throw new Error(`open-world A-Life: missing species at ${site.id}`);
    seen.add(site.id);
    return Object.freeze(site);
  });
  const huntingGrounds = read(input.huntingGrounds, 'huntingGround');
  const outposts = read(input.outposts, 'outpost');
  const rewards = source => Object.freeze(Object.fromEntries([1, 2, 3, 4, 5].map(tier => [tier,
    Object.freeze((Array.isArray(source?.[tier]) ? source[tier] : [])
      .map(row => ({ id: id(row.id), qty: Math.max(1, Math.min(999, Math.floor(number(row.qty, 1)))) }))
      .filter(row => row.id))])));
  const lairRewards = rewards(input.lairRewards);
  const caravanRobberyRewards = rewards(input.caravanRobberyRewards);
  const anomalyRoutes = Object.freeze((Array.isArray(input.anomalyRoutes) ? input.anomalyRoutes : [])
    .map(id).filter(Boolean));
  return Object.freeze({ version: 1, lairAnchors, lairAnchorsById, huntingGrounds, outposts, lairRewards, caravanRobberyRewards,
    anomalyRoutes, sites: [...huntingGrounds, ...outposts] });
}

function emptyOutpost(def) {
  return {
    id: def.id, ownerFaction: def.ownerFaction, bossAlive: true, garrisonGeneration: 1,
    captureMs: {}, contributionMs: {}, captureFaction: '', lastTickAt: 0,
    stormActive: false, stormSheltered: false, bossSiegeMs: 0, version: 1
  };
}

function normalizeState(input = {}, catalog = normalizeCatalog()) {
  const state = { version: 1, revision: Math.max(1, Math.floor(number(input.revision, 1))), outposts: new Map(),
    pendingXp: Object.fromEntries(Object.entries(input.pendingXp || {}).map(([key, xp]) =>
      [id(key), Math.max(0, Math.floor(number(xp)))]).filter(([key, xp]) => key && xp > 0)), dirty: false };
  for (const def of catalog.outposts) {
    const row = (Array.isArray(input.outposts) ? input.outposts : []).find(item => item?.id === def.id) || {};
    const runtime = emptyOutpost(def);
    runtime.ownerFaction = id(row.ownerFaction) || runtime.ownerFaction;
    runtime.bossAlive = row.bossAlive !== false;
    runtime.garrisonGeneration = Math.max(1, Math.floor(number(row.garrisonGeneration, 1)));
    runtime.captureMs = Object.fromEntries(Object.entries(row.captureMs || {})
      .map(([faction, ms]) => [id(faction), Math.max(0, Math.min(CAPTURE_MS, number(ms)))])
      .filter(([faction]) => faction));
    runtime.contributionMs = Object.fromEntries(Object.entries(row.contributionMs || {})
      .map(([playerId, ms]) => [id(playerId), Math.max(0, number(ms))]).filter(([playerId]) => playerId));
    runtime.captureFaction = id(row.captureFaction);
    // Capture time never accrues while the server was stopped.
    runtime.lastTickAt = 0;
    runtime.stormActive = row.stormActive === true;
    runtime.stormSheltered = row.stormSheltered === true;
    runtime.bossSiegeMs = Math.max(0, Math.min(60000, number(row.bossSiegeMs)));
    runtime.version = Math.max(1, Math.floor(number(row.version, 1)));
    state.outposts.set(def.id, runtime);
  }
  return state;
}

function serializeState(state) {
  return {
    version: 1, revision: state.revision, pendingXp: { ...state.pendingXp },
    outposts: [...state.outposts.values()].map(row => ({
      id: row.id, ownerFaction: row.ownerFaction, bossAlive: row.bossAlive,
      garrisonGeneration: row.garrisonGeneration, captureMs: { ...row.captureMs },
      contributionMs: { ...row.contributionMs }, captureFaction: row.captureFaction,
      stormActive: row.stormActive, stormSheltered: row.stormSheltered,
      bossSiegeMs: row.bossSiegeMs, version: row.version
    }))
  };
}

function within(def, actor) {
  if (!actor || actor.alive === false) return false;
  const x = number(actor.x);
  const z = number(actor.z);
  if (def.bounds) return x >= def.bounds.minX && x <= def.bounds.maxX
    && z >= def.bounds.minZ && z <= def.bounds.maxZ;
  return Math.hypot(x - def.x, z - def.z) <= def.radius;
}

function markChanged(state, runtime) {
  runtime.version += 1;
  state.revision += 1;
  state.dirty = true;
}

function setBossAlive(state, def, alive) {
  const runtime = state.outposts.get(def.id);
  if (!runtime || runtime.bossAlive === !!alive) return false;
  runtime.bossAlive = !!alive;
  markChanged(state, runtime);
  return true;
}

function tickOutpost(state, def, now, observed = {}) {
  const runtime = state.outposts.get(def.id);
  if (!runtime) return [];
  const events = [];
  const players = (Array.isArray(observed.players) ? observed.players : []).filter(actor => within(def, actor));
  const guards = (Array.isArray(observed.guards) ? observed.guards : []).filter(actor => within(def, actor));
  const stormInside = observed.stormInside === true;
  if (stormInside) {
    const sheltered = players.length > 0;
    if (!runtime.stormActive || (sheltered && !runtime.stormSheltered)) {
      runtime.stormActive = true;
      runtime.stormSheltered = runtime.stormSheltered || sheltered;
      markChanged(state, runtime);
    }
  } else if (runtime.stormActive) {
    if (!runtime.stormSheltered) {
      runtime.ownerFaction = 'raiders';
      runtime.bossAlive = true;
      runtime.garrisonGeneration += 1;
      runtime.captureMs = {};
      runtime.contributionMs = {};
      runtime.captureFaction = '';
      runtime.bossSiegeMs = 0;
      events.push({ type: 'stormRaiderTakeover', siteId: def.id, ownerFaction: 'raiders' });
    }
    runtime.stormActive = false;
    runtime.stormSheltered = false;
    markChanged(state, runtime);
  }

  const delta = runtime.lastTickAt ? Math.max(0, Math.min(MAX_TICK_MS, now - runtime.lastTickAt)) : 0;
  runtime.lastTickAt = now;
  const patrols = (Array.isArray(observed.patrols) ? observed.patrols : [])
    .filter(actor => within(def, actor));
  if (delta && observed.offscreen === true && runtime.bossAlive) {
    const attackers = patrols.filter(actor => id(actor.faction) !== runtime.ownerFaction && id(actor.faction) !== 'neutral');
    const largestFaction = Math.max(0, ...[...new Set(attackers.map(actor => id(actor.faction)))]
      .map(faction => attackers.filter(actor => id(actor.faction) === faction).length));
    const nextSiege = largestFaction >= def.garrisonSize ? Math.min(60000, runtime.bossSiegeMs + delta) : 0;
    if (nextSiege !== runtime.bossSiegeMs) {
      runtime.bossSiegeMs = nextSiege;
      markChanged(state, runtime);
    }
    if (runtime.bossSiegeMs >= 60000) {
      runtime.bossAlive = false;
      events.push({ type: 'bossDefeatedByPatrol', siteId: def.id });
      markChanged(state, runtime);
    }
  }
  if (!delta || runtime.bossAlive) return events;
  const counts = new Map();
  for (const actor of [...players, ...guards, ...patrols]) {
    const faction = id(actor.faction);
    if (faction && faction !== 'neutral') counts.set(faction, (counts.get(faction) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || (ranked[1] && ranked[0][1] === ranked[1][1])) return events;
  const leader = ranked[0][0];
  if (leader === runtime.ownerFaction) return events;
  runtime.captureFaction = leader;
  runtime.captureMs[leader] = Math.min(CAPTURE_MS, (runtime.captureMs[leader] || 0) + delta);
  for (const player of players) if (id(player.faction) === leader) {
    const key = id(player.id);
    if (key) runtime.contributionMs[key] = (runtime.contributionMs[key] || 0) + delta;
  }
  markChanged(state, runtime);
  if (runtime.captureMs[leader] >= CAPTURE_MS) {
    const contributions = { ...runtime.contributionMs };
    runtime.ownerFaction = leader;
    runtime.bossAlive = true;
    runtime.garrisonGeneration += 1;
    runtime.captureMs = {};
    runtime.contributionMs = {};
    runtime.captureFaction = '';
    runtime.bossSiegeMs = 0;
    markChanged(state, runtime);
    events.push({ type: 'captured', siteId: def.id, ownerFaction: leader, contributions, captureXp: def.captureXp });
  }
  return events;
}

function scaleDefenderHealth(actor, attackerCount, multiplier = 0.3) {
  const oldMax = Math.max(1, number(actor.maxHp, 1));
  const oldHp = Math.max(0, number(actor.hp, 0));
  const nextMax = Math.max(1, Math.round(number(actor.alifeBaseMaxHp, oldMax)
    * (1 + Math.max(0, attackerCount) * multiplier)));
  actor.maxHp = nextMax;
  // A changing attacker count never restores current health.
  actor.hp = Math.min(oldHp, nextMax);
  return actor;
}

function publicOutpost(def, runtime) {
  return {
    id: def.id, kind: 'outpost', locationId: def.locationId,
    x: def.x, z: def.z, radius: def.radius, bounds: def.bounds, active: true,
    ownerFaction: runtime.ownerFaction, captureFaction: runtime.captureFaction,
    capturePercent: Math.round(100 * (runtime.captureMs[runtime.captureFaction] || 0) / CAPTURE_MS),
    bossAlive: runtime.bossAlive, version: runtime.version
  };
}

function publicCaptureTask(def, runtime) {
  const site = publicOutpost(def, runtime);
  return {
    id: `capture:${site.id}`, siteId: site.id, title: 'Захват аванпоста',
    phase: site.bossAlive ? 'defeatBoss' : 'hold',
    ownerFaction: site.ownerFaction, captureFaction: site.captureFaction,
    progressPercent: site.capturePercent, requiredSeconds: CAPTURE_MS / 1000,
    bossAlive: site.bossAlive, version: site.version
  };
}

module.exports = { CAPTURE_MS, normalizeCatalog, normalizeState, serializeState, setBossAlive, tickOutpost, scaleDefenderHealth, publicOutpost, publicCaptureTask, within };
