'use strict';

function hash32(value = '') {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createShiftCycle(config = {}, options = {}) {
  const epochMs = Number(options.epochMs || 0);
  const cycleMs = Math.max(60000, Number(config.cycleMs || 7200000));
  const warningMs = Math.min(cycleMs * 0.4, Math.max(10000, Number(config.warningMs || 600000)));
  const activeMs = Math.min(cycleMs * 0.3, Math.max(10000, Number(config.activeMs || 240000)));
  const afterglowMs = Math.min(cycleMs * 0.4, Math.max(10000, Number(config.afterglowMs || 1200000)));

  function state(now = Date.now()) {
    const elapsed = Math.max(0, Number(now) - epochMs);
    const cycleIndex = Math.floor(elapsed / cycleMs);
    const offset = elapsed % cycleMs;
    const warningStart = cycleMs - warningMs - activeMs - afterglowMs;
    const activeStart = warningStart + warningMs;
    const afterglowStart = activeStart + activeMs;
    let phase = 'calm';
    let phaseStartedAt = epochMs + cycleIndex * cycleMs;
    let phaseEndsAt = epochMs + cycleIndex * cycleMs + warningStart;
    if (offset >= warningStart && offset < activeStart) {
      phase = 'warning'; phaseStartedAt = epochMs + cycleIndex * cycleMs + warningStart; phaseEndsAt = epochMs + cycleIndex * cycleMs + activeStart;
    } else if (offset >= activeStart && offset < afterglowStart) {
      phase = 'active'; phaseStartedAt = epochMs + cycleIndex * cycleMs + activeStart; phaseEndsAt = epochMs + cycleIndex * cycleMs + afterglowStart;
    } else if (offset >= afterglowStart) {
      phase = 'afterglow'; phaseStartedAt = epochMs + cycleIndex * cycleMs + afterglowStart; phaseEndsAt = epochMs + (cycleIndex + 1) * cycleMs;
    }
    const shiftId = `shift_${cycleIndex}`;
    return {
      shiftId,
      cycleIndex,
      strength: 1 + hash32(shiftId) % 3,
      phase,
      phaseStartedAt,
      phaseEndsAt,
      remainingMs: Math.max(0, phaseEndsAt - Number(now)),
      nextShiftAt: epochMs + cycleIndex * cycleMs + activeStart,
      serverNow: Number(now)
    };
  }

  return { state, cycleMs, warningMs, activeMs, afterglowMs };
}

module.exports = { createShiftCycle, hash32 };
