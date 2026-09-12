'use strict';

// Server-owned support mechanics. Time is injected so expiry and reconnects can
// be tested without sleeping; no client-provided status fields are accepted.
const RULES = Object.freeze({
  hydrationPerMinute: 1, waterRestore: 40, foodHeal: 10,
  stimDurationMs: 10000, stimApRegenPct: 0.2,
  wetDurationMs: 30000, stunDurationMs: 1200, stunCooldownMs: 5000,
  traceDurationMs: 5000, footstepDistance: 1.8, footstepRadius: 14
});
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function sanitizeArtifactRuntime(input = {}, now = Date.now()) {
  const src = input && typeof input === 'object' ? input : {};
  const until = (key, limit) => clamp(number(src[key]), 0, now + limit);
  return {
    hydration: clamp(number(src.hydration, 100), 0, 100),
    stimUntil: until('stimUntil', RULES.stimDurationMs * 2),
    wetUntil: until('wetUntil', RULES.wetDurationMs),
    stunnedUntil: until('stunnedUntil', RULES.stunDurationMs),
    stunCooldownUntil: until('stunCooldownUntil', RULES.stunCooldownMs)
  };
}

function runtime(player) {
  if (!player.artifactRuntime) player.artifactRuntime = sanitizeArtifactRuntime();
  return player.artifactRuntime;
}

function isArtifactStunned(player, now = Date.now()) {
  return number(player.artifactRuntime?.stunnedUntil) > now;
}

function artifactApMultiplier(player, now = Date.now()) {
  const state = runtime(player);
  return (state.hydration <= 0 ? 0.75 : 1)
    * (state.stimUntil > now ? 1 + RULES.stimApRegenPct : 1);
}

function startArtifactStim(player, effects = {}, now = Date.now()) {
  // Refresh, never stack. The recipient's belt determines the duration.
  runtime(player).stimUntil = now + RULES.stimDurationMs * (1 + clamp(number(effects.stimDurationPct), 0, 1));
}

function consumableProblem(player, itemId, effects = {}) {
  if (itemId === 'water') return runtime(player).hydration >= 100 ? 'Запас воды в организме полный.' : '';
  if (itemId === 'food') {
    if (effects.flags?.foodHealingDisabled) return 'Роса не позволяет восстанавливать здоровье едой.';
    return number(player.hp) >= number(player.maxHp, 100) ? 'Персонаж уже здоров.' : '';
  }
  return 'Этот предмет нельзя употребить.';
}

function consumeArtifactProvision(player, itemId, effects = {}) {
  const error = consumableProblem(player, itemId, effects);
  if (error) return { ok: false, error };
  const before = number(player.hp);
  const state = runtime(player);
  const hydrationBefore = state.hydration;
  if (itemId === 'water') state.hydration = Math.min(100, state.hydration + RULES.waterRestore);
  else player.hp = Math.min(number(player.maxHp, 100), before + RULES.foodHeal);
  return { ok: true, healed: number(player.hp) - before, hydrated: state.hydration - hydrationBefore };
}

function tickArtifactRuntime(player, effects = {}, wet = false, now = Date.now()) {
  const state = runtime(player);
  const dt = clamp((now - number(player.lastArtifactRuntimeAt, now)) / 1000, 0, 2.5);
  player.lastArtifactRuntimeAt = now;
  if (player.dead || player.downed || player.onGlobalMap) return;
  state.hydration = Math.max(0, state.hydration - dt * RULES.hydrationPerMinute / 60
    * (1 + clamp(number(effects.waterUsePct), -0.5, 1.5)));
  if (wet) state.wetUntil = now + RULES.wetDurationMs;
}

function applyArtifactElectricHit(player, damageType, effects = {}, now = Date.now()) {
  const state = runtime(player);
  if (damageType !== 'electric' || !effects.flags?.wetElectricStun || state.wetUntil <= now
    || state.stunCooldownUntil > now || player.dead || number(player.hp) <= 0) return false;
  state.stunnedUntil = now + RULES.stunDurationMs;
  state.stunCooldownUntil = now + RULES.stunCooldownMs;
  player.input = { forward: 0, right: 0 };
  player.vx = player.vz = 0;
  player.moving = false;
  return true;
}

function isWetEnvironment(player, fields = [], zones = []) {
  return [...fields.filter(row => row.type === 'dew'), ...zones].some(row =>
    Math.hypot(number(player.x) - number(row.x), number(player.z) - number(row.z)) <= Math.max(0, number(row.radius)));
}

function displaceArtifactPlayer(player, source, meters, effects = {}, moveAllowed = () => false) {
  // Positive pushes away, negative pulls in. Substeps prevent tunnelling through
  // thin collision and stop at a wall instead of teleporting through it.
  const dx = number(player.x) - number(source.x), dz = number(player.z) - number(source.z);
  const distance = Math.hypot(dx, dz);
  if (distance < 0.001) return 0;
  let amount = number(meters) * (1 - clamp(number(effects.knockbackResistance), 0, 0.8));
  if (amount < 0) amount = -Math.min(-amount, distance);
  amount = clamp(amount, -4, 4);
  const steps = Math.ceil(Math.abs(amount) / 0.15);
  let moved = 0;
  for (let i = 0; i < steps; i++) {
    const x = player.x + dx / distance * amount / steps;
    const z = player.z + dz / distance * amount / steps;
    if (!moveAllowed(player.x, player.z, x, z)) break;
    moved += Math.hypot(x - player.x, z - player.z);
    player.x = x; player.z = z;
  }
  return moved;
}

function artifactFootstep(player, effects = {}, now = Date.now()) {
  const previous = player.artifactFootstepPosition;
  player.artifactFootstepPosition = { x: player.x, z: player.z, roomId: player.roomId };
  if (!previous || previous.roomId !== player.roomId || player.onGlobalMap || player.dead || player.downed) {
    player.artifactStepDistance = 0;
    return 0;
  }
  const distance = Math.hypot(player.x - previous.x, player.z - previous.z);
  if (distance > 3) { player.artifactStepDistance = 0; return 0; }
  player.artifactStepDistance = number(player.artifactStepDistance) + distance;
  if (player.artifactStepDistance < RULES.footstepDistance || now - number(player.lastArtifactStepAt) < 250) return 0;
  player.artifactStepDistance %= RULES.footstepDistance;
  player.lastArtifactStepAt = now;
  return RULES.footstepRadius * (player.crouching ? 0.4 : 1)
    * (1 + clamp(number(effects.movementNoisePct), -0.8, 1));
}

function publicArtifactRuntime(player, now = Date.now()) {
  const state = runtime(player);
  return {
    hydration: Math.round(state.hydration * 10) / 10,
    stimSeconds: Math.max(0, (state.stimUntil - now) / 1000),
    wetSeconds: Math.max(0, (state.wetUntil - now) / 1000),
    stunSeconds: Math.max(0, (state.stunnedUntil - now) / 1000)
  };
}

module.exports = { RULES, sanitizeArtifactRuntime, isArtifactStunned, artifactApMultiplier,
  startArtifactStim, consumableProblem, consumeArtifactProvision, tickArtifactRuntime,
  applyArtifactElectricHit, isWetEnvironment, displaceArtifactPlayer, artifactFootstep, publicArtifactRuntime };
