'use strict';

// Городская живность. В мирном городе нет логов зверей, а шкура — ресурс,
// который снимают только с туши. Поэтому внутри стен каждого города живёт
// несколько мирных зверьков: в городе можно бить только их, с туши снимают
// шкуру тира города, а убитый зверёк возвращается на своё место через
// respawnSeconds. Зверёк не отвечает на удар и остаётся на месте.
// Модуль чистый: места и сроки считает он, спавнит и водит зверьков сервер.

const SCHEMA = 'kromka.cityCritters.v1';

function safeId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function normalizeCityCritters(raw = {}) {
  if (raw.schema && raw.schema !== SCHEMA) throw new Error(`City critters schema must be ${SCHEMA}`);
  const species = safeId(raw.species);
  if (!species) throw new Error('City critters need a species');
  const qty = Array.isArray(raw.hideQty) ? raw.hideQty : [1, 2];
  const hideMin = Math.floor(finite(qty[0], 1, 1, 20));
  return Object.freeze({
    schema: SCHEMA,
    species,
    perCity: Math.floor(finite(raw.perCity, 6, 0, 24)),
    respawnMs: Math.round(finite(raw.respawnSeconds, 180, 5, 3600) * 1000),
    hideQty: Object.freeze([hideMin, Math.max(hideMin, Math.floor(finite(qty[1], hideMin, 1, 20)))]),
    spacingTiles: finite(raw.spacingTiles, 7, 1, 40),
    keepClearTiles: finite(raw.keepClearTiles, 6, 0, 40),
    wanderRadius: finite(raw.wanderRadius, 3.5, 0.5, 20),
    startleMs: Math.round(finite(raw.startleSeconds, 3.5, 0.5, 30) * 1000),
    minPlayerDistance: finite(raw.minPlayerDistance, 6, 0, 40)
  });
}

/** Детерминированное число в [0, 1) по строке (FNV-1a). */
function hash01(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash / 4294967296;
}

/**
 * Места зверьков города из годных клеток {tx, tz}: не больше perCity и не
 * ближе spacingTiles друг к другу. Порядок перебора задаёт хеш города и
 * клетки, поэтому тот же город всегда получает те же места.
 */
function planSlots(config, cityId, candidates = [], isValid = () => true) {
  const ordered = candidates
    .filter(tile => Number.isFinite(Number(tile?.tx)) && Number.isFinite(Number(tile?.tz)))
    .map(tile => ({ tx: Number(tile.tx), tz: Number(tile.tz), order: hash01(`${cityId}:${tile.tx}:${tile.tz}`) }))
    .sort((a, b) => a.order - b.order || a.tx - b.tx || a.tz - b.tz);
  const slots = [];
  for (const tile of ordered) {
    if (slots.length >= config.perCity) break;
    if (slots.some(slot => Math.hypot(slot.tx - tile.tx, slot.tz - tile.tz) < config.spacingTiles)) continue;
    if (!isValid(tile)) continue;
    slots.push({ id: `critter_${slots.length + 1}`, tx: tile.tx, tz: tile.tz, enemyId: '', respawnAt: 0 });
  }
  return slots;
}

/**
 * Слоты, которые пора заселить. lookup(enemyId) отвечает про зверька слота:
 * null — его уже нет в комнате, иначе {alive, diedAt}. Пустой слот заселяется
 * сразу, а слот погибшего или пропавшего зверька — через respawnMs после
 * смерти (после того, как пропажу заметили). Отсчёт хранится в самом слоте.
 */
function dueSlots(config, slots = [], lookup = () => null, now = Date.now()) {
  const due = [];
  for (const slot of slots) {
    if (!slot.enemyId) {
      due.push(slot);
      continue;
    }
    const state = lookup(slot.enemyId);
    if (state?.alive) {
      slot.respawnAt = 0;
      continue;
    }
    if (!(Number(slot.respawnAt) > 0)) {
      const diedAt = Number(state?.diedAt || 0);
      slot.respawnAt = (diedAt > 0 ? Math.min(diedAt, now) : now) + config.respawnMs;
    }
    if (now >= slot.respawnAt) due.push(slot);
  }
  return due;
}

/** Сколько шкур в туше зверька; roll01 — случайное число в [0, 1). */
function hideCharges(config, roll01) {
  const [min, max] = config.hideQty;
  return min + Math.min(max - min, Math.floor(Number(roll01 || 0) * (max - min + 1)));
}

module.exports = {
  SCHEMA,
  normalizeCityCritters,
  planSlots,
  dueSlots,
  hideCharges
};
